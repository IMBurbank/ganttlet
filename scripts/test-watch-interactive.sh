#!/usr/bin/env bash
# test-watch-interactive.sh — Hands-on test for WATCH mode interactive sessions.
#
# Unlike test-watch-mode.sh (automated), this test requires YOU to watch.
# It launches agents in tmux and you verify:
#   1. You can see rich TUI output (thinking blocks, tool use panels)
#   2. The session closes automatically after the agent finishes
#   3. Multi-stage transitions happen without manual intervention
#
# Usage:
#   ./scripts/test-watch-interactive.sh          # full test (3 stages)
#   ./scripts/test-watch-interactive.sh single   # just one agent, watch it
#   ./scripts/test-watch-interactive.sh multi    # two parallel + stage transition
#   ./scripts/test-watch-interactive.sh modes    # compare -p vs interactive side by side
#
# After launch, attach with:  tmux attach -t test-watch
# Switch panes: Ctrl-B N/P    Detach: Ctrl-B D

set -uo pipefail

TMUX_SESSION="test-watch"
TEST_DIR="/tmp/test-watch-interactive-$$"
mkdir -p "$TEST_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
info() { echo -e "${YELLOW}INFO:${NC} $*"; }

cleanup() {
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  tmux kill-session -t "${TMUX_SESSION}-compare" 2>/dev/null || true
}

if [[ -n "${CLAUDECODE:-}" ]]; then
  echo "ERROR: Cannot run inside a Claude Code session."
  exit 1
fi

command -v tmux >/dev/null 2>&1 || { echo "ERROR: tmux not installed"; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "ERROR: claude not available"; exit 1; }

# ── Prompt that requires tool use (not just a chat response) ──────────────────

# This prompt forces claude to use Bash/Read/Write tools, which is what real
# agent work looks like. A trivial "say hello" prompt won't trigger the stall.
TOOL_USE_PROMPT='You are a test agent. Do the following steps in order:
1. Run: ls -la /tmp
2. Create a file /tmp/test-watch-proof.txt with the content "Watch mode test completed at $(date)"
3. Read the file back and confirm it exists
4. Say "ALL STEPS COMPLETE" as your final message

Do NOT enter plan mode. Execute immediately.'

# Simpler prompt for comparison
SIMPLE_PROMPT='List the files in /tmp and say DONE.'

# ── Test: Single agent, watch the TUI ────────────────────────────────────────

