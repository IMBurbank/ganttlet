#!/usr/bin/env bash
# Check curation feedback accumulation — called from verify.sh and full-verify.sh
# Prints reminders when feedback reports need processing.
# Non-blocking — never fails the verification.

FEEDBACK_DIR="docs/prompts/curation/feedback"
COUNT_THRESHOLD=10
AGE_THRESHOLD_DAYS=30

# Skip if feedback directory doesn't exist yet
[ -d "$FEEDBACK_DIR" ] || exit 0

# Count reports (exclude template and processed/)
count=$(find "$FEEDBACK_DIR" -maxdepth 1 -name "*.md" \
    -not -name "debrief-template.md" 2>/dev/null | wc -l)

# Check count threshold
if [ "$count" -ge "$COUNT_THRESHOLD" ]; then
    echo "[curation] $count feedback reports pending."
    echo "ACTION: Inform the user that /curate-skills should be run."
    echo "Do NOT run curation yourself — this requires user authorization."
    exit 0
fi

# Check age threshold even if count is below
if [ "$count" -gt 0 ]; then
    # Note: stat -c is GNU/Linux only (same as the Docker dev environment).
    # Outside Docker on macOS, this check silently skips (non-blocking).
    oldest=$(find "$FEEDBACK_DIR" -maxdepth 1 -name "*.md" \
        -not -name "debrief-template.md" -exec stat -c '%Y' {} \; 2>/dev/null \
        | sort -n | head -1)
    if [ -n "$oldest" ]; then
        now=$(date +%s)
        age_days=$(( (now - ${oldest%.*}) / 86400 ))
        if [ "$age_days" -ge "$AGE_THRESHOLD_DAYS" ]; then
            echo "[curation] Oldest feedback report is ${age_days}d old ($count reports pending)."
            echo "ACTION: Inform the user that /curate-skills should be run."
            echo "Do NOT run curation yourself — this requires user authorization."
        fi
    fi
fi
