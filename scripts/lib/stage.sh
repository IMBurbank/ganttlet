#!/usr/bin/env bash
# scripts/lib/stage.sh — Parallel stage runner (pipe mode and WATCH/tmux mode)

# Preflight check before launching agents.
preflight_check() {
  log "=== Preflight check ==="

  # Verify claude CLI is available
  if ! command -v claude >/dev/null 2>&1; then
    err "claude CLI not found — install it before launching agents"
    return 1
  fi
  log "claude CLI: $(claude --version 2>/dev/null || echo 'available')"

  # Verify tmux if WATCH mode is enabled
  if [[ "$WATCH" == "1" ]] && ! command -v tmux >/dev/null 2>&1; then
    err "WATCH=1 requires tmux but it's not installed"
    return 1
  fi

  # Check the invoking directory for dirty state (worktree or workspace).
  # Curators branch from the invoker's HEAD, so uncommitted changes won't
  # be visible to them.
  if [[ -n "$(git status --porcelain)" ]]; then
    err "Dirty git state — commit or stash changes before launching agents"
    return 1
  fi

  # Check prompt files exist. When SDK_RUNNER=1, reviewer-pattern groups
  # (e.g., hooks-adversarial) use a shared template resolved by the naming
  # convention in run_agent(), so per-group prompt files don't exist for them.
  local _review_angles="accuracy|structure|scope|history|adversarial"
  local prompts_exist=true
  for group in "$@"; do
    if [[ "${SDK_RUNNER:-}" == "1" && "$group" =~ -(${_review_angles})$ ]]; then
      continue  # reviewer groups use shared template
    fi
    if [[ ! -f "${PROMPTS_DIR}/${group}.md" ]]; then
      err "Missing prompt file: ${PROMPTS_DIR}/${group}.md"
      prompts_exist=false
    fi
  done
  $prompts_exist || return 1

  # Verify merge target branch can be created or already exists
  if ! git rev-parse --verify "$MERGE_TARGET" >/dev/null 2>&1; then
    local base_ref="${_LAUNCH_BASE_REF:-main}"
    log "Merge target ${MERGE_TARGET} will be created from ${base_ref}"
  else
    log "Merge target ${MERGE_TARGET} already exists"
  fi

  # Verify worktree isolation hooks (fast, safety-critical — run before slow WASM build)
  local hooks_script="scripts/test-hooks.sh"
  if [[ -f "$hooks_script" ]]; then
    log "Running hook integration tests..."
    if ! bash "$hooks_script"; then
      err "Hook integration tests failed. Fix .claude/settings.json before launching agents."
      return 1
    fi
  fi

  # Ensure WASM artifacts exist in the invoker's worktree.
  # Worktrees are created from git (WASM is gitignored), so they won't have
  # build artifacts. Copy from the main repo if missing.
  local launch_dir="${_LAUNCH_DIR:-.}"
  if [[ ! -d "${launch_dir}/src/wasm/scheduler" ]]; then
    local main_repo
    main_repo="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
    if [[ -d "${main_repo}/src/wasm/scheduler" ]]; then
      log "Copying WASM artifacts from main repo to orchestrator worktree"
      mkdir -p "${launch_dir}/src/wasm"
      cp -r "${main_repo}/src/wasm/scheduler" "${launch_dir}/src/wasm/scheduler"
    fi
  fi

  # Only check WASM build if Rust source files differ from main
  if git diff main --name-only 2>/dev/null | grep -q '^crates/'; then
    log "Rust files changed — checking WASM build..."
    if ! (npm run build:wasm > /dev/null 2>&1); then
      err "WASM build broken — fix before launching agents"
      return 1
    fi
  else
    log "No Rust changes — skipping WASM build check"
  fi

  # Suggest plan review before launch
  if [[ "${SKIP_PLAN_REVIEW:-}" != "1" ]]; then
    log "Tip: Consider running plan-reviewer agent on config before launching phase"
  fi

  ok "Preflight check passed"
}

