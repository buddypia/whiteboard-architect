#!/usr/bin/env bash
# deploy.sh - Full deployment pipeline for Whiteboard Architect
# Usage: ./deploy.sh --project <GCP_PROJECT_ID> [--region <REGION>]
set -euo pipefail

# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
PROJECT_ID=""
REGION="us-central1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)  PROJECT_ID="$2"; shift 2 ;;
    --region)   REGION="$2";     shift 2 ;;
    *)          err "Unknown flag: $1"; exit 1 ;;
  esac
done

# Source .env if present
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  info "Loading environment from .env"
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
  set +a
fi

# Fallback to env vars if flags not provided
PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
REGION="${REGION:-us-central1}"
GOOGLE_API_KEY="${GOOGLE_API_KEY:-${GEMINI_API_KEY:-}}"

if [[ -z "$PROJECT_ID" ]]; then
  err "Project ID is required. Use --project <ID> or set GOOGLE_CLOUD_PROJECT in .env"
  exit 1
fi

if [[ -z "$GOOGLE_API_KEY" ]]; then
  err "GOOGLE_API_KEY must be set in .env or as an environment variable"
  exit 1
fi

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/whiteboard-architect"
BACKEND_IMAGE="${REGISTRY}/backend:latest"
FRONTEND_IMAGE="${REGISTRY}/frontend:latest"
TF_DIR="${SCRIPT_DIR}/infra/terraform"

echo ""
echo "=============================================="
echo "  Whiteboard Architect - Deployment Pipeline"
echo "=============================================="
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "  Registry: ${REGISTRY}"
echo "=============================================="
echo ""

# ============================================================================
# Phase 1/5: Setup - Verify gcloud auth and configure project
# ============================================================================
info "Phase 1/5: Setup"

if ! command -v gcloud &>/dev/null; then
  err "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || true)
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  err "No active gcloud account. Run: gcloud auth login"
  exit 1
fi
ok "Authenticated as ${ACTIVE_ACCOUNT}"

gcloud config set project "${PROJECT_ID}" --quiet
gcloud config set run/region "${REGION}" --quiet
ok "Project set to ${PROJECT_ID}, region ${REGION}"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
ok "Docker configured for Artifact Registry"

# ============================================================================
# Phase 2/5: Infrastructure - Provision base GCP resources
# ============================================================================
info "Phase 2/5: Infrastructure (APIs, Registry, SA, Secrets, Firestore, Storage)"

cd "${TF_DIR}"

cat > terraform.tfvars <<EOF
project_id     = "${PROJECT_ID}"
region         = "${REGION}"
gemini_api_key = "${GOOGLE_API_KEY}"
backend_image  = "${BACKEND_IMAGE}"
frontend_image = "${FRONTEND_IMAGE}"
EOF
ok "Generated terraform.tfvars"

terraform init -input=false

# Deploy only base resources (no Cloud Run yet - images not built)
terraform apply -input=false -auto-approve \
  -target='google_project_service.apis' \
  -target='google_artifact_registry_repository.repo' \
  -target='google_service_account.backend' \
  -target='google_project_iam_member.backend_firestore' \
  -target='google_project_iam_member.backend_storage' \
  -target='google_project_iam_member.backend_secret_accessor' \
  -target='google_secret_manager_secret.gemini_api_key' \
  -target='google_secret_manager_secret_version.gemini_api_key' \
  -target='google_firestore_database.default' \
  -target='google_storage_bucket.snapshots'

ok "Base infrastructure provisioned"

# ============================================================================
# Phase 3/5: Build - Parallel Cloud Build for backend and frontend
# ============================================================================
info "Phase 3/5: Cloud Build (backend + frontend in parallel)"

cd "${SCRIPT_DIR}"

# Backend build (background)
gcloud builds submit ./backend \
  --tag "${BACKEND_IMAGE}" \
  --project "${PROJECT_ID}" \
  --quiet &
PID_BACKEND=$!

# Frontend build (background) - no build-args needed; URL injected at runtime
gcloud builds submit ./frontend \
  --tag "${FRONTEND_IMAGE}" \
  --project "${PROJECT_ID}" \
  --quiet &
PID_FRONTEND=$!

# Wait for both builds
FAILED=0
if ! wait "$PID_BACKEND"; then
  err "Backend build failed"
  FAILED=1
fi
if ! wait "$PID_FRONTEND"; then
  err "Frontend build failed"
  FAILED=1
fi
if [[ "$FAILED" -ne 0 ]]; then
  err "One or more builds failed. Aborting."
  exit 1
fi

ok "Both images built and pushed via Cloud Build"

# ============================================================================
# Phase 4/5: Deploy - Single terraform apply for all Cloud Run services
# ============================================================================
info "Phase 4/5: Deploy all services"

cd "${TF_DIR}"

# Single apply: Terraform resolves dependency order automatically
# (backend deploys first → frontend gets backend URI via env var)
terraform apply -input=false -auto-approve

BACKEND_URL=$(terraform output -raw backend_url)
FRONTEND_URL=$(terraform output -raw frontend_url)

ok "Backend  deployed at ${BACKEND_URL}"
ok "Frontend deployed at ${FRONTEND_URL}"

# ============================================================================
# Phase 5/5: CORS - Update backend with frontend origin
# ============================================================================
info "Phase 5/5: Update CORS origins"

if grep -q '^cors_origins' terraform.tfvars; then
  awk -v url="${FRONTEND_URL}" '/^cors_origins/{$0="cors_origins     = \""url"\""}1' terraform.tfvars > terraform.tfvars.tmp \
    && mv terraform.tfvars.tmp terraform.tfvars
else
  echo "cors_origins     = \"${FRONTEND_URL}\"" >> terraform.tfvars
fi

terraform apply -input=false -auto-approve \
  -target='google_cloud_run_v2_service.backend'

ok "CORS origins updated to ${FRONTEND_URL}"

echo ""
echo "=============================================="
echo -e "  ${GREEN}Deployment Complete!${NC}"
echo "=============================================="
echo "  Frontend : ${FRONTEND_URL}"
echo "  Backend  : ${BACKEND_URL}"
echo "  SA       : $(terraform output -raw backend_service_account)"
echo "  Bucket   : $(terraform output -raw storage_bucket_name)"
echo "  Registry : $(terraform output -raw artifact_registry_repo)"
echo "=============================================="
echo ""
