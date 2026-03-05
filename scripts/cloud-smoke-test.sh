#!/usr/bin/env bash
# cloud-smoke-test.sh — Service account smoke tests against live Cloud Run.
# Tests Sheets API read/write and relay WebSocket connectivity.
#
# Required env vars:
#   RELAY_URL              — Cloud Run relay URL (https://...)
#   GCP_SA_KEY_WRITER1_DEV — JSON key for ci-writer-1 service account
#   GCP_SA_KEY_READER1_DEV — JSON key for ci-reader-1 service account
#   TEST_SHEET_ID_DEV      — Google Sheet ID shared with service accounts
set -euo pipefail

# ── Helpers ───────────────────────────────────────────────────────────────────

die() { echo "FAIL: $*" >&2; exit 1; }
ok()  { echo "PASS: $*"; }

# Get an access token from a service account JSON key via JWT assertion.
# Uses only bash, openssl, and curl — no gcloud or client libraries needed.
get_access_token() {
  local key_json="$1"

  local client_email
  client_email=$(echo "$key_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['client_email'])")
  local private_key
  private_key=$(echo "$key_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['private_key'])")

  local now
  now=$(date +%s)
  local exp=$((now + 3600))

  # JWT header (base64url)
  local header
  header=$(echo -n '{"alg":"RS256","typ":"JWT"}' | openssl base64 -e | tr -d '\n=' | tr '/+' '_-')

  # JWT claims (base64url)
  local claims
  claims=$(echo -n "{\"iss\":\"${client_email}\",\"scope\":\"https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile\",\"aud\":\"https://oauth2.googleapis.com/token\",\"iat\":${now},\"exp\":${exp}}" \
    | openssl base64 -e | tr -d '\n=' | tr '/+' '_-')

  # Sign with RSA-SHA256
  local signature
  signature=$(echo -n "${header}.${claims}" \
    | openssl dgst -sha256 -sign <(echo "$private_key") \
    | openssl base64 -e | tr -d '\n=' | tr '/+' '_-')

  local jwt="${header}.${claims}.${signature}"

  # Exchange JWT for access token
  local response
  response=$(curl -s -X POST https://oauth2.googleapis.com/token \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}")

  local token
  token=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)

  if [[ -z "$token" ]]; then
    echo "Token exchange failed: $response" >&2
    return 1
  fi

  echo "$token"
}

# ── Validate env vars ─────────────────────────────────────────────────────────

[[ -n "${RELAY_URL:-}" ]]              || die "RELAY_URL not set"
[[ -n "${GCP_SA_KEY_WRITER1_DEV:-}" ]] || die "GCP_SA_KEY_WRITER1_DEV not set"
[[ -n "${GCP_SA_KEY_READER1_DEV:-}" ]] || die "GCP_SA_KEY_READER1_DEV not set"
[[ -n "${TEST_SHEET_ID_DEV:-}" ]]      || die "TEST_SHEET_ID_DEV not set"

echo "=== Cloud Smoke Tests ==="
echo "Relay:  ${RELAY_URL}"
echo "Sheet:  ${TEST_SHEET_ID_DEV}"
echo ""

# ── Get access tokens ─────────────────────────────────────────────────────────

echo "--- Obtaining writer token ---"
WRITER_TOKEN=$(get_access_token "$GCP_SA_KEY_WRITER1_DEV")
ok "Writer token obtained"

echo "--- Obtaining reader token ---"
READER_TOKEN=$(get_access_token "$GCP_SA_KEY_READER1_DEV")
ok "Reader token obtained"

# ── Test 1: Writer WebSocket connection to relay ──────────────────────────────

echo ""
echo "--- Test 1: Writer WebSocket to relay ---"
WS_URL="${RELAY_URL}/ws/smoke-test-$$"
WS_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --http1.1 --max-time 5 \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Authorization: Bearer ${WRITER_TOKEN}" \
  "${WS_URL}" || true)

if [[ "$WS_STATUS" == "000" ]] || [[ "$WS_STATUS" =~ ^5 ]]; then
  die "Writer WebSocket connection failed (HTTP ${WS_STATUS})"
fi
ok "Writer WebSocket upgrade (HTTP ${WS_STATUS})"

# ── Test 2: Writer writes to Sheets API ───────────────────────────────────────

echo ""
echo "--- Test 2: Writer writes to Sheets API ---"
TEST_VALUE="smoke-test-$(date +%s)"
WRITE_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X PUT \
  "https://sheets.googleapis.com/v4/spreadsheets/${TEST_SHEET_ID_DEV}/values/Sheet1!A1?valueInputOption=RAW" \
  -H "Authorization: Bearer ${WRITER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"values\":[[\"${TEST_VALUE}\"]]}")

WRITE_BODY=$(echo "$WRITE_RESPONSE" | head -n -1)
WRITE_STATUS=$(echo "$WRITE_RESPONSE" | tail -1)

if [[ "$WRITE_STATUS" != "200" ]]; then
  die "Sheets write failed (HTTP ${WRITE_STATUS}): ${WRITE_BODY}"
fi
ok "Writer wrote '${TEST_VALUE}' to Sheet1!A1"

# ── Test 3: Reader reads from Sheets API ──────────────────────────────────────

echo ""
echo "--- Test 3: Reader reads from Sheets API ---"
READ_RESPONSE=$(curl -s -w "\n%{http_code}" \
  "https://sheets.googleapis.com/v4/spreadsheets/${TEST_SHEET_ID_DEV}/values/Sheet1!A1" \
  -H "Authorization: Bearer ${READER_TOKEN}")

READ_BODY=$(echo "$READ_RESPONSE" | head -n -1)
READ_STATUS=$(echo "$READ_RESPONSE" | tail -1)

if [[ "$READ_STATUS" != "200" ]]; then
  die "Sheets read failed (HTTP ${READ_STATUS}): ${READ_BODY}"
fi

READ_VALUE=$(echo "$READ_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('values',[['']])[0][0])" 2>/dev/null || true)

if [[ "$READ_VALUE" != "$TEST_VALUE" ]]; then
  die "Read value '${READ_VALUE}' does not match written value '${TEST_VALUE}'"
fi
ok "Reader read back '${READ_VALUE}' — round-trip verified"

# ── Test 4: Reader write is rejected ──────────────────────────────────────────

echo ""
echo "--- Test 4: Reader write is rejected ---"
REJECT_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X PUT \
  "https://sheets.googleapis.com/v4/spreadsheets/${TEST_SHEET_ID_DEV}/values/Sheet1!A2?valueInputOption=RAW" \
  -H "Authorization: Bearer ${READER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"values":[["should-fail"]]}')

REJECT_STATUS=$(echo "$REJECT_RESPONSE" | tail -1)

if [[ "$REJECT_STATUS" == "200" ]]; then
  die "Reader write should have been rejected but succeeded"
fi
ok "Reader write correctly rejected (HTTP ${REJECT_STATUS})"

# ── Test 5: Reader WebSocket connection to relay ──────────────────────────────

echo ""
echo "--- Test 5: Reader WebSocket to relay ---"
WS_URL="${RELAY_URL}/ws/smoke-test-reader-$$"
WS_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --http1.1 --max-time 5 \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Authorization: Bearer ${READER_TOKEN}" \
  "${WS_URL}" || true)

if [[ "$WS_STATUS" == "000" ]] || [[ "$WS_STATUS" =~ ^5 ]]; then
  die "Reader WebSocket connection failed (HTTP ${WS_STATUS})"
fi
ok "Reader WebSocket upgrade (HTTP ${WS_STATUS})"

echo ""
echo "=== All smoke tests passed ==="
