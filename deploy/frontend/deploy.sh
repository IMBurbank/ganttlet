#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to your GCP project}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-ganttlet-frontend}"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "==> Building container image with Cloud Build..."
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="${IMAGE_NAME}" \
  --timeout=600 \
  /workspace

echo "==> Deploying to Cloud Run (${REGION})..."
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE_NAME}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=128Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --startup-probe-path=/healthz

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')

echo ""
echo "==> Frontend deployment complete!"
echo "    URL: ${SERVICE_URL}"
