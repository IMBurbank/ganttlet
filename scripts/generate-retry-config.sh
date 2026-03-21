#!/usr/bin/env bash
# Generate a retry config containing only failed groups from a launch-phase run.
# Usage: ./scripts/generate-retry-config.sh <original-config> <output-path>
#
# Reads launch-phase.sh status to identify failed groups, then extracts their
# config entries from the original YAML into a new config with the same
# merge_target and phase name.
#
# Exit codes:
#   0 — retry config generated (partial failure — some groups failed, some succeeded)
#   1 — no retry config needed (all groups succeeded OR all groups failed)
set -uo pipefail

ORIGINAL_CONFIG="${1:?Usage: $0 <original-config> <output-path>}"
OUTPUT_PATH="${2:?Usage: $0 <original-config> <output-path>}"

# Read failed/succeeded groups from stage log files (written by stage.sh)
PHASE=$(yq -r '.phase' "$ORIGINAL_CONFIG")
run_suffix=$(echo "${_LAUNCH_BASE_REF:-$(date +%s)}" | cut -c1-8)
LOG_DIR="/tmp/ganttlet-logs/${PHASE}-${run_suffix}"

if [ ! -f "${LOG_DIR}/stage-failed.txt" ]; then
    echo "[retry] No stage-failed.txt found in ${LOG_DIR}/."
    exit 1
fi

failed_groups=$(cat "${LOG_DIR}/stage-failed.txt" 2>/dev/null | tr '\n' ' ')
succeeded_groups=$(cat "${LOG_DIR}/stage-succeeded.txt" 2>/dev/null | tr '\n' ' ')

if [ -z "$failed_groups" ]; then
    echo "[retry] No failed groups found — all succeeded or status unavailable."
    exit 1
fi

if [ -z "$succeeded_groups" ]; then
    echo "[retry] All groups failed — retry config would be identical to original."
    exit 1
fi

echo "[retry] Failed groups: $failed_groups"
echo "[retry] Generating retry config: $OUTPUT_PATH"

# Extract config values
phase=$(yq -r '.phase' "$ORIGINAL_CONFIG")
# Use env var override if set (curate-skills.sh exports _USER_MERGE_TARGET)
merge_target="${_USER_MERGE_TARGET:-$(yq -r '.merge_target' "$ORIGINAL_CONFIG")}"

# Build retry config with only failed groups
cat > "$OUTPUT_PATH" << EOF
# Auto-generated retry config — failed groups only
# Original: $ORIGINAL_CONFIG
# Failed: $failed_groups

phase: ${phase}-retry
merge_target: $merge_target

stages:
  - name: "Retry failed groups"
    groups:
EOF

# Extract each failed group's config from the original
for group in $failed_groups; do
    branch=$(yq -r ".stages[].groups[] | select(.id == \"$group\") | .branch" "$ORIGINAL_CONFIG")
    merge_msg=$(yq -r ".stages[].groups[] | select(.id == \"$group\") | .merge_message" "$ORIGINAL_CONFIG")

    cat >> "$OUTPUT_PATH" << EOF
      - id: $group
        branch: $branch
        merge_message: "$merge_msg"
EOF
done

echo "[retry] Config written to $OUTPUT_PATH"
