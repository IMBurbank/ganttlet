#!/usr/bin/env bash
# Reinstall fencepost if its source changed in the merge.
# Install: ln -sf ../../scripts/post-merge-hook.sh .git/hooks/post-merge

if git diff-tree -r --name-only ORIG_HEAD HEAD | grep -q "^crates/fencepost/"; then
  echo "[post-merge] Fencepost source changed — reinstalling..."
  cargo install --path crates/fencepost 2>&1 | tail -1
fi
