#!/usr/bin/env bash
# scripts/pre-commit-hook.sh — Reject hollow implementations and deleted tests
#
# Install: ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit
# Or run directly: ./scripts/pre-commit-hook.sh

set -euo pipefail

ERRORS=0

# ── Worktree isolation: block non-main commits in /workspace ──────────────
# Worktrees (e.g. /workspace/.claude/worktrees/foo) have a different toplevel
# and pass through. CI/deploy agents don't use /workspace so are unaffected.
# Override with WORKTREE_EXEMPT=1 for intentional direct-on-main work.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [[ "$TOPLEVEL" = "/workspace" && "$BRANCH" != "main" && "${WORKTREE_EXEMPT:-}" != "1" ]]; then
  echo "ERROR: Committing to branch '$BRANCH' directly in /workspace is blocked."
  echo "       /workspace must stay on main. Use a worktree instead:"
  echo ""
  echo "         git worktree add /workspace/.claude/worktrees/$BRANCH -b $BRANCH"
  echo "         cd /workspace/.claude/worktrees/$BRANCH"
  echo ""
  echo "       Override: WORKTREE_EXEMPT=1 git commit ..."
  exit 1
fi

# Check staged files only
STAGED=$(git diff --cached --name-only --diff-filter=ACM)

if [[ -z "$STAGED" ]]; then
  exit 0
fi

# Check for todo!() / unimplemented!() in Rust files
if echo "$STAGED" | grep -q '\.rs$'; then
  if git diff --cached | grep -qE '^\+.*todo!\(\)|^\+.*unimplemented!\(\)'; then
    echo "ERROR: Commit contains todo!() or unimplemented!() in Rust files."
    echo "       Every function must have a real implementation."
    ERRORS=$((ERRORS + 1))
  fi
fi

# Check for commented-out tests
if git diff --cached | grep -qE '^\+\s*//\s*(#\[test\]|it\(|describe\(|test\()'; then
  echo "ERROR: Commit contains commented-out test declarations."
  echo "       If a test needs to change, fix it — don't comment it out."
  ERRORS=$((ERRORS + 1))
fi

# Check for empty function bodies in TypeScript (heuristic — warn only)
if echo "$STAGED" | grep -q '\.\(ts\|tsx\)$'; then
  EMPTY_BODIES=$(git diff --cached | grep -cE '^\+.*\{\s*\}\s*$' || true)
  if [[ "$EMPTY_BODIES" -gt 0 ]]; then
    echo "WARNING: Possible empty function body detected. Verify this is intentional."
  fi
fi

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "Pre-commit hook found $ERRORS error(s). Fix them before committing."
  echo "To bypass (NOT recommended): git commit --no-verify"
  exit 1
fi

exit 0
