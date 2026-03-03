#!/usr/bin/env bash
# deploy.sh — Unified deploy orchestrator for Ganttlet.
#
# Delegates to existing scripts: setup.sh, cloudrun/deploy.sh,
# frontend/deploy.sh, cloudrun/update-cors.sh.
#
# Usage:
#   source deploy/deploy.sh                       # full deploy
#   source deploy/deploy.sh --project "My Proj"   # skip project prompt
#   source deploy/deploy.sh --frontend-only       # redeploy frontend only
#   source deploy/deploy.sh --relay-only          # redeploy relay only
#   source deploy/deploy.sh --cors-only           # update CORS only
#
# Must be run from the repository root (deploy/setup.sh must exist).

# NOTE: Do not use `set -e` here. This script is `source`d into interactive
# shells so env vars propagate. With `set -e`, any failure kills the session.
set -uo pipefail

# ── Flag parsing ─────────────────────────────────────────────────────────────

DEPLOY_RELAY=true
DEPLOY_FRONTEND=true
DEPLOY_CORS=true
PROJECT_ARG=""

for arg in "$@"; do
  case "$arg" in
    --relay-only)
      DEPLOY_RELAY=true
      DEPLOY_FRONTEND=false
      DEPLOY_CORS=false
      ;;
    --frontend-only)
      DEPLOY_RELAY=false
      DEPLOY_FRONTEND=true
      DEPLOY_CORS=false
      ;;
    --cors-only)
      DEPLOY_RELAY=false
      DEPLOY_FRONTEND=false
      DEPLOY_CORS=true
      ;;
    --project)
      # Next arg will be captured below
      ;;
    *)
      # Capture project name (follows --project or is a positional arg)
      if [[ "${PREV_ARG:-}" == "--project" ]]; then
        PROJECT_ARG="$arg"
      fi
      ;;
  esac
  PREV_ARG="$arg"
done

# ── Verify working directory ─────────────────────────────────────────────────

if [[ ! -f "deploy/setup.sh" ]]; then
  echo "ERROR: deploy/setup.sh not found. Run this script from the repository root."
  return 1 2>/dev/null || exit 1
fi

# ── Setup: resolve PROJECT_ID ────────────────────────────────────────────────

if [[ -z "${PROJECT_ID:-}" ]]; then
  echo ""
  echo "==> Running project setup..."
  if [[ -n "$PROJECT_ARG" ]]; then
    source deploy/setup.sh "$PROJECT_ARG"
  else
    source deploy/setup.sh
  fi
  echo ""
fi

REGION="${REGION:-us-central1}"

# ── Detect existing services ─────────────────────────────────────────────────

