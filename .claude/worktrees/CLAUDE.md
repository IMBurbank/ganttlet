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
7. Merge to main: `gh pr merge --squash` (do NOT use `--delete-branch` — it fails when the worktree still holds the branch).

## Parallel Agent Awareness
- Other agents may be running concurrently in sibling worktrees.
- **Never remove a worktree you did not create.** Other agents' worktrees may be in active use — even if they look stale. Only clean up your own worktree, and only after your PR is merged. Only the user can authorize removal of other worktrees.
- Never modify `/workspace` directly — it must stay on `main`.
- If you need to read another agent's in-progress work, look in `/workspace/.claude/worktrees/`.
- Coordinate via files in the repo (e.g. `.agent-status.json`), not by switching branches.

## Worktree Lifecycle
- You are working in a worktree. All git operations (commit, push, rebase) happen here.
- **Clean up your own worktree only after its PR is merged** — the worktree is your only working copy. If you delete it before the merge completes and the merge fails, you have no way to fix and retry.
- **`git worktree prune` is always safe** — it only removes stale references to already-deleted directories. It never deletes files. Run it after removing a worktree directory.
- **Cleanup order (each step is a separate Bash call — NEVER chain with `&&`):**
  1. Verify merge: `gh pr view <number> --json state --jq '.state'` — must be `"MERGED"`
  2. `rm -rf /workspace/.claude/worktrees/<name>` (delete the directory)
  3. `git worktree prune` (clean up stale git reference)
  4. `git branch -d <branch>` (delete local branch)
  5. `git push origin --delete <branch>` (delete remote branch)
  - **Why `rm -rf` + `prune` instead of `git worktree remove`**: The guard binary blocks `git worktree remove` to prevent agents from deleting each other's worktrees. `rm -rf` your own directory + `prune` achieves the same result safely.
  - **Why separate calls**: If `cd` is chained with `&&` and a later command fails, the Bash tool does not persist the directory change. The CWD remains pointed at the deleted worktree and all subsequent Bash calls fail — this is unrecoverable in the current session.
  - **Why no `--delete-branch` on merge**: `gh pr merge --squash --delete-branch` tries to delete the local branch while the worktree still holds it, causing an error. Always merge without `--delete-branch` and clean up branches manually after removing the worktree.
  - **NEVER `cd /workspace`**: Only the admin works from `/workspace`. Agents must stay in their worktree. Git operations (worktree prune, branch -d) work from any worktree.
