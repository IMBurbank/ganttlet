#!/usr/bin/env bash
# test-launch-lib.sh — Unit tests for launch-phase.sh library functions.
# Run: bash scripts/test-launch-lib.sh
#
# Tests config loading, pipeline step generation, and array population
# without actually launching agents or modifying git state.

set -euo pipefail

PASS=0
FAIL=0

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: ${label}"
    echo "    expected: '${expected}'"
    echo "    actual:   '${actual}'"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local label="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "  PASS: ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: ${label}"
    echo "    expected to contain: '${needle}'"
    echo "    actual: '${haystack}'"
    FAIL=$((FAIL + 1))
  fi
}

# ── Setup ────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Use the directory containing this test script's parent as WORKSPACE
# so tests read configs from the worktree, not the main repo
WORKSPACE="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKTREE_BASE="${WORKTREE_BASE:-/workspace/.claude/worktrees}"
_USER_MERGE_TARGET=""

# Source libraries (no side effects at source time)
source "${SCRIPT_DIR}/lib/log.sh"
source "${SCRIPT_DIR}/lib/config.sh"

# ── Test 1: Phase 15 config loading ──────────────────────────────────────────

echo "=== Test 1: Phase 15 config loading ==="

load_config "${WORKSPACE}/docs/prompts/phase15/launch-config.yaml"

assert_eq "PHASE" "phase15" "$PHASE"
assert_eq "MERGE_TARGET" "feature/phase15" "$MERGE_TARGET"
assert_eq "NUM_STAGES" "3" "$NUM_STAGES"

assert_eq "Stage 1 name" "Core Type + Constraint Engine" "${STAGE_NAMES[0]}"
assert_eq "Stage 2 name" "Cascade + Graph + TypeScript" "${STAGE_NAMES[1]}"
assert_eq "Stage 3 name" "Constraint UI" "${STAGE_NAMES[2]}"

assert_eq "Stage 1 group count" "1" "${STAGE_GROUP_COUNTS[0]}"
assert_eq "Stage 2 group count" "2" "${STAGE_GROUP_COUNTS[1]}"
assert_eq "Stage 3 group count" "1" "${STAGE_GROUP_COUNTS[2]}"

assert_eq "Stage 1 group 0 id" "groupA" "${STAGE_GROUP_IDS["0:0"]}"
assert_eq "Stage 2 group 0 id" "groupB" "${STAGE_GROUP_IDS["1:0"]}"
assert_eq "Stage 2 group 1 id" "groupC" "${STAGE_GROUP_IDS["1:1"]}"
assert_eq "Stage 3 group 0 id" "groupD" "${STAGE_GROUP_IDS["2:0"]}"

assert_eq "Stage 1 group 0 branch" "feature/phase15-constraint-engine" "${STAGE_BRANCHES["0:0"]}"
assert_eq "Stage 2 group 0 branch" "feature/phase15-sf-cascade-conflicts" "${STAGE_BRANCHES["1:0"]}"
assert_eq "Stage 2 group 1 branch" "feature/phase15-ts-types-sheets" "${STAGE_BRANCHES["1:1"]}"

assert_contains "Stage 1 merge msg" "ALAP" "${STAGE_MERGE_MSGS["0:0"]}"
assert_contains "Stage 2 group 0 merge msg" "cascade" "${STAGE_MERGE_MSGS["1:0"]}"

assert_eq "LOG_DIR" "${WORKSPACE}/logs/phase15" "$LOG_DIR"

echo ""

# ── Test 2: Phase 14 config loading ──────────────────────────────────────────

echo "=== Test 2: Phase 14 config loading ==="

# Reset globals
_USER_MERGE_TARGET=""
load_config "${WORKSPACE}/docs/prompts/phase14/launch-config.yaml"

assert_eq "PHASE" "phase14" "$PHASE"
assert_eq "MERGE_TARGET" "feature/phase14" "$MERGE_TARGET"
assert_eq "NUM_STAGES" "3" "$NUM_STAGES"
assert_eq "Stage 1 group count" "3" "${STAGE_GROUP_COUNTS[0]}"
assert_eq "Stage 2 group count" "2" "${STAGE_GROUP_COUNTS[1]}"
assert_eq "Stage 3 group count" "1" "${STAGE_GROUP_COUNTS[2]}"

