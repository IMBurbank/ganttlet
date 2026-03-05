#!/usr/bin/env bash
# test-watch-mode.sh — Smoke test for WATCH mode tmux agent sessions.
#
# Validates that:
#   1. Dependencies are available (tmux, claude)
#   2. CLI flags actually exist (--max-turns, --max-budget-usd with and without -p)
#   3. Different invocation modes produce the expected output characteristics
#   4. Agents auto-exit without manual intervention
#   5. Exit codes are captured correctly
#   6. A two-stage pipeline flows without stalling
#
# Usage:
#   ./scripts/test-watch-mode.sh           # run all tests
#   ./scripts/test-watch-mode.sh flags     # only test CLI flag validation
#   ./scripts/test-watch-mode.sh modes     # only test invocation modes
#   ./scripts/test-watch-mode.sh pipeline  # only test multi-stage pipeline flow
#
# This script must be run OUTSIDE of a claude session (will fail if CLAUDECODE is set).

set -uo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

TEST_DIR="/tmp/test-watch-mode-$$"
TMUX_SESSION="test-watch-$$"
TIMEOUT=120  # max seconds to wait for a single test
TRIVIAL_PROMPT="List the files in the current directory, then say DONE."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}  PASS${NC}: $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "${RED}  FAIL${NC}: $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); FAILURES+=("$*"); }
skip() { echo -e "${YELLOW}  SKIP${NC}: $*"; SKIP_COUNT=$((SKIP_COUNT + 1)); }
info() { echo -e "${BLUE}  INFO${NC}: $*"; }

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
FAILURES=()

