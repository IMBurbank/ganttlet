#!/usr/bin/env bash
# scripts/lib/pr.sh — PR creation and code review trigger

# Create a PR from the implementation branch to main.
# Uses PR metadata from the YAML config if available, otherwise generates from commit log.
create_pr() {
  cd "$WORKSPACE"

  local current_branch
  current_branch=$(git branch --show-current)
  if [[ "$current_branch" != "$MERGE_TARGET" ]]; then
    git checkout "$MERGE_TARGET"
  fi

  log "Pushing ${MERGE_TARGET} to origin..."
  git push -u origin "$MERGE_TARGET"

  local commit_log
  commit_log=$(git log --oneline main.."$MERGE_TARGET" 2>/dev/null || echo "(no commits)")
  local commit_count
  commit_count=$(echo "$commit_log" | wc -l)

  local validation_status="PASSED"
  local latest_validate_log
  latest_validate_log=$(ls -t "${LOG_DIR}"/validate-attempt*.log 2>/dev/null | head -1 || echo "")
  if [[ -n "$latest_validate_log" ]] && grep -v "COMMAND=" "$latest_validate_log" | grep -q "OVERALL.*FAIL"; then
    validation_status="FAILED — see validation logs"
  fi

  # Build PR title — from config or default
  local pr_title="${PR_TITLE:-${PHASE}: implementation}"

  # Build PR body — from config or auto-generated
  local pr_body=""
  if [[ -n "${PR_SUMMARY:-}" ]]; then
    pr_body="## Summary
${PR_SUMMARY}"
  else
    pr_body="## Summary
${PHASE} implementation — ${NUM_STAGES} stages, ${commit_count} commits merged."
  fi

  pr_body+="

### Implementation
- ${NUM_STAGES} stages with $(get_total_group_count) agent groups
- ${commit_count} commits merged to implementation branch
- Validation status: **${validation_status}**

### Commits
\`\`\`
${commit_log}
\`\`\`

## Test plan"

  if [[ -n "${PR_TEST_PLAN:-}" ]]; then
    pr_body+="
${PR_TEST_PLAN}"
  else
    pr_body+="
- [ ] \`npx tsc --noEmit\` passes
- [ ] \`npm run test\` passes
- [ ] \`cd crates/scheduler && cargo test\` passes"
  fi

  pr_body+="

🤖 Generated with [Claude Code](https://claude.com/claude-code)"

  log "Creating PR: ${MERGE_TARGET} → main"

  local pr_url
  pr_url=$(gh pr create \
    --base main \
    --head "$MERGE_TARGET" \
    --title "$pr_title" \
    --body "$pr_body" 2>&1)

  ok "PR created: ${pr_url}"

  # Trigger code-review agent
  log "Triggering code review..."
  local pr_number
  pr_number=$(echo "$pr_url" | grep -o '[0-9]*$')

  if [[ -n "$pr_number" ]]; then
    local review_prompt="Review PR #${pr_number} for the Ganttlet project. Use /code-review to review the PR at ${pr_url}"
    echo "$review_prompt" | claude --dangerously-skip-permissions --max-turns 40 --max-budget-usd 5.00 -p - >> "${LOG_DIR}/code-review.log" 2>&1 &
    local review_pid=$!
    log "Code review agent launched (PID: ${review_pid}, log: ${LOG_DIR}/code-review.log)"
    log "Review running in background — check log or PR comments for results."
  else
    warn "Could not extract PR number from: ${pr_url} — skipping code review"
  fi

  ok "=== PR created and code review triggered ==="
}

# Helper: total groups across all stages
get_total_group_count() {
  local total=0
  for count in "${STAGE_GROUP_COUNTS[@]}"; do
    total=$((total + count))
  done
  echo "$total"
}