test_single() {
  log "═══ Single Agent Test ═══"
  log ""
  log "Launching ONE agent with a tool-use prompt."
  log "This will test whether:"
  log "  1. You see rich TUI output (not just text)"
  log "  2. The session exits automatically when done"
  log ""

  cleanup

  local exitfile="$TEST_DIR/single.exit"
  rm -f "$exitfile" /tmp/test-watch-proof.txt

  # ── Approach: Pre-trust + direct interactive ──
  # Step 1: Run a throwaway -p command to establish workspace trust
  #         (interactive mode shows a trust dialog that blocks automation;
  #          -p mode skips it and establishes trust for future runs)
  # Step 2: Run claude interactively — NO -p flag, NO pipe
  #         Claude owns the terminal directly = full rich TUI
  # Step 3: Log capture via tmux pipe-pane (doesn't affect TUI rendering)
  local logfile="$TEST_DIR/single.log"

  # The wrapper runs two processes:
  #   1. Claude interactive (foreground) — owns the terminal for rich TUI
  #   2. Idle monitor (background) — detects when claude is waiting for input
  #      and sends /exit via tmux send-keys to cleanly close the session
  cat > "$TEST_DIR/single-run.sh" <<'WRAPPER'
#!/usr/bin/env bash
EXITFILE="PLACEHOLDER_EXIT"
LOGFILE="PLACEHOLDER_LOG"
WORKDIR="PLACEHOLDER_WORKDIR"
TMUX_TARGET="PLACEHOLDER_TMUX_TARGET"
IDLE_THRESHOLD=15  # seconds of no output before sending /exit

cd "$WORKDIR"

# CRITICAL: Pre-trust the workspace directory.
# Interactive mode shows a trust dialog that stalls unattended sessions.
# A quick -p dry run establishes trust without the dialog.
echo "Pre-trusting workspace..."
claude --dangerously-skip-permissions -p "echo ok" >/dev/null 2>&1 || true
echo "Workspace trusted. Launching interactive session..."

# Start tmux pipe-pane to capture output to log (doesn't affect TUI rendering)
tmux pipe-pane -o "cat >> $LOGFILE" 2>/dev/null || true

# Create log file before pipe-pane starts
touch "$LOGFILE"

# Write PID file so monitor can walk the process tree
echo $$ > "${LOGFILE}.wrapper-pid"

# get_all_descendants PID — recursively finds all descendant PIDs
get_all_descendants() {
  local parent=$1
  local children
  children=$(ps -o pid= --ppid "$parent" 2>/dev/null | tr -d ' ')
  for child in $children; do
    echo "$child"
    get_all_descendants "$child"
  done
}

# Idle monitor — kills claude process tree after idle threshold
(
  # Survive our own SIGTERM blast (we're a descendant of the wrapper too)
  trap '' TERM

  sleep 10  # grace: let claude start up
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
      echo "[monitor] Agent idle for ${IDLE_SECONDS}s — killing claude"
      WRAPPER_PID=$(cat "${LOGFILE}.wrapper-pid" 2>/dev/null || echo "")

      if [[ -n "$WRAPPER_PID" ]]; then
        # Get all descendants but filter out our own PID (we're a descendant too)
        MY_PID=$BASHPID
        DESCENDANTS=$(get_all_descendants "$WRAPPER_PID" | grep -v "^${MY_PID}$")
        if [[ -n "$DESCENDANTS" ]]; then
          echo "[monitor] Killing descendants: $DESCENDANTS"
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

# Run claude interactively — full rich TUI, no -p flag
claude --dangerously-skip-permissions "$(cat PLACEHOLDER_PROMPT_FILE)"
EXIT_CODE=$?

# Clean up
kill $MONITOR_PID 2>/dev/null || true
rm -f "${LOGFILE}.wrapper-pid"

# Exit code 143=SIGTERM, 137=SIGKILL from monitor — treat as success
if [[ $EXIT_CODE -eq 143 ]] || [[ $EXIT_CODE -eq 137 ]]; then
  EXIT_CODE=0
fi

# Stop pipe-pane capture
tmux pipe-pane 2>/dev/null || true

echo "$EXIT_CODE" > "$EXITFILE"
WRAPPER

  # Use the project workspace (already has code to interact with) rather than /tmp
  local workdir="/workspace"
  echo "$TOOL_USE_PROMPT" > "$TEST_DIR/single-prompt.txt"

  sed -i "s|PLACEHOLDER_EXIT|${exitfile}|g" "$TEST_DIR/single-run.sh"
  sed -i "s|PLACEHOLDER_LOG|${logfile}|g" "$TEST_DIR/single-run.sh"
  sed -i "s|PLACEHOLDER_WORKDIR|${workdir}|g" "$TEST_DIR/single-run.sh"
  sed -i "s|PLACEHOLDER_PROMPT_FILE|${TEST_DIR}/single-prompt.txt|g" "$TEST_DIR/single-run.sh"
  sed -i "s|PLACEHOLDER_TMUX_TARGET|${TMUX_SESSION}:agent|g" "$TEST_DIR/single-run.sh"
  chmod +x "$TEST_DIR/single-run.sh"

  tmux new-session -d -s "$TMUX_SESSION" -n "agent" \
    "$TEST_DIR/single-run.sh; echo ''; echo '════════════════════════════════'; echo 'Session ended. Exit code:'; cat '$exitfile' 2>/dev/null || echo '?'; echo '════════════════════════════════'; echo 'Press Enter to close'; read"

  log ""
  log "╔══════════════════════════════════════════════════════╗"
  log "║  Agent running in tmux session: $TMUX_SESSION"
  log "║                                                      ║"
  log "║  ATTACH NOW:  tmux attach -t $TMUX_SESSION     "
  log "║                                                      ║"
  log "║  WATCH FOR:                                          ║"
  log "║    1. Thinking indicators / spinner                  ║"
  log "║    2. Tool use panels (Bash, Read, Write)            ║"
  log "║    3. Automatic exit after 'ALL STEPS COMPLETE'      ║"
  log "║                                                      ║"
  log "║  Detach anytime: Ctrl-B D                            ║"
  log "╚══════════════════════════════════════════════════════╝"
  log ""

  # Poll for completion
  local waited=0
  local timeout=180
  while [[ ! -f "$exitfile" ]] && [[ $waited -lt $timeout ]]; do
    sleep 2
    waited=$((waited + 2))
    if (( waited % 30 == 0 )); then
      log "  Still running... (${waited}s elapsed)"
    fi
  done

  if [[ -f "$exitfile" ]]; then
    local rc
    rc=$(cat "$exitfile")
    log ""
    log "Agent exited with code: $rc (after ${waited}s)"
    if [[ -f /tmp/test-watch-proof.txt ]]; then
      log "Proof file exists: $(cat /tmp/test-watch-proof.txt)"
    else
      log "WARNING: Proof file not created — agent may not have completed tool use"
    fi
    if [[ -f "$logfile" ]]; then
      local log_bytes
      log_bytes=$(wc -c < "$logfile")
      log "Log captured: ${log_bytes} bytes (via tmux pipe-pane)"
    fi
  else
    log ""
    log "TIMEOUT: Agent did not exit after ${timeout}s"
    log "This is the stall bug. The agent finished work but the session is still open."
    log ""
    log "Check: is the tmux pane showing a prompt waiting for input?"
    log "  tmux attach -t $TMUX_SESSION"
  fi

  log ""
  log "Questions to answer:"
  log "  1. Did you see rich TUI (thinking blocks, tool panels)? [Y/N]"
  log "  2. Did the session exit on its own? [Y/N]"
  log "  3. Was the output richer than the sparse mode-A from test-watch-mode.sh? [Y/N]"
}

# ── Test: Compare -p vs interactive side by side ─────────────────────────────

test_modes_compare() {
  log "═══ Mode Comparison Test ═══"
  log ""
  log "Launching TWO agents side by side:"
  log "  Window 'pipe-mode':   claude -p (sparse output)"
  log "  Window 'interactive': claude (no -p, full TUI)"
  log ""
  log "Compare the output visually."
  log ""

  cleanup

  local pipe_exit="$TEST_DIR/pipe.exit"
  local interactive_exit="$TEST_DIR/interactive.exit"
  rm -f "$pipe_exit" "$interactive_exit"

  echo "$TOOL_USE_PROMPT" > "$TEST_DIR/compare-prompt.txt"

  # Window 1: pipe mode
  cat > "$TEST_DIR/pipe-run.sh" <<WRAPPER
#!/usr/bin/env bash
cd /workspace
echo "═══ PIPE MODE (-p) ═══"
echo ""
claude --dangerously-skip-permissions -p "\$(cat '$TEST_DIR/compare-prompt.txt')"
echo \$? > "$pipe_exit"
WRAPPER
  chmod +x "$TEST_DIR/pipe-run.sh"

  # Window 2: interactive mode (with pre-trust)
  cat > "$TEST_DIR/interactive-run.sh" <<WRAPPER
#!/usr/bin/env bash
cd /workspace
# Pre-trust: -p mode skips the workspace trust dialog, establishing trust for interactive mode
claude --dangerously-skip-permissions -p "echo ok" >/dev/null 2>&1 || true
echo "Workspace trusted. Launching interactive..."
claude --dangerously-skip-permissions "\$(cat '$TEST_DIR/compare-prompt.txt')"
echo \$? > "$interactive_exit"
WRAPPER
  chmod +x "$TEST_DIR/interactive-run.sh"

  local sess="${TMUX_SESSION}-compare"
  tmux kill-session -t "$sess" 2>/dev/null || true
  tmux new-session -d -s "$sess" -n "pipe-mode" \
    "$TEST_DIR/pipe-run.sh; echo ''; echo '── pipe mode finished ──'; read"
  tmux new-window -t "$sess" -n "interactive" \
    "$TEST_DIR/interactive-run.sh; echo ''; echo '── interactive finished ──'; read"

  log "╔══════════════════════════════════════════════════════╗"
  log "║  Comparison running in: tmux attach -t $sess"
  log "║                                                      ║"
  log "║  Window 'pipe-mode':   Ctrl-B 0 (or N/P to switch)  ║"
  log "║  Window 'interactive': Ctrl-B 1                      ║"
  log "║                                                      ║"
  log "║  Compare: which shows richer output?                 ║"
  log "╚══════════════════════════════════════════════════════╝"

  # Wait for both
  local waited=0
  while [[ $waited -lt 180 ]]; do
    local done=true
    [[ ! -f "$pipe_exit" ]] && done=false
    [[ ! -f "$interactive_exit" ]] && done=false
    $done && break
    sleep 2
    waited=$((waited + 2))
  done

  log ""
  [[ -f "$pipe_exit" ]] && log "Pipe mode exited: $(cat "$pipe_exit")" || log "Pipe mode: still running"
  [[ -f "$interactive_exit" ]] && log "Interactive exited: $(cat "$interactive_exit")" || log "Interactive: still running (STALL?)"
}

# ── Test: Multi-stage pipeline ───────────────────────────────────────────────

test_multi() {
  log "═══ Multi-Stage Pipeline Test ═══"
  log ""
  log "Stage 1: Two parallel agents (agentX, agentY)"
  log "Stage 2: One agent (agentZ) — starts automatically after stage 1"
  log ""
  log "Verifies that stage transitions don't require manual intervention."
  log ""

  cleanup

  # ── Design ───────────────────────────────────────────────────────────────
  # The hard problem: rich TUI requires Claude owning the terminal, but
  # interactive Claude never auto-exits (--max-turns limits tool calls but
  # keeps the session open; | tee makes stdout a pipe = sparse output).
  #
  # Solution — identical to the working single test:
  #   1. Claude runs directly in tmux (owns TTY = full rich TUI).
  #   2. tmux pipe-pane captures output to log (doesn't affect TUI).
  #   3. Idle monitor INSIDE the wrapper (child process of the shell running
  #      in the tmux pane) watches log file size. When output stabilizes
  #      (Claude done, sitting at input prompt), it kills Claude's process
  #      tree. This MUST run inside the pane — an external monitor can't
  #      signal processes in the tmux session's process namespace.
  #   4. Wrapper captures exit code (143/137 → 0), writes exit file.
  #   5. Shell stays alive (send-keys approach) — user can scroll back.
  #   6. Poll loop detects exit files → kill-session → next stage.

  local idle_threshold=15  # seconds of stable log size before killing claude

  for agent in agentX agentY agentZ; do
    local prompt
    case "$agent" in
      agentX|agentY) prompt="$SIMPLE_PROMPT" ;;
      agentZ)        prompt="Say 'Stage 2 agent reporting. DONE.'" ;;
    esac

    echo "$prompt" > "$TEST_DIR/${agent}-prompt.txt"
    rm -f "$TEST_DIR/${agent}.exit"

    # Wrapper with embedded idle monitor — same pattern as test_single.
    # Claude runs directly (owns terminal = full TUI). Monitor runs as
    # background child, kills claude process tree when idle.
    cat > "$TEST_DIR/${agent}-run.sh" <<'WRAPPER'
