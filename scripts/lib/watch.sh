#!/usr/bin/env bash
# scripts/lib/watch.sh — WATCH mode: tmux-based interactive agent output
#
# WATCH mode runs agents in tmux windows with full rich TUI output.
# Uses pipe-pane for log capture and idle monitor for auto-exit detection.
#
# Lessons learned:
# 1. Claude interactive (no -p flag) = full rich TUI output
# 2. tmux pipe-pane captures logs WITHOUT breaking TUI rendering
# 3. Idle monitor (background child) kills claude when output stabilizes
# 4. tmux send-keys (not command string) keeps shell alive for scrollback
# 5. Pre-trust workspace via quick -p dry run (interactive shows trust dialog)
# 6. Explicit -t TMUX_TARGET for pipe-pane (avoids wrong-pane bug)

AGENT_IDLE_THRESHOLD="${IDLE_THRESHOLD:-30}"  # seconds of stable log before killing agent
VALIDATE_IDLE_THRESHOLD="${IDLE_THRESHOLD:-120}"  # validation needs longer (runs tsc/vitest/cargo)

# Build wrapper script for a WATCH mode agent.
# Returns path to the wrapper script via stdout.
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
tmux pipe-pane -t "$TMUX_TARGET" -o "cat >> $LOGFILE" 2>/dev/null || true
touch "$LOGFILE"

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
  (
    trap '' TERM
    sleep 15
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

  # Replace placeholders
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
  sed -i "s|__IDLE_THRESHOLD__|${AGENT_IDLE_THRESHOLD}|g" "$wrapper"

  chmod +x "$wrapper"
  echo "$wrapper"
}

# Launch all agents in tmux windows and wait for completion.
watch_parallel_stage() {
  local stage_label="$1"
  local -n wps_groups="$2"
  local -n wps_branches="$3"

  if ! command -v tmux >/dev/null 2>&1; then
    err "WATCH mode requires tmux but it's not installed. Run without WATCH=1 or install tmux first."
    return 1
  fi

  setup_merge_target

  log "=== ${stage_label} (WATCH mode): Launching agents in tmux ==="

  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

  local launched_groups=()
  local setup_failures=0
  local first=true

  for i in "${!wps_groups[@]}"; do
    local group="${wps_groups[$i]}"
    local branch="${wps_branches[$i]}"

    local worktree
    worktree=$(setup_worktree "$group" "$branch")
    if [[ $? -ne 0 ]]; then
      err "${group}: worktree setup failed — skipping"
      setup_failures=$((setup_failures + 1))
      continue
    fi

    rm -f "${LOG_DIR}/${group}.exit"

    local wrapper
    wrapper=$(build_claude_cmd "$group" "$worktree")

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

  if [[ ${#launched_groups[@]} -eq 0 ]]; then
    err "=== ${stage_label}: ALL worktree setups failed — no agents launched ==="
    echo "" > "${LOG_DIR}/stage-succeeded.txt"
    echo "${wps_groups[*]}" > "${LOG_DIR}/stage-failed.txt"
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

  echo "${succeeded_groups[*]}" > "${LOG_DIR}/stage-succeeded.txt"
  echo "${failed_groups[*]}" > "${LOG_DIR}/stage-failed.txt"

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

# Run the validation agent in WATCH/tmux mode.
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

    local prompt_to_use="$prompt_file"
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

    local wrapper="${LOG_DIR}/validate-run.sh"
    local idle_threshold="${VALIDATE_IDLE_THRESHOLD}"
    local max_turns_val="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
    local max_budget_val="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
    local model_flag_val=""
    [[ -n "${MODEL:-}" ]] && model_flag_val="--model $MODEL"

    cat > "$wrapper" <<VALIDATE_WRAPPER
#!/usr/bin/env bash
set -uo pipefail
cd "${MERGE_WORKTREE}"

claude --dangerously-skip-permissions -p "echo ok" >/dev/null 2>&1 || true

tmux pipe-pane -t "${tmux_target}" -o "cat >> ${logfile}" 2>/dev/null || true
touch "${logfile}"

echo \$\$ > "${logfile}.wrapper-pid"

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

claude --dangerously-skip-permissions --max-turns "${max_turns_val}" --max-budget-usd "${max_budget_val}" ${model_flag_val} "\$(cat '${prompt_to_use}')"
EXIT_CODE=\$?

kill \$MONITOR_PID 2>/dev/null || true

if [[ \$EXIT_CODE -eq 143 ]] || [[ \$EXIT_CODE -eq 137 ]]; then
  EXIT_CODE=0
fi

rm -f "${logfile}.wrapper-pid"
tmux pipe-pane -t "${tmux_target}" 2>/dev/null || true
echo "\$EXIT_CODE" > "${exitcode_file}"
VALIDATE_WRAPPER
    chmod +x "$wrapper"

    tmux kill-session -t "${tmux_session}" 2>/dev/null || true
    tmux new-session -d -s "${tmux_session}" -n "validate"
    tmux send-keys -t "${tmux_target}" "$wrapper" Enter

    log "Validation attempt ${attempt}/${max_attempts} running in tmux session: ${tmux_session}"
    log "Attach to watch:  tmux attach -t ${tmux_session}"

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
