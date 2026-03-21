#!/usr/bin/env bash
# launch-phase.sh — Orchestrates parallel Claude Code agents for a phase.
#
# The phase is fully defined by a YAML config file (launch-config.yaml) and
# per-group prompt files. The script itself never changes between phases.
#
# Usage:
#   ./scripts/launch-phase.sh <config> all              # full pipeline
#   ./scripts/launch-phase.sh <config> stage 1           # run Stage 1 parallel groups
#   ./scripts/launch-phase.sh <config> merge 1           # merge Stage 1 branches
#   ./scripts/launch-phase.sh <config> validate          # run validation agent
#   ./scripts/launch-phase.sh <config> create-pr         # create PR + trigger code review
#   ./scripts/launch-phase.sh <config> resume <step>     # resume from a step (e.g., "stage:2")
#   ./scripts/launch-phase.sh <config> status            # show worktree/branch status
#   WATCH=1 ./scripts/launch-phase.sh <config> all       # with live tmux output
#
#   <config> is a path to a launch-config.yaml file, e.g.:
#     docs/prompts/phase15/launch-config.yaml
#
# Environment:
#   WATCH=1             — live interactive agent output in tmux panes
#   MAX_RETRIES=3       — retries per agent on crash
#   RETRY_DELAY=5       — seconds between retries
#   VALIDATE_MAX_ATTEMPTS=3 — max fix-and-retry cycles for validation
#   MERGE_FIX_RETRIES=3 — retries for merge conflict resolution
#   MAX_STAGE_DURATION=1800 — max seconds per stage before killing agents
#   MERGE_TARGET        — override implementation branch (default: from config)
#   WORKTREE_BASE       — worktree root (default: <main-repo-root>/.claude/worktrees)

set -euo pipefail

# Allow nested Claude sessions when launched from a supervisor agent.
# Without this, child `claude` processes refuse to start.
unset CLAUDECODE 2>/dev/null || true

# ── Config defaults ──────────────────────────────────────────────────────────

MAX_RETRIES="${MAX_RETRIES:-3}"
RETRY_DELAY="${RETRY_DELAY:-5}"
MERGE_FIX_RETRIES="${MERGE_FIX_RETRIES:-3}"
DEFAULT_MAX_TURNS="${DEFAULT_MAX_TURNS:-80}"
DEFAULT_MAX_BUDGET="${DEFAULT_MAX_BUDGET:-10.00}"
STALL_TIMEOUT="${STALL_TIMEOUT:-30}"
# WORKSPACE is the main repo root — used only for WORKTREE_BASE derivation
# and config file path resolution. No scripts cd to it.
WORKSPACE="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
WORKTREE_BASE="${WORKTREE_BASE:-${WORKSPACE}/.claude/worktrees}"
WATCH="${WATCH:-0}"
VALIDATE_MAX_ATTEMPTS="${VALIDATE_MAX_ATTEMPTS:-3}"
MAX_STAGE_DURATION="${MAX_STAGE_DURATION:-1800}"  # 30 minutes default

# Preserve user's explicit MERGE_TARGET (empty if unset)
_USER_MERGE_TARGET="${MERGE_TARGET:-}"

# Capture the invoker's context so downstream operations use the
# orchestrator's worktree, not /workspace.
_LAUNCH_BASE_REF="$(git rev-parse HEAD)"
_LAUNCH_DIR="$(pwd)"
export _LAUNCH_BASE_REF _LAUNCH_DIR

# ── Resolve script directory and source libraries ────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/lib/log.sh"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/worktree.sh"
source "${SCRIPT_DIR}/lib/agent.sh"
source "${SCRIPT_DIR}/lib/stage.sh"
source "${SCRIPT_DIR}/lib/watch.sh"
source "${SCRIPT_DIR}/lib/merge.sh"
source "${SCRIPT_DIR}/lib/validate.sh"
source "${SCRIPT_DIR}/lib/pr.sh"

# ── Parse arguments ──────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
Usage: ./scripts/launch-phase.sh <config-file> <command> [args...]

Arguments:
  <config-file>   Path to launch-config.yaml (e.g., docs/prompts/phase15/launch-config.yaml)

Commands:
  all               Full pipeline: stage1 → merge1 → ... → validate → create-pr
  stage <N>         Run Stage N parallel groups in worktrees (1-based)
  merge <N>         Merge Stage N branches to implementation branch + verify
  validate          Run validation agent (checks all tests, fixes issues, reports)
  create-pr         Create PR from implementation branch to main + trigger code review
  resume <step>     Resume pipeline from a step (e.g., "stage:2", "merge:1", "validate")
  cleanup           Remove all worktrees and prune branches for this phase
  status            Show current worktree and branch status
  logs [group]      Tail agent logs (optionally for a specific group)