echo "==> Checking for existing Cloud Run services..."
EXISTING_SERVICES=$(gcloud run services list \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(metadata.name)" 2>/dev/null || true)

RELAY_EXISTS=false
FRONTEND_EXISTS=false

if echo "$EXISTING_SERVICES" | grep -q "ganttlet-relay"; then
  RELAY_EXISTS=true
  echo "    Found: ganttlet-relay"
fi
if echo "$EXISTING_SERVICES" | grep -q "ganttlet-frontend"; then
  FRONTEND_EXISTS=true
  echo "    Found: ganttlet-frontend"
fi

# If setup.sh just created the project, it already paused for manual setup.
# Only show the prompt here if the project existed but has no services yet.
if [[ "$RELAY_EXISTS" == "false" && "$FRONTEND_EXISTS" == "false" && "${SETUP_CREATED_PROJECT:-}" != "true" ]]; then
  echo "    No existing services found — this looks like a first deploy."
  echo ""
  echo "    Before deploying, complete the Cloud Console Setup steps in deploy/README.md:"
  echo ""
  echo "      1. Link a billing account"
  echo "         https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}"
  echo ""
  echo "      2. Configure the OAuth consent screen"
  echo "         https://console.cloud.google.com/apis/credentials/consent?project=${PROJECT_ID}"
  echo ""
  echo "      3. Create an OAuth client ID"
  echo "         https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"
  echo ""
  echo "    See deploy/README.md § 'Cloud Console Setup' for detailed instructions."
  echo ""
  read -rp "Press Enter once you've completed these steps (or Ctrl-C to abort)..."
  echo ""
fi

# ── Resolve GOOGLE_CLIENT_ID ─────────────────────────────────────────────────

if [[ -z "${GOOGLE_CLIENT_ID:-}" ]]; then
  # Try to extract from existing .env.production
  if [[ -f ".env.production" ]]; then
    EXTRACTED=$(grep 'VITE_GOOGLE_CLIENT_ID=' .env.production 2>/dev/null | cut -d= -f2- || true)
    if [[ -n "$EXTRACTED" ]]; then
      export GOOGLE_CLIENT_ID="$EXTRACTED"
      echo "==> GOOGLE_CLIENT_ID recovered from .env.production"
    fi
  fi
fi

if [[ -z "${GOOGLE_CLIENT_ID:-}" && "$DEPLOY_FRONTEND" == "true" ]]; then
  echo ""
  echo "GOOGLE_CLIENT_ID is not set. The frontend needs it for Google Sign-In."
  read -rp "Enter your OAuth Client ID (or press Enter to skip): " CLIENT_ID_INPUT
  if [[ -n "$CLIENT_ID_INPUT" ]]; then
    export GOOGLE_CLIENT_ID="$CLIENT_ID_INPUT"
    echo "==> GOOGLE_CLIENT_ID set."
  else
    echo "    Skipped — Google Sign-In will be disabled."
  fi
  echo ""
fi

# ── Recover RELAY_URL from existing service ──────────────────────────────────

if [[ -z "${RELAY_URL:-}" && "$RELAY_EXISTS" == "true" ]]; then
  RELAY_URL=$(gcloud run services describe ganttlet-relay \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='value(status.url)' 2>/dev/null || true)
  if [[ -n "$RELAY_URL" ]]; then
    export RELAY_URL
    echo "==> RELAY_URL recovered from existing service: ${RELAY_URL}"
  fi
fi

# ── Recover FRONTEND_URL from existing service ───────────────────────────────

if [[ -z "${FRONTEND_URL:-}" && "$FRONTEND_EXISTS" == "true" ]]; then
  FRONTEND_URL=$(gcloud run services describe ganttlet-frontend \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='value(status.url)' 2>/dev/null || true)
  if [[ -n "$FRONTEND_URL" ]]; then
    export FRONTEND_URL
    echo "==> FRONTEND_URL recovered from existing service: ${FRONTEND_URL}"
  fi
fi

# ── Deploy relay server ──────────────────────────────────────────────────────

if [[ "$DEPLOY_RELAY" == "true" ]]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Deploying relay server"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  source deploy/cloudrun/deploy.sh
fi

# ── Deploy frontend ──────────────────────────────────────────────────────────

if [[ "$DEPLOY_FRONTEND" == "true" ]]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Deploying frontend"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  source deploy/frontend/deploy.sh
fi

# ── Update CORS ──────────────────────────────────────────────────────────────

if [[ "$DEPLOY_CORS" == "true" ]]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Updating relay server CORS"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  # Prevent SERVICE_NAME leak from frontend deploy (it defaults to ganttlet-relay in update-cors.sh)
  unset SERVICE_NAME
  source deploy/cloudrun/update-cors.sh
  # Restore default shell options — update-cors.sh uses set -uo pipefail
  set +u 2>/dev/null || true
  set -uo pipefail
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Deployment complete                                             ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
if [[ -n "${RELAY_URL:-}" ]]; then
  echo "║  Relay:    ${RELAY_URL}"
fi
if [[ -n "${FRONTEND_URL:-}" ]]; then
  echo "║  Frontend: ${FRONTEND_URL}"
fi
echo "║                                                                  ║"

# Check if this was a first deploy (we need to remind about OAuth redirect URIs)
if [[ "$RELAY_EXISTS" == "false" || "$FRONTEND_EXISTS" == "false" ]]; then
  echo "║  Remaining manual step:                                         ║"
  echo "║  Add your frontend URL to OAuth redirect URIs:                  ║"
  echo "║  https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"
  echo "║                                                                  ║"
  echo "║  Add ${FRONTEND_URL:-<frontend-url>} to:"
  echo "║    - Authorized JavaScript origins                              ║"
  echo "║    - Authorized redirect URIs                                   ║"
fi
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
