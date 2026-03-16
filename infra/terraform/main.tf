terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "storage.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "secretmanager.googleapis.com",
  ]

  labels = {
    app     = "whiteboard-architect"
    managed = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Enable required GCP APIs
# ---------------------------------------------------------------------------

resource "google_project_service" "apis" {
  for_each = toset(local.apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Artifact Registry
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "whiteboard-architect"
  format        = "DOCKER"
  description   = "Docker images for Whiteboard Architect"
  labels        = local.labels

  depends_on = [google_project_service.apis]
}

# ---------------------------------------------------------------------------
# Service Account for backend
# ---------------------------------------------------------------------------

resource "google_service_account" "backend" {
  account_id   = "whiteboard-backend"
  display_name = "Whiteboard Architect Backend"
  project      = var.project_id

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "backend_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_storage" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# ---------------------------------------------------------------------------
# Secret Manager - Gemini API Key
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "gemini-api-key"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "gemini_api_key" {
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key
}

# ---------------------------------------------------------------------------
# Firestore (import existing; location may differ from var.region)
# ---------------------------------------------------------------------------

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = "nam5"
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.apis]

  lifecycle {
    ignore_changes = [location_id]
  }
}

# ---------------------------------------------------------------------------
# Cloud Storage - whiteboard snapshots
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "snapshots" {
  name          = "${var.project_id}-whiteboard-snapshots"
  location      = var.region
  force_destroy = true
  labels        = local.labels

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

# ---------------------------------------------------------------------------
# Cloud Run v2 - Backend
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "backend" {
  name     = "whiteboard-backend"
  location = var.region
  labels   = local.labels

  template {
    service_account = google_service_account.backend.email
    labels          = local.labels

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    session_affinity = true

    timeout = "3600s"

    containers {
      image = var.backend_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      # --- Google Cloud ---
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_REGION"
        value = var.region
      }
      env {
        name = "GOOGLE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_api_key.secret_id
            version = "latest"
          }
        }
      }

      # --- Gemini Model ---
      env {
        name  = "GEMINI_MODEL_NAME"
        value = var.gemini_model_name
      }

      # --- Storage ---
      env {
        name  = "GCS_BUCKET_NAME"
        value = google_storage_bucket.snapshots.name
      }
      env {
        name  = "FIRESTORE_DATABASE"
        value = "(default)"
      }

      # --- Background Analysis ---
      env {
        name  = "ANALYSIS_ENABLED"
        value = var.analysis_enabled ? "true" : "false"
      }
      env {
        name  = "ANALYSIS_INTERVAL_S"
        value = tostring(var.analysis_interval_s)
      }
      env {
        name  = "ANALYSIS_MODEL_NAME"
        value = var.analysis_model_name
      }
      env {
        name  = "ANALYSIS_THINKING_BUDGET"
        value = tostring(var.analysis_thinking_budget)
      }
      env {
        name  = "ANALYSIS_MEDIA_RESOLUTION"
        value = var.analysis_media_resolution
      }

      # --- CORS ---
      env {
        name  = "CORS_ORIGINS"
        value = var.cors_origins
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_artifact_registry_repository.repo,
    google_secret_manager_secret_version.gemini_api_key,
    google_project_iam_member.backend_secret_accessor,
  ]
}

# ---------------------------------------------------------------------------
# Cloud Run v2 - Frontend
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "frontend" {
  name     = "whiteboard-frontend"
  location = var.region
  labels   = local.labels

  template {
    labels = local.labels

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = var.frontend_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      # Runtime injection: entrypoint.sh replaces placeholders in built JS
      env {
        name  = "BACKEND_URL"
        value = google_cloud_run_v2_service.backend.uri
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_artifact_registry_repository.repo,
  ]
}

# ---------------------------------------------------------------------------
# IAM - Public access for both services
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