Environment variables:
  WATCH=1                    Live interactive agent output in tmux panes
  MAX_RETRIES=3              Retries per agent on crash
  RETRY_DELAY=5              Seconds between retries
  VALIDATE_MAX_ATTEMPTS=3    Max fix-and-retry cycles for validation
  MERGE_FIX_RETRIES=3        Retries for merge conflict resolution
  MAX_STAGE_DURATION=1800    Max seconds per stage before killing agents (0=disabled)
  MERGE_TARGET               Override implementation branch
  MODEL                      Override Claude model (opus, sonnet, haiku)
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

CONFIG_FILE="$1"
shift

if [[ ! -f "$CONFIG_FILE" ]]; then
  # Try resolving relative to WORKSPACE
  if [[ -f "${WORKSPACE}/${CONFIG_FILE}" ]]; then
    CONFIG_FILE="${WORKSPACE}/${CONFIG_FILE}"
  else
    err "Config file not found: ${CONFIG_FILE}"
    exit 1
  fi
fi

# Load config — sets PHASE, MERGE_TARGET, NUM_STAGES, STAGE_* arrays, PR_*, LOG_DIR, etc.
load_config "$CONFIG_FILE"

# Derive PROMPTS_DIR from config file location
PROMPTS_DIR="$(dirname "$CONFIG_FILE")"
# Make it relative to WORKSPACE if it's an absolute path under WORKSPACE
PROMPTS_DIR="${PROMPTS_DIR#"${WORKSPACE}/"}"

# ── Dynamic stage/merge runners ─────────────────────────────────────────────

# Run stage N (1-based).
run_stage() {
  local stage_num="$1"
  local stage_idx=$((stage_num - 1))

  if [[ $stage_idx -lt 0 || $stage_idx -ge $NUM_STAGES ]]; then
    err "Stage ${stage_num} out of range (config has ${NUM_STAGES} stages)"
    return 1
  fi

  local stage_name="${STAGE_NAMES[$stage_idx]}"
  local count="${STAGE_GROUP_COUNTS[$stage_idx]}"

  # Build temporary arrays for this stage
  local groups=() branches=()
  for ((g=0; g<count; g++)); do
    groups+=("${STAGE_GROUP_IDS["${stage_idx}:${g}"]}")
    branches+=("${STAGE_BRANCHES["${stage_idx}:${g}"]}")
  done

  run_parallel_stage "Stage ${stage_num}: ${stage_name}" groups branches
}

# Run merge for stage N (1-based).
run_merge() {
  local stage_num="$1"
  local stage_idx=$((stage_num - 1))

  if [[ $stage_idx -lt 0 || $stage_idx -ge $NUM_STAGES ]]; then
    err "Stage ${stage_num} out of range (config has ${NUM_STAGES} stages)"
    return 1
  fi

  local stage_name="${STAGE_NAMES[$stage_idx]}"
  local count="${STAGE_GROUP_COUNTS[$stage_idx]}"

  local groups=() branches=() messages=()
  for ((g=0; g<count; g++)); do
    groups+=("${STAGE_GROUP_IDS["${stage_idx}:${g}"]}")
    branches+=("${STAGE_BRANCHES["${stage_idx}:${g}"]}")
    messages+=("${STAGE_MERGE_MSGS["${stage_idx}:${g}"]}")
  done

  do_merge "Merge ${stage_num}: ${stage_name}" groups branches messages
}

# ── Pipeline ─────────────────────────────────────────────────────────────────

# Build the ordered list of pipeline steps dynamically from NUM_STAGES.
# Pattern: stage:1, merge:1, stage:2, merge:2, ..., stage:N, merge:N, validate, create-pr
build_pipeline_steps() {
  local steps=()
  for ((s=1; s<=NUM_STAGES; s++)); do
    steps+=("stage:${s}" "merge:${s}")
  done
  steps+=("validate" "create-pr")
  echo "${steps[@]}"
}

run_pipeline() {
  local start_from="${1:-stage:1}"
  local pipeline_ok=true
  local started=false

  log "=== Pipeline starting from: ${start_from} ==="
  log "=== Phase: ${PHASE} — ${NUM_STAGES} stages ==="

  local steps
  read -ra steps <<< "$(build_pipeline_steps)"

  for step in "${steps[@]}"; do
    if [[ "$step" == "$start_from" ]]; then
      started=true
    fi
    if ! $started; then
      log "Skipping ${step} (resuming from ${start_from})"
      continue
    fi

    case "$step" in
      stage:*)
        local n="${step#stage:}"
        if ! run_stage "$n"; then
          err "Stage ${n} FAILED — aborting pipeline (no agents ran successfully)"
          return 1
        fi
        ;;
      merge:*)
        local n="${step#merge:}"
        run_merge "$n" || { warn "Merge ${n} had failures — continuing pipeline"; pipeline_ok=false; }
        ;;
      validate)
        if validate; then
          ok "=== Validation passed ==="
        else
          err "=== Validation FAILED ==="
          pipeline_ok=false
        fi
        ;;
      create-pr)
        if $pipeline_ok; then
          create_pr || warn "PR creation had issues"
        else
          warn "Skipping PR creation — pipeline had failures"
        fi
        ;;
    esac
  done

  if $pipeline_ok; then
    ok "=== Pipeline complete — all stages passed, PR created ==="
  else
    err "Pipeline had issues — review logs in ${LOG_DIR}"
    return 1
  fi
}

