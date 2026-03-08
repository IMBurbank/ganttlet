#!/usr/bin/env bash
# launch-phase.sh — Orchestrates parallel Claude Code agents for a phase.
#
# Usage:
#   ./scripts/launch-phase.sh all                # full pipeline: stage1 → merge → ... → validate → create-pr
#   WATCH=1 ./scripts/launch-phase.sh all        # same, with live agent output in tmux
#   ./scripts/launch-phase.sh stage1             # run Stage 1 parallel groups
#   ./scripts/launch-phase.sh merge1             # merge Stage 1 branches to implementation branch
#   ./scripts/launch-phase.sh stage2             # run Stage 2 groups
#   ./scripts/launch-phase.sh merge2             # merge Stage 2 branches to implementation branch
#   ./scripts/launch-phase.sh stage3             # run Stage 3 groups
#   ./scripts/launch-phase.sh merge3             # merge Stage 3 branches to implementation branch
#   ./scripts/launch-phase.sh validate           # run validation agent (fix-and-retry)
#   ./scripts/launch-phase.sh create-pr          # create PR to main + trigger code review
#   ./scripts/launch-phase.sh status             # show worktree/branch status
#
# Environment:
#   WATCH=1             — live interactive agent output in tmux panes
#   MAX_RETRIES=3       — retries per agent on crash
#   RETRY_DELAY=5       — seconds between retries
#   VALIDATE_MAX_ATTEMPTS=3 — max fix-and-retry cycles for validation
#   MERGE_FIX_RETRIES=3 — retries for merge conflict resolution
#   PROMPTS_DIR         — path to prompt files (default: docs/prompts/phase14)
#   MERGE_TARGET        — implementation branch (default: feature/<phase>)
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
PROMPTS_DIR="${PROMPTS_DIR:-docs/prompts/phase14}"
WORKTREE_BASE="${WORKTREE_BASE:-/workspace/.claude/worktrees}"
WORKSPACE="/workspace"
# Set WATCH=1 to see full live agent output in tmux panes
WATCH="${WATCH:-0}"
PHASE="phase14"
# Implementation branch — all stage merges target this branch, then a PR is created to main
_USER_MERGE_TARGET="${MERGE_TARGET:-}"  # Preserve user's explicit env var (empty if unset)
MERGE_TARGET="${MERGE_TARGET:-feature/${PHASE}}"

LOG_DIR="${WORKSPACE}/logs/${PHASE}"
TMUX_SESSION="${PHASE}-agents"

# Stage 1: Core Fixes — drag throttle, duration derivation, cascade optimization (3 groups, parallel, zero file overlap)
STAGE1_GROUPS=("groupA" "groupB" "groupC")
STAGE1_BRANCHES=(
  "feature/phase14-drag-throttle"
  "feature/phase14-duration-derive"
  "feature/phase14-cascade-optimize"
)
STAGE1_MERGE_MESSAGES=(
  "Merge feature/phase14-drag-throttle: RAF throttle + CRDT broadcast throttle + dispatch split + SET_TASKS guard (R1, R3)"
  "Merge feature/phase14-duration-derive: duration computed from dates in reducer + Sheets + standardized semantics (R2, R7, R9)"
  "Merge feature/phase14-cascade-optimize: adjacency list O(e*d) cascade + performance instrumentation (R8)"
)

# Stage 2: Sync Resilience + Rendering — atomic drag + structural sync + arrow fixes (2 groups, parallel, zero file overlap)
STAGE2_GROUPS=("groupD" "groupE")
STAGE2_BRANCHES=(
  "feature/phase14-atomic-drag-sync"
  "feature/phase14-arrow-render"
)
STAGE2_MERGE_MESSAGES=(
  "Merge feature/phase14-atomic-drag-sync: COMPLETE_DRAG action + dependency/add/delete CRDT sync (R4, R10)"
  "Merge feature/phase14-arrow-render: arrow consistency guards + memoization (R5)"
)

# Stage 3: Multi-User UX — awareness ghost bar (1 group)
STAGE3_GROUPS=("groupF")
STAGE3_BRANCHES=(
  "feature/phase14-ghost-bar"
)
STAGE3_MERGE_MESSAGES=(
  "Merge feature/phase14-ghost-bar: drag intent via awareness + ghost bar rendering (R6)"
)

