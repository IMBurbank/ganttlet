#!/usr/bin/env bash
# launch-phase.sh — Orchestrates parallel Claude Code agents for a phase.
#
# Usage:
#   ./scripts/launch-phase.sh                    # interactive menu
#   ./scripts/launch-phase.sh stage1             # run Stage 1 parallel groups
#   ./scripts/launch-phase.sh merge1             # merge Stage 1 branches to main
#   ./scripts/launch-phase.sh stage2             # run Stage 2 parallel groups
#   ./scripts/launch-phase.sh merge2             # merge Stage 2 branches to main
#   ./scripts/launch-phase.sh all                # full pipeline: stage1 → merge1 → stage2 → merge2
#
# Environment:
#   MAX_RETRIES     — retries per agent on crash (default: 3)
#   RETRY_DELAY     — seconds between retries (default: 5)
#   PROMPTS_DIR     — path to prompt files (default: docs/prompts)
#   WORKTREE_BASE   — worktree root (default: /workspace/.claude/worktrees)

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

MAX_RETRIES="${MAX_RETRIES:-3}"
RETRY_DELAY="${RETRY_DELAY:-5}"
PROMPTS_DIR="${PROMPTS_DIR:-docs/prompts}"
WORKTREE_BASE="${WORKTREE_BASE:-/workspace/.claude/worktrees}"
WORKSPACE="/workspace"
LOG_DIR="${WORKSPACE}/logs/phase11"

PHASE="phase11"

# Stage 1: Testing infrastructure (all three groups run in parallel, single stage)
STAGE1_GROUPS=("groupE" "groupF" "groupG")
STAGE1_BRANCHES=(
  "feature/phase11-server-tests"
  "feature/phase11-e2e-tests"
  "feature/phase11-ci-e2e"
)
STAGE1_MERGE_MESSAGES=(
  "Merge feature/phase11-server-tests: diagnose and fix presence regression, add WebSocket auth and awareness integration tests"
  "Merge feature/phase11-e2e-tests: Playwright E2E tests for collaboration, presence, and tooltip"
  "Merge feature/phase11-ci-e2e: E2E test workflow in CI pipeline"
)

# Stage 2: empty (single-stage phase)
STAGE2_GROUPS=()
STAGE2_BRANCHES=()
STAGE2_MERGE_MESSAGES=()

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

    # If retrying, add context about the restart
    local full_prompt="$prompt"
    if [[ $attempt -gt 1 ]]; then
      local recent_commits
      recent_commits=$(cd "$workdir" && git log --oneline -5 2>/dev/null || echo "(no commits yet)")
      full_prompt="NOTE: You are being restarted after a crash. This is attempt ${attempt}/${MAX_RETRIES}.
Your recent commits in this worktree:
${recent_commits}

Review what has already been done and continue from where you left off. Do not redo completed work.

---