# ── Status / logs ────────────────────────────────────────────────────────────

show_status() {
  log "=== Current status ==="
  echo ""
  echo "Phase: ${PHASE}"
  echo "Config: ${CONFIG_FILE}"
  echo "Stages: ${NUM_STAGES}"
  for ((s=0; s<NUM_STAGES; s++)); do
    echo "  Stage $((s+1)): ${STAGE_NAMES[$s]} (${STAGE_GROUP_COUNTS[$s]} groups)"
  done
  echo ""
  echo "Git worktrees:"
  git worktree list
  echo ""
  echo "Branches:"
  git branch -v
  echo ""
  echo "Log files:"
  ls -lh "$LOG_DIR" 2>/dev/null || echo "  (no logs yet)"
}

# Remove all worktrees and branches for this phase.
cleanup_phase() {
  log "=== Cleaning up phase: ${PHASE} ==="

  # Remove merge worktree
  cleanup_merge_worktree

  # Find and remove all phase worktrees (names derived from branch names)
  local removed=0
  for ((s=0; s<NUM_STAGES; s++)); do
    local count="${STAGE_GROUP_COUNTS[$s]}"
    for ((g=0; g<count; g++)); do
      local branch="${STAGE_BRANCHES["${s}:${g}"]}"
      local wt="${WORKTREE_BASE}/${branch//\//-}"
      if [[ -d "$wt" ]]; then
        log "Removing worktree: ${wt}"
        rm -rf "$wt"
        removed=$((removed + 1))
      fi
    done
  done

  # Prune any stale worktree references
  git worktree prune 2>/dev/null || true

  # Remove phase branches (implementation branch + group branches)
  local phase_branches
  phase_branches=$(git branch --list "*${PHASE}*" 2>/dev/null || echo "")
  if [[ -n "$phase_branches" ]]; then
    while IFS= read -r branch; do
      branch=$(echo "$branch" | sed 's/^[* ]*//')
      if [[ -n "$branch" && "$branch" != "main" ]]; then
        log "Deleting branch: ${branch}"
        git branch -d "$branch" 2>/dev/null || \
          warn "Could not delete branch: ${branch} (may need -D)"
      fi
    done <<< "$phase_branches"
  fi

  log "Verifying cleanup..."
  echo ""
  echo "Remaining worktrees:"
  git worktree list
  echo ""
  echo "Remaining branches matching ${PHASE}:"
  git branch --list "*${PHASE}*" 2>/dev/null || echo "  (none)"
  echo ""

  ok "=== Phase ${PHASE} cleanup complete (${removed} worktrees removed) ==="
}

show_logs() {
  local group="${1:-}"
  if [[ -n "$group" ]]; then
    tail -f "${LOG_DIR}/${group}.log"
  else
    tail -f "${LOG_DIR}"/*.log
  fi
}

# ── CLI dispatch ─────────────────────────────────────────────────────────────

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  stage)
    if [[ -z "${1:-}" ]]; then
      err "Usage: ./scripts/launch-phase.sh <config> stage <N>"
      exit 1
    fi
    run_stage "$1"
    ;;
  merge)
    if [[ -z "${1:-}" ]]; then
      err "Usage: ./scripts/launch-phase.sh <config> merge <N>"
      exit 1
    fi
    run_merge "$1"
    ;;
  validate)
    validate
    ;;
  create-pr)
    create_pr
    ;;
  all)
    run_pipeline "stage:1"
    ;;
  resume)
    if [[ -z "${1:-}" ]]; then
      err "Usage: ./scripts/launch-phase.sh <config> resume <step>"
      err "Steps: stage:1, merge:1, stage:2, merge:2, ..., validate, create-pr"
      exit 1
    fi
    # Support both "resume stage 2" and "resume stage:2" syntax
    resume_step="$1"
    if [[ -n "${2:-}" && "$1" =~ ^(stage|merge)$ ]]; then
      resume_step="${1}:${2}"
    fi
    run_pipeline "$resume_step"
    ;;
  cleanup)
    cleanup_phase
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs "${1:-}"
    ;;
  -h|--help)
    usage
    ;;
  *)
    err "Unknown command: ${COMMAND}"
    usage
    exit 1
    ;;
esac