# ── Load config from YAML if available ────────────────────────────────────────

load_yaml_config() {
  local config_file="${WORKSPACE}/${PROMPTS_DIR}/launch-config.yaml"
  if [[ ! -f "$config_file" ]]; then
    return 0  # No YAML config — use hardcoded arrays above
  fi

  log "Loading config from ${config_file}"

  PHASE=$(yq -r '.phase' "$config_file")
  # YAML merge_target overrides hardcoded default, but user's env var wins
  local merge_target_yaml
  merge_target_yaml=$(yq -r '.merge_target // empty' "$config_file")
  if [[ -n "$merge_target_yaml" && -z "$_USER_MERGE_TARGET" ]]; then
    MERGE_TARGET="$merge_target_yaml"
  fi

  local num_stages
  num_stages=$(yq -r '.stages | length' "$config_file")

  for ((s=0; s<num_stages; s++)); do
    local stage_num=$((s + 1))
    local num_groups
    num_groups=$(yq -r ".stages[$s].groups | length" "$config_file")

    # Build arrays for this stage
    local groups=() branches=() messages=()
    for ((g=0; g<num_groups; g++)); do
      groups+=("$(yq -r ".stages[$s].groups[$g].id" "$config_file")")
      branches+=("$(yq -r ".stages[$s].groups[$g].branch" "$config_file")")
      messages+=("$(yq -r ".stages[$s].groups[$g].merge_message" "$config_file")")
    done

    # Assign to the STAGE<N>_ arrays dynamically
    case $stage_num in
      1) STAGE1_GROUPS=("${groups[@]}"); STAGE1_BRANCHES=("${branches[@]}"); STAGE1_MERGE_MESSAGES=("${messages[@]}") ;;
      2) STAGE2_GROUPS=("${groups[@]}"); STAGE2_BRANCHES=("${branches[@]}"); STAGE2_MERGE_MESSAGES=("${messages[@]}") ;;
      3) STAGE3_GROUPS=("${groups[@]}"); STAGE3_BRANCHES=("${branches[@]}"); STAGE3_MERGE_MESSAGES=("${messages[@]}") ;;
      *) warn "Stage ${stage_num} defined in YAML but launch-phase.sh only supports stages 1-3" ;;
    esac
  done

  # Update derived values (PHASE may have changed from YAML)
  if [[ -z "$_USER_MERGE_TARGET" && -z "$merge_target_yaml" ]]; then
    MERGE_TARGET="feature/${PHASE}"  # Derive from new PHASE if neither user nor YAML set it
  fi
  LOG_DIR="${WORKSPACE}/logs/${PHASE}"
  TMUX_SESSION="${PHASE}-agents"
}

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

load_yaml_config

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
      if [[ -f "${workdir}/.agent-status.json" ]]; then
        progress=$(cat "${workdir}/.agent-status.json")
      elif [[ -f "${workdir}/claude-progress.txt" ]]; then
        progress="(legacy plain-text format)
$(cat "${workdir}/claude-progress.txt")"
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

  # Only the path goes to stdout — log calls go to stderr
  echo "$worktree"
}

# ── WATCH mode: tmux-based interactive output ────────────────────────────────
#
# Lessons learned from test-watch-interactive.sh:
# 1. Claude interactive (no -p flag) = full rich TUI output
# 2. tmux pipe-pane captures logs WITHOUT breaking TUI rendering
# 3. Idle monitor (background child) kills claude when output stabilizes
# 4. tmux send-keys (not command string) keeps shell alive for scrollback
# 5. Pre-trust workspace via quick -p dry run (interactive shows trust dialog)
# 6. Explicit -t TMUX_TARGET for pipe-pane (avoids wrong-pane bug)

IDLE_THRESHOLD="${IDLE_THRESHOLD:-30}"  # seconds of stable log before killing claude

# Build the wrapper script for a group agent.
# Uses interactive mode (rich TUI) + pipe-pane (log capture) + idle monitor (auto-exit).
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

