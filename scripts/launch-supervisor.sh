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
#   ./scripts/launch-supervisor.sh docs/prompts/phase15/launch-config.yaml
#
# Environment:
#   MODEL                — Override Claude model for the supervisor (default: unset)
#   SUPERVISOR_BUDGET    — Max USD budget for supervisor agent (default: 50.00)

set -euo pipefail

WORKSPACE="/workspace"
SUPERVISOR_BUDGET="${SUPERVISOR_BUDGET:-50.00}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERVISOR_PROMPT="${SCRIPT_DIR}/../docs/prompts/supervisor.md"

# ── Parse arguments ──────────────────────────────────────────────────────────

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: ./scripts/launch-supervisor.sh <config-file>

Starts an interactive Claude agent that orchestrates the full phase pipeline:
  stage 1 → merge 1 → stage 2 → merge 2 → ... → validate → create-pr → review loop

The supervisor calls launch-phase.sh subcommands and makes intelligent decisions
about retries, failures, and the code review loop.

Arguments:
  <config-file>   Path to launch-config.yaml (e.g., docs/prompts/phase15/launch-config.yaml)

Environment variables:
  MODEL                Override Claude model for supervisor (opus, sonnet, haiku)
  SUPERVISOR_BUDGET    Max USD budget for supervisor agent (default: 50.00)
USAGE
  exit 0
fi

if [[ $# -lt 1 ]]; then
  echo "Error: config file required"
  echo "Usage: ./scripts/launch-supervisor.sh <config-file>"
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
  --max-budget-usd "$SUPERVISOR_BUDGET"
)

if [[ -n "${MODEL:-}" ]]; then
  claude_args+=(--model "$MODEL")
fi

# Initial message tells the agent which config to use
initial_msg="Orchestrate the phase launch using config: ${CONFIG_FILE}

Start by reading the config file and running status, then execute the full pipeline."

# ── Launch supervisor ────────────────────────────────────────────────────────

echo "Starting supervisor agent..."
echo "  Config: ${CONFIG_FILE}"
echo "  Budget: \$${SUPERVISOR_BUDGET}"
echo "  Prompt: ${SUPERVISOR_PROMPT}"
echo ""

exec claude "${claude_args[@]}" "$initial_msg"
