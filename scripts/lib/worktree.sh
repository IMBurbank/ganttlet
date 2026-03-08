#!/usr/bin/env bash
# scripts/lib/worktree.sh — Git worktree setup and cleanup utilities

# Setup a worktree for an agent group. Prints the worktree path to stdout.
# All log output goes to stderr to keep stdout clean for path capture.
#
# Usage: worktree_path=$(setup_worktree "groupA" "feature/phase15-foo")
setup_worktree() {
  local group="$1"
  local branch="$2"
  local worktree="${WORKTREE_BASE}/${PHASE}-${group}"

  if [[ ! -d "$worktree" ]]; then
    log "Creating worktree: ${worktree} (branch: ${branch}) from ${MERGE_TARGET}" >&2
    cd "$WORKSPACE"
    # Branch from MERGE_TARGET so each stage sees prior stage merges
    git worktree add "$worktree" -b "$branch" "$MERGE_TARGET" >/dev/null 2>&1 || \
      git worktree add "$worktree" "$branch" >/dev/null 2>&1 || \
      { err "Failed to create worktree for ${group}" >&2; return 1; }
  else
    log "Worktree already exists: ${worktree}" >&2
  fi

  (cd "$worktree" && npm install --silent >/dev/null 2>&1) || true

  (
    cd "$worktree"
    if [[ ! -d "src/wasm/scheduler" && ! -L "src/wasm/scheduler" ]]; then
      log "Symlinking WASM artifacts for ${group}" >&2
      ln -s /workspace/src/wasm/scheduler src/wasm/scheduler >/dev/null 2>&1 || true
    fi
  )

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

# Remove worktrees and delete branches for a list of groups.
# Usage: cleanup_worktrees groups_array branches_array
cleanup_worktrees() {
  local -n _groups="$1"
  local -n _branches="$2"

  log "Cleaning up worktrees..."
  for i in "${!_groups[@]}"; do
    local group="${_groups[$i]}"
    local branch="${_branches[$i]}"
    local worktree="${WORKTREE_BASE}/${PHASE}-${group}"
    if [[ -d "$worktree" ]]; then
      git worktree remove "$worktree" --force 2>/dev/null || \
        warn "Could not remove worktree: ${worktree}"
    fi
    git branch -d "$branch" 2>/dev/null || \
      warn "Could not delete branch: ${branch}"
  done
}