GROUP="__GROUP__"
WORKDIR="__WORKDIR__"
PROMPT_FILE="__PROMPT_FILE__"
EXITCODE_FILE="__EXITCODE_FILE__"
LOGFILE="__LOGFILE__"
MAX_RETRIES="__MAX_RETRIES__"
RETRY_DELAY="__RETRY_DELAY__"
MAX_TURNS_VAL="__MAX_TURNS__"
MAX_BUDGET_VAL="__MAX_BUDGET__"
MODEL_FLAG="__MODEL_FLAG__"
TMUX_TARGET="__TMUX_TARGET__"
IDLE_THRESHOLD="__IDLE_THRESHOLD__"

cd "$WORKDIR"

# Pre-trust workspace (interactive mode shows trust dialog that blocks automation)
claude --dangerously-skip-permissions -p "echo ok" >/dev/null 2>&1 || true

# Start tmux pipe-pane to capture output to log (doesn't affect TUI rendering)
# Use explicit -t target to avoid wrong-pane bug with concurrent windows
tmux pipe-pane -t "$TMUX_TARGET" -o "cat >> $LOGFILE" 2>/dev/null || true
touch "$LOGFILE"

# Write PID so idle monitor can walk the process tree
echo $$ > "${LOGFILE}.wrapper-pid"

# Recursively find all descendant PIDs
get_all_descendants() {
  local parent=$1
  local children
  children=$(ps -o pid= --ppid "$parent" 2>/dev/null | tr -d ' ')
  for child in $children; do
    echo "$child"
    get_all_descendants "$child"
  done
}

PROMPT="$(cat "$PROMPT_FILE")"

for attempt in $(seq 1 "$MAX_RETRIES"); do
  echo "=== ${GROUP}: attempt ${attempt}/${MAX_RETRIES} ==="

  FULL_PROMPT="$PROMPT"
  if [[ $attempt -gt 1 ]]; then
    RECENT_COMMITS=$(git log --oneline -5 2>/dev/null || echo "(no commits yet)")
    PREV_LOG_TAIL=$(tail -100 "$LOGFILE" 2>/dev/null | head -80 || echo "(no previous output)")
    PROGRESS=""
    if [[ -f "${WORKDIR}/.agent-status.json" ]]; then
      PROGRESS=$(cat "${WORKDIR}/.agent-status.json")
    elif [[ -f "${WORKDIR}/claude-progress.txt" ]]; then
      PROGRESS="(legacy plain-text format)
$(cat "${WORKDIR}/claude-progress.txt")"
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

  # Write prompt to temp file for interactive mode
  PROMPT_TMPFILE="${LOGFILE}.prompt-attempt${attempt}"
  echo "$FULL_PROMPT" > "$PROMPT_TMPFILE"

  # Idle monitor — kills claude process tree when output stabilizes
  # (Claude interactive never auto-exits; this is how we detect completion)
  (
    trap '' TERM  # survive our own SIGTERM blast
    sleep 15  # grace: let claude start up
    LAST_SIZE=0
    IDLE_SECONDS=0
    while true; do
      sleep 5
      CURRENT_SIZE=$(stat -c %s "$LOGFILE" 2>/dev/null || echo 0)
      if [[ "$CURRENT_SIZE" -gt 0 ]] && [[ "$CURRENT_SIZE" == "$LAST_SIZE" ]]; then
        IDLE_SECONDS=$((IDLE_SECONDS + 5))
      else
        IDLE_SECONDS=0
        LAST_SIZE=$CURRENT_SIZE
      fi
      if [[ $IDLE_SECONDS -ge $IDLE_THRESHOLD ]]; then
        echo "[monitor] ${GROUP}: idle for ${IDLE_SECONDS}s — killing claude"
        WRAPPER_PID=$(cat "${LOGFILE}.wrapper-pid" 2>/dev/null || echo "")
        if [[ -n "$WRAPPER_PID" ]]; then
          MY_PID=$BASHPID
          DESCENDANTS=$(get_all_descendants "$WRAPPER_PID" | grep -v "^${MY_PID}$")
          if [[ -n "$DESCENDANTS" ]]; then
            echo "$DESCENDANTS" | xargs kill -TERM 2>/dev/null || true
            sleep 2
            echo "$DESCENDANTS" | xargs kill -9 2>/dev/null || true
          fi
        fi
        break
      fi
    done
  ) &
  MONITOR_PID=$!

  # Run claude interactively — owns the terminal for full rich TUI
  # shellcheck disable=SC2086
  claude --dangerously-skip-permissions --max-turns "$MAX_TURNS_VAL" --max-budget-usd "$MAX_BUDGET_VAL" $MODEL_FLAG "$(cat "$PROMPT_TMPFILE")"
  EXIT_CODE=$?

  # Clean up monitor
  kill $MONITOR_PID 2>/dev/null || true

  # 143=SIGTERM, 137=SIGKILL from idle monitor — treat as success
  if [[ $EXIT_CODE -eq 143 ]] || [[ $EXIT_CODE -eq 137 ]]; then
    EXIT_CODE=0
  fi

  if [[ $EXIT_CODE -eq 0 ]]; then
    echo "=== ${GROUP}: completed successfully ==="
    break
  fi

  echo "=== ${GROUP}: exited with code ${EXIT_CODE} ==="

  if [[ $attempt -lt $MAX_RETRIES ]]; then
    echo "=== ${GROUP}: retrying in ${RETRY_DELAY}s... ==="
    sleep "$RETRY_DELAY"
  fi
