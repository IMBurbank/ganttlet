#!/usr/bin/env bash
# Enable Identity-Aware Proxy for Cloud Run services.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"

echo "==> Enabling IAP API..."
gcloud services enable iap.googleapis.com --project="${PROJECT_ID}"

echo ""
echo "IAP setup steps (manual):"
echo "1. Go to: https://console.cloud.google.com/security/iap?project=${PROJECT_ID}"
echo "2. Enable IAP for each Cloud Run service"
echo "3. Add authorized users/groups"
echo "4. Configure OAuth consent screen if not already done"
echo ""
echo "For automated setup, use 'gcloud iap web enable' after configuring a backend service."
