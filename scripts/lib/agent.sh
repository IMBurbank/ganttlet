#!/usr/bin/env bash
# scripts/lib/agent.sh — Agent runner with retry loop and stall detection

# ── Agent Metrics Logging ─────────────────────────────────────────────────

LOG_METRICS_DIR="${LOG_METRICS_DIR:-.claude/logs}"

log_agent_metrics() {
  local group="$1" duration_secs="$2" retries="$3" exit_code="$4"
  local status="success"
  [[ "$exit_code" -ne 0 ]] && status="failure"

  mkdir -p "$LOG_METRICS_DIR"
  local metrics_file="${LOG_METRICS_DIR}/agent-metrics.jsonl"

  node -e "
    const entry = {
      timestamp: new Date().toISOString(),
      phase: '${PHASE:-unknown}',
      group: '${group}',
      duration_seconds: ${duration_secs},
      retries: ${retries},
      exit_code: ${exit_code},
      status: '${status}'
    };
    require('fs').appendFileSync('${metrics_file}', JSON.stringify(entry) + '\n');
  "
}

# Build the retry context for a crashed agent restart.
build_retry_context() {
  local workdir="$1"
  local logfile="$2"
  local attempt="$3"
  local max_retries="$4"

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

  cat <<EOF
NOTE: You are being restarted after a crash. This is attempt ${attempt}/${max_retries}.

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

EOF
}