done

# Clean up
rm -f "${LOGFILE}.wrapper-pid" "${LOGFILE}".prompt-attempt*
tmux pipe-pane -t "$TMUX_TARGET" 2>/dev/null || true

echo "$EXIT_CODE" > "$EXITCODE_FILE"
WRAPPER_OUTER

  # Replace placeholders (wrapper uses single-quoted heredoc, no expansion)
  sed -i "s|__GROUP__|${group}|g" "$wrapper"
  sed -i "s|__WORKDIR__|${workdir}|g" "$wrapper"
  sed -i "s|__PROMPT_FILE__|${prompt_file}|g" "$wrapper"
  sed -i "s|__EXITCODE_FILE__|${exitcode_file}|g" "$wrapper"
  sed -i "s|__LOGFILE__|${logfile}|g" "$wrapper"
  sed -i "s|__MAX_RETRIES__|${MAX_RETRIES}|g" "$wrapper"
  sed -i "s|__RETRY_DELAY__|${RETRY_DELAY}|g" "$wrapper"
  sed -i "s|__MAX_TURNS__|${MAX_TURNS:-$DEFAULT_MAX_TURNS}|g" "$wrapper"
  sed -i "s|__MAX_BUDGET__|${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}|g" "$wrapper"
  local model_flag_val=""
  [[ -n "${MODEL:-}" ]] && model_flag_val="--model $MODEL"
  sed -i "s|__MODEL_FLAG__|${model_flag_val}|g" "$wrapper"
  sed -i "s|__TMUX_TARGET__|${TMUX_SESSION}:${group}|g" "$wrapper"
  sed -i "s|__IDLE_THRESHOLD__|${IDLE_THRESHOLD}|g" "$wrapper"

  chmod +x "$wrapper"
  echo "$wrapper"
}

