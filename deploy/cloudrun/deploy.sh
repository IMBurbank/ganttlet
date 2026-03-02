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

set -euo pipefail

# --- Configuration (override via environment) ---

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to your GCP project}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-ganttlet-relay}"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Comma-separated list of allowed CORS origins for the relay server.
# In production, set this to your frontend URL(s).
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com}"

# Minimum and maximum instances. Cloud Run can scale to zero by default.
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"

# Memory and CPU allocation
MEMORY="${MEMORY:-256Mi}"
CPU="${CPU:-1}"

# --- Build ---

echo "==> Building container image with Cloud Build..."
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="${IMAGE_NAME}" \
  --timeout=600 \
  /workspace

# --- Deploy ---

echo "==> Deploying to Cloud Run (${REGION})..."
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE_NAME}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=4000 \
  --memory="${MEMORY}" \
  --cpu="${CPU}" \
  --min-instances="${MIN_INSTANCES}" \
  --max-instances="${MAX_INSTANCES}" \
  --set-env-vars="RELAY_ALLOWED_ORIGINS=${ALLOWED_ORIGINS},RUST_LOG=info" \
  --use-http2 \
  --session-affinity

# --- Output ---

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')

echo ""
echo "==> Deployment complete!"
echo "    Service URL: ${SERVICE_URL}"
echo ""
echo "    Set this in your .env (use wss:// for WebSocket):"
echo "    VITE_COLLAB_URL=wss://$(echo "${SERVICE_URL}" | sed 's|https://||')"
echo ""
