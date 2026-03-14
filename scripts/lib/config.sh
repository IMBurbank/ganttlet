#!/usr/bin/env bash
# scripts/lib/config.sh — YAML config loader for launch-phase.sh
# Reads launch-config.yaml and populates global arrays for dynamic stage execution.
#
# After loading, the following globals are set:
#   PHASE, MERGE_TARGET, NUM_STAGES
#   STAGE_NAMES[0..N-1]          — human-readable stage name
#   STAGE_GROUP_IDS[stage:idx]   — group ID (e.g., "groupA")
#   STAGE_BRANCHES[stage:idx]    — branch name
#   STAGE_MERGE_MSGS[stage:idx]  — merge commit message
#   STAGE_GROUP_COUNTS[0..N-1]   — number of groups in each stage
#   PR_TITLE, PR_SUMMARY, PR_TEST_PLAN — PR metadata (optional)

# shellcheck disable=SC2034  # variables are used by sourcing scripts

load_config() {
  local config_file="$1"

  if [[ ! -f "$config_file" ]]; then
    err "Config file not found: ${config_file}"
    return 1
  fi

  if ! command -v yq >/dev/null 2>&1; then
    err "yq is required but not installed. Install: https://github.com/mikefarah/yq"
    return 1
  fi

  log "Loading config from ${config_file}"

  PHASE=$(yq -r '.phase' "$config_file")
  if [[ -z "$PHASE" || "$PHASE" == "null" ]]; then
    err "Config missing required field: phase"
    return 1
  fi

  # MERGE_TARGET: user env var > YAML > derived from phase
  local merge_target_yaml
  merge_target_yaml=$(yq -r '.merge_target // ""' "$config_file")
  if [[ -n "${_USER_MERGE_TARGET:-}" ]]; then
    MERGE_TARGET="$_USER_MERGE_TARGET"
  elif [[ -n "$merge_target_yaml" ]]; then
    MERGE_TARGET="$merge_target_yaml"
  else
    MERGE_TARGET="feature/${PHASE}"
  fi

  # Load stages dynamically
  NUM_STAGES=$(yq -r '.stages | length' "$config_file")
  if [[ "$NUM_STAGES" -eq 0 || "$NUM_STAGES" == "null" ]]; then
    err "Config has no stages defined"
    return 1
  fi

  declare -g -a STAGE_NAMES=()
  declare -g -A STAGE_GROUP_IDS=()
  declare -g -A STAGE_BRANCHES=()
  declare -g -A STAGE_MERGE_MSGS=()
  declare -g -a STAGE_GROUP_COUNTS=()

  for ((s=0; s<NUM_STAGES; s++)); do
    STAGE_NAMES+=("$(yq -r ".stages[$s].name // \"Stage $((s+1))\"" "$config_file")")

    local num_groups
    num_groups=$(yq -r ".stages[$s].groups | length" "$config_file")
    STAGE_GROUP_COUNTS+=("$num_groups")

    for ((g=0; g<num_groups; g++)); do
      STAGE_GROUP_IDS["${s}:${g}"]=$(yq -r ".stages[$s].groups[$g].id" "$config_file")
      STAGE_BRANCHES["${s}:${g}"]=$(yq -r ".stages[$s].groups[$g].branch" "$config_file")
      STAGE_MERGE_MSGS["${s}:${g}"]=$(yq -r ".stages[$s].groups[$g].merge_message" "$config_file")
    done
  done

  # PR metadata (optional — defaults generated from phase name if missing)
  PR_TITLE=$(yq -r ".pr.title // \"${PHASE}: implementation\"" "$config_file")
  PR_SUMMARY=$(yq -r '.pr.summary // ""' "$config_file")
  PR_TEST_PLAN=$(yq -r '.pr.test_plan // ""' "$config_file")

  # Derived values
  LOG_DIR="${WORKSPACE}/logs/${PHASE}"
  TMUX_SESSION="${PHASE}-agents"
  MERGE_WORKTREE="${WORKTREE_BASE}/${PHASE}-merge"

  mkdir -p "$LOG_DIR"

  ok "Loaded config: ${PHASE} — ${NUM_STAGES} stages"
}

# Get all group IDs for a given stage index (0-based)
get_stage_groups() {
  local stage_idx="$1"
  local count="${STAGE_GROUP_COUNTS[$stage_idx]}"
  local groups=()
  for ((g=0; g<count; g++)); do
    groups+=("${STAGE_GROUP_IDS["${stage_idx}:${g}"]}")
  done
  echo "${groups[@]}"
}

# Get all branches for a given stage index (0-based)
get_stage_branches() {
  local stage_idx="$1"
  local count="${STAGE_GROUP_COUNTS[$stage_idx]}"
  local branches=()
  for ((g=0; g<count; g++)); do
    branches+=("${STAGE_BRANCHES["${stage_idx}:${g}"]}")
  done
  echo "${branches[@]}"
}

# Get all merge messages for a given stage index (0-based)
get_stage_merge_msgs() {
  local stage_idx="$1"
  local count="${STAGE_GROUP_COUNTS[$stage_idx]}"
  local msgs=()
  for ((g=0; g<count; g++)); do
    msgs+=("${STAGE_MERGE_MSGS["${stage_idx}:${g}"]}")
  done
  # Use null delimiter for messages (they may contain spaces)
  printf '%s\0' "${msgs[@]}"
}
