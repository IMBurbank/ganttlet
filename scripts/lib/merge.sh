#!/usr/bin/env bash
# scripts/lib/merge.sh — Branch merging with conflict resolution and post-merge verification
#
# All merge operations happen inside the merge worktree (MERGE_WORKTREE).
# Git commands work from any worktree — no need to cd to /workspace.

# Ensure the implementation branch exists (created from main).
setup_merge_target() {
  if ! git rev-parse --verify "$MERGE_TARGET" >/dev/null 2>&1; then
    # Branch from HEAD of wherever launch-phase.sh was invoked.
    # When run from an orchestrator worktree, curators inherit its changes.
    # When run from main, curators get main. No manual branch management needed.
    local base_ref="${_LAUNCH_BASE_REF:-main}"
    log "Creating implementation branch: ${MERGE_TARGET} (from ${base_ref})"
    git branch "$MERGE_TARGET" "$base_ref"
  fi
}

# Launch a Claude agent to resolve merge conflicts.
# All operations run inside the merge worktree.
resolve_merge_conflicts() {
  local branch="$1"
  local msg="$2"
  local conflicts
  conflicts=$(cd "$MERGE_WORKTREE" && git diff --name-only --diff-filter=U)

  if [[ -z "$conflicts" ]]; then
    warn "resolve_merge_conflicts called but no conflicted files found"
    return 1
  fi

  log "Conflicted files:"
  echo "$conflicts" | while read -r f; do log "  $f"; done

  local conflict_diffs=""
  while IFS= read -r f; do
    conflict_diffs+="
=== $f ===
$(cd "$MERGE_WORKTREE" && head -200 "$f")
"
  done <<< "$conflicts"

  local branch_summary
  branch_summary=$(cd "$MERGE_WORKTREE" && git log --oneline "${MERGE_TARGET}".."$branch" 2>/dev/null | head -10 || echo "(no commits)")

  local fix_prompt="You are resolving git merge conflicts in the Ganttlet project.
The branch '${branch}' is being merged into ${MERGE_TARGET}. The following files have conflicts:

${conflicts}

What the branch did (recent commits):
${branch_summary}

Conflicted files and their current state (showing conflict markers):
${conflict_diffs}

Instructions:
1. Read each conflicted file and resolve the conflict markers (<<<<<<< ======= >>>>>>>).
   Keep BOTH sides of the changes — the goal is to combine the work from both branches.
   Use your judgment on how to integrate them correctly.
2. After resolving each file, run: git add <file>
3. After all files are resolved, run: git commit --no-edit
4. Verify the merge is clean: git status should show nothing to commit.

Do NOT enter plan mode. Do NOT ask for confirmation. Fix the conflicts and commit."

  if [[ "$WATCH" == "1" ]]; then
    local fix_prompt_file="${LOG_DIR}/merge-fix-${branch//\//-}.md"
    echo "$fix_prompt" > "$fix_prompt_file"
    local exitcode_file="${LOG_DIR}/merge-fix.exit"
    rm -f "$exitcode_file"

    local wrapper="${LOG_DIR}/merge-fix-run.sh"
    cat > "$wrapper" <<WRAPPER
#!/usr/bin/env bash
cd "${MERGE_WORKTREE}"
set -o pipefail && cat '${fix_prompt_file}' | claude --dangerously-skip-permissions --max-turns "${MAX_TURNS:-$DEFAULT_MAX_TURNS}" --max-budget-usd "${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}" -p -
echo \${PIPESTATUS[1]:-\$?} > "$exitcode_file"
WRAPPER
    chmod +x "$wrapper"

    tmux kill-session -t "${TMUX_SESSION}-merge-fix" 2>/dev/null || true
    tmux new-session -d -s "${TMUX_SESSION}-merge-fix" -n "merge-fix" \
      "$wrapper; echo '── merge-fix finished ──'; read"

    log "Merge-fix agent running in tmux session: ${TMUX_SESSION}-merge-fix"
    log "Attach to watch:  tmux attach -t ${TMUX_SESSION}-merge-fix"

    while [[ ! -f "$exitcode_file" ]]; do sleep 5; done

    local rc
    rc=$(cat "$exitcode_file")
    tmux kill-session -t "${TMUX_SESSION}-merge-fix" 2>/dev/null || true
    return "$rc"
  else
    (
      cd "$MERGE_WORKTREE"
      echo "$fix_prompt" | claude --dangerously-skip-permissions --max-turns "${MAX_TURNS:-$DEFAULT_MAX_TURNS}" --max-budget-usd "${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}" -p - >> "${LOG_DIR}/merge-fix.log" 2>&1
    )
    return $?
  fi
}

