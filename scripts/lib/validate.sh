#!/usr/bin/env bash
# scripts/lib/validate.sh — Validation agent runner (pipe mode)
#
# Runs inside the merge worktree (MERGE_WORKTREE), not /workspace.

# Run the validation agent with retry loop.
validate() {
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

  # Ensure merge worktree exists (may be called standalone via `validate` command)
  setup_merge_worktree

  log "=== Running validation agent (up to ${max_attempts} attempts) ==="

  for attempt in $(seq 1 "$max_attempts"); do
    local logfile="${LOG_DIR}/validate-attempt${attempt}.log"
    local prompt
    prompt="$(cat "$prompt_file")"

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

    local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
    local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
    (
      cd "$MERGE_WORKTREE"
      echo "$prompt" | claude --dangerously-skip-permissions --max-turns "$max_turns" --max-budget-usd "$max_budget" -p - > "$logfile" 2>&1
    )
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

    echo ""
    log "=== Validation Report (attempt ${attempt}) ==="
    tail -40 "$logfile"
    echo ""

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
