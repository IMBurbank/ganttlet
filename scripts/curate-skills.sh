#!/usr/bin/env bash
# Skill curation — runs pipeline, moves processed reports.
# The orchestrating agent handles PR creation and code review after this completes.
#
# No manifest needed — curators read the feedback directory directly.
# The batch cap (20 reports) is enforced by the curator prompt.
set -uo pipefail

FEEDBACK_DIR="docs/prompts/curation/feedback"
PROCESSED_DIR="$FEEDBACK_DIR/processed"
CONFIG="docs/prompts/curation/skill-curation.yaml"

# Date-stamped merge branch (config.sh reads _USER_MERGE_TARGET)
# Short hash suffix handles same-day reruns
export _USER_MERGE_TARGET="curation/$(date +%Y-%m-%d)-$(head -c4 /dev/urandom | xxd -p)"

mkdir -p "$PROCESSED_DIR"

# Count reports to process
count=$(find "$FEEDBACK_DIR" -maxdepth 1 -name "*.md" \
    -not -name "debrief-template.md" 2>/dev/null | wc -l)

if [ "$count" -eq 0 ]; then
    echo "[curate] No reports to process."
    exit 0
fi

echo "[curate] $count reports pending (merge branch: $_USER_MERGE_TARGET)"

# Run pipeline: stage → merge → validate (agent handles PR creation)
./scripts/launch-phase.sh "$CONFIG" stage 1
stage_exit=$?

if [ "$stage_exit" -ne 0 ]; then
    echo "[curate] Stage failed (exit $stage_exit)."
    echo ""

    # Check if partial failure — generate retry config if so
    RETRY_CONFIG="/tmp/skill-curation-retry-$(date +%Y%m%d-%H%M%S).yaml"
    if ./scripts/generate-retry-config.sh "$CONFIG" "$RETRY_CONFIG" 2>/dev/null; then
        echo "[curate] Partial failure — retry config generated: $RETRY_CONFIG"
        echo ""
        echo "[curate] To diagnose failed groups:"
        echo "  ./scripts/launch-phase.sh $CONFIG status"
        echo ""
        echo "[curate] After fixing the issue, retry failed groups only:"
        echo "  ./scripts/launch-phase.sh $RETRY_CONFIG stage 1"
        echo "  ./scripts/launch-phase.sh $CONFIG merge 1"
        echo "  ./scripts/launch-phase.sh $CONFIG validate"
    else
        echo "[curate] All groups failed. Diagnose with:"
        echo "  ./scripts/launch-phase.sh $CONFIG status"
    fi

    exit "$stage_exit"
fi

./scripts/launch-phase.sh "$CONFIG" merge 1
merge_exit=$?

if [ "$merge_exit" -ne 0 ]; then
    echo "[curate] Merge failed (exit $merge_exit). Diagnose with:"
    echo "  ./scripts/launch-phase.sh $CONFIG status"
    exit "$merge_exit"
fi

./scripts/launch-phase.sh "$CONFIG" validate
validate_exit=$?

if [ "$validate_exit" -ne 0 ]; then
    echo "[curate] Validation failed (exit $validate_exit). Diagnose with:"
    echo "  ./scripts/launch-phase.sh $CONFIG status"
    echo "[curate] Skill edits are merged but validation found issues."
    echo "[curate] Agent should fix validation failures, then create PR."
    # Don't exit — move reports anyway, the edits are merged
fi

# Move processed reports (oldest 20, matching what curators saw)
find "$FEEDBACK_DIR" -maxdepth 1 -name "*.md" \
    -not -name "debrief-template.md" | sort | head -n 20 | \
    while IFS= read -r report; do
        mv "$report" "$PROCESSED_DIR/"
    done

# Check for remaining reports
remaining=$(find "$FEEDBACK_DIR" -maxdepth 1 -name "*.md" \
    -not -name "debrief-template.md" 2>/dev/null | wc -l)
if [ "$remaining" -gt 0 ]; then
    echo "[curate] $remaining reports remain for next curation run."
fi

echo "[curate] Done. Agent should create PR and run code review."
