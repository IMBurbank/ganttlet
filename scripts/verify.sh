#!/usr/bin/env bash
# PostToolUse hook: runs tsc + vitest (or cargo check) after edits.
# Supports AGENT_SCOPE (rust|ts|full), output deduplication, and rate limiting.
# Exits non-zero if checks fail, so agents know to fix errors.

set -euo pipefail

# Read the hook JSON from stdin
INPUT=$(cat)

# Extract the file path using node (jq not guaranteed)
FILE=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try { console.log(JSON.parse(d).tool_input.file_path||''); }
    catch { console.log(''); }
  });
")

# --- Rate limiting ---
VERIFY_COOLDOWN="${VERIFY_COOLDOWN:-30}"
LAST_VERIFY_FILE="${TMPDIR:-/tmp}/.verify-last-run"
NOW=$(date +%s)

if [[ -f "$LAST_VERIFY_FILE" ]]; then
  LAST_RUN=$(cat "$LAST_VERIFY_FILE" 2>/dev/null || echo 0)
  ELAPSED=$(( NOW - LAST_RUN ))
  if [[ $ELAPSED -lt $VERIFY_COOLDOWN ]]; then
    echo "[verify: skipped, last run ${ELAPSED}s ago (cooldown: ${VERIFY_COOLDOWN}s)]"
    exit 0
  fi
fi

# --- Agent scope ---
AGENT_SCOPE="${AGENT_SCOPE:-full}"

# Hash file for output deduplication (per-file)
VERIFY_HASH_FILE="${TMPDIR:-/tmp}/.verify-hash-$(echo "$FILE" | md5sum | cut -d' ' -f1)"

run_tsc() {
  TSC_OUTPUT=$(npx tsc --noEmit 2>&1) || true
  TSC_EXIT=${PIPESTATUS[0]:-$?}
  TSC_HASH=$(echo "$TSC_OUTPUT" | md5sum | cut -d' ' -f1)

  if [[ -f "${VERIFY_HASH_FILE}-tsc" ]] && [[ "$(cat "${VERIFY_HASH_FILE}-tsc")" == "$TSC_HASH" ]]; then
    if [[ $TSC_EXIT -ne 0 ]]; then
      ERROR_COUNT=$(echo "$TSC_OUTPUT" | grep -c "error TS" || echo "0")
      echo "[tsc: same ${ERROR_COUNT} errors as previous run]"
    else
      echo "[tsc: still clean]"
    fi
  else
    if [[ $TSC_EXIT -ne 0 ]]; then
      ERROR_COUNT=$(echo "$TSC_OUTPUT" | grep -c "error TS" || echo "0")
      echo "[tsc: ${ERROR_COUNT} errors]"
      echo "$TSC_OUTPUT" | grep "error TS" | head -5
    else
      echo "[tsc: clean]"
    fi
    echo "$TSC_HASH" > "${VERIFY_HASH_FILE}-tsc"
  fi
}

run_vitest() {
  VITEST_OUTPUT=$(npx vitest run --reporter=dot 2>&1) || true
  VITEST_EXIT=${PIPESTATUS[0]:-$?}
  VITEST_HASH=$(echo "$VITEST_OUTPUT" | md5sum | cut -d' ' -f1)

  if [[ -f "${VERIFY_HASH_FILE}-vitest" ]] && [[ "$(cat "${VERIFY_HASH_FILE}-vitest")" == "$VITEST_HASH" ]]; then
    if [[ $VITEST_EXIT -ne 0 ]]; then
      echo "[vitest: same failures as previous run]"
    else
      echo "[vitest: still passing]"
    fi
  else
    if [[ $VITEST_EXIT -ne 0 ]]; then
      echo "[vitest: failures]"
      echo "$VITEST_OUTPUT" | tail -10
    else
      PASS_LINE=$(echo "$VITEST_OUTPUT" | grep -E "Tests\s+[0-9]+ passed" || echo "")
      if [[ -n "$PASS_LINE" ]]; then
        echo "[vitest: ${PASS_LINE}]"
      else
        echo "[vitest: passed]"
      fi
    fi
    echo "$VITEST_HASH" > "${VERIFY_HASH_FILE}-vitest"
  fi
}

run_cargo() {
  echo "[cargo check]"
  (cd crates/scheduler && cargo check 2>&1 | tail -20)
  return $?
}

run_guard() {
  echo "[guard: test + rebuild]"
  cargo test -p fencepost 2>&1 | tail -5; GUARD_EXIT=${PIPESTATUS[0]:-$?}
  if [[ $GUARD_EXIT -eq 0 ]]; then
    cargo build --release -p fencepost 2>&1 | tail -3
    echo "[guard: binary rebuilt]"
  else
    echo "[guard: tests failed — binary NOT rebuilt]"
  fi
  return $GUARD_EXIT
}

# --- Scope-based routing ---
case "$AGENT_SCOPE" in
  rust)
    if [[ ! "$FILE" =~ \.(rs)$ ]]; then
      exit 0
    fi
    run_cargo
    FINAL_EXIT=$?
    ;;
  ts)
    if [[ ! "$FILE" =~ \.(ts|tsx)$ ]]; then
      exit 0
    fi
    echo "--- verify: $FILE ---"
    run_tsc
    run_vitest
    FINAL_EXIT=0
    if [[ $TSC_EXIT -ne 0 || $VITEST_EXIT -ne 0 ]]; then
      FINAL_EXIT=1
    fi
    ;;
  full|*)
    if [[ "$FILE" =~ crates/fencepost/ ]]; then
      run_guard
      FINAL_EXIT=$?
    elif [[ "$FILE" =~ \.(rs)$ ]]; then
      run_cargo
      FINAL_EXIT=$?
    elif [[ "$FILE" =~ \.(ts|tsx)$ ]]; then
      echo "--- verify: $FILE ---"
      run_tsc
      run_vitest
      FINAL_EXIT=0
      if [[ $TSC_EXIT -ne 0 || $VITEST_EXIT -ne 0 ]]; then
        FINAL_EXIT=1
      fi
    else
      exit 0
    fi
    ;;
esac

# Update rate limit timestamp
echo "$NOW" > "$LAST_VERIFY_FILE"

# Check curation feedback accumulation (non-blocking reminder)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -x "${SCRIPT_DIR}/check-curation.sh" ] && "${SCRIPT_DIR}/check-curation.sh" 2>/dev/null || true

exit ${FINAL_EXIT:-0}
