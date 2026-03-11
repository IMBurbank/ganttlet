#!/usr/bin/env bash
# scripts/lib/pr.sh — PR creation and code review trigger
#
# Operates from the merge worktree (MERGE_WORKTREE) for git push,
# but gh commands work from anywhere.

# ── PR Classification ─────────────────────────────────────────────────────

classify_pr() {
  # Classify a PR for review depth based on changed files.
  # Returns: "light" or "full"
  # Usage: tier=$(classify_pr)

  local diff_stat
  diff_stat=$(git diff --stat "origin/main...HEAD" -- 2>/dev/null || echo "")

  # Count file types changed
  local md_only=true
  local test_only=true
  local single_file=false
  local file_count=0
  local has_security=false

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    [[ "$line" == *"files changed"* ]] && continue
    local file
    file=$(echo "$line" | awk '{print $1}')
    ((file_count++))

    # Check if non-docs files exist
    [[ "$file" != *.md ]] && md_only=false

    # Check if non-test files exist
    [[ "$file" != *.test.* && "$file" != *.spec.* && "$file" != *__tests__* ]] && test_only=false

    # Check for security-relevant files
    [[ "$file" == *auth* || "$file" == *oauth* || "$file" == *cors* || "$file" == *.env* || "$file" == *Cargo.toml || "$file" == *package.json ]] && has_security=true
  done <<< "$diff_stat"

  [[ $file_count -eq 1 ]] && single_file=true

  # Classification logic
  if [[ "$has_security" == "true" ]]; then
    echo "full"
  elif [[ "$md_only" == "true" ]]; then
    echo "light"
  elif [[ "$test_only" == "true" ]]; then
    echo "light"
  elif [[ "$single_file" == "true" ]]; then
    echo "light"
  else
    echo "full"
  fi
}

# Create a PR from the implementation branch to main.
# Uses PR metadata from the YAML config if available, otherwise generates from commit log.
create_pr() {
  # Ensure merge worktree exists (may be called standalone via `create-pr` command)
  setup_merge_worktree

  cd "$MERGE_WORKTREE"

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

  # Trigger code-review agent with tier-based depth
  log "Triggering code review..."
  local pr_number
  pr_number=$(echo "$pr_url" | grep -o '[0-9]*$')

  if [[ -n "$pr_number" ]]; then
    # Determine review depth
    local review_tier
    review_tier=$(classify_pr)
    log "PR classified as: ${review_tier} review"

    if [[ "$review_tier" == "light" ]]; then
      # Light review: 1 agent, fewer turns
      local review_prompt="Review PR #${pr_number} for correctness. Focus on: logic errors, constraint violations, test coverage. PR: ${pr_url}"
      echo "$review_prompt" | claude --dangerously-skip-permissions --max-turns 20 --max-budget-usd 2.00 -p - >> "${LOG_DIR}/code-review.log" 2>&1 &
    else
      # Full review: existing multi-agent review via /code-review skill
      local review_prompt="Review PR #${pr_number} for the Ganttlet project. Use /code-review to review the PR at ${pr_url}"
      echo "$review_prompt" | claude --dangerously-skip-permissions --max-turns 40 --max-budget-usd 5.00 -p - >> "${LOG_DIR}/code-review.log" 2>&1 &
    fi
    local review_pid=$!
    log "Code review agent launched (PID: ${review_pid}, tier: ${review_tier}, log: ${LOG_DIR}/code-review.log)"
    log "Review running in background — check log or PR comments for results."
  else
    warn "Could not extract PR number from: ${pr_url} — skipping code review"
  fi

  # Clean up the merge worktree — no longer needed after push + PR creation
  cd "$WORKSPACE"
  cleanup_merge_worktree

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
