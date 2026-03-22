#!/usr/bin/env bash
# scripts/lib/worktree.sh — Git worktree setup and cleanup utilities

# Delete a local branch safely, handling squash merges.
# Squash merges create a new commit with no parent link to the branch, so
# `git branch -d` refuses ("not fully merged"). This function detects that
# the branch content is already on the target ref by comparing trees:
#   - If git diff shows no file differences → content is merged, safe to delete
#   - If git diff shows changes → genuinely unmerged, refuse
#
# Usage: delete_merged_branch "feature/my-branch" "origin/main"
delete_merged_branch() {
  local branch="$1"
  local target="${2:-origin/main}"

  # Fast path: git branch -d works when ancestry is intact (non-squash merges)
  if git branch -d "$branch" 2>/dev/null; then
    return 0
  fi

  # Check if the branch even exists
  if ! git rev-parse --verify "$branch" >/dev/null 2>&1; then
    return 0  # already gone
  fi

  # Compare tree content (files), not commit history.
  # Two-dot diff: what does branch have that target doesn't?
  # (Three-dot would compare from merge-base, which is wrong when target has advanced.)
  local tree_diff
  tree_diff=$(git diff "${target}..${branch}" --stat 2>/dev/null || echo "ERROR")

  if [[ "$tree_diff" == "ERROR" ]]; then
    warn "Could not compare ${branch} to ${target} — skipping deletion"
    return 1
  fi

  if [[ -z "$tree_diff" ]]; then
    # Same tree content — squash merged. Fast-forward branch ref then delete.
    if ! git branch -f "$branch" "$target" 2>/dev/null; then
      warn "Branch ${branch} is merged but branch -f failed (may be checked out in a worktree)"
      return 1
    fi
    if git branch -d "$branch" 2>/dev/null; then
      return 0
    fi
    # Rollback: branch -f succeeded but -d failed — should not happen, but be safe
    warn "Branch ${branch} content is merged but branch -d failed after fast-forward"
    return 1
  fi

  # Genuinely unmerged — refuse
  warn "Branch ${branch} has unmerged changes — not deleting"
  return 1
}

# Setup a worktree for an agent group. Prints the worktree path to stdout.
# All log output goes to stderr to keep stdout clean for path capture.
#
# Usage: worktree_path=$(setup_worktree "groupA" "feature/phase15-foo")
setup_worktree() {
  local group="$1"
  local branch="$2"
  # Derive worktree path from branch name (includes run suffix for uniqueness)
  local worktree="${WORKTREE_BASE}/${branch//\//-}"

  if [[ ! -d "$worktree" ]]; then
    log "Creating worktree: ${worktree} (branch: ${branch}) from ${MERGE_TARGET}" >&2
    # Branch from MERGE_TARGET so each stage sees prior stage merges
    git worktree add "$worktree" -b "$branch" "$MERGE_TARGET" >/dev/null 2>&1 || \
      git worktree add "$worktree" "$branch" >/dev/null 2>&1 || \
      { err "Failed to create worktree for ${group}" >&2; return 1; }
  else
    log "Worktree already exists: ${worktree}" >&2
  fi

  (cd "$worktree" && npm install --silent >/dev/null 2>&1) || true

  # Copy WASM build artifacts from the invoker's worktree
  local launch_dir="${_LAUNCH_DIR:-.}"
  if [[ -d "${launch_dir}/src/wasm/scheduler" && ! -d "${worktree}/src/wasm/scheduler" ]]; then
    log "Copying WASM artifacts for ${group}" >&2
    mkdir -p "${worktree}/src/wasm" >/dev/null 2>&1
    cp -r "${launch_dir}/src/wasm/scheduler" "${worktree}/src/wasm/scheduler" >/dev/null 2>&1 || true
  elif [[ ! -d "${worktree}/src/wasm/scheduler" ]]; then
    warn "WASM artifacts missing in ${launch_dir} — tsc may fail" >&2
  fi

  # Seed .agent-status.json if it doesn't exist yet
  if [[ ! -f "${worktree}/.agent-status.json" ]]; then
    local phase_num
    phase_num=$(echo "$PHASE" | sed 's/[^0-9]//g')
    phase_num="${phase_num:-0}"
    cat > "${worktree}/.agent-status.json" <<SEED
{
  "group": "${group}",
  "phase": ${phase_num},
  "tasks": {},
  "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
SEED
  fi

  # Only the path goes to stdout
  echo "$worktree"
}

# Setup the merge worktree for the implementation branch.
# This worktree persists across stages (merge → validate → create-pr).
setup_merge_worktree() {
  if [[ -d "$MERGE_WORKTREE" ]]; then
    log "Merge worktree already exists: ${MERGE_WORKTREE}"
    return 0
  fi

  setup_merge_target  # ensure the implementation branch exists

  log "Creating merge worktree: ${MERGE_WORKTREE} (branch: ${MERGE_TARGET})"
  git worktree add "$MERGE_WORKTREE" "$MERGE_TARGET" >/dev/null 2>&1 || \
    { err "Failed to create merge worktree"; return 1; }

  # Install dependencies so tsc/vitest can run in the worktree
  (cd "$MERGE_WORKTREE" && npm install --silent >/dev/null 2>&1) || true

  # WASM artifacts come from the invoker's worktree (orchestrator responsibility)
  local launch_dir="${_LAUNCH_DIR:-.}"
  if [[ -d "${launch_dir}/src/wasm/scheduler" && ! -d "${MERGE_WORKTREE}/src/wasm/scheduler" ]]; then
    mkdir -p "${MERGE_WORKTREE}/src/wasm" >/dev/null 2>&1
    cp -r "${launch_dir}/src/wasm/scheduler" "${MERGE_WORKTREE}/src/wasm/scheduler" >/dev/null 2>&1 || true
  fi
}

# Remove the merge worktree. Called after PR creation or on pipeline cleanup.
cleanup_merge_worktree() {
  if [[ -d "$MERGE_WORKTREE" ]]; then
    log "Removing merge worktree: ${MERGE_WORKTREE}"
    rm -rf "$MERGE_WORKTREE"
    git worktree prune 2>/dev/null || true
  fi
}

# Remove worktrees and delete branches for a list of groups.
# Usage: cleanup_worktrees groups_array branches_array
cleanup_worktrees() {
  local -n _groups="$1"
  local -n _branches="$2"

  log "Cleaning up worktrees..."
  for i in "${!_groups[@]}"; do
    local group="${_groups[$i]}"
    local branch="${_branches[$i]}"
    local worktree="${WORKTREE_BASE}/${branch//\//-}"
    if [[ -d "$worktree" ]]; then
      rm -rf "$worktree"
      log "Removed worktree: ${worktree}"
    fi
    delete_merged_branch "$branch" "${MERGE_TARGET}" || true
  done
  git worktree prune 2>/dev/null || true
}
