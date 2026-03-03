#!/usr/bin/env bash
# Deploy the Ganttlet relay server to Google Cloud Run.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - A GCP project with Cloud Run API enabled
#   - Docker or gcloud builds enabled
#
# Usage:
#   ./deploy.sh                          # uses defaults
#   PROJECT_ID=my-proj REGION=us-east1 ./deploy.sh
#
# The script builds the container image using Cloud Build and deploys it
# to Cloud Run. Cloud Run automatically sets the PORT env var, which the
# relay server reads as a fallback when RELAY_PORT is not set.

# NOTE: Do not use `set -e` here. These deploy scripts are typically `source`d
# (not executed as subprocesses) so that env vars like RELAY_URL propagate to
# the caller. With `set -e`, any command failure would kill the interactive
# shell session. Instead, critical commands use explicit error checks below.
set -uo pipefail

# --- Configuration (override via environment) ---

# If PROJECT_ID is not set, run interactive setup
if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "PROJECT_ID not set. Running setup..."
  # shellcheck source=../setup.sh
  source "$(dirname "$0")/../setup.sh" --skip-apis
fi
REGION="${REGION:-us-central1}"
SERVICE_NAME="ganttlet-relay"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Comma-separated list of allowed CORS origins for the relay server.
# In production, set this to your frontend Cloud Run URL.
# Override with: ALLOWED_ORIGINS=https://your-domain.com ./deploy.sh
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"

# Minimum and maximum instances. Cloud Run can scale to zero by default.
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"

# Memory and CPU allocation
MEMORY="${MEMORY:-256Mi}"
CPU="${CPU:-1}"

# --- Build ---

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building container image with Cloud Build..."
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --config="deploy/cloudrun/cloudbuild.yaml" \
  --substitutions="_IMAGE_NAME=${IMAGE_NAME}" \
  /workspace

# --- Deploy ---

echo "==> Deploying to Cloud Run (${REGION})..."
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE_NAME}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --no-use-http2 \
  --memory="${MEMORY}" \
  --cpu="${CPU}" \
  --min-instances="${MIN_INSTANCES}" \
  --max-instances="${MAX_INSTANCES}" \
  --set-env-vars="^||^RELAY_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}||RUST_LOG=info" \
  --session-affinity

# --- Output ---

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')

# Export the relay URL so subsequent pipeline steps can use it
export RELAY_URL="${SERVICE_URL}"
RELAY_WSS="wss://$(echo "${SERVICE_URL}" | sed 's|https://||')"

echo ""
echo "==> Relay server deployment complete!"
echo "    Service URL: ${SERVICE_URL}"
echo "    WebSocket:   ${RELAY_WSS}"
echo ""
echo "    RELAY_URL exported. The frontend deploy script will use it automatically."
echo ""
