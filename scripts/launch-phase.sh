#!/usr/bin/env bash
# launch-phase.sh — Orchestrates parallel Claude Code agents for a phase.
#
# Usage:
#   ./scripts/launch-phase.sh all                # full pipeline: stage1 → merge → ... → validate
#   WATCH=1 ./scripts/launch-phase.sh all        # same, with live agent output in tmux
#   ./scripts/launch-phase.sh stage1             # run Stage 1 parallel groups
#   ./scripts/launch-phase.sh merge1             # merge Stage 1 branches to main
#   ./scripts/launch-phase.sh stage2             # run Stage 2 groups
#   ./scripts/launch-phase.sh merge2             # merge Stage 2 branches to main
#   ./scripts/launch-phase.sh stage3             # run Stage 3 groups
#   ./scripts/launch-phase.sh merge3             # merge Stage 3 branches to main
#   ./scripts/launch-phase.sh validate           # run validation agent (fix-and-retry)
#   ./scripts/launch-phase.sh status             # show worktree/branch status
#
# Environment:
#   WATCH=1             — live interactive agent output in tmux panes
#   MAX_RETRIES=3       — retries per agent on crash
#   RETRY_DELAY=5       — seconds between retries
#   VALIDATE_MAX_ATTEMPTS=3 — max fix-and-retry cycles for validation
#   MERGE_FIX_RETRIES=3 — retries for merge conflict resolution
#   PROMPTS_DIR         — path to prompt files (default: docs/prompts/phase13)
#   WORKTREE_BASE       — worktree root (default: /workspace/.claude/worktrees)

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

MAX_RETRIES="${MAX_RETRIES:-3}"
RETRY_DELAY="${RETRY_DELAY:-5}"
MERGE_FIX_RETRIES="${MERGE_FIX_RETRIES:-3}"
DEFAULT_MAX_TURNS="${DEFAULT_MAX_TURNS:-80}"
DEFAULT_MAX_BUDGET="${DEFAULT_MAX_BUDGET:-10.00}"
STALL_TIMEOUT="${STALL_TIMEOUT:-30}"  # minutes before warning about stalled agent
# Per-agent model override: MODEL=sonnet run_agent groupH "$workdir"
# Default: uses Claude's default model. Options: opus, sonnet, haiku
PROMPTS_DIR="${PROMPTS_DIR:-docs/prompts/phase13}"
WORKTREE_BASE="${WORKTREE_BASE:-/workspace/.claude/worktrees}"
WORKSPACE="/workspace"
# Set WATCH=1 to see full live agent output in tmux panes
WATCH="${WATCH:-0}"
PHASE="phase13"

LOG_DIR="${WORKSPACE}/logs/${PHASE}"
TMUX_SESSION="${PHASE}-agents"

# Stage 1: Agent infrastructure improvements (4 groups, parallel, zero file overlap)
STAGE1_GROUPS=("groupA" "groupB" "groupC" "groupD")
STAGE1_BRANCHES=(
  "feature/phase13-claude-skills"
  "feature/phase13-orchestrator"
  "feature/phase13-hooks-guardrails"
  "feature/phase13-github-pipeline"
)
STAGE1_MERGE_MESSAGES=(
  "Merge feature/phase13-claude-skills: restructure CLAUDE.md to lean core, create .claude/skills/ with 8 domain skills, extract reference docs"
  "Merge feature/phase13-orchestrator: enrich retry context, add --max-turns/budget, improve merge conflict context, partial stage success, preflight, model selection, stall detection"
  "Merge feature/phase13-hooks-guardrails: scope-aware verify.sh, output dedup, rate limiting, compact output, pre-commit hook"
  "Merge feature/phase13-github-pipeline: issue template, quality gate workflow, overhaul agent-work.yml with retry and complexity routing"
)

# No Stage 2 or 3 needed — single parallel stage
STAGE2_GROUPS=()
STAGE2_BRANCHES=()
STAGE2_MERGE_MESSAGES=()

# Stage 3: empty
STAGE3_GROUPS=()
STAGE3_BRANCHES=()
STAGE3_MERGE_MESSAGES=()

# ── Helpers ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] OK:${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARN:${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} $*"; }

mkdir -p "$LOG_DIR"

# ── Agent runner with retry loop ──────────────────────────────────────────────