cleanup() {
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  tmux kill-session -t "${TMUX_SESSION}-s2" 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$TEST_DIR"

# ── Preflight ─────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════"
echo "  WATCH Mode Smoke Test"
echo "═══════════════════════════════════════════════════"
echo ""

# Block running inside a claude session
if [[ -n "${CLAUDECODE:-}" ]]; then
  echo "ERROR: Cannot run inside a Claude Code session (nested sessions crash)."
  echo "Run this script directly: ./scripts/test-watch-mode.sh"
  exit 1
fi

# ── Test 1: Dependencies ─────────────────────────────────────────────────────

test_dependencies() {
  echo "── Test 1: Dependencies ──"

  if command -v tmux >/dev/null 2>&1; then
    pass "tmux is installed ($(tmux -V))"
  else
    fail "tmux is NOT installed"
  fi

  if command -v claude >/dev/null 2>&1; then
    pass "claude CLI is available"
  else
    fail "claude CLI is NOT available"
  fi
}

# ── Test 2: CLI Flag Validation ──────────────────────────────────────────────

test_flags() {
  echo "── Test 2: CLI Flag Validation ──"

  # Test --max-turns: does it exist?
  info "Testing --max-turns flag..."
  local mt_output
  mt_output=$(claude --max-turns 1 --dangerously-skip-permissions -p "Say hello" 2>&1) || true

  if echo "$mt_output" | grep -qi "unknown option\|unrecognized\|invalid\|error.*max-turns"; then
    fail "--max-turns is NOT a valid CLI flag (all launch-phase.sh invocations using it are broken)"
    info "  Output: $(echo "$mt_output" | head -3)"
  else
    pass "--max-turns is accepted by the CLI"
    info "  Output preview: $(echo "$mt_output" | head -1 | cut -c1-80)"
  fi

  # Test --max-budget-usd with -p (should work per docs)
  info "Testing --max-budget-usd with -p..."
  local mb_output
  mb_output=$(claude --max-budget-usd 0.01 --dangerously-skip-permissions -p "Say hello" 2>&1) || true

  if echo "$mb_output" | grep -qi "unknown option\|unrecognized\|invalid\|error.*max-budget"; then
    fail "--max-budget-usd is NOT accepted with -p"
  else
    pass "--max-budget-usd works with -p"
  fi

  # Test --max-budget-usd WITHOUT -p (docs say "only works with --print")
  # This is important: if launch-phase.sh switches to interactive mode, this flag does nothing
  info "Testing --max-budget-usd WITHOUT -p (interactive mode)..."
  info "  Note: --help says this 'only works with --print' — testing if it errors or silently ignores"

  # Can't fully test interactive mode in automated way, but we can check the help text
  local help_text
  help_text=$(claude --help 2>&1)
  if echo "$help_text" | grep -q "max-budget.*only works with.*print"; then
    fail "--max-budget-usd only works with --print — will be ignored in interactive mode"
    info "  This means switching to interactive mode for rich output loses budget limits"
  else
    pass "--max-budget-usd appears to work in all modes"
  fi

  # Check for --max-turns in help
  if echo "$help_text" | grep -q "max-turns"; then
    pass "--max-turns is documented in --help"
  else
    fail "--max-turns is NOT in --help output — may not be a real flag"
    info "  The flag might be silently ignored even if it doesn't error"
  fi

  # Check for native --tmux support
  if echo "$help_text" | grep -q "\-\-tmux"; then
    pass "claude has native --tmux flag (potential alternative to custom wrapper)"
    info "  $(echo "$help_text" | grep -A1 'tmux' | head -2)"
  else
    info "No native --tmux flag available"
  fi
}

# ── Test 3: Invocation Modes ─────────────────────────────────────────────────

test_modes() {
  echo "── Test 3: Invocation Modes ──"

  # --- Mode A: pipe mode (echo | claude -p -)
  info "Testing Mode A: pipe mode (echo | claude -p -)..."
  local mode_a_log="$TEST_DIR/mode-a.log"
  local mode_a_start
  mode_a_start=$(date +%s)

  echo "$TRIVIAL_PROMPT" | claude --dangerously-skip-permissions -p - > "$mode_a_log" 2>&1
  local mode_a_exit=$?
  local mode_a_elapsed=$(( $(date +%s) - mode_a_start ))

  if [[ $mode_a_exit -eq 0 ]]; then
    pass "Mode A (pipe) exited cleanly (${mode_a_elapsed}s)"
  else
    fail "Mode A (pipe) exited with code $mode_a_exit"
  fi

  local mode_a_lines
  mode_a_lines=$(wc -l < "$mode_a_log")
  info "  Mode A output: ${mode_a_lines} lines, $(wc -c < "$mode_a_log") bytes"

  # --- Mode B: positional arg with -p
  info "Testing Mode B: positional arg with -p (claude -p 'prompt')..."
  local mode_b_log="$TEST_DIR/mode-b.log"
  local mode_b_start
  mode_b_start=$(date +%s)

  claude --dangerously-skip-permissions -p "$TRIVIAL_PROMPT" > "$mode_b_log" 2>&1
  local mode_b_exit=$?
  local mode_b_elapsed=$(( $(date +%s) - mode_b_start ))

  if [[ $mode_b_exit -eq 0 ]]; then
    pass "Mode B (-p positional) exited cleanly (${mode_b_elapsed}s)"
  else
    fail "Mode B (-p positional) exited with code $mode_b_exit"
  fi

  local mode_b_lines
  mode_b_lines=$(wc -l < "$mode_b_log")
  info "  Mode B output: ${mode_b_lines} lines, $(wc -c < "$mode_b_log") bytes"

  # --- Mode C: interactive positional (no -p) in tmux — the critical test
  info "Testing Mode C: interactive mode (no -p) in tmux..."
  info "  This tests whether claude auto-exits or stalls"

  if ! command -v tmux >/dev/null 2>&1; then
    skip "Mode C: tmux not available"
    return
  fi

  local mode_c_log="$TEST_DIR/mode-c.log"
  local mode_c_exit_file="$TEST_DIR/mode-c.exit"
  rm -f "$mode_c_exit_file"

  # Write wrapper that runs claude interactively and captures exit
  cat > "$TEST_DIR/mode-c-wrapper.sh" <<'WRAPPER'
#!/usr/bin/env bash
set -uo pipefail
LOGFILE="PLACEHOLDER_LOG"
EXITFILE="PLACEHOLDER_EXIT"

# Run claude interactively with prompt as positional arg
# Use tee to capture output while showing in tmux
claude --dangerously-skip-permissions "List the files in the current directory, then say DONE." 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=${PIPESTATUS[0]:-$?}
echo "$EXIT_CODE" > "$EXITFILE"
exit "$EXIT_CODE"
WRAPPER
  sed -i "s|PLACEHOLDER_LOG|${mode_c_log}|g" "$TEST_DIR/mode-c-wrapper.sh"
  sed -i "s|PLACEHOLDER_EXIT|${mode_c_exit_file}|g" "$TEST_DIR/mode-c-wrapper.sh"
  chmod +x "$TEST_DIR/mode-c-wrapper.sh"

  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  tmux new-session -d -s "$TMUX_SESSION" -n "mode-c" "$TEST_DIR/mode-c-wrapper.sh"

  # Wait for completion with timeout
  local waited=0
  while [[ ! -f "$mode_c_exit_file" ]] && [[ $waited -lt $TIMEOUT ]]; do
    sleep 2
    waited=$((waited + 2))
  done

  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

  if [[ ! -f "$mode_c_exit_file" ]]; then
    fail "Mode C (interactive) DID NOT EXIT after ${TIMEOUT}s — this is the stall bug"
    info "  Claude in interactive mode without -p does not auto-exit"
    info "  The orchestrator MUST use a mechanism to force exit (--max-turns, prompt instructions, etc.)"
  else
    local mode_c_exit
    mode_c_exit=$(cat "$mode_c_exit_file")
    if [[ "$mode_c_exit" -eq 0 ]]; then
      pass "Mode C (interactive) exited cleanly in ${waited}s"
    else
      fail "Mode C (interactive) exited with code $mode_c_exit in ${waited}s"
    fi
  fi

  # Compare output richness
  if [[ -f "$mode_c_log" ]]; then
    local mode_c_lines
    mode_c_lines=$(wc -l < "$mode_c_log")
    local mode_c_bytes
    mode_c_bytes=$(wc -c < "$mode_c_log")
    info "  Mode C output: ${mode_c_lines} lines, ${mode_c_bytes} bytes"

    # Check for rich output indicators (thinking blocks, tool use, ANSI codes)
    local has_ansi=false
    local has_tool_use=false
    if grep -qP '\x1b\[' "$mode_c_log" 2>/dev/null; then
      has_ansi=true
    fi
    if grep -qi 'tool\|bash\|read\|edit\|write' "$mode_c_log" 2>/dev/null; then
      has_tool_use=true
    fi

    info "  Mode C rich indicators: ANSI=${has_ansi}, tool_use=${has_tool_use}"

    if [[ $mode_c_bytes -gt $(( $(wc -c < "$mode_a_log") * 2 )) ]]; then
      pass "Mode C produces significantly more output than pipe mode (richer)"
    else
      info "Mode C output size is comparable to pipe mode — may not be capturing rich TUI"
    fi
  fi

  # --- Mode D: interactive with --max-turns (if flag exists)
  info "Testing Mode D: interactive + --max-turns (auto-exit mechanism?)..."

  local mode_d_log="$TEST_DIR/mode-d.log"
  local mode_d_exit_file="$TEST_DIR/mode-d.exit"
  rm -f "$mode_d_exit_file"

  cat > "$TEST_DIR/mode-d-wrapper.sh" <<'WRAPPER'
#!/usr/bin/env bash
set -uo pipefail
LOGFILE="PLACEHOLDER_LOG"
EXITFILE="PLACEHOLDER_EXIT"

claude --dangerously-skip-permissions --max-turns 5 "List the files in the current directory, then say DONE." 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=${PIPESTATUS[0]:-$?}
echo "$EXIT_CODE" > "$EXITFILE"
exit "$EXIT_CODE"
WRAPPER
  sed -i "s|PLACEHOLDER_LOG|${mode_d_log}|g" "$TEST_DIR/mode-d-wrapper.sh"
  sed -i "s|PLACEHOLDER_EXIT|${mode_d_exit_file}|g" "$TEST_DIR/mode-d-wrapper.sh"
  chmod +x "$TEST_DIR/mode-d-wrapper.sh"

  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  tmux new-session -d -s "$TMUX_SESSION" -n "mode-d" "$TEST_DIR/mode-d-wrapper.sh"

  waited=0
  while [[ ! -f "$mode_d_exit_file" ]] && [[ $waited -lt $TIMEOUT ]]; do
    sleep 2
    waited=$((waited + 2))
  done

  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

  if [[ ! -f "$mode_d_exit_file" ]]; then
    fail "Mode D (interactive + --max-turns) DID NOT EXIT after ${TIMEOUT}s"
    info "  --max-turns may not cause auto-exit in interactive mode"
  else
    local mode_d_exit
    mode_d_exit=$(cat "$mode_d_exit_file")
    pass "Mode D (interactive + --max-turns) exited in ${waited}s (exit code: $mode_d_exit)"

    if [[ -f "$mode_d_log" ]]; then
      local mode_d_bytes
      mode_d_bytes=$(wc -c < "$mode_d_log")
      info "  Mode D output: $(wc -l < "$mode_d_log") lines, ${mode_d_bytes} bytes"

      # Compare with pipe mode
      local mode_a_bytes
      mode_a_bytes=$(wc -c < "$mode_a_log")
      if [[ $mode_d_bytes -gt $(( mode_a_bytes * 2 )) ]]; then
        pass "Mode D is significantly richer than pipe mode — this is the winning approach"
      else
        info "Mode D output size comparable to pipe mode — --max-turns may force pipe-like behavior"
      fi
    fi
  fi
}

# ── Test 4: Two-Stage Pipeline Flow ──────────────────────────────────────────

test_pipeline() {
  echo "── Test 4: Two-Stage Pipeline Flow ──"

  if ! command -v tmux >/dev/null 2>&1; then
    skip "Pipeline test: tmux not available"
    return
  fi

  info "Running a two-stage pipeline with trivial prompts..."
  info "  Stage 1: two parallel agents (agentX, agentY)"
  info "  Stage 2: one agent (agentZ) — should start automatically after stage 1"

  # Create trivial prompt files
  mkdir -p "$TEST_DIR/prompts"
  echo "Say 'Hello from agent X' and then say DONE." > "$TEST_DIR/prompts/agentX.md"
  echo "Say 'Hello from agent Y' and then say DONE." > "$TEST_DIR/prompts/agentY.md"
  echo "Say 'Hello from agent Z, stage 2' and then say DONE." > "$TEST_DIR/prompts/agentZ.md"

  # Determine the best invocation mode from test 3 results
  # For now, use -p mode as the known-working baseline
  local claude_flags="--dangerously-skip-permissions -p"

  # Stage 1: launch two agents in parallel tmux windows
  local stage1_start
  stage1_start=$(date +%s)

  for agent in agentX agentY; do
    local agent_log="$TEST_DIR/${agent}.log"
    local agent_exit="$TEST_DIR/${agent}.exit"
    rm -f "$agent_exit"

    cat > "$TEST_DIR/${agent}-run.sh" <<WRAPPER
#!/usr/bin/env bash
set -uo pipefail
claude $claude_flags "\$(cat '$TEST_DIR/prompts/${agent}.md')" 2>&1 | tee -a "$agent_log"
echo \${PIPESTATUS[0]:-\$?} > "$agent_exit"
WRAPPER
    chmod +x "$TEST_DIR/${agent}-run.sh"
  done

  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  tmux new-session -d -s "$TMUX_SESSION" -n "agentX" "$TEST_DIR/agentX-run.sh; read"
  tmux new-window -t "$TMUX_SESSION" -n "agentY" "$TEST_DIR/agentY-run.sh; read"

  # Wait for both stage 1 agents
  local waited=0
  while [[ $waited -lt $TIMEOUT ]]; do
    local s1_done=true
    for agent in agentX agentY; do
      [[ ! -f "$TEST_DIR/${agent}.exit" ]] && s1_done=false && break
    done
    $s1_done && break
    sleep 2
    waited=$((waited + 2))
  done

  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  local stage1_elapsed=$(( $(date +%s) - stage1_start ))

  # Check stage 1 results
  local s1_ok=true
  for agent in agentX agentY; do
    if [[ ! -f "$TEST_DIR/${agent}.exit" ]]; then
      fail "Stage 1: ${agent} did not complete in ${TIMEOUT}s"
      s1_ok=false
    else
      local rc
      rc=$(cat "$TEST_DIR/${agent}.exit")
      if [[ "$rc" -eq 0 ]]; then
        pass "Stage 1: ${agent} completed (exit 0, ${stage1_elapsed}s)"
      else
        fail "Stage 1: ${agent} failed (exit $rc)"
        s1_ok=false
      fi
    fi
  done

  if ! $s1_ok; then
    skip "Stage 2: skipping because stage 1 failed"
    return
  fi

  # Stage 2: launch one agent — tests that pipeline doesn't stall between stages
  info "Stage 1 complete. Starting stage 2 automatically..."

  local stage2_start
  stage2_start=$(date +%s)
  local agent_log="$TEST_DIR/agentZ.log"
  local agent_exit="$TEST_DIR/agentZ.exit"
  rm -f "$agent_exit"

  cat > "$TEST_DIR/agentZ-run.sh" <<WRAPPER
#!/usr/bin/env bash
set -uo pipefail
claude $claude_flags "\$(cat '$TEST_DIR/prompts/agentZ.md')" 2>&1 | tee -a "$agent_log"
echo \${PIPESTATUS[0]:-\$?} > "$agent_exit"
WRAPPER
  chmod +x "$TEST_DIR/agentZ-run.sh"

  tmux kill-session -t "${TMUX_SESSION}-s2" 2>/dev/null || true
  tmux new-session -d -s "${TMUX_SESSION}-s2" -n "agentZ" "$TEST_DIR/agentZ-run.sh; read"

  waited=0
  while [[ ! -f "$agent_exit" ]] && [[ $waited -lt $TIMEOUT ]]; do
    sleep 2
    waited=$((waited + 2))
  done

  tmux kill-session -t "${TMUX_SESSION}-s2" 2>/dev/null || true
  local stage2_elapsed=$(( $(date +%s) - stage2_start ))

  if [[ ! -f "$agent_exit" ]]; then
    fail "Stage 2: agentZ did not complete in ${TIMEOUT}s"
  else
    local rc
    rc=$(cat "$agent_exit")
    if [[ "$rc" -eq 0 ]]; then
      pass "Stage 2: agentZ completed (exit 0, ${stage2_elapsed}s)"
    else
      fail "Stage 2: agentZ failed (exit $rc)"
    fi
  fi

  local total_elapsed=$(( $(date +%s) - stage1_start ))
  pass "Full pipeline completed in ${total_elapsed}s without manual intervention"
}

# ── Report ────────────────────────────────────────────────────────────────────

report() {
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  Results: ${PASS_COUNT} passed, ${FAIL_COUNT} failed, ${SKIP_COUNT} skipped"
  echo "═══════════════════════════════════════════════════"

  if [[ ${#FAILURES[@]} -gt 0 ]]; then
    echo ""
    echo "Failures:"
    for f in "${FAILURES[@]}"; do
      echo "  - $f"
    done
  fi

  echo ""
  echo "Log files in: $TEST_DIR"
  echo "  Mode A (pipe):            $TEST_DIR/mode-a.log"
  echo "  Mode B (-p positional):   $TEST_DIR/mode-b.log"
  echo "  Mode C (interactive):     $TEST_DIR/mode-c.log"
  echo "  Mode D (interactive+max): $TEST_DIR/mode-d.log"
  echo ""

  if [[ $FAIL_COUNT -gt 0 ]]; then
    echo "ACTION REQUIRED: Review failures above before using WATCH mode in production."
    echo ""
    echo "Key questions to answer:"
    echo "  1. Does --max-turns exist and cause auto-exit in interactive mode?"
    echo "  2. If not, what mechanism from Phase 12 forced auto-exit?"
    echo "  3. Does --max-budget-usd work without -p? If not, how do we limit spend in interactive mode?"
    echo "  4. Is the native --tmux flag a better approach than custom wrappers?"
    exit 1
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

case "${1:-all}" in
  flags)    test_dependencies; test_flags ;;
  modes)    test_dependencies; test_modes ;;
  pipeline) test_dependencies; test_pipeline ;;
  all)      test_dependencies; test_flags; test_modes; test_pipeline ;;
  *)
    echo "Usage: $0 [flags|modes|pipeline|all]"
    exit 1
    ;;
esac

report
