#!/usr/bin/env bash
# NOTE: Do not use `set -e` here. These deploy scripts are typically `source`d
# so that env vars like FRONTEND_URL propagate to the caller. With `set -e`,
# any command failure would kill the interactive shell session.
set -uo pipefail

# If PROJECT_ID is not set, run interactive setup
if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "PROJECT_ID not set. Running setup..."
  # shellcheck source=../setup.sh
  source "$(dirname "$0")/../setup.sh" --skip-apis
fi
REGION="${REGION:-us-central1}"
SERVICE_NAME="ganttlet-frontend"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Write .env.production from env vars if available
if [[ -n "${RELAY_URL:-}" ]]; then
  RELAY_WSS="wss://$(echo "${RELAY_URL}" | sed 's|https://||')"
  echo "VITE_COLLAB_URL=${RELAY_WSS}" > .env.production
  echo "==> Wrote VITE_COLLAB_URL=${RELAY_WSS}"
else
  if [[ ! -f .env.production ]]; then
    echo "WARNING: RELAY_URL not set and .env.production not found."
    echo "         The frontend will build without a collab server URL."
    echo "         Set RELAY_URL or create .env.production manually."
  fi
fi

if [[ -n "${GOOGLE_CLIENT_ID:-}" ]]; then
  echo "VITE_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}" >> .env.production
  echo "==> Wrote VITE_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"
elif ! grep -q 'VITE_GOOGLE_CLIENT_ID' .env.production 2>/dev/null; then
  echo "WARNING: GOOGLE_CLIENT_ID not set and not found in .env.production."
  echo "         Google Sign-In will be disabled."
  echo "         Set GOOGLE_CLIENT_ID or add VITE_GOOGLE_CLIENT_ID to .env.production."
fi

echo "==> .env.production:"
cat .env.production

echo "==> Building container image with Cloud Build..."
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --config="deploy/frontend/cloudbuild.yaml" \
  --substitutions="_IMAGE_NAME=${IMAGE_NAME}" \
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
  --max-instances=10

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')

# Export the frontend URL so subsequent pipeline steps can use it
export FRONTEND_URL="${SERVICE_URL}"

echo ""
echo "==> Frontend deployment complete!"
echo "    URL: ${SERVICE_URL}"
echo ""
echo "    FRONTEND_URL exported. Use it to set ALLOWED_ORIGINS for the relay server."
echo ""
