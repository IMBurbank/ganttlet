#!/usr/bin/env bash
# Reinstall fencepost if its source changed in the merge.
# Install: ln -sf ../../scripts/post-merge-hook.sh .git/hooks/post-merge

# Guard: ORIG_HEAD may not exist on initial clone or ff-only merge
if ! git rev-parse --verify ORIG_HEAD >/dev/null 2>&1; then
  exit 0
fi

if git diff-tree -r --name-only ORIG_HEAD HEAD | grep -q "^crates/fencepost/"; then
  echo "[post-merge] Fencepost source changed — reinstalling..."
  cargo install --path crates/fencepost 2>&1 | tail -3 || echo "[post-merge] WARNING: fencepost install failed — binary may be stale"
fi
