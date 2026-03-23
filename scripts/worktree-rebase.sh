#!/usr/bin/env bash
# Rebase a worktree branch onto the latest origin/main.
#
# git rebase with many commits on worktrees is unreliable — it enters
# interactive mode, generates duplicate todo entries, and pauses. This
# script uses reset + cherry-pick instead, which is reliable regardless
# of commit count.
#
# Usage (from within a worktree):
#   ../../../scripts/worktree-rebase.sh
#   # or with absolute path:
#   /workspace/scripts/worktree-rebase.sh
#
# What it does:
#   1. Fetches origin/main
#   2. Saves your commit list (everything after the fork point)
#   3. Resets to origin/main
#   4. Cherry-picks each commit one at a time
#   5. Reports success/failure
#
# On failure: prints the failing commit and leaves you in a state where
# you can resolve the conflict and run `git cherry-pick --continue`.

set -euo pipefail

# Must be in a git worktree
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: not inside a git repository" >&2
  exit 1
fi

BRANCH=$(git branch --show-current)
if [ -z "$BRANCH" ]; then
  echo "ERROR: detached HEAD — checkout a branch first" >&2
  exit 1
fi

# Determine the workspace root (parent of .git common dir)
WORKSPACE_ROOT="$(dirname "$(git rev-parse --git-common-dir)")"

echo "Rebasing $BRANCH onto origin/main..."
git fetch origin main

# Find the fork point — where this branch diverged from main
FORK_POINT=$(git merge-base origin/main HEAD)
MAIN_HEAD=$(git rev-parse origin/main)
COMMIT_COUNT=$(git log --oneline "$FORK_POINT..HEAD" | wc -l | tr -d ' ')

if [ "$COMMIT_COUNT" -eq 0 ]; then
  echo "Already up to date with origin/main."
  exit 0
fi

if [ "$FORK_POINT" = "$MAIN_HEAD" ]; then
  echo "Already based on origin/main ($COMMIT_COUNT commits ahead). Nothing to rebase."
  exit 0
fi

NEW_COMMITS=$(git log --oneline "$FORK_POINT..$MAIN_HEAD" | wc -l | tr -d ' ')
echo "Found $COMMIT_COUNT commits to replay onto origin/main ($NEW_COMMITS new commits on main)"

# Save the commit list (oldest first)
LAST_COMMIT=$(git rev-parse HEAD)

# Reset to origin/main
git reset --hard origin/main

# Cherry-pick each commit
APPLIED=0
FAILED=""
for commit in $(git log --oneline --reverse "$FORK_POINT..$LAST_COMMIT" | awk '{print $1}'); do
  if ! git cherry-pick "$commit" >/dev/null 2>&1; then
    FAILED="$commit"
    break
  fi
  APPLIED=$((APPLIED + 1))
done

if [ -n "$FAILED" ]; then
  echo ""
  echo "CONFLICT at commit $FAILED ($APPLIED/$COMMIT_COUNT applied)"
  echo "Resolve the conflict, then run:"
  echo "  git cherry-pick --continue"
  echo ""
  echo "Remaining commits to apply manually:"
  SKIP=$((APPLIED + 1))
  git log --oneline --reverse "$FORK_POINT..$LAST_COMMIT" | tail -n +"$((SKIP + 1))"
  exit 1
fi

echo "Successfully rebased $APPLIED commits onto origin/main"