${prompt}"
    fi

    # Run claude, capturing exit code
    set +e
    (
      cd "$workdir"
      echo "$full_prompt" | claude --dangerously-skip-permissions -p -
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

# ── Generic parallel stage runner ─────────────────────────────────────────────

# Usage: run_parallel_stage "Stage 1" STAGE1_GROUPS STAGE1_BRANCHES
run_parallel_stage() {
  local stage_label="$1"
  local -n groups_ref="$2"
  local -n branches_ref="$3"

  log "=== ${stage_label}: Launching parallel groups ==="

  local pids=()
  local groups_list=()

  for i in "${!groups_ref[@]}"; do
    local group="${groups_ref[$i]}"
    local branch="${branches_ref[$i]}"
    local worktree="${WORKTREE_BASE}/${PHASE}-${group}"

    # Create worktree if it doesn't exist
    if [[ ! -d "$worktree" ]]; then
      log "Creating worktree: ${worktree} (branch: ${branch})"
      cd "$WORKSPACE"
      git worktree add "$worktree" -b "$branch" 2>/dev/null || \
        git worktree add "$worktree" "$branch" 2>/dev/null || \
        { err "Failed to create worktree for ${group}"; continue; }
    else
      log "Worktree already exists: ${worktree}"
    fi

    # Install deps in worktree
    (cd "$worktree" && npm install --silent 2>/dev/null) || true

    # Symlink WASM artifacts in worktrees (needed for tests/builds)
    (
      cd "$worktree"
      if [[ ! -d "src/wasm/scheduler" && ! -L "src/wasm/scheduler" ]]; then
        log "Symlinking WASM artifacts for ${group}"
        ln -s /workspace/src/wasm/scheduler src/wasm/scheduler 2>/dev/null || true
      fi
    )

    # Launch agent in background
    run_agent "$group" "$worktree" &
    pids+=($!)
    groups_list+=("$group")

    log "${group} launched (PID: ${pids[-1]})"
  done

  # Wait for all parallel agents
  local all_ok=true
  for i in "${!pids[@]}"; do
    local pid="${pids[$i]}"
    local group="${groups_list[$i]}"
    set +e
    wait "$pid"
    local rc=$?
    set -e
    if [[ $rc -ne 0 ]]; then
      err "${group} (PID ${pid}) failed with exit code ${rc}"
      all_ok=false
    else
      ok "${group} (PID ${pid}) finished"
    fi
  done

  if $all_ok; then
    ok "=== ${stage_label} complete: all parallel groups finished ==="
  else
    err "=== ${stage_label} finished with errors. Review logs in ${LOG_DIR} ==="
    return 1
  fi
}

# ── Generic merge ─────────────────────────────────────────────────────────────

# Usage: do_merge_stage "Merge 1" STAGE1_GROUPS STAGE1_BRANCHES STAGE1_MERGE_MESSAGES
do_merge_stage() {
  local merge_label="$1"
  local -n m_groups_ref="$2"
  local -n m_branches_ref="$3"
  local -n m_messages_ref="$4"

  log "=== ${merge_label}: Combining parallel branches into main ==="

  cd "$WORKSPACE"

  # Ensure we're on main
  local current_branch
  current_branch=$(git branch --show-current)
  if [[ "$current_branch" != "main" ]]; then
    warn "Not on main (on ${current_branch}). Switching..."
    git checkout main
  fi

  # Merge each branch
  for i in "${!m_branches_ref[@]}"; do
    local branch="${m_branches_ref[$i]}"
    local msg="${m_messages_ref[$i]}"

    log "Merging ${branch}..."
    if git merge "$branch" --no-ff -m "$msg"; then
      ok "Merged ${branch}"
    else
      err "Merge conflict on ${branch}. Resolve manually, then re-run: $0 ${merge_label,,}"
      return 1
    fi
  done

  # Rebuild WASM (Rust source may have changed in a parallel branch)
  log "Rebuilding WASM..."
  source "$HOME/.cargo/env" 2>/dev/null || true
  npm run build:wasm || warn "WASM build failed (may not have Rust changes)"

  # Verify build
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
    err "=== ${merge_label} verification failed. Fix issues before proceeding ==="
    return 1
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

  ok "=== ${merge_label} complete and verified ==="
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

# ── Full pipeline ─────────────────────────────────────────────────────────────

validate() {
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
      local prev_failures
      prev_failures="$(grep -A2 'FAIL' "$prev_log" 2>/dev/null | tail -30 || echo "(no previous log)")"
      prompt="NOTE: This is validation attempt ${attempt}/${max_attempts}. Previous attempt found failures:

${prev_failures}

You MUST fix the issues above before re-running checks. Read the failing test output, diagnose the
root cause, apply fixes, and then re-run ALL checks to confirm everything passes.

${prompt}"
    fi

    log "Validation attempt ${attempt}/${max_attempts} (log: ${logfile})"
    cd "$WORKSPACE"
    claude --dangerously-skip-permissions -p "$prompt" > "$logfile" 2>&1
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
    if grep -q "OVERALL.*FAIL" "$logfile"; then
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

run_all() {
  log "=== Full pipeline: stage1 → merge1 → stage2 → merge2 → validate ==="
  stage1
  merge1
  stage2
  merge2
  validate
  ok "=== Full pipeline complete — all checks passed ==="
}

# ── CLI ───────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
Usage: ./scripts/launch-phase.sh <command>

Commands:
  stage1    Run Stage 1 parallel groups in worktrees
  merge1    Merge Stage 1 branches to main + verify
  stage2    Run Stage 2 parallel groups in worktrees
  merge2    Merge Stage 2 branches to main + verify
  validate  Run validation agent (checks all tests, fixes issues, reports)
  all       Full pipeline: stage1 → merge1 → stage2 → merge2 → validate
  status    Show current worktree and branch status
  logs      Tail agent logs

Environment variables:
  MAX_RETRIES=3              Retries per agent on crash
  RETRY_DELAY=5              Seconds between retries
  VALIDATE_MAX_ATTEMPTS=3    Max fix-and-retry cycles for validation
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
  stage1)  stage1 ;;
  merge1)  merge1 ;;
  stage2)  stage2 ;;
  merge2)  merge2 ;;
  validate) validate ;;
  all)     run_all ;;
  status)  show_status ;;
  logs)    show_logs "$@" ;;
  -h|--help) usage ;;
  *)
    usage
    exit 1
    ;;
esac
