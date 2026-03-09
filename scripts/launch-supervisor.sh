#!/usr/bin/env bash
# launch-supervisor.sh — Start a Claude supervisor agent to orchestrate a phase launch.
#
# The supervisor agent drives the pipeline step-by-step using launch-phase.sh
# subcommands (stage, merge, validate, create-pr). It monitors output, reads
# logs, makes judgment calls on retries/failures, and handles the code review
# loop — replacing the automated run_pipeline() with intelligent orchestration.
#
# Usage:
#   ./scripts/launch-supervisor.sh <config-file>
#   ./scripts/launch-supervisor.sh --tmux <config-file>
#   ./scripts/launch-supervisor.sh docs/prompts/phase15/launch-config.yaml
#
# Environment:
#   MODEL                — Override Claude model for the supervisor (default: unset)

set -euo pipefail

WORKSPACE="/workspace"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERVISOR_PROMPT="${SCRIPT_DIR}/../docs/prompts/supervisor.md"
TMUX_MODE=0

# ── Parse arguments ──────────────────────────────────────────────────────────

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: ./scripts/launch-supervisor.sh [--tmux] <config-file>

Starts an interactive Claude agent that orchestrates the full phase pipeline:
  stage 1 → merge 1 → stage 2 → merge 2 → ... → validate → create-pr → review loop

The supervisor calls launch-phase.sh subcommands and makes intelligent decisions
about retries, failures, and the code review loop.

Options:
  --tmux           Run supervisor inside a tmux session with direct agent
                   window control (launch, monitor, kill agents in real-time)

Arguments:
  <config-file>   Path to launch-config.yaml (e.g., docs/prompts/phase15/launch-config.yaml)

Environment variables:
  MODEL                Override Claude model for supervisor (opus, sonnet, haiku)
USAGE
  exit 0
fi

if [[ "${1:-}" == "--tmux" ]]; then
  TMUX_MODE=1
  shift
fi

if [[ $# -lt 1 ]]; then
  echo "Error: config file required"
  echo "Usage: ./scripts/launch-supervisor.sh [--tmux] <config-file>"
  exit 1
fi

CONFIG_FILE="$1"

# Resolve config path
if [[ ! -f "$CONFIG_FILE" ]]; then
  if [[ -f "${WORKSPACE}/${CONFIG_FILE}" ]]; then
    CONFIG_FILE="${WORKSPACE}/${CONFIG_FILE}"
  else
    echo "Error: Config file not found: ${CONFIG_FILE}"
    exit 1
  fi
fi

# Make absolute
CONFIG_FILE="$(cd "$(dirname "$CONFIG_FILE")" && pwd)/$(basename "$CONFIG_FILE")"

# ── Validate prerequisites ───────────────────────────────────────────────────

if ! command -v claude &>/dev/null; then
  echo "Error: claude CLI not found"
  exit 1
fi

if [[ ! -f "$SUPERVISOR_PROMPT" ]]; then
  echo "Error: Supervisor prompt not found: ${SUPERVISOR_PROMPT}"
  exit 1
fi

# ── Build Claude command ─────────────────────────────────────────────────────

claude_args=(
  --dangerously-skip-permissions
  --system-prompt "$(cat "$SUPERVISOR_PROMPT")"
)

# Note: --max-budget-usd only works with --print (pipe mode).
# The supervisor runs interactively, so budget must be managed manually.
# The supervisor prompt instructs the agent to be cost-conscious.

if [[ -n "${MODEL:-}" ]]; then
  claude_args+=(--model "$MODEL")
fi

# Initial message tells the agent which config to use
initial_msg="Orchestrate the phase launch using config: ${CONFIG_FILE}

Start by reading the config file and running status, then execute the full pipeline."

# ── Launch supervisor ────────────────────────────────────────────────────────

if [[ "$TMUX_MODE" -eq 1 ]]; then
  # Tmux mode: create a session and run the supervisor in window 0
  if ! command -v tmux &>/dev/null; then
    echo "Error: --tmux requires tmux but it's not installed"
    exit 1
  fi

  # Extract phase name from config for session naming
  PHASE_NAME=$(grep -m1 '^phase:' "$CONFIG_FILE" | awk '{print $2}' || echo "phase")
  SESSION_NAME="${PHASE_NAME}-supervisor"

  # Kill existing session if any
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

  echo "Starting supervisor in tmux session: ${SESSION_NAME}"
  echo "  Config: ${CONFIG_FILE}"
  echo "  Prompt: ${SUPERVISOR_PROMPT}"
  echo "  Mode:   tmux-native (direct agent window control)"
  echo ""
  echo "Attach with:  tmux attach -t ${SESSION_NAME}"
  echo ""

  # Create session with high history limit
  tmux new-session -d -s "$SESSION_NAME" -n "supervisor"
  tmux set-option -t "$SESSION_NAME" history-limit 10000

  # Write a launcher script to avoid quoting issues with tmux send-keys.
  # Direct send-keys breaks when the system prompt contains backticks, dollar
  # signs, or double quotes (supervisor.md has all three). A temp script reads
  # the prompt into a variable safely and passes it via "$VAR" expansion.
  LAUNCH_SCRIPT=$(mktemp /tmp/supervisor-launch-XXXXXX.sh)
  cat > "$LAUNCH_SCRIPT" <<LAUNCHER
#!/usr/bin/env bash
unset CLAUDECODE
PROMPT_CONTENT="\$(cat '${SUPERVISOR_PROMPT}')"
exec claude --dangerously-skip-permissions --system-prompt "\$PROMPT_CONTENT" ${MODEL:+--model "${MODEL}"} 'Orchestrate the phase launch using config: ${CONFIG_FILE}. Start by reading the config file and running status, then execute the full pipeline.'
LAUNCHER
  chmod +x "$LAUNCH_SCRIPT"

  # Send just the script path — no quoting issues
  tmux send-keys -t "${SESSION_NAME}:supervisor" "bash '${LAUNCH_SCRIPT}'"
  sleep 0.5
  tmux send-keys -t "${SESSION_NAME}:supervisor" Enter

  # Attach to the session
  exec tmux attach -t "$SESSION_NAME"
else
  echo "Starting supervisor agent..."
  echo "  Config: ${CONFIG_FILE}"
  echo "  Prompt: ${SUPERVISOR_PROMPT}"
  echo ""

  exec claude "${claude_args[@]}" "$initial_msg"
fi