# Merge a single branch with conflict resolution retries.
# Runs inside the merge worktree.
merge_branch_with_retries() {
  local branch="$1"
  local msg="$2"

  cd "$MERGE_WORKTREE"

  if ! git rev-parse --verify "$branch" >/dev/null 2>&1; then
    err "Branch '${branch}' does not exist — agents may not have run. Skipping."
    return 1
  fi

  for attempt in $(seq 1 "$MERGE_FIX_RETRIES"); do
    log "Merging ${branch}... (attempt ${attempt}/${MERGE_FIX_RETRIES})"

    if git merge "$branch" --no-ff -m "$msg"; then
      ok "Merged ${branch}"
      return 0
    fi

    warn "Merge conflict on ${branch} (attempt ${attempt}/${MERGE_FIX_RETRIES})"

    if resolve_merge_conflicts "$branch" "$msg"; then
      if ! git diff --name-only --diff-filter=U | grep -q .; then
        ok "Merge conflicts resolved for ${branch}"
        return 0
      else
        warn "Conflicts remain after fix attempt ${attempt}"
      fi
    else
      warn "Merge-fix agent failed on attempt ${attempt}"
    fi

    if [[ $attempt -lt $MERGE_FIX_RETRIES ]]; then
      git merge --abort 2>/dev/null || true
      sleep "$RETRY_DELAY"
    fi
  done

  err "Could not resolve merge conflicts for ${branch} after ${MERGE_FIX_RETRIES} attempts"
  git merge --abort 2>/dev/null || true
  return 1
}

# Run tsc + vitest + cargo test in parallel. Returns 0 if all pass.
# Runs inside the merge worktree.
run_parallel_verification() {
  local label="${1:-verification}"

  log "Running parallel verification (tsc + vitest + cargo test) for ${label}..."

  local tsc_log="${LOG_DIR}/verify-tsc.log"
  local vitest_log="${LOG_DIR}/verify-vitest.log"
  local cargo_log="${LOG_DIR}/verify-cargo.log"

  (cd "$MERGE_WORKTREE" && npx tsc --noEmit > "$tsc_log" 2>&1) &
  local tsc_pid=$!

  (cd "$MERGE_WORKTREE" && npm run test > "$vitest_log" 2>&1) &
  local vitest_pid=$!

  (cd "$MERGE_WORKTREE" && source "$HOME/.cargo/env" 2>/dev/null; cd "$MERGE_WORKTREE/crates/scheduler" && cargo test > "$cargo_log" 2>&1) &
  local cargo_pid=$!

  local tsc_ok=true vitest_ok=true cargo_ok=true
  set +e
  wait $tsc_pid || tsc_ok=false
  wait $vitest_pid || vitest_ok=false
  wait $cargo_pid || cargo_ok=false
  set -e

  if ! $tsc_ok; then
    err "TypeScript check failed (${label})"
    tail -20 "$tsc_log" 2>/dev/null || true
  fi
  if ! $vitest_ok; then
    err "Unit tests failed (${label})"
    tail -20 "$vitest_log" 2>/dev/null || true
  fi
  if ! $cargo_ok; then
    err "Rust tests failed (${label})"
    tail -20 "$cargo_log" 2>/dev/null || true
  fi

  $tsc_ok && $vitest_ok && $cargo_ok
}

