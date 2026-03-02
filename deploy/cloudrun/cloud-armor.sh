#!/usr/bin/env bash
# Configure Cloud Armor security policy for the frontend.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
POLICY_NAME="${POLICY_NAME:-ganttlet-waf}"

echo "==> Creating Cloud Armor security policy..."
gcloud compute security-policies create "${POLICY_NAME}" \
  --project="${PROJECT_ID}" \
  --description="Ganttlet WAF policy" \
  2>/dev/null || echo "Policy already exists"

echo "==> Adding rate limiting rule..."
gcloud compute security-policies rules create 1000 \
  --security-policy="${POLICY_NAME}" \
  --project="${PROJECT_ID}" \
  --expression="true" \
  --action=throttle \
  --rate-limit-threshold-count=100 \
  --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  2>/dev/null || echo "Rate limit rule already exists"

echo "==> Adding OWASP CRS rules..."
gcloud compute security-policies rules create 2000 \
  --security-policy="${POLICY_NAME}" \
  --project="${PROJECT_ID}" \
  --expression="evaluatePreconfiguredWaf('sqli-v33-stable')" \
  --action=deny-403 \
  2>/dev/null || echo "SQLi rule already exists"

gcloud compute security-policies rules create 2001 \
  --security-policy="${POLICY_NAME}" \
  --project="${PROJECT_ID}" \
  --expression="evaluatePreconfiguredWaf('xss-v33-stable')" \
  --action=deny-403 \
  2>/dev/null || echo "XSS rule already exists"

echo ""
echo "==> Cloud Armor policy '${POLICY_NAME}' configured."
echo "    Apply to a backend service with:"
echo "    gcloud compute backend-services update SERVICE_NAME --security-policy=${POLICY_NAME}"