# Run a Claude agent in pipe mode with retry loop.
# Usage: run_agent "groupA" "/path/to/worktree"
run_agent() {
  local group="$1"
  local workdir="$2"

  local logfile="${LOG_DIR}/${group}.log"

  if [[ "${SDK_RUNNER:-}" == "1" ]]; then

    # ── Shared locals ────────────────────────────────────────────────
    local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
    local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
    local prompt_file=""
    local exit_code=0
    local start_seconds=$SECONDS

    # ── Prompt vars as array (safe for values with spaces) ───────────
    local -a prompt_vars=("SKILL=${group}")
    [[ -n "${LOG_DIR:-}" ]] && prompt_vars+=("LOG_DIR=${LOG_DIR}")

    # ── Reviewer angle detection ─────────────────────────────────────
    local -r _REVIEW_ANGLES="accuracy|structure|scope|history|adversarial"
    if [[ "$group" =~ ^(.+)-(${_REVIEW_ANGLES})$ ]]; then
      local skill="${BASH_REMATCH[1]}"
      local angle="${BASH_REMATCH[2]}"
      : "${SDK_POLICY:=reviewer}"
      : "${SDK_AGENT:=skill-reviewer}"
      : "${SDK_OUTPUT_FILE:=${LOG_DIR}/reviews/${skill}/${angle}.md}"
      prompt_vars=("SKILL=${skill}" "ANGLE=${angle}")
      [[ -n "${LOG_DIR:-}" ]] && prompt_vars+=("LOG_DIR=${LOG_DIR}")
      : "${prompt_file:=docs/prompts/curation/reviewer-template.md}"
    fi

    # ── Curator detection (non-reviewer groups in skill-curation phase) ──
    if [[ -z "${SDK_POLICY:-}" && "${PHASE:-}" == "skill-curation" ]]; then
      : "${SDK_POLICY:=curator}"
    fi

    # ── Build CLI args ───────────────────────────────────────────────
    local policy="${SDK_POLICY:-default}"
    local -a extra_args=()
    [[ -n "${SDK_OUTPUT_FILE:-}" ]] && extra_args+=(--output-file "$SDK_OUTPUT_FILE")
    [[ -n "${SDK_AGENT:-}" ]] && extra_args+=(--agent "$SDK_AGENT")

    for var in "${prompt_vars[@]}"; do
      extra_args+=(--prompt-var "$var")
    done

    : "${prompt_file:=${PROMPTS_DIR}/${group}.md}"

    # ── Invoke runner ────────────────────────────────────────────────
    log "Starting ${group} in ${workdir} via SDK runner (log: ${logfile})"
    set +e
    local result
    result=$(npx tsx scripts/sdk/agent-runner.ts \
      --group "$group" \
      --workdir "$workdir" \
      --prompt "$prompt_file" \
      --log "$logfile" \
      --phase "${PHASE:-unknown}" \
      --policy "$policy" \
      ${max_turns:+--max-turns "${max_turns}"} \
      ${max_budget:+--max-budget "${max_budget}"} \
      ${MAX_RETRIES:+--max-crash-retries "${MAX_RETRIES}"} \
      ${MODEL:+--model "${MODEL}"} \
      "${extra_args[@]}" \
      2>>"$logfile")
    exit_code=$?
    set -e

    # SDK runner handles its own detailed metrics via TypeScript (scripts/sdk/metrics.ts).
    # Also log to bash-level agent-metrics.jsonl for uniform orchestrator-level tracking.
    local duration=$(( SECONDS - start_seconds ))
    log_agent_metrics "$group" "$duration" "0" "$exit_code"

    if [[ $exit_code -eq 0 ]]; then
      ok "${group}: completed successfully"
      log "${group}: result: ${result}"
      return 0
    else
      err "${group}: failed. Result: ${result}"
      return 1
    fi

  else

  local prompt_file="${workdir}/${PROMPTS_DIR}/${group}.md"
  local start_seconds=$SECONDS
  local retry_count=0

  if [[ ! -f "$prompt_file" ]]; then
    err "Prompt file not found: $prompt_file"
    return 1
  fi

  local prompt
  prompt="$(cat "$prompt_file")"

  log "Starting ${group} in ${workdir} (log: ${logfile})"

  for attempt in $(seq 1 "$MAX_RETRIES"); do
    log "${group}: attempt ${attempt}/${MAX_RETRIES}"

    local full_prompt="$prompt"
    if [[ $attempt -gt 1 ]]; then
      full_prompt="$(build_retry_context "$workdir" "$logfile" "$attempt" "$MAX_RETRIES")${prompt}"
    fi

    local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
    local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
    local model_flag=""
    [[ -n "${MODEL:-}" ]] && model_flag="--model $MODEL"
    local ancestor_flag=""
    [[ -n "${SESSION_ANCESTOR:-}" ]] && ancestor_flag="--append-system-prompt-file $SESSION_ANCESTOR"
    set +e
    (
      cd "$workdir"
      # shellcheck disable=SC2086
      echo "$full_prompt" | claude --dangerously-skip-permissions --max-turns "$max_turns" --max-budget-usd "$max_budget" $model_flag $ancestor_flag -p -
    ) >> "$logfile" 2>&1
    local exit_code=$?
    set -e

    if [[ $exit_code -eq 0 ]]; then
      local duration=$(( SECONDS - start_seconds ))
      log_agent_metrics "$group" "$duration" "$retry_count" 0
      ok "${group}: completed successfully"
      return 0
    fi

    warn "${group}: exited with code ${exit_code}"

    if [[ $attempt -lt $MAX_RETRIES ]]; then
      retry_count=$((retry_count + 1))
      log "${group}: retrying in ${RETRY_DELAY}s..."
      sleep "$RETRY_DELAY"
    fi
  done

  local duration=$(( SECONDS - start_seconds ))
  log_agent_metrics "$group" "$duration" "$retry_count" "${exit_code:-1}"

  err "${group}: failed after ${MAX_RETRIES} attempts. Check ${logfile}"
  return 1

  fi  # SDK_RUNNER
}

# Monitor an agent process for stall detection.
# Usage: monitor_agent $pid "/path/to/worktree" "groupA" &
monitor_agent() {
  local agent_pid="$1"
  local workdir="$2"
  local group="$3"
  local timeout_minutes="${STALL_TIMEOUT:-30}"
  # Watch all log files for this group (base + per-attempt logs from SDK runner)
  local log_pattern="${LOG_DIR}/${group}*.log"
  local last_size=0
  local last_activity
  last_activity=$(date +%s)

  while kill -0 "$agent_pid" 2>/dev/null; do
    sleep 60

    # Sum sizes of all matching log files (base + attempt logs)
    local current_size=0
    for f in $log_pattern; do
      [[ -f "$f" ]] && current_size=$((current_size + $(stat -c %s "$f" 2>/dev/null || echo 0)))
    done

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