# Run a parallel stage in pipe mode (background processes).
# Usage: run_parallel_stage "Stage 1" groups_array branches_array
run_parallel_stage() {
  local stage_label="$1"
  local -n rps_groups="$2"
  local -n rps_branches="$3"

  preflight_check "${rps_groups[@]}" || return 1
  setup_merge_target

  if [[ "$WATCH" == "1" ]]; then
    watch_parallel_stage "$stage_label" "$2" "$3"
    return $?
  fi

  log "=== ${stage_label}: Launching parallel groups ==="

  local pids=()
  local monitor_pids=()
  local groups_list=()
  local setup_failures=0

  for i in "${!rps_groups[@]}"; do
    local group="${rps_groups[$i]}"
    local branch="${rps_branches[$i]}"

    local worktree
    worktree=$(setup_worktree "$group" "$branch")
    if [[ $? -ne 0 ]]; then
      err "${group}: worktree setup failed — skipping"
      setup_failures=$((setup_failures + 1))
      continue
    fi

    run_agent "$group" "$worktree" &
    local agent_pid=$!
    pids+=($agent_pid)
    groups_list+=("$group")

    monitor_agent "$agent_pid" "$worktree" "$group" &
    monitor_pids+=($!)

    log "${group} launched (PID: ${agent_pid})"
  done

  if [[ ${#pids[@]} -eq 0 ]]; then
    err "=== ${stage_label}: ALL worktree setups failed — no agents launched ==="
    echo "" > "${LOG_DIR}/stage-succeeded.txt"
    echo "${rps_groups[*]}" > "${LOG_DIR}/stage-failed.txt"
    return 1
  fi

  # Stage-level timeout watchdog
  local stage_start
  stage_start=$(date +%s)
  local timeout_pid=""
  if [[ "${MAX_STAGE_DURATION:-0}" -gt 0 ]]; then
    (
      sleep "$MAX_STAGE_DURATION"
      warn "=== ${stage_label}: stage timeout (${MAX_STAGE_DURATION}s) reached — killing agents ==="
      for pid in "${pids[@]}"; do
        kill -TERM "$pid" 2>/dev/null || true
      done
      sleep 5
      for pid in "${pids[@]}"; do
        kill -9 "$pid" 2>/dev/null || true
      done
    ) &
    timeout_pid=$!
  fi

  local succeeded_groups=()
  local failed_groups=()

  for i in "${!pids[@]}"; do
    local pid="${pids[$i]}"
    local group="${groups_list[$i]}"
    set +e
    wait "$pid"
    local rc=$?
    set -e
    if [[ $rc -ne 0 ]]; then
      err "${group} (PID ${pid}) failed with exit code ${rc}"
      failed_groups+=("$group")
    else
      ok "${group} (PID ${pid}) finished"
      succeeded_groups+=("$group")
    fi
  done

  # Kill timeout watchdog if it's still running
  if [[ -n "$timeout_pid" ]]; then
    kill "$timeout_pid" 2>/dev/null || true
  fi

  for mpid in "${monitor_pids[@]}"; do
    kill "$mpid" 2>/dev/null || true
  done

  local stage_end
  stage_end=$(date +%s)
  local stage_elapsed=$(( stage_end - stage_start ))
  log "${stage_label} completed in ${stage_elapsed}s"

  echo "${succeeded_groups[*]}" > "${LOG_DIR}/stage-succeeded.txt"
  echo "${failed_groups[*]}" > "${LOG_DIR}/stage-failed.txt"

  if [[ ${#failed_groups[@]} -eq 0 ]]; then
    ok "=== ${stage_label} complete: all parallel groups finished ==="
  elif [[ ${#succeeded_groups[@]} -gt 0 ]]; then
    warn "=== ${stage_label} partial success: ${succeeded_groups[*]} succeeded, ${failed_groups[*]} failed ==="
    warn "Successful groups will still be merged. Review logs in ${LOG_DIR}"
  else
    err "=== ${stage_label} ALL groups failed. Review logs in ${LOG_DIR} ==="
    return 1
  fi
}
