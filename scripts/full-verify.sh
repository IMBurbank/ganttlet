#!/usr/bin/env bash
# full-verify.sh — Complete verification suite for agents.
# Run this before declaring work done. Exits non-zero on first failure.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "=== TypeScript type check ==="
npx tsc --noEmit

echo ""
echo "=== Vitest unit tests ==="
npx vitest run --reporter=dot

echo ""
echo "=== Rust scheduler tests ==="
(cd crates/scheduler && cargo test)

echo ""
echo "=== E2E tests (with relay) ==="
E2E_RELAY=1 npx playwright test

echo ""
echo "=== All checks passed ==="