# Launch all agents in tmux windows and wait for them to finish.
# Uses send-keys pattern from test-watch-interactive.sh: shell survives
# after wrapper finishes so user can scroll back and read output.
watch_parallel_stage() {
  local stage_label="$1"
  local -n w_groups_ref="$2"
  local -n w_branches_ref="$3"

  if ! command -v tmux >/dev/null 2>&1; then
    err "WATCH mode requires tmux but it's not installed. Run without WATCH=1 or install tmux first."
    return 1
  fi

  # Ensure the implementation branch exists BEFORE creating worktrees
  setup_merge_target

  log "=== ${stage_label} (WATCH mode): Launching agents in tmux ==="

  # Kill any existing session with this name
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

  local launched_groups=()
  local setup_failures=0
  local first=true

  for i in "${!w_groups_ref[@]}"; do
    local group="${w_groups_ref[$i]}"
    local branch="${w_branches_ref[$i]}"

    # Setup worktree
    local worktree
    worktree=$(setup_worktree "$group" "$branch")
    if [[ $? -ne 0 ]]; then
      err "${group}: worktree setup failed — skipping"
      setup_failures=$((setup_failures + 1))
      continue
    fi

    # Clean up exit code file from prior runs
    rm -f "${LOG_DIR}/${group}.exit"

    # Build the wrapper script
    local wrapper
    wrapper=$(build_claude_cmd "$group" "$worktree")

    # Create tmux windows with bare shells, then send-keys to start wrappers.
    # Shell survives after wrapper finishes — user can scroll back and read.
    if $first; then
      tmux new-session -d -s "$TMUX_SESSION" -n "$group"
      first=false
    else
      tmux new-window -t "$TMUX_SESSION" -n "$group"
    fi
    tmux send-keys -t "${TMUX_SESSION}:${group}" "$wrapper" Enter

    launched_groups+=("$group")
    log "${group} launched in tmux window '${group}'"
  done

  # If no agents launched, fail immediately
  if [[ ${#launched_groups[@]} -eq 0 ]]; then
    err "=== ${stage_label}: ALL worktree setups failed — no agents launched ==="
    echo "" > "${LOG_DIR}/stage-succeeded.txt"
    echo "${w_groups_ref[*]}" > "${LOG_DIR}/stage-failed.txt"
    return 1
  fi

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
    for group in "${launched_groups[@]}"; do
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
  for group in "${launched_groups[@]}"; do
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
    local tmux_session="${TMUX_SESSION}-validate"
    local tmux_target="${tmux_session}:validate"

    # Build wrapper script using interactive mode + pipe-pane + idle monitor
    local wrapper="${LOG_DIR}/validate-run.sh"
    local idle_threshold="${IDLE_THRESHOLD:-120}"
    local max_turns_val="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
    local max_budget_val="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
    local model_flag_val=""
    [[ -n "${MODEL:-}" ]] && model_flag_val="--model $MODEL"

    cat > "$wrapper" <<VALIDATE_WRAPPER
#!/usr/bin/env bash
set -uo pipefail
cd "${WORKSPACE}"

# Pre-trust workspace
claude --dangerously-skip-permissions -p "echo ok" >/dev/null 2>&1 || true

# Start pipe-pane to capture output to log
tmux pipe-pane -t "${tmux_target}" -o "cat >> ${logfile}" 2>/dev/null || true
touch "${logfile}"

echo \$\$ > "${logfile}.wrapper-pid"

# Idle monitor
get_all_descendants() {
  local parent=\$1
  local children
  children=\$(ps -o pid= --ppid "\$parent" 2>/dev/null | tr -d ' ')
  for child in \$children; do
    echo "\$child"
    get_all_descendants "\$child"
  done
}
(
  trap '' TERM
  sleep 15
  LAST_SIZE=0
  IDLE_SECONDS=0
  while true; do
    sleep 5
    CURRENT_SIZE=\$(stat -c %s "${logfile}" 2>/dev/null || echo 0)
    if [[ "\$CURRENT_SIZE" -gt 0 ]] && [[ "\$CURRENT_SIZE" == "\$LAST_SIZE" ]]; then
      IDLE_SECONDS=\$((IDLE_SECONDS + 5))
    else
      IDLE_SECONDS=0
      LAST_SIZE=\$CURRENT_SIZE
    fi
    if [[ \$IDLE_SECONDS -ge ${idle_threshold} ]]; then
      echo "[monitor] validate: idle for \${IDLE_SECONDS}s — killing claude"
      WRAPPER_PID=\$(cat "${logfile}.wrapper-pid" 2>/dev/null || echo "")
      if [[ -n "\$WRAPPER_PID" ]]; then
        MY_PID=\$BASHPID
        DESCENDANTS=\$(get_all_descendants "\$WRAPPER_PID" | grep -v "^\${MY_PID}\$")
        if [[ -n "\$DESCENDANTS" ]]; then
          echo "\$DESCENDANTS" | xargs kill -TERM 2>/dev/null || true
          sleep 2
          echo "\$DESCENDANTS" | xargs kill -9 2>/dev/null || true
        fi
      fi
      break
    fi
  done
) &
MONITOR_PID=\$!

# Run claude interactively
claude --dangerously-skip-permissions --max-turns "${max_turns_val}" --max-budget-usd "${max_budget_val}" ${model_flag_val} "\$(cat '${prompt_to_use}')"
EXIT_CODE=\$?

kill \$MONITOR_PID 2>/dev/null || true

# 143=SIGTERM, 137=SIGKILL from idle monitor — treat as success
if [[ \$EXIT_CODE -eq 143 ]] || [[ \$EXIT_CODE -eq 137 ]]; then
  EXIT_CODE=0
fi

rm -f "${logfile}.wrapper-pid"
tmux pipe-pane -t "${tmux_target}" 2>/dev/null || true
echo "\$EXIT_CODE" > "${exitcode_file}"
VALIDATE_WRAPPER
    chmod +x "$wrapper"

    # Run in tmux using send-keys pattern (shell survives for scrollback)
    tmux kill-session -t "${tmux_session}" 2>/dev/null || true
    tmux new-session -d -s "${tmux_session}" -n "validate"
    tmux send-keys -t "${tmux_target}" "$wrapper" Enter

    log "Validation attempt ${attempt}/${max_attempts} running in tmux session: ${tmux_session}"
    log "Attach to watch:  tmux attach -t ${tmux_session}"

    # Wait for completion
    while [[ ! -f "$exitcode_file" ]]; do
      sleep 5
    done

    local exit_code
    exit_code=$(cat "$exitcode_file")

    tmux kill-session -t "${tmux_session}" 2>/dev/null || true

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

  # Ensure the implementation branch exists BEFORE creating worktrees
  # (worktrees branch from MERGE_TARGET — it must exist first)
  setup_merge_target

  # Delegate to tmux-based runner in WATCH mode
  if [[ "$WATCH" == "1" ]]; then
    watch_parallel_stage "$stage_label" "$2" "$3"
    return $?
  fi

  log "=== ${stage_label}: Launching parallel groups ==="

  local pids=()
  local monitor_pids=()
  local groups_list=()
  local setup_failures=0

  for i in "${!groups_ref[@]}"; do
    local group="${groups_ref[$i]}"
    local branch="${branches_ref[$i]}"

    local worktree
    worktree=$(setup_worktree "$group" "$branch")
    if [[ $? -ne 0 ]]; then
      err "${group}: worktree setup failed — skipping"
      setup_failures=$((setup_failures + 1))
      continue
    fi

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

  # If no agents launched, fail immediately
  if [[ ${#pids[@]} -eq 0 ]]; then
    err "=== ${stage_label}: ALL worktree setups failed — no agents launched ==="
    echo "" > "${LOG_DIR}/stage-succeeded.txt"
    echo "${groups_ref[*]}" > "${LOG_DIR}/stage-failed.txt"
    return 1
  fi

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
  branch_summary=$(git log --oneline "${MERGE_TARGET}".."$branch" 2>/dev/null | head -10 || echo "(no commits)")

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

# Merge a single branch into the current branch with conflict resolution and retries.
merge_branch_with_retries() {
  local branch="$1"
  local msg="$2"

  # Check if the branch exists before attempting merge
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

# Ensure the implementation branch exists (created from main).
setup_merge_target() {
  cd "$WORKSPACE"
  if ! git rev-parse --verify "$MERGE_TARGET" >/dev/null 2>&1; then
    log "Creating implementation branch: ${MERGE_TARGET} (from main)"
    git branch "$MERGE_TARGET" main
  fi
}

# Launch a fix agent that keeps running until tsc + vitest + cargo test all pass.
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
3. Run \`cd crates/scheduler && cargo test\` — fix any Rust test failures
4. Repeat until ALL pass
5. Commit all fixes with: \`fix: resolve merge verification failures for ${merge_label}\`

Do NOT modify files unnecessarily. Only fix actual errors. Read the error output carefully."

  for attempt in $(seq 1 "$max_fix_attempts"); do
    log "Merge-fix attempt ${attempt}/${max_fix_attempts}"
    local logfile="${LOG_DIR}/merge-fix-${merge_label// /-}-attempt${attempt}.log"

    cd "$WORKSPACE"
    local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
    local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"

    set +e
    echo "$fix_prompt" | claude --dangerously-skip-permissions --max-turns "$max_turns" --max-budget-usd "$max_budget" -p - > "$logfile" 2>&1
    local exit_code=$?
    set -e

    # Verify all checks pass now
    local all_ok=true
    npx tsc --noEmit >/dev/null 2>&1 || all_ok=false
    npm run test >/dev/null 2>&1 || all_ok=false
    (source "$HOME/.cargo/env" 2>/dev/null; cd crates/scheduler && cargo test >/dev/null 2>&1) || all_ok=false

    if $all_ok; then
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

# Usage: do_merge_stage "Merge 1" STAGE1_GROUPS STAGE1_BRANCHES STAGE1_MERGE_MESSAGES
do_merge_stage() {
  local merge_label="$1"
  local -n m_groups_ref="$2"
  local -n m_branches_ref="$3"
  local -n m_messages_ref="$4"

  log "=== ${merge_label}: Combining parallel branches into ${MERGE_TARGET} ==="

  cd "$WORKSPACE"
  setup_merge_target

  # Ensure we're on the implementation branch
  local current_branch
  current_branch=$(git branch --show-current)
  if [[ "$current_branch" != "$MERGE_TARGET" ]]; then
    log "Switching to ${MERGE_TARGET}..."
    git checkout "$MERGE_TARGET"
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

  # Verify build — if failures, launch fix agent
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
    warn "=== ${merge_label} verification found issues — launching fix agent ==="
    if run_merge_fix_agent "$merge_label"; then
      ok "=== ${merge_label} verification issues resolved by fix agent ==="
    else
      warn "=== ${merge_label} fix agent could not resolve all issues — validation agent will handle remaining ==="
    fi
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

  ok "=== ${merge_label} complete ==="
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

    # Ensure we're on the implementation branch
    local current_branch
    current_branch=$(git branch --show-current)
    if [[ "$current_branch" != "$MERGE_TARGET" ]]; then
      log "Switching to ${MERGE_TARGET} for validation..."
      git checkout "$MERGE_TARGET"
    fi

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

# ── PR creation + code review ─────────────────────────────────────────────────

create_pr() {
  cd "$WORKSPACE"

  # Ensure we're on the implementation branch
  local current_branch
  current_branch=$(git branch --show-current)
  if [[ "$current_branch" != "$MERGE_TARGET" ]]; then
    git checkout "$MERGE_TARGET"
  fi

  # Push the implementation branch
  log "Pushing ${MERGE_TARGET} to origin..."
  git push -u origin "$MERGE_TARGET"

  # Build PR body from commit log
  local commit_log
  commit_log=$(git log --oneline main.."$MERGE_TARGET" 2>/dev/null || echo "(no commits)")
  local commit_count
  commit_count=$(echo "$commit_log" | wc -l)

  # Check if validation passed
  local validation_status="PASSED"
  local latest_validate_log
  latest_validate_log=$(ls -t "${LOG_DIR}"/validate-attempt*.log 2>/dev/null | head -1 || echo "")
  if [[ -n "$latest_validate_log" ]] && grep -v "COMMAND=" "$latest_validate_log" | grep -q "OVERALL.*FAIL"; then
    validation_status="FAILED — see validation logs"
  fi

  log "Creating PR: ${MERGE_TARGET} → main"

  local pr_url
  pr_url=$(gh pr create \
    --base main \
    --head "$MERGE_TARGET" \
    --title "Phase 14: Drag reliability & sync integrity (R1-R10)" \
    --body "$(cat <<EOF
## Summary
Phase 14 implementation — drag reliability and CRDT sync integrity improvements.

- **R1**: RAF-throttled drag dispatch (~60fps local, ~10fps CRDT broadcast)
- **R2/R7/R9**: Duration derived from dates (never stored independently)
- **R3**: SET_TASKS guard prevents snap-back during active drag
- **R4**: Atomic COMPLETE_DRAG action (single undo entry per drag)
- **R5**: Arrow render consistency for collapsed/hidden tasks
- **R6**: Awareness-based ghost bars for remote drag intent
- **R8**: Adjacency-list cascade optimization O(n*d) → O(e*d)
- **R10**: Structural CRDT sync for add/delete/dependency operations

### Implementation
- 6 agent groups across 3 stages (zero file overlap per stage)
- ${commit_count} commits merged to implementation branch
- Validation status: **${validation_status}**

### Commits
\`\`\`
${commit_log}
\`\`\`

## Test plan
- [ ] \`npx tsc --noEmit\` passes
- [ ] \`npm run test\` passes
- [ ] \`cd crates/scheduler && cargo test\` passes
- [ ] Manual drag test: drag a task, verify no snap-back
- [ ] Manual drag test: drag while remote user edits, verify no snap-back
- [ ] Undo after drag: single Ctrl-Z undoes entire drag
- [ ] Arrow rendering with collapsed tasks
- [ ] Ghost bar visible for remote drag

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1)

  ok "PR created: ${pr_url}"

  # Trigger code-review agent on the PR
  log "Triggering code review..."
  local pr_number
  pr_number=$(echo "$pr_url" | grep -o '[0-9]*$')

  if [[ -n "$pr_number" ]]; then
    # Use the code-review skill via claude
    local review_prompt="Review PR #${pr_number} for the Ganttlet project. Use /code-review to review the PR at ${pr_url}"
    echo "$review_prompt" | claude --dangerously-skip-permissions --max-turns 40 --max-budget-usd 5.00 -p - >> "${LOG_DIR}/code-review.log" 2>&1 &
    local review_pid=$!
    log "Code review agent launched (PID: ${review_pid}, log: ${LOG_DIR}/code-review.log)"
    log "Review running in background — check log or PR comments for results."
  else
    warn "Could not extract PR number from: ${pr_url} — skipping code review"
  fi

  ok "=== PR created and code review triggered ==="
}

run_pipeline() {
  local start_from="${1:-stage1}"
  local pipeline_ok=true
  local started=false

  log "=== Pipeline starting from: ${start_from} ==="

  local steps=("stage1" "merge1" "stage2" "merge2" "stage3" "merge3" "validate" "create-pr")
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
        ok "=== Validation passed ==="
      else
        err "=== Validation FAILED ==="
        pipeline_ok=false
      fi
    elif [[ "$step" == "create-pr" ]]; then
      if $pipeline_ok; then
        create_pr || warn "PR creation had issues"
      else
        warn "Skipping PR creation — pipeline had failures"
      fi
    elif [[ "$step" == stage* ]]; then
      # Stage failures are fatal — no point merging or running later stages
      if ! $step; then
        err "${step} FAILED — aborting pipeline (no agents ran successfully)"
        return 1
      fi
    else
      # Merge steps: warn and continue to let validation attempt fixes
      $step || { warn "${step} had failures — continuing pipeline"; pipeline_ok=false; }
    fi
  done

  if $pipeline_ok; then
    ok "=== Pipeline complete — all stages passed, PR created ==="
  else
    err "Pipeline had issues — review logs in ${LOG_DIR}"
    return 1
  fi
}

run_all() {
  run_pipeline "stage1"
}

# ── CLI ───────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
Usage: ./scripts/launch-phase.sh <command>

Commands:
  stage1      Run Stage 1 parallel groups in worktrees
  merge1      Merge Stage 1 branches to implementation branch + verify
  stage2      Run Stage 2 groups in worktrees
  merge2      Merge Stage 2 branches to implementation branch + verify
  stage3      Run Stage 3 groups in worktrees
  merge3      Merge Stage 3 branches to implementation branch + verify
  validate    Run validation agent (checks all tests, fixes issues, reports)
  create-pr   Create PR from implementation branch to main + trigger code review
  all         Full pipeline: stage1 → merge1 → ... → validate → create-pr
  resume <step>  Resume pipeline from a specific step (e.g., resume merge1)
  status      Show current worktree and branch status
  logs        Tail agent logs

Environment variables:
  MAX_RETRIES=3              Retries per agent on crash
  RETRY_DELAY=5              Seconds between retries
  VALIDATE_MAX_ATTEMPTS=3    Max fix-and-retry cycles for validation
  MERGE_FIX_RETRIES=3        Retries for merge conflict resolution
  MERGE_TARGET               Implementation branch (default: feature/<phase>)
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
  stage1)    stage1 ;;
  merge1)    merge1 ;;
  stage2)    stage2 ;;
  merge2)    merge2 ;;
  stage3)    stage3 ;;
  merge3)    merge3 ;;
  validate)  validate ;;
  create-pr) create_pr ;;
  all)       run_all ;;
  resume)
    if [[ -z "${2:-}" ]]; then
      err "Usage: ./scripts/launch-phase.sh resume <step>"
      err "Steps: stage1, merge1, stage2, merge2, stage3, merge3, validate, create-pr"
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