run_agent() {
  local group="$1"
  local workdir="$2"
  local prompt_file="${WORKSPACE}/${PROMPTS_DIR}/${group}.md"
  local logfile="${LOG_DIR}/${group}.log"

  if [[ ! -f "$prompt_file" ]]; then
    err "Prompt file not found: $prompt_file"
    return 1
  fi

  local prompt
  prompt="$(cat "$prompt_file")"

  log "Starting ${group} in ${workdir} (log: ${logfile})"

  for attempt in $(seq 1 "$MAX_RETRIES"); do
    log "${group}: attempt ${attempt}/${MAX_RETRIES}"

    # If retrying, add rich context about the restart
    local full_prompt="$prompt"
    if [[ $attempt -gt 1 ]]; then
      local recent_commits
      recent_commits=$(cd "$workdir" && git log --oneline -5 2>/dev/null || echo "(no commits yet)")
      local prev_log_tail
      prev_log_tail=$(tail -100 "$logfile" 2>/dev/null | head -80 || echo "(no previous output)")
      local progress=""
      if [[ -f "${workdir}/claude-progress.txt" ]]; then
        progress=$(cat "${workdir}/claude-progress.txt")
      fi
      full_prompt="NOTE: You are being restarted after a crash. This is attempt ${attempt}/${MAX_RETRIES}.

Your recent commits in this worktree:
${recent_commits}

Last output from your previous attempt (may contain the error that caused the crash):
\`\`\`
${prev_log_tail}
\`\`\`

Your progress file (tasks completed so far):
${progress}

Review what has already been done. Do NOT redo completed work. If the output above shows a specific error, fix that error first.

---

${prompt}"
    fi

    # Run claude, capturing exit code
    local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
    local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
    local model_flag=""
    [[ -n "${MODEL:-}" ]] && model_flag="--model $MODEL"
    set +e
    (
      cd "$workdir"
      # shellcheck disable=SC2086
      echo "$full_prompt" | claude --dangerously-skip-permissions --max-turns "$max_turns" --max-budget-usd "$max_budget" $model_flag -p -
    ) >> "$logfile" 2>&1
    local exit_code=$?
    set -e

    if [[ $exit_code -eq 0 ]]; then
      ok "${group}: completed successfully"
      return 0
    fi

    warn "${group}: exited with code ${exit_code}"

    if [[ $attempt -lt $MAX_RETRIES ]]; then
      log "${group}: retrying in ${RETRY_DELAY}s..."
      sleep "$RETRY_DELAY"
    fi
  done

  err "${group}: failed after ${MAX_RETRIES} attempts. Check ${logfile}"
  return 1
}

# ── Stall detection watchdog ─────────────────────────────────────────────────

monitor_agent() {
  local agent_pid="$1"
  local workdir="$2"
  local group="$3"
  local timeout_minutes="${STALL_TIMEOUT:-30}"
  local logfile="${LOG_DIR}/${group}.log"
  local last_size=0
  local last_activity
  last_activity=$(date +%s)

  while kill -0 "$agent_pid" 2>/dev/null; do
    sleep 60

    # Check if the log file is growing
    local current_size=0
    [[ -f "$logfile" ]] && current_size=$(stat -c %s "$logfile" 2>/dev/null || echo 0)

    if [[ "$current_size" != "$last_size" ]]; then
      last_size=$current_size
      last_activity=$(date +%s)
    else
      local now
      now=$(date +%s)
      local elapsed_since_activity=$(( (now - last_activity) / 60 ))
      if [[ $elapsed_since_activity -ge $timeout_minutes ]]; then
        warn "${group}: no log activity in ${elapsed_since_activity} minutes — may be stuck"
      fi
    fi
  done
}

# ── Worktree setup ───────────────────────────────────────────────────────────

setup_worktree() {
  local group="$1"
  local branch="$2"
  local worktree="${WORKTREE_BASE}/${PHASE}-${group}"

  if [[ ! -d "$worktree" ]]; then
    log "Creating worktree: ${worktree} (branch: ${branch})" >&2
    cd "$WORKSPACE"
    git worktree add "$worktree" -b "$branch" >/dev/null 2>&1 || \
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

  # Only the path goes to stdout — log calls go to stderr
  echo "$worktree"
}

# ── WATCH mode: tmux-based interactive output ────────────────────────────────

# Build the claude command string for a group.
# Generates a wrapper script with retry loop, log capture, and crash context
# injection — mirroring the non-WATCH run_agent() behavior.
build_claude_cmd() {
  local group="$1"
  local workdir="$2"
  local prompt_file="${WORKSPACE}/${PROMPTS_DIR}/${group}.md"
  local exitcode_file="${LOG_DIR}/${group}.exit"
  local logfile="${LOG_DIR}/${group}.log"

  local wrapper="${LOG_DIR}/${group}-run.sh"
  cat > "$wrapper" <<'WRAPPER_OUTER'
#!/usr/bin/env bash
set -uo pipefail

GROUP="PLACEHOLDER_GROUP"
WORKDIR="PLACEHOLDER_WORKDIR"
PROMPT_FILE="PLACEHOLDER_PROMPT_FILE"
EXITCODE_FILE="PLACEHOLDER_EXITCODE_FILE"
LOGFILE="PLACEHOLDER_LOGFILE"
MAX_RETRIES="PLACEHOLDER_MAX_RETRIES"
RETRY_DELAY="PLACEHOLDER_RETRY_DELAY"
MAX_TURNS_VAL="PLACEHOLDER_MAX_TURNS"
MAX_BUDGET_VAL="PLACEHOLDER_MAX_BUDGET"
MODEL_FLAG="PLACEHOLDER_MODEL_FLAG"

PROMPT="$(cat "$PROMPT_FILE")"

cd "$WORKDIR"

for attempt in $(seq 1 "$MAX_RETRIES"); do
  echo "=== ${GROUP}: attempt ${attempt}/${MAX_RETRIES} ==="

  FULL_PROMPT="$PROMPT"
  if [[ $attempt -gt 1 ]]; then
    RECENT_COMMITS=$(git log --oneline -5 2>/dev/null || echo "(no commits yet)")
    PREV_LOG_TAIL=$(tail -100 "$LOGFILE" 2>/dev/null | head -80 || echo "(no previous output)")
    PROGRESS=""
    if [[ -f "${WORKDIR}/claude-progress.txt" ]]; then
      PROGRESS=$(cat "${WORKDIR}/claude-progress.txt")
    fi
    FULL_PROMPT="NOTE: You are being restarted after a crash. This is attempt ${attempt}/${MAX_RETRIES}.

Your recent commits in this worktree:
${RECENT_COMMITS}

Last output from your previous attempt (may contain the error that caused the crash):
\`\`\`
${PREV_LOG_TAIL}
\`\`\`

Your progress file (tasks completed so far):
${PROGRESS}

Review what has already been done. Do NOT redo completed work. If the output above shows a specific error, fix that error first.

---

${PROMPT}"
  fi

  # Run claude, capturing output to log AND showing in tmux
  # PIPESTATUS: [0]=echo [1]=claude [2]=tee — we want claude's exit code
  # shellcheck disable=SC2086
  echo "$FULL_PROMPT" | claude --dangerously-skip-permissions --max-turns "$MAX_TURNS_VAL" --max-budget-usd "$MAX_BUDGET_VAL" $MODEL_FLAG -p - 2>&1 | tee -a "$LOGFILE"
  EXIT_CODE=${PIPESTATUS[1]:-$?}

  if [[ $EXIT_CODE -eq 0 ]]; then
    echo "=== ${GROUP}: completed successfully ==="
    echo "0" > "$EXITCODE_FILE"
    exit 0
  fi

  echo "=== ${GROUP}: exited with code ${EXIT_CODE} ==="

  if [[ $attempt -lt $MAX_RETRIES ]]; then
    echo "=== ${GROUP}: retrying in ${RETRY_DELAY}s... ==="
    sleep "$RETRY_DELAY"
  fi
done

echo "=== ${GROUP}: FAILED after ${MAX_RETRIES} attempts ==="
echo "1" > "$EXITCODE_FILE"
exit 1
WRAPPER_OUTER

  # Substitute placeholders with actual values
  sed -i "s|PLACEHOLDER_GROUP|${group}|g" "$wrapper"
  sed -i "s|PLACEHOLDER_WORKDIR|${workdir}|g" "$wrapper"
  sed -i "s|PLACEHOLDER_PROMPT_FILE|${prompt_file}|g" "$wrapper"
  sed -i "s|PLACEHOLDER_EXITCODE_FILE|${exitcode_file}|g" "$wrapper"
  sed -i "s|PLACEHOLDER_LOGFILE|${logfile}|g" "$wrapper"
  sed -i "s|PLACEHOLDER_MAX_RETRIES|${MAX_RETRIES}|g" "$wrapper"
  sed -i "s|PLACEHOLDER_RETRY_DELAY|${RETRY_DELAY}|g" "$wrapper"
  sed -i "s|PLACEHOLDER_MAX_TURNS|${MAX_TURNS:-$DEFAULT_MAX_TURNS}|g" "$wrapper"
  sed -i "s|PLACEHOLDER_MAX_BUDGET|${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}|g" "$wrapper"
  local model_flag_val=""
  [[ -n "${MODEL:-}" ]] && model_flag_val="--model $MODEL"
  sed -i "s|PLACEHOLDER_MODEL_FLAG|${model_flag_val}|g" "$wrapper"

  chmod +x "$wrapper"
  echo "$wrapper"
}

# Launch all agents in tmux panes and wait for them to finish.
watch_parallel_stage() {
  local stage_label="$1"
  local -n w_groups_ref="$2"
  local -n w_branches_ref="$3"

  log "=== ${stage_label} (WATCH mode): Launching agents in tmux ==="

  # Kill any existing session with this name
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

  local first=true
  for i in "${!w_groups_ref[@]}"; do
    local group="${w_groups_ref[$i]}"
    local branch="${w_branches_ref[$i]}"

    # Setup worktree
    local worktree
    worktree=$(setup_worktree "$group" "$branch") || continue

    # Clean up exit code file from prior runs
    rm -f "${LOG_DIR}/${group}.exit"

    # Build the wrapper script
    local wrapper
    wrapper=$(build_claude_cmd "$group" "$worktree")

    if $first; then
      # Create the tmux session with the first agent
      tmux new-session -d -s "$TMUX_SESSION" -n "$group" \
        "$wrapper; echo ''; echo '══════════════════════════════════════════════'; echo \"── ${group} finished (exit code: \$(cat '${LOG_DIR}/${group}.exit' 2>/dev/null || echo '?'))  Press Enter to close ──\"; echo '══════════════════════════════════════════════'; read"
      first=false
    else
      # Add a new window for each additional agent
      tmux new-window -t "$TMUX_SESSION" -n "$group" \
        "$wrapper; echo ''; echo '══════════════════════════════════════════════'; echo \"── ${group} finished (exit code: \$(cat '${LOG_DIR}/${group}.exit' 2>/dev/null || echo '?'))  Press Enter to close ──\"; echo '══════════════════════════════════════════════'; read"
    fi

    log "${group} launched in tmux window '${group}'"
  done

  echo ""
  log "╔══════════════════════════════════════════════════════════════╗"
  log "║  Agents running in tmux session: ${TMUX_SESSION}"
  log "║  Attach to watch:  tmux attach -t ${TMUX_SESSION}          "
  log "║  Switch windows:   Ctrl-B then N (next) or P (previous)    "
  log "║  Detach:           Ctrl-B then D                           "
  log "╚══════════════════════════════════════════════════════════════╝"
  echo ""

  # Poll for all agents to complete (check for exit code files)
  log "Waiting for all agents to finish..."
  while true; do
    local all_done=true
    for i in "${!w_groups_ref[@]}"; do
      local group="${w_groups_ref[$i]}"
      if [[ ! -f "${LOG_DIR}/${group}.exit" ]]; then
        all_done=false
        break
      fi
    done
    if $all_done; then
      break
    fi
    sleep 5
  done

  # Collect results, tracking success/failure per group
  local succeeded_groups=()
  local failed_groups=()
  for i in "${!w_groups_ref[@]}"; do
    local group="${w_groups_ref[$i]}"
    local rc
    rc=$(cat "${LOG_DIR}/${group}.exit" 2>/dev/null || echo "1")
    if [[ "$rc" -ne 0 ]]; then
      err "${group} failed with exit code ${rc}"
      failed_groups+=("$group")
    else
      ok "${group} finished successfully"
      succeeded_groups+=("$group")
    fi
  done

  # Write result files so the merge stage knows which groups to skip
  echo "${succeeded_groups[*]}" > "${LOG_DIR}/stage-succeeded.txt"
  echo "${failed_groups[*]}" > "${LOG_DIR}/stage-failed.txt"

  # Clean up tmux session
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

  if [[ ${#failed_groups[@]} -eq 0 ]]; then
    ok "=== ${stage_label} complete: all agents finished ==="
  elif [[ ${#succeeded_groups[@]} -gt 0 ]]; then
    warn "=== ${stage_label} partial success: ${succeeded_groups[*]} succeeded, ${failed_groups[*]} failed ==="
  else
    err "=== ${stage_label} ALL groups failed ==="
    return 1
  fi
}

# Run the validation agent in a tmux window with live output.
watch_validate() {
  local prompt_file="${WORKSPACE}/${PROMPTS_DIR}/validate.md"
  local max_attempts="${VALIDATE_MAX_ATTEMPTS:-3}"
  local exitcode_file="${LOG_DIR}/validate.exit"

  if [[ ! -f "$prompt_file" ]]; then
    warn "No validation prompt found at $prompt_file — skipping."
    return 0
  fi

  log "=== Validation (WATCH mode) ==="

  for attempt in $(seq 1 "$max_attempts"); do
    rm -f "$exitcode_file"

    # Build prompt (with retry context if applicable)
    local prompt_to_use="$prompt_file"
    if [[ $attempt -gt 1 ]]; then
      # Write augmented prompt to a temp file
      local prev_log="${LOG_DIR}/validate-attempt$((attempt - 1)).log"
      local prev_report
      prev_report=$(sed -n '/║.*CHECK/,/║.*OVERALL/p' "$prev_log" 2>/dev/null || echo "")
      local prev_errors
      prev_errors=$(grep -E '(error\[|FAILED|panicked|assertion.*failed)' "$prev_log" 2>/dev/null | tail -20 || echo "")
      local prev_failures="Previous validation report:
${prev_report}

Specific errors from previous attempt:
${prev_errors}"
      prompt_to_use="${LOG_DIR}/validate-prompt-attempt${attempt}.md"
      {
        echo "NOTE: This is validation attempt ${attempt}/${max_attempts}. Previous attempt found failures:"
        echo ""
        echo "$prev_failures"
        echo ""
        echo "You MUST fix the issues above before re-running checks."
        echo ""
        cat "$prompt_file"
      } > "$prompt_to_use"
    fi

    local logfile="${LOG_DIR}/validate-attempt${attempt}.log"

    # Write a wrapper script for tmux — captures log AND shows in tmux via tee.
    local wrapper="${LOG_DIR}/validate-run.sh"
    cat > "$wrapper" <<WRAPPER
#!/usr/bin/env bash
set -uo pipefail
cd "$WORKSPACE"
# PIPESTATUS: [0]=claude [1]=tee — we want claude's exit code
claude --dangerously-skip-permissions --max-turns "${MAX_TURNS:-$DEFAULT_MAX_TURNS}" --max-budget-usd "${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}" -p "\$(cat '$prompt_to_use')" 2>&1 | tee "$logfile"
EXIT_CODE=\${PIPESTATUS[0]:-\$?}
echo "\$EXIT_CODE" > "$exitcode_file"
exit "\$EXIT_CODE"
WRAPPER
    chmod +x "$wrapper"

    # Run in tmux
    tmux kill-session -t "${TMUX_SESSION}-validate" 2>/dev/null || true
    tmux new-session -d -s "${TMUX_SESSION}-validate" -n "validate" "$wrapper; echo '── validate finished ──'; read"

    log "Validation attempt ${attempt}/${max_attempts} running in tmux session: ${TMUX_SESSION}-validate"
    log "Attach to watch:  tmux attach -t ${TMUX_SESSION}-validate"

    # Wait for completion
    while [[ ! -f "$exitcode_file" ]]; do
      sleep 5
    done

    local exit_code
    exit_code=$(cat "$exitcode_file")

    tmux kill-session -t "${TMUX_SESSION}-validate" 2>/dev/null || true

    if [[ "$exit_code" -ne 0 ]]; then
      warn "Validation agent exited with code ${exit_code} on attempt ${attempt}"
      if [[ $attempt -lt $max_attempts ]]; then
        sleep "$RETRY_DELAY"
        continue
      fi
      err "Validation agent failed after ${max_attempts} attempts"
      return 1
    fi

    if grep -v "COMMAND=" "$logfile" | grep -q "OVERALL.*FAIL"; then
      if [[ $attempt -lt $max_attempts ]]; then
        warn "Validation found failures on attempt ${attempt} — retrying..."
        sleep "$RETRY_DELAY"
        continue
      fi
      err "Validation FAILED after ${max_attempts} attempts"
      return 1
    fi

    ok "Validation PASSED on attempt ${attempt}"
    return 0
  done
}

# ── Preflight check ──────────────────────────────────────────────────────────

preflight_check() {
  log "=== Preflight check ==="

  # Clean git state
  if [[ -n "$(cd "$WORKSPACE" && git status --porcelain)" ]]; then
    err "Dirty git state — commit or stash changes before launching agents"
    return 1
  fi

  # Check that prompt files exist
  local prompts_exist=true
  for group in "$@"; do
    if [[ ! -f "${WORKSPACE}/${PROMPTS_DIR}/${group}.md" ]]; then
      err "Missing prompt file: ${PROMPTS_DIR}/${group}.md"
      prompts_exist=false
    fi
  done
  $prompts_exist || return 1

  # Quick build check — verify WASM builds and basic compilation
  log "Checking WASM build..."
  if ! (cd "$WORKSPACE" && npm run build:wasm > /dev/null 2>&1); then
    err "WASM build broken — fix before launching agents"
    return 1
  fi

  ok "Preflight check passed"
}

# ── Generic parallel stage runner ─────────────────────────────────────────────

# Usage: run_parallel_stage "Stage 1" STAGE1_GROUPS STAGE1_BRANCHES
run_parallel_stage() {
  local stage_label="$1"
  local -n groups_ref="$2"
  local -n branches_ref="$3"

  # Run preflight checks before launching agents
  preflight_check "${groups_ref[@]}" || return 1

  # Delegate to tmux-based runner in WATCH mode
  if [[ "$WATCH" == "1" ]]; then
    watch_parallel_stage "$stage_label" "$2" "$3"
    return $?
  fi

  log "=== ${stage_label}: Launching parallel groups ==="

  local pids=()
  local monitor_pids=()
  local groups_list=()

  for i in "${!groups_ref[@]}"; do
    local group="${groups_ref[$i]}"
    local branch="${branches_ref[$i]}"

    local worktree
    worktree=$(setup_worktree "$group" "$branch") || continue

    # Launch agent in background
    run_agent "$group" "$worktree" &
    local agent_pid=$!
    pids+=($agent_pid)
    groups_list+=("$group")

    # Launch stall detection watchdog
    monitor_agent "$agent_pid" "$worktree" "$group" &
    monitor_pids+=($!)

    log "${group} launched (PID: ${agent_pid})"
  done

  # Wait for all parallel agents, tracking success/failure per group
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

  # Kill stall detection monitors
  for mpid in "${monitor_pids[@]}"; do
    kill "$mpid" 2>/dev/null || true
  done

  # Write result files so the merge stage knows which groups to skip
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

# ── Generic merge ─────────────────────────────────────────────────────────────

# Resolve merge conflicts by launching a claude agent.
# Expects to be called while conflicted files exist in the working tree.
resolve_merge_conflicts() {
  local branch="$1"
  local msg="$2"
  local conflicts
  conflicts=$(cd "$WORKSPACE" && git diff --name-only --diff-filter=U)

  if [[ -z "$conflicts" ]]; then
    warn "resolve_merge_conflicts called but no conflicted files found"
    return 1
  fi

  log "Conflicted files:"
  echo "$conflicts" | while read -r f; do log "  $f"; done

  # Capture conflict markers from each file (first 200 lines)
  local conflict_diffs=""
  while IFS= read -r f; do
    conflict_diffs+="
=== $f ===
$(head -200 "$f")
"
  done <<< "$conflicts"

  # Get branch commit summary
  local branch_summary
  branch_summary=$(git log --oneline main.."$branch" 2>/dev/null | head -10 || echo "(no commits)")

  local fix_prompt="You are resolving git merge conflicts in the Ganttlet project.
The branch '${branch}' is being merged into main. The following files have conflicts:

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

  cd "$WORKSPACE"

  if [[ "$WATCH" == "1" ]]; then
    local fix_prompt_file="${LOG_DIR}/merge-fix-${branch//\//-}.md"
    echo "$fix_prompt" > "$fix_prompt_file"
    local exitcode_file="${LOG_DIR}/merge-fix.exit"
    rm -f "$exitcode_file"

    local wrapper="${LOG_DIR}/merge-fix-run.sh"
    cat > "$wrapper" <<WRAPPER
#!/usr/bin/env bash
cd "$WORKSPACE"
claude --dangerously-skip-permissions --max-turns "${MAX_TURNS:-$DEFAULT_MAX_TURNS}" --max-budget-usd "${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}" -p "\$(cat '$fix_prompt_file')"
echo \$? > "$exitcode_file"
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
    echo "$fix_prompt" | claude --dangerously-skip-permissions --max-turns "${MAX_TURNS:-$DEFAULT_MAX_TURNS}" --max-budget-usd "${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}" -p - >> "${LOG_DIR}/merge-fix.log" 2>&1
    return $?
  fi
}

# Merge a single branch into main with conflict resolution and retries.
merge_branch_with_retries() {
  local branch="$1"
  local msg="$2"

  for attempt in $(seq 1 "$MERGE_FIX_RETRIES"); do
    log "Merging ${branch}... (attempt ${attempt}/${MERGE_FIX_RETRIES})"

    if git merge "$branch" --no-ff -m "$msg"; then
      ok "Merged ${branch}"
      return 0
    fi

    warn "Merge conflict on ${branch} (attempt ${attempt}/${MERGE_FIX_RETRIES})"

    # Launch agent to resolve conflicts
    if resolve_merge_conflicts "$branch" "$msg"; then
      # Check if the merge was completed
      if ! git diff --name-only --diff-filter=U | grep -q .; then
        ok "Merge conflicts resolved for ${branch}"
        return 0
      else
        warn "Conflicts remain after fix attempt ${attempt}"
      fi
    else
      warn "Merge-fix agent failed on attempt ${attempt}"
    fi

    # Abort the failed merge and retry
    if [[ $attempt -lt $MERGE_FIX_RETRIES ]]; then
      git merge --abort 2>/dev/null || true
      sleep "$RETRY_DELAY"
    fi
  done

  err "Could not resolve merge conflicts for ${branch} after ${MERGE_FIX_RETRIES} attempts"
  git merge --abort 2>/dev/null || true
  return 1
}

# Usage: do_merge_stage "Merge 1" STAGE1_GROUPS STAGE1_BRANCHES STAGE1_MERGE_MESSAGES
do_merge_stage() {
  local merge_label="$1"
  local -n m_groups_ref="$2"
  local -n m_branches_ref="$3"
  local -n m_messages_ref="$4"

  log "=== ${merge_label}: Combining parallel branches into main ==="

  cd "$WORKSPACE"

  # Ensure we're on main
  local current_branch
  current_branch=$(git branch --show-current)
  if [[ "$current_branch" != "main" ]]; then
    warn "Not on main (on ${current_branch}). Switching..."
    git checkout main
  fi

  # Check which groups succeeded (if stage result files exist)
  local succeeded=""
  [[ -f "${LOG_DIR}/stage-succeeded.txt" ]] && succeeded=$(cat "${LOG_DIR}/stage-succeeded.txt")

  # Merge each branch with automatic conflict resolution
  local merge_failures=0
  for i in "${!m_branches_ref[@]}"; do
    local group="${m_groups_ref[$i]}"
    local branch="${m_branches_ref[$i]}"
    local msg="${m_messages_ref[$i]}"

    # Skip groups that failed in the parallel stage
    if [[ -n "$succeeded" ]] && ! echo " $succeeded " | grep -q " $group "; then
      warn "Skipping merge of ${group} (failed in parallel stage)"
      continue
    fi

    if ! merge_branch_with_retries "$branch" "$msg"; then
      err "Failed to merge ${branch} — continuing with remaining branches"
      merge_failures=$((merge_failures + 1))
    fi
  done

  # Rebuild WASM (Rust source may have changed in a parallel branch)
  log "Rebuilding WASM..."
  source "$HOME/.cargo/env" 2>/dev/null || true
  npm run build:wasm || warn "WASM build failed (may not have Rust changes)"

  # Verify build
  log "Verifying merged code..."
  local verify_ok=true

  log "Running tsc..."
  if ! npx tsc --noEmit; then
    err "TypeScript check failed after merge"
    verify_ok=false
  fi

  log "Running vitest..."
  if ! npm run test; then
    err "Unit tests failed after merge"
    verify_ok=false
  fi

  log "Running cargo test..."
  if ! (source "$HOME/.cargo/env" 2>/dev/null; cd crates/scheduler && cargo test); then
    err "Rust tests failed after merge"
    verify_ok=false
  fi

  if ! $verify_ok; then
    warn "=== ${merge_label} verification found issues — continuing to next stage ==="
    warn "The validation agent will fix remaining issues at the end of the pipeline."
  fi

  # Cleanup worktrees
  log "Cleaning up worktrees..."
  for i in "${!m_groups_ref[@]}"; do
    local group="${m_groups_ref[$i]}"
    local branch="${m_branches_ref[$i]}"
    local worktree="${WORKTREE_BASE}/${PHASE}-${group}"
    if [[ -d "$worktree" ]]; then
      git worktree remove "$worktree" --force 2>/dev/null || \
        warn "Could not remove worktree: ${worktree}"
    fi
    git branch -d "$branch" 2>/dev/null || \
      warn "Could not delete branch: ${branch}"
  done

  ok "=== ${merge_label} complete and verified ==="
}

# ── Stage entry points ────────────────────────────────────────────────────────

stage1() {
  run_parallel_stage "Stage 1" STAGE1_GROUPS STAGE1_BRANCHES
}

merge1() {
  do_merge_stage "Merge 1" STAGE1_GROUPS STAGE1_BRANCHES STAGE1_MERGE_MESSAGES
}

stage2() {
  if [[ ${#STAGE2_GROUPS[@]} -eq 0 ]]; then
    ok "No Stage 2 groups configured. Skipping."
    return 0
  fi
  run_parallel_stage "Stage 2" STAGE2_GROUPS STAGE2_BRANCHES
}

merge2() {
  if [[ ${#STAGE2_GROUPS[@]} -eq 0 ]]; then
    ok "No Stage 2 groups configured. Skipping."
    return 0
  fi
  do_merge_stage "Merge 2" STAGE2_GROUPS STAGE2_BRANCHES STAGE2_MERGE_MESSAGES
}

stage3() {
  if [[ ${#STAGE3_GROUPS[@]} -eq 0 ]]; then
    ok "No Stage 3 groups configured. Skipping."
    return 0
  fi
  run_parallel_stage "Stage 3" STAGE3_GROUPS STAGE3_BRANCHES
}

merge3() {
  if [[ ${#STAGE3_GROUPS[@]} -eq 0 ]]; then
    ok "No Stage 3 groups configured. Skipping."
    return 0
  fi
  do_merge_stage "Merge 3" STAGE3_GROUPS STAGE3_BRANCHES STAGE3_MERGE_MESSAGES
}

# ── Full pipeline ─────────────────────────────────────────────────────────────

validate() {
  # Delegate to tmux-based runner in WATCH mode
  if [[ "$WATCH" == "1" ]]; then
    watch_validate
    return $?
  fi

  local prompt_file="${WORKSPACE}/${PROMPTS_DIR}/validate.md"
  local max_attempts="${VALIDATE_MAX_ATTEMPTS:-3}"

  if [[ ! -f "$prompt_file" ]]; then
    warn "No validation prompt found at $prompt_file — skipping."
    return 0
  fi

  log "=== Running validation agent (up to ${max_attempts} attempts) ==="

  for attempt in $(seq 1 "$max_attempts"); do
    local logfile="${LOG_DIR}/validate-attempt${attempt}.log"
    local prompt
    prompt="$(cat "$prompt_file")"

    # On retry, tell the agent about previous failures
    if [[ $attempt -gt 1 ]]; then
      local prev_log="${LOG_DIR}/validate-attempt$((attempt - 1)).log"
      local prev_report
      prev_report=$(sed -n '/║.*CHECK/,/║.*OVERALL/p' "$prev_log" 2>/dev/null || echo "")
      local prev_errors
      prev_errors=$(grep -E '(error\[|FAILED|panicked|assertion.*failed)' "$prev_log" 2>/dev/null | tail -20 || echo "")
      local prev_failures="Previous validation report:
${prev_report}

Specific errors from previous attempt:
${prev_errors}"
      prompt="NOTE: This is validation attempt ${attempt}/${max_attempts}. Previous attempt found failures:

${prev_failures}

You MUST fix the issues above before re-running checks. Read the failing test output, diagnose the
root cause, apply fixes, and then re-run ALL checks to confirm everything passes.

${prompt}"
    fi

    log "Validation attempt ${attempt}/${max_attempts} (log: ${logfile})"
    cd "$WORKSPACE"

    local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
    local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
    echo "$prompt" | claude --dangerously-skip-permissions --max-turns "$max_turns" --max-budget-usd "$max_budget" -p - > "$logfile" 2>&1
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
      warn "Validation agent exited with code ${exit_code} on attempt ${attempt}"
      if [[ $attempt -lt $max_attempts ]]; then
        log "Retrying validation..."
        sleep "$RETRY_DELAY"
        continue
      fi
      err "Validation agent failed after ${max_attempts} attempts"
      err "Check logs: ${LOG_DIR}/validate-attempt*.log"
      return 1
    fi

    # Print the validation report (last 40 lines should contain the summary table)
    echo ""
    log "=== Validation Report (attempt ${attempt}) ==="
    tail -40 "$logfile"
    echo ""

    # Check if the report contains FAIL
    if grep -v "COMMAND=" "$logfile" | grep -q "OVERALL.*FAIL"; then
      if [[ $attempt -lt $max_attempts ]]; then
        warn "Validation found failures on attempt ${attempt} — retrying with fixes..."
        sleep "$RETRY_DELAY"
        continue
      fi
      err "Validation FAILED after ${max_attempts} attempts — see report above"
      return 1
    fi

    ok "Validation PASSED on attempt ${attempt}"
    return 0
  done
}

run_pipeline() {
  local start_from="${1:-stage1}"
  local pipeline_ok=true
  local started=false

  log "=== Pipeline starting from: ${start_from} ==="

  local steps=("stage1" "merge1" "stage2" "merge2" "stage3" "merge3" "validate")
  for step in "${steps[@]}"; do
    if [[ "$step" == "$start_from" ]]; then
      started=true
    fi
    if ! $started; then
      log "Skipping ${step} (resuming from ${start_from})"
      continue
    fi

    if [[ "$step" == "validate" ]]; then
      # Validation always runs — it's the cleanup/fix step
      if validate; then
        ok "=== Pipeline complete — validation passed ==="
      else
        err "=== Pipeline complete — validation FAILED ==="
        pipeline_ok=false
      fi
    else
      $step || { warn "${step} had failures — continuing pipeline"; pipeline_ok=false; }
    fi
  done

  $pipeline_ok || { err "Pipeline had issues — review logs in ${LOG_DIR}"; return 1; }
}

run_all() {
  run_pipeline "stage1"
}

# ── CLI ───────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
Usage: ./scripts/launch-phase.sh <command>

Commands:
  stage1    Run Stage 1 parallel groups in worktrees
  merge1    Merge Stage 1 branches to main + verify
  stage2    Run Stage 2 groups in worktrees
  merge2    Merge Stage 2 branches to main + verify
  stage3    Run Stage 3 groups in worktrees
  merge3    Merge Stage 3 branches to main + verify
  validate  Run validation agent (checks all tests, fixes issues, reports)
  all       Full pipeline: stage1 → merge1 → ... → merge3 → validate
  resume <step>  Resume pipeline from a specific step (e.g., resume merge1)
  status    Show current worktree and branch status
  logs      Tail agent logs

Environment variables:
  MAX_RETRIES=3              Retries per agent on crash
  RETRY_DELAY=5              Seconds between retries
  VALIDATE_MAX_ATTEMPTS=3    Max fix-and-retry cycles for validation
  MERGE_FIX_RETRIES=3        Retries for merge conflict resolution
  WATCH=1                    Live interactive agent output in tmux panes
USAGE
}

show_status() {
  log "=== Current status ==="
  echo ""
  echo "Git worktrees:"
  cd "$WORKSPACE" && git worktree list
  echo ""
  echo "Branches:"
  cd "$WORKSPACE" && git branch -v
  echo ""
  echo "Log files:"
  ls -lh "$LOG_DIR" 2>/dev/null || echo "  (no logs yet)"
}

show_logs() {
  local group="${2:-}"
  if [[ -n "$group" ]]; then
    tail -f "${LOG_DIR}/${group}.log"
  else
    tail -f "${LOG_DIR}"/*.log
  fi
}

case "${1:-}" in
  stage1)   stage1 ;;
  merge1)   merge1 ;;
  stage2)   stage2 ;;
  merge2)   merge2 ;;
  stage3)   stage3 ;;
  merge3)   merge3 ;;
  validate) validate ;;
  all)      run_all ;;
  resume)
    if [[ -z "${2:-}" ]]; then
      err "Usage: ./scripts/launch-phase.sh resume <step>"
      err "Steps: stage1, merge1, stage2, merge2, stage3, merge3, validate"
      exit 1
    fi
    run_pipeline "$2"
    ;;
  status)   show_status ;;
  logs)     show_logs "$@" ;;
  -h|--help) usage ;;
  *)
    usage
    exit 1
    ;;
esac
