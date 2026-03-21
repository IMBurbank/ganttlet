---
name: issue-workflow
description: "Use when working from a GitHub issue (agent-ready label, single-agent work). Covers branch naming, implementation order, verification, PR creation, error handling, and context conservation."
---

# Single-Agent Issue Workflow

## Setup
- Create a worktree: `git worktree add /workspace/.claude/worktrees/issue-{number} -b agent/issue-{number}`
- `cd /workspace/.claude/worktrees/issue-{number}` (separate Bash call) — all work happens here, not in `/workspace`
- Read the issue carefully. Identify acceptance criteria and scope boundaries.
- If the issue lacks acceptance criteria, write your own based on the description.
- Read CLAUDE.md and relevant skill files before starting work.

## Implementation Order
1. Read relevant files BEFORE editing. Understand current behavior first.
2. Write/update tests FIRST that verify the expected behavior.
3. Implement the changes to make tests pass.
4. Commit after each logical change with conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).

## Verification
Run `./scripts/full-verify.sh` before declaring done. This runs:
- `npx tsc --noEmit` (TypeScript type check)
- `npx vitest run` (unit tests)
- Rust tests: `cd crates/scheduler` then `cargo test` (separate Bash calls)
- `E2E_RELAY=1 npx playwright test` (E2E with relay)

If E2E tests fail but unit tests pass, note this in your summary.

After pushing, run `./scripts/attest-e2e.sh` to post the `e2e-verified` commit
status. Or use `ATTEST_E2E=1 ./scripts/full-verify.sh` to auto-attest on success.

## PR Creation
- `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}` for auto-closing
- Write `.agent-summary.md`: what changed, tests added, what couldn't be done
- PR body should include structured sections: Summary, Test plan, Closes #N
- **After PR is merged**, clean up:
  1. `git push origin --delete agent/issue-{number}` (delete remote branch)
  2. Use `ExitWorktree` with `action: "remove"` (deletes directory + local branch + restores CWD)

## Error Handling Protocol
<!-- Canonical location for error escalation (moved from root CLAUDE.md) -->
- **Level 1** (fixable): Read error, fix code, re-run. Up to 3 distinct approaches.
- **Level 2** (stuck): Commit WIP with message explaining what's broken and why. Move to next task — do NOT stop all work.
- **Level 3** (blocked): Commit, update `.agent-status.json` with `"status": "blocked"` and a `"blocker"` message, skip dependent tasks, continue with independent ones.
- **Emergency** (out of context/crashing): `git add -A && git commit -m "emergency: saving work"`

After each major task, update `.agent-status.json` in the worktree root.

## Progress Tracking
Initialize `.agent-status.json` at the start of issue work:
```bash
cat > .agent-status.json <<JSON
{
  "issue": {number},
  "branch": "agent/issue-{number}",
  "status": "in_progress",
  "tasks": {},
  "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
```
Update after each major task:
```bash
node -e "const fs=require('fs'),f='.agent-status.json',d=JSON.parse(fs.readFileSync(f,'utf8'));d.tasks['write-tests']={status:'done'};d.last_updated=new Date().toISOString();fs.writeFileSync(f,JSON.stringify(d,null,2))"
```

## If Stuck
<!-- Moved from root CLAUDE.md — curator cleanup pending in step 12 -->
- Follow the Error Handling Protocol above.
- Commit WIP with clear status message.
- Write `.agent-summary.md` explaining where you got stuck.
- The PR will be created even with partial work — human reviewers can help.

## Creating Issues
- Use the template: `gh issue create --template agent-task.yml`
- Fill in all required fields: Task Summary, Acceptance Criteria, Scope Boundaries, and Estimated Complexity.

## Context Conservation
- Commit early and often (progress survives crashes)
- Use subagents for expensive investigation
- Check `git log --oneline -10` if you lose track of previous work
- Check `.agent-status.json` for task status on restart (fall back to `claude-progress.txt` if it exists)

## Lessons Learned
<!-- Managed by curation pipeline — do not edit directly -->
- `${{ github.event.issue.body }}` injected directly into a shell heredoc is a shell injection risk — always sanitize or use environment variables
- The workflow's claude invocation needs `--max-turns` and `--max-budget-usd` to prevent runaway agents
- PR body should include structured sections (Summary, Test plan, Closes #N) not generic boilerplate
- The agent should read CLAUDE.md and relevant skill files before starting work