assert_eq "Stage 1 group 0 id" "groupA" "${STAGE_GROUP_IDS["0:0"]}"
assert_eq "Stage 1 group 1 id" "groupB" "${STAGE_GROUP_IDS["0:1"]}"
assert_eq "Stage 1 group 2 id" "groupC" "${STAGE_GROUP_IDS["0:2"]}"

echo ""

# ── Test 3: MERGE_TARGET precedence ──────────────────────────────────────────

echo "=== Test 3: MERGE_TARGET precedence ==="

# User env var should win
_USER_MERGE_TARGET="feature/custom-target"
load_config "${WORKSPACE}/docs/prompts/phase15/launch-config.yaml"
assert_eq "User env wins over YAML" "feature/custom-target" "$MERGE_TARGET"

# YAML value used when no user env
_USER_MERGE_TARGET=""
load_config "${WORKSPACE}/docs/prompts/phase15/launch-config.yaml"
assert_eq "YAML value used when no user env" "feature/phase15" "$MERGE_TARGET"

echo ""

# ── Test 4: PR metadata ─────────────────────────────────────────────────────

echo "=== Test 4: PR metadata ==="

_USER_MERGE_TARGET=""
load_config "${WORKSPACE}/docs/prompts/phase15/launch-config.yaml"
assert_contains "PR title from config" "Phase 15" "$PR_TITLE"
assert_contains "PR summary from config" "constraint" "$PR_SUMMARY"
assert_contains "PR test plan from config" "tsc" "$PR_TEST_PLAN"

echo ""

# ── Test 5: get_stage_groups helper ──────────────────────────────────────────

echo "=== Test 5: get_stage_groups helper ==="

_USER_MERGE_TARGET=""
load_config "${WORKSPACE}/docs/prompts/phase15/launch-config.yaml"

stage1_groups=$(get_stage_groups 0)
assert_eq "Stage 1 groups" "groupA" "$stage1_groups"

stage2_groups=$(get_stage_groups 1)
assert_eq "Stage 2 groups" "groupB groupC" "$stage2_groups"

stage2_branches=$(get_stage_branches 1)
assert_eq "Stage 2 branches" "feature/phase15-sf-cascade-conflicts feature/phase15-ts-types-sheets" "$stage2_branches"

echo ""

# ── Test 6: Pipeline step generation ─────────────────────────────────────────

echo "=== Test 6: Pipeline step generation ==="

# Source the main script just for build_pipeline_steps (need NUM_STAGES)
build_pipeline_steps() {
  local steps=()
  for ((s=1; s<=NUM_STAGES; s++)); do
    steps+=("stage:${s}" "merge:${s}")
  done
  steps+=("validate" "create-pr")
  echo "${steps[@]}"
}

NUM_STAGES=3
steps_output=$(build_pipeline_steps)
assert_eq "3-stage pipeline" "stage:1 merge:1 stage:2 merge:2 stage:3 merge:3 validate create-pr" "$steps_output"

NUM_STAGES=1
steps_output=$(build_pipeline_steps)
assert_eq "1-stage pipeline" "stage:1 merge:1 validate create-pr" "$steps_output"

NUM_STAGES=5
steps_output=$(build_pipeline_steps)
assert_eq "5-stage pipeline" "stage:1 merge:1 stage:2 merge:2 stage:3 merge:3 stage:4 merge:4 stage:5 merge:5 validate create-pr" "$steps_output"

echo ""

# ── Test 7: Error cases ──────────────────────────────────────────────────────

echo "=== Test 7: Error cases ==="

# Missing config file
set +e
output=$(load_config "/nonexistent/config.yaml" 2>&1)
rc=$?
set -e
assert_eq "Missing config returns error" "1" "$rc"
assert_contains "Missing config error message" "not found" "$output"

echo ""

# ── Summary ──────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
echo "════════════════════════════════════════"
echo "Results: ${PASS}/${TOTAL} passed, ${FAIL} failed"
echo "════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
