---
name: issue-workflow
description: "Use when working from a GitHub issue (agent-ready label, single-agent work). Covers branch naming, implementation order, verification, PR creation, error handling, and context conservation."
---

# Single-Agent Issue Workflow

## Setup
- Branch: `agent/issue-{number}`
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
- `cd crates/scheduler && cargo test` (Rust tests)
- `E2E_RELAY=1 npx playwright test` (E2E with relay)

If E2E tests fail but unit tests pass, note this in your summary.

## PR Creation
- `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}` for auto-closing
- Write `.agent-summary.md`: what changed, tests added, what couldn't be done
- PR body should include structured sections: Summary, Test plan, Closes #N

## Error Handling
- **Level 1** (fixable): Read error, fix code, re-run. Up to 3 distinct approaches.
- **Level 2** (stuck): Commit WIP with message explaining what's broken and why. Move to next task — do NOT stop all work.
- **Level 3** (blocked): Commit, write BLOCKED note in `claude-progress.txt` (pipe-delimited: `TASK_ID | STATUS | ISO_TIMESTAMP | MESSAGE`), continue with non-dependent tasks.
- **Emergency**: If running out of context: `git add -A && git commit -m "emergency: saving work"`

## Context Conservation
- Commit early and often (progress survives crashes)
- Use subagents for expensive investigation
- Check `git log --oneline -10` if you lose track of previous work
- Check `claude-progress.txt` for task status on restart (format: `TASK_ID | STATUS | ISO_TIMESTAMP | MESSAGE`)

## Lessons Learned
- `${{ github.event.issue.body }}` injected directly into a shell heredoc is a shell injection risk — always sanitize or use environment variables
- The workflow's claude invocation needs `--max-turns` and `--max-budget-usd` to prevent runaway agents
- PR body should include structured sections (Summary, Test plan, Closes #N) not generic boilerplate
- The agent should read CLAUDE.md and relevant skill files before starting work
