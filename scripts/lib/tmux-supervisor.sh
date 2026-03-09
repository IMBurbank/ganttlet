#!/usr/bin/env bash
# scripts/lib/tmux-supervisor.sh — Tmux-native supervisor helpers
#
# Provides functions for a supervisor agent running inside tmux to launch,
# monitor, and control agent windows directly. Source this file, don't execute it.
#
# Key patterns:
#   - tmux_launch_agent uses send-keys with 0.5s sleep before Enter (prevents race conditions)
#   - Log files for reliable output capture (pane capture for quick checks)
#   - .status files for completion detection

# ── Launch ──────────────────────────────────────────────────────────────────

# Launch a claude agent in a new tmux window.
#
# Usage: tmux_launch_agent <session> <group> <worktree> <prompt_file> <log_file> [max_turns] [max_budget] [model]
#
# Creates a tmux window, starts claude in pipe mode with tee for dual output.
# The agent's exit code is written to <log_file>.status on completion.
tmux_launch_agent() {
  local session="$1"
  local group="$2"
  local worktree="$3"
  local prompt_file="$4"
  local log_file="$5"
  local max_turns="${6:-80}"
  local max_budget="${7:-10.00}"
  local model="${8:-}"

  if ! command -v tmux >/dev/null 2>&1; then
    echo "ERROR: tmux not available" >&2
    return 1
  fi

  if ! tmux has-session -t "$session" 2>/dev/null; then
    echo "ERROR: tmux session '$session' does not exist" >&2
    return 1
  fi

  if [[ ! -f "$prompt_file" ]]; then
    echo "ERROR: prompt file not found: $prompt_file" >&2
    return 1
  fi

  if [[ ! -d "$worktree" ]]; then
    echo "ERROR: worktree not found: $worktree" >&2
    return 1
  fi

  local model_flag=""
  [[ -n "$model" ]] && model_flag="--model $model"

  # Create the window
  tmux new-window -t "$session" -n "$group"
  sleep 0.5

  # Clear any stale status file from a previous run (prevents tmux_agent_status
  # from immediately returning the old result when relaunching a killed agent).
  rm -f "${log_file}.status"

  # Build the command — unset CLAUDECODE, cd to worktree, run claude with tee.
  # Pipeline: cat | claude | tee — PIPESTATUS[1] is claude's exit code.
  local cmd="unset CLAUDECODE && cd '${worktree}' && set -o pipefail && cat '${prompt_file}' | claude --dangerously-skip-permissions --max-turns ${max_turns} --max-budget-usd ${max_budget} ${model_flag} -p - 2>&1 | tee '${log_file}'; echo \"EXIT:\${PIPESTATUS[1]:-\$?}\" > '${log_file}.status'"

  # Send keys with sleep before Enter (prevents race condition)
  tmux send-keys -t "${session}:${group}" "$cmd"
  sleep 0.5
  tmux send-keys -t "${session}:${group}" Enter

  echo "Launched ${group} in ${session}:${group}"
}

# ── Monitoring ──────────────────────────────────────────────────────────────

# Capture the visible pane output for an agent.
#
# Usage: tmux_poll_agent <session> <group> [scroll_lines]
# Default: last 30 lines of pane (including scrollback)
tmux_poll_agent() {
  local session="$1"
  local group="$2"
  local lines="${3:-30}"

  tmux capture-pane -t "${session}:${group}" -p -S "-${lines}" 2>/dev/null
}

# Read the tail of an agent's log file.
#
# Usage: tmux_poll_log <log_file> [lines]
# More reliable than pane capture for long output.
tmux_poll_log() {
  local log_file="$1"
  local lines="${2:-50}"

  if [[ -f "$log_file" ]]; then
    tail -"$lines" "$log_file"
  else
    echo "(no log file yet)"
  fi
}

# Check the status of a single agent.
#
# Usage: tmux_agent_status <session> <group> <log_file>
# Returns: running | succeeded | failed | not_started
tmux_agent_status() {
  local session="$1"
  local group="$2"
  local log_file="$3"

  # Check if status file exists (written on exit)
  if [[ -f "${log_file}.status" ]]; then
    local status_line
    status_line=$(cat "${log_file}.status")
    local exit_code="${status_line#EXIT:}"
    if [[ "$exit_code" == "0" ]]; then
      echo "succeeded"
    else
      echo "failed"
    fi
    return
  fi

  # Check if the tmux window still exists
  if tmux list-windows -t "$session" -F '#{window_name}' 2>/dev/null | grep -qx "$group"; then
    echo "running"
  else
    echo "not_started"
  fi
}

