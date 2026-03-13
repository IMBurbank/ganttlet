#!/usr/bin/env bash
# attest-e2e.sh — Post e2e-verified commit status for the current HEAD.
#
# Run this IMMEDIATELY after ./scripts/full-verify.sh passes and BEFORE
# any rebase/push, to ensure the SHA matches what was actually tested.
#
# Requires: gh CLI authenticated with push access to the repo.
# Usage: ./scripts/attest-e2e.sh
set -euo pipefail

if ! command -v gh &>/dev/null; then
  echo "ERROR: gh CLI not found. Install it or use 'gh api' manually."
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)
if [[ -z "$REPO" ]]; then
  echo "ERROR: Could not determine repo. Are you in a git repo with a GitHub remote?"
  exit 1
fi

SHA=$(git rev-parse HEAD)

echo "Posting e2e-verified status for $SHA on $REPO"

gh api "repos/$REPO/statuses/$SHA" \
  -f state=success \
  -f context=e2e-verified \
  -f description="E2E passed locally (agent attestation)" \
  -f target_url="https://github.com/$REPO/commit/$SHA" \
  --silent

echo "Done. e2e-verified=success posted for $SHA"
