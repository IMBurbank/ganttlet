#!/usr/bin/env bash
# full-verify.sh — Complete verification suite for agents.
# Run this before declaring work done. Exits non-zero on first failure.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "=== Hook safety tests ==="
bash scripts/test-hooks.sh

echo ""
echo "=== TypeScript type check ==="
npx tsc --noEmit

echo ""
echo "=== SDK type check ==="
npx tsc -p tsconfig.sdk.json --noEmit

echo ""
echo "=== Vitest unit tests ==="
npx vitest run --reporter=dot

echo ""
echo "=== Rust fencepost tests ==="
cargo test -p fencepost

echo ""
echo "=== Rust scheduler tests ==="
(cd crates/scheduler && cargo test)

echo ""
echo "=== E2E tests (with relay) ==="
E2E_RELAY=1 npx playwright test

echo ""
echo "=== Curation status ==="
SCRIPT_DIR="$(dirname "$0")"
[ -x "${SCRIPT_DIR}/check-curation.sh" ] && "${SCRIPT_DIR}/check-curation.sh" || true

# Check for debrief report
# Use git rev-parse to resolve .git/HEAD correctly in worktrees (where .git is a file)
_git_head="$(git rev-parse --git-dir)/HEAD"
if [ -d "docs/prompts/curation/feedback" ] && [ -f "$_git_head" ]; then
  has_debrief=$(find docs/prompts/curation/feedback -maxdepth 1 -name "*.md" \
    -not -name "debrief-template.md" -newer "$_git_head" 2>/dev/null | head -1 || true)
  if [ -z "$has_debrief" ]; then
    echo "[curation] No debrief report found for this session."
    echo "Read docs/prompts/curation/debrief-template.md and write your report."
  fi
fi

echo ""
echo "=== All checks passed ==="

# Post E2E attestation if requested (skips redundant CI E2E run on PR)
if [[ "${ATTEST_E2E:-}" == "1" ]] && command -v gh &>/dev/null; then
  echo ""
  echo "=== Posting E2E attestation ==="
  "$(dirname "$0")/attest-e2e.sh"
fi