# Get a summary table of all agents in a stage.
#
# Usage: tmux_stage_status <session> <log_dir> <groups...>
# Prints a formatted status table.
tmux_stage_status() {
  local session="$1"
  local log_dir="$2"
  shift 2
  local groups=("$@")

  printf "%-12s | %-10s | %-14s | %s\n" "GROUP" "STATUS" "LAST_ACTIVITY" "LOG_SIZE"
  printf "%-12s-+-%-10s-+-%-14s-+-%s\n" "------------" "----------" "--------------" "--------"

  for group in "${groups[@]}"; do
    local log_file="${log_dir}/${group}.log"
    local status
    status=$(tmux_agent_status "$session" "$group" "$log_file")

    local last_activity="-"
    if [[ -f "$log_file" ]]; then
      local mtime
      mtime=$(stat -c %Y "$log_file" 2>/dev/null || echo 0)
      local now
      now=$(date +%s)
      local elapsed=$(( now - mtime ))
      if [[ $elapsed -lt 60 ]]; then
        last_activity="${elapsed}s ago"
      elif [[ $elapsed -lt 3600 ]]; then
        last_activity="$(( elapsed / 60 ))m ago"
      else
        last_activity="$(( elapsed / 3600 ))h ago"
      fi
    fi

    local log_size="-"
    if [[ -f "$log_file" ]]; then
      log_size=$(du -h "$log_file" 2>/dev/null | cut -f1)
    fi

    printf "%-12s | %-10s | %-14s | %s\n" "$group" "$status" "$last_activity" "$log_size"
  done
}

# ── Control ─────────────────────────────────────────────────────────────────

# Kill an agent running in a tmux window.
#
# Usage: tmux_kill_agent <session> <group> <log_file>
# Sends C-c, waits, escalates to kill-window if needed.
tmux_kill_agent() {
  local session="$1"
  local group="$2"
  local log_file="$3"

  if ! tmux list-windows -t "$session" -F '#{window_name}' 2>/dev/null | grep -qx "$group"; then
    echo "${group}: window does not exist"
    return 0
  fi

  # First attempt: Ctrl-C
  tmux send-keys -t "${session}:${group}" C-c
  sleep 3

  # Check if it exited
  if [[ -f "${log_file}.status" ]]; then
    echo "${group}: stopped (exit code in ${log_file}.status)"
    return 0
  fi

  # Second attempt: Ctrl-C again
  tmux send-keys -t "${session}:${group}" C-c
  sleep 3

  if [[ -f "${log_file}.status" ]]; then
    echo "${group}: stopped after second C-c"
    return 0
  fi

  # Final: kill the window
  tmux kill-window -t "${session}:${group}" 2>/dev/null
  echo "KILLED" > "${log_file}.status"
  echo "${group}: force-killed window"
}

# Wait for all agents in a stage to complete.
#
# Usage: tmux_wait_stage <session> <log_dir> <timeout_seconds> <groups...>
# Polls every 10 seconds. Returns 0 if all succeeded, 1 if any failed.
tmux_wait_stage() {
  local session="$1"
  local log_dir="$2"
  local timeout="$3"
  shift 3
  local groups=("$@")

  local stall_threshold="${AGENT_STALL_THRESHOLD:-300}"  # 5 min default
  local start
  start=$(date +%s)

  # Track log sizes for stall detection
  declare -A _last_sizes _last_change
  for group in "${groups[@]}"; do
    _last_sizes["$group"]=0
    _last_change["$group"]=$start
  done

  while true; do
    local all_done=true
    local any_failed=false

    for group in "${groups[@]}"; do
      local status
      status=$(tmux_agent_status "$session" "$group" "${log_dir}/${group}.log")
      case "$status" in
        running|not_started) all_done=false ;;
        failed) any_failed=true ;;
      esac
    done

    if $all_done; then
      if $any_failed; then
        return 1
      fi
      return 0
    fi

    local now
    now=$(date +%s)

    # Stall detection: check log file growth for running agents
    for group in "${groups[@]}"; do
      local status
      status=$(tmux_agent_status "$session" "$group" "${log_dir}/${group}.log")
      if [[ "$status" == "running" ]]; then
        local current_size
        current_size=$(stat -c %s "${log_dir}/${group}.log" 2>/dev/null || echo 0)
        if [[ "$current_size" != "${_last_sizes[$group]}" ]]; then
          _last_sizes["$group"]=$current_size
          _last_change["$group"]=$now
        fi
        local stall_duration=$(( now - ${_last_change[$group]} ))
        if [[ $stall_duration -ge $stall_threshold ]]; then
          echo "STALL: ${group} log unchanged for ${stall_duration}s — killing agent"
          tmux_kill_agent "$session" "$group" "${log_dir}/${group}.log"
        fi
      fi
    done

    local elapsed=$(( now - start ))
    if [[ $elapsed -ge $timeout ]]; then
      echo "TIMEOUT after ${timeout}s — killing remaining agents"
      for group in "${groups[@]}"; do
        local status
        status=$(tmux_agent_status "$session" "$group" "${log_dir}/${group}.log")
        if [[ "$status" == "running" ]]; then
          tmux_kill_agent "$session" "$group" "${log_dir}/${group}.log"
        fi
      done
      return 1
    fi

    sleep 10
  done
}

# ── Session Setup ───────────────────────────────────────────────────────────

# Create a tmux session for the supervisor.
#
# Usage: tmux_create_session <session_name>
# Sets history-limit to 10000 for better scrollback capture.
tmux_create_session() {
  local session="$1"

  tmux kill-session -t "$session" 2>/dev/null || true
  tmux new-session -d -s "$session" -n "supervisor"
  tmux set-option -t "$session" history-limit 10000
  echo "Created tmux session: $session"
}
