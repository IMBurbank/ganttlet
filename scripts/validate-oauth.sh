#!/usr/bin/env bash
# validate-oauth.sh — Validate OAuth client ID from a deployed frontend.
# Can be run standalone or as part of the deploy pipeline.
#
# Required env vars:
#   FRONTEND_URL — Deployed frontend URL (https://...)
#
# Optional env vars:
#   GOOGLE_CLIENT_ID — Override: validate this ID directly instead of fetching from config.js
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }
ok()  { echo "PASS: $*"; }

echo "=== OAuth Client ID Validation ==="

# Get client ID from config.js or env var
if [[ -n "${GOOGLE_CLIENT_ID:-}" ]]; then
  CLIENT_ID="$GOOGLE_CLIENT_ID"
  echo "Using CLIENT_ID from environment"
elif [[ -n "${FRONTEND_URL:-}" ]]; then
  echo "Fetching config from ${FRONTEND_URL}/config.js"
  BODY=$(curl -s "${FRONTEND_URL}/config.js")
  if ! echo "$BODY" | grep -q '__ganttlet_config'; then
    die "Runtime config missing __ganttlet_config"
  fi
  CLIENT_ID=$(echo "$BODY" | grep -oP 'googleClientId:"([^"]*)"' | head -1 | cut -d'"' -f2)
  if [[ -z "$CLIENT_ID" ]]; then
    die "googleClientId is empty in config.js — OAuth will not work"
  fi
else
  die "Set FRONTEND_URL or GOOGLE_CLIENT_ID"
fi

echo "Client ID: ${CLIENT_ID}"

# Validate 1: Format check (should end with .apps.googleusercontent.com)
if ! echo "$CLIENT_ID" | grep -qP '\.apps\.googleusercontent\.com$'; then
  die "Client ID does not match expected format (*.apps.googleusercontent.com)"
fi
ok "Client ID format valid"

# Validate 2: Hit Google's OAuth2 auth endpoint to check if the client ID is recognized
# A valid client_id returns 200 (consent page), invalid returns 400
AUTH_URL="https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&response_type=token&redirect_uri=https://localhost&scope=email"
HTTP_CODE=$(curl -s -L --max-redirs 0 -o /dev/null -w '%{http_code}' "$AUTH_URL")

if [[ "$HTTP_CODE" == "400" ]]; then
  die "Google rejected client ID as invalid (HTTP 400)"
fi
ok "Google accepts client ID (HTTP ${HTTP_CODE})"

# Validate 3: If FRONTEND_URL is set, verify the app's login redirect
if [[ -n "${FRONTEND_URL:-}" ]]; then
  echo ""
  echo "--- Checking frontend serves GIS library ---"
  INDEX=$(curl -s "${FRONTEND_URL}")
  if echo "$INDEX" | grep -q 'accounts.google.com/gsi/client'; then
    ok "Frontend loads Google Identity Services library"
  else
    echo "WARNING: GIS library script tag not found in HTML (may be loaded dynamically)"
  fi
fi

echo ""
echo "=== OAuth validation passed ==="
