# Local Development Context

This file is auto-loaded by Claude Code for agents working in worktrees.
It does NOT apply to CI/workflow agents.

## PR and Merge Workflow
1. Create a PR on your branch after all work is complete and validated.
2. Rebase on `origin/main` and re-run `./scripts/full-verify.sh` — the branch must pass against current HEAD.
3. Push and create the PR with `gh pr create`.
4. Trigger code review: use the `/code-review` skill with the PR number.
5. Fix every issue the review finds, commit, and re-trigger review. Loop until clean.
6. Once there are no issues, post a comment on the PR summarizing what changed and your reasoning for the approach.
7. Merge to main: `gh pr merge --squash --delete-branch`.

## Parallel Agent Awareness
- Other agents may be running concurrently in sibling worktrees.
- Never modify `/workspace` directly — it must stay on `main`.
- If you need to read another agent's in-progress work, look in `/workspace/.claude/worktrees/`.
- Coordinate via files in the repo (e.g. `claude-progress.txt`), not by switching branches.

## Worktree Lifecycle
- You are working in a worktree. All git operations (commit, push, rebase) happen here.
- Clean up when done: `cd /workspace && git worktree remove /workspace/.claude/worktrees/<name>`
- If you find stale worktrees from crashed agents: `git worktree prune`
