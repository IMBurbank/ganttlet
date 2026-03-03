#!/usr/bin/env bash
# Update the relay server's ALLOWED_ORIGINS without a full rebuild.
#
# Usage:
#   ALLOWED_ORIGINS=https://my-frontend.run.app ./deploy/cloudrun/update-cors.sh
#   # Or with FRONTEND_URL already exported from frontend deploy:
#   source deploy/cloudrun/update-cors.sh
# NOTE: Do not use `set -e` here. This script may be `source`d by the unified
# deploy script. With `set -e`, the flag leaks into the parent shell and any
# subsequent command failure would kill the interactive session.
set -uo pipefail

# If PROJECT_ID is not set, run interactive setup
if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "PROJECT_ID not set. Running setup..."
  # shellcheck source=../setup.sh
  source "$(dirname "$0")/../setup.sh" --skip-apis
fi

REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-ganttlet-relay}"

# Resolve ALLOWED_ORIGINS from FRONTEND_URL if not explicitly set
if [[ -z "${ALLOWED_ORIGINS:-}" && -n "${FRONTEND_URL:-}" ]]; then
  ALLOWED_ORIGINS="${FRONTEND_URL}"
fi

if [[ -z "${ALLOWED_ORIGINS:-}" ]]; then
  echo "ERROR: Set ALLOWED_ORIGINS or FRONTEND_URL before running this script."
  return 1 2>/dev/null || exit 1
fi

echo "==> Updating relay server CORS origins..."
echo "    ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"

gcloud run services update "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="RELAY_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"

echo ""
echo "==> CORS origins updated."
if [[ -n "${FRONTEND_URL:-}" ]]; then
  echo ""
  echo "    Next step — add this URL to OAuth redirect URIs in Google Cloud Console:"
  echo "    ${FRONTEND_URL}"
fi
echo ""
