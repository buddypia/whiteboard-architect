output "backend_url" {
  description = "Backend Cloud Run service URL"
  value       = google_cloud_run_v2_service.backend.uri
}

output "frontend_url" {
  description = "Frontend Cloud Run service URL"
  value       = google_cloud_run_v2_service.frontend.uri
}

output "artifact_registry_repo" {
  description = "Artifact Registry repository path"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
}

output "storage_bucket_name" {
  description = "Cloud Storage bucket for whiteboard snapshots"
  value       = google_storage_bucket.snapshots.name
}

output "backend_service_account" {
  description = "Backend service account email"
  value       = google_service_account.backend.email
}