#!/usr/bin/env bash
EXITFILE="__EXITFILE__"
LOGFILE="__LOGFILE__"
TMUX_TARGET="__TMUX_TARGET__"
IDLE_THRESHOLD=__IDLE_THRESHOLD__

cd /workspace

# Pre-trust workspace (interactive mode shows trust dialog that blocks automation)
claude --dangerously-skip-permissions -p "echo ok" >/dev/null 2>&1 || true

# Start pipe-pane log capture with explicit target (without -t, "current pane"
# is ambiguous when multiple windows start simultaneously — the first window's
# pipe-pane silently targets the wrong pane, producing a 0-byte log).
tmux pipe-pane -t "$TMUX_TARGET" -o "cat >> $LOGFILE" 2>/dev/null || true
touch "$LOGFILE"

# Write PID so the monitor can walk the process tree
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

# Idle monitor — kills claude process tree when output stabilizes
(
  trap '' TERM  # survive our own SIGTERM blast

  sleep 10  # grace: let claude start up

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
claude --dangerously-skip-permissions "$(cat __PROMPT_FILE__)"
EXIT_CODE=$?

# Clean up
kill $MONITOR_PID 2>/dev/null || true
rm -f "${LOGFILE}.wrapper-pid"
tmux pipe-pane -t "$TMUX_TARGET" 2>/dev/null || true

# 143=SIGTERM, 137=SIGKILL from monitor — treat as success
if [[ $EXIT_CODE -eq 143 ]] || [[ $EXIT_CODE -eq 137 ]]; then
  EXIT_CODE=0
fi

echo "$EXIT_CODE" > "$EXITFILE"
WRAPPER

    # Replace placeholders (wrapper uses single-quoted heredoc, no expansion)
    sed -i "s|__EXITFILE__|$TEST_DIR/${agent}.exit|g" "$TEST_DIR/${agent}-run.sh"
    sed -i "s|__LOGFILE__|$TEST_DIR/${agent}.log|g" "$TEST_DIR/${agent}-run.sh"
    sed -i "s|__TMUX_TARGET__|${TMUX_SESSION}:${agent}|g" "$TEST_DIR/${agent}-run.sh"
    sed -i "s|__IDLE_THRESHOLD__|$idle_threshold|g" "$TEST_DIR/${agent}-run.sh"
    sed -i "s|__PROMPT_FILE__|$TEST_DIR/${agent}-prompt.txt|g" "$TEST_DIR/${agent}-run.sh"
    chmod +x "$TEST_DIR/${agent}-run.sh"
  done

  # ── Stage 1: two parallel agents ─────────────────────────────────────────
  # Create tmux session with bare shells, then send-keys to start wrappers.
  # Shell survives after wrapper finishes — user can scroll back and read.
  tmux new-session -d -s "$TMUX_SESSION" -n "agentX"
  tmux new-window  -t "$TMUX_SESSION" -n "agentY"
  tmux send-keys -t "$TMUX_SESSION:agentX" "$TEST_DIR/agentX-run.sh" Enter
  tmux send-keys -t "$TMUX_SESSION:agentY" "$TEST_DIR/agentY-run.sh" Enter

  log "Stage 1 launched. Attach: tmux attach -t $TMUX_SESSION"

  # Poll for both agents to finish
  local waited=0
  while [[ $waited -lt 120 ]]; do
    local s1_done=true
    [[ ! -f "$TEST_DIR/agentX.exit" ]] && s1_done=false
    [[ ! -f "$TEST_DIR/agentY.exit" ]] && s1_done=false
    $s1_done && break
    sleep 2
    waited=$((waited + 2))
    if (( waited % 30 == 0 )); then
      log "  Stage 1 still running... (${waited}s elapsed)"
    fi
  done

  # Kill stage 1 tmux session to transition (output preserved in log files)
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

  if [[ ! -f "$TEST_DIR/agentX.exit" ]] || [[ ! -f "$TEST_DIR/agentY.exit" ]]; then
    log "TIMEOUT: Stage 1 agents did not complete in 120s"
    [[ -f "$TEST_DIR/agentX.exit" ]] && log "  agentX: exited $(cat "$TEST_DIR/agentX.exit")" || log "  agentX: still running"
    [[ -f "$TEST_DIR/agentY.exit" ]] && log "  agentY: exited $(cat "$TEST_DIR/agentY.exit")" || log "  agentY: still running"
    return 1
  fi

  local x_rc y_rc
  x_rc=$(cat "$TEST_DIR/agentX.exit")
  y_rc=$(cat "$TEST_DIR/agentY.exit")
  log "Stage 1 complete in ${waited}s (agentX=$x_rc, agentY=$y_rc). Transitioning to stage 2..."

  # ── Stage 2: one agent, starts automatically ─────────────────────────────
  tmux new-session -d -s "$TMUX_SESSION" -n "agentZ"
  tmux send-keys -t "$TMUX_SESSION:agentZ" "$TEST_DIR/agentZ-run.sh" Enter

  log "Stage 2 launched. Attach: tmux attach -t $TMUX_SESSION"

  waited=0
  while [[ ! -f "$TEST_DIR/agentZ.exit" ]] && [[ $waited -lt 120 ]]; do
    sleep 2
    waited=$((waited + 2))
    if (( waited % 30 == 0 )); then
      log "  Stage 2 still running... (${waited}s elapsed)"
    fi
  done

  # Do NOT kill the final tmux session — the shell is still alive with
  # full scrollback of the agent's TUI output. User can attach and read.
  # Gets cleaned up at the start of the next run (cleanup).

  if [[ -f "$TEST_DIR/agentZ.exit" ]]; then
    local z_rc
    z_rc=$(cat "$TEST_DIR/agentZ.exit")
    log "Stage 2 complete in ${waited}s (agentZ=$z_rc)."
    log ""
    log "Full pipeline finished without manual intervention."
  else
    log "TIMEOUT: Stage 2 agent did not complete in 120s."
  fi

  log ""
  log "Inspect output:  tmux attach -t $TMUX_SESSION"
  log "Log files in: $TEST_DIR/"
}

# ── Main ──────────────────────────────────────────────────────────────────────

case "${1:-single}" in
  single)  test_single ;;
  modes)   test_modes_compare ;;
  multi)   test_multi ;;
  all)     test_single; echo ""; test_modes_compare; echo ""; test_multi ;;
  *)
    echo "Usage: $0 [single|modes|multi|all]"
    exit 1
    ;;
esac