# Launch a fix agent that keeps running until tsc + vitest + cargo test all pass.
# Runs inside the merge worktree.
run_merge_fix_agent() {
  local merge_label="$1"
  local max_fix_attempts="${MERGE_FIX_RETRIES:-3}"

  log "Launching merge-fix agent to resolve verification failures..."

  local fix_prompt="You are fixing build/test failures after merging parallel branches for ${merge_label} in the Ganttlet project.
Read CLAUDE.md for project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Fix issues and keep going.

Steps:
1. Run \`npx tsc --noEmit\` — fix any TypeScript errors
2. Run \`npm run test\` — fix any test failures
3. Rust tests (two separate commands):
   - \`cd crates/scheduler\`
   - \`cargo test\`
4. Repeat until ALL pass
5. Commit all fixes with: \`fix: resolve merge verification failures for ${merge_label}\`

Do NOT modify files unnecessarily. Only fix actual errors. Read the error output carefully."

  for attempt in $(seq 1 "$max_fix_attempts"); do
    log "Merge-fix attempt ${attempt}/${max_fix_attempts}"
    local logfile="${LOG_DIR}/merge-fix-${merge_label// /-}-attempt${attempt}.log"

    local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
    local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"

    set +e
    (
      cd "$MERGE_WORKTREE"
      echo "$fix_prompt" | claude --dangerously-skip-permissions --max-turns "$max_turns" --max-budget-usd "$max_budget" -p - > "$logfile" 2>&1
    )
    local exit_code=$?
    set -e

    if run_parallel_verification "merge-fix attempt ${attempt}"; then
      ok "Merge-fix agent resolved all issues on attempt ${attempt}"
      return 0
    fi

    if [[ $attempt -lt $max_fix_attempts ]]; then
      warn "Merge-fix: issues remain after attempt ${attempt} — retrying..."
      sleep "$RETRY_DELAY"
    fi
  done

  err "Merge-fix agent could not resolve all issues after ${max_fix_attempts} attempts"
  return 1
}

# Run merge stage for a given stage index: merge all branches, verify, fix if needed.
# All operations run in the merge worktree — /workspace stays on main.
# Usage: do_merge "Merge 1" groups_array branches_array messages_array
do_merge() {
  local merge_label="$1"
  local -n dm_groups="$2"
  local -n dm_branches="$3"
  local -n dm_messages="$4"

  log "=== ${merge_label}: Combining parallel branches into ${MERGE_TARGET} ==="

  # Create/reuse merge worktree (persists across stages)
  setup_merge_worktree

  cd "$MERGE_WORKTREE"

  # Check which groups succeeded (if stage result files exist)
  local succeeded=""
  [[ -f "${LOG_DIR}/stage-succeeded.txt" ]] && succeeded=$(cat "${LOG_DIR}/stage-succeeded.txt")

  local merge_failures=0
  local merged_count=0
  for i in "${!dm_branches[@]}"; do
    local group="${dm_groups[$i]}"
    local branch="${dm_branches[$i]}"
    local msg="${dm_messages[$i]}"

    if [[ -n "$succeeded" ]] && ! echo " $succeeded " | grep -q " $group "; then
      warn "Skipping merge of ${group} (failed in parallel stage)"
      continue
    fi

    if ! merge_branch_with_retries "$branch" "$msg"; then
      err "Failed to merge ${branch} — continuing with remaining branches"
      merge_failures=$((merge_failures + 1))
      continue
    fi

    merged_count=$((merged_count + 1))

    # Verify after each branch merge to catch breakage early
    log "Verifying after merging ${group}..."
    cd "$MERGE_WORKTREE"

    # Only rebuild WASM if Rust source files changed in this merge
    if git diff HEAD~1 --name-only 2>/dev/null | grep -q '^crates/'; then
      log "Rust files changed — rebuilding WASM"
      source "$HOME/.cargo/env" 2>/dev/null || true
      npm run build:wasm 2>/dev/null || warn "WASM build failed after merging ${group}"

      # Commit Cargo.lock if it was modified by the build
      if [[ -n "$(git diff --name-only -- crates/scheduler/Cargo.lock 2>/dev/null)" ]]; then
        git add crates/scheduler/Cargo.lock
        git commit -m "chore: update Cargo.lock after merging ${group}"
      fi
    else
      log "No Rust files changed — skipping WASM rebuild"
    fi

    if ! run_parallel_verification "after merging ${group}"; then
      warn "=== Verification failed after merging ${group} — launching fix agent ==="
      if run_merge_fix_agent "${merge_label} (${group})"; then
        ok "=== Verification issues after ${group} resolved by fix agent ==="
      else
        warn "=== Fix agent could not resolve all issues after ${group} — continuing ==="
      fi
    else
      ok "Verification passed after merging ${group}"
    fi
  done

  if [[ $merged_count -eq 0 ]]; then
    warn "No branches were merged in ${merge_label}"
  fi

  # Cleanup agent worktrees (not the merge worktree — it persists for validate/PR)
  cleanup_worktrees "$2" "$3"

  ok "=== ${merge_label} complete ==="
}
