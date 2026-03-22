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
- **Cleanup: use `ExitWorktree` with `action: "remove"`**. This is the proper
  lifecycle command — it deletes the directory, removes the branch, and restores
  your CWD to `/workspace`. Never use `rm -rf` on your own worktree (breaks CWD
  and all subsequent Bash calls fail).
- **Cleanup order:**
  1. Verify merge: `gh pr view <number> --json state --jq '.state'` — must be `"MERGED"`
  2. `git push origin --delete <branch>` (delete remote branch — do this before exit)
  3. Handle squash-merged branches: `ExitWorktree` may refuse to remove branches after a
     squash merge (git doesn't recognize them as merged). Fix by fast-forwarding first:
     `git fetch origin main && git reset --hard origin/main`
     This moves your branch to the merge commit so git recognizes it as merged.
  4. `ExitWorktree` with `action: "remove"` (deletes directory + local branch + restores CWD)
  5. `git pull origin main` (update main with the merged changes)
  - **Why not `rm -rf`**: Deleting your own CWD breaks the Bash tool — no subsequent commands can run. `ExitWorktree` handles this safely by restoring CWD first.
  - **Why not `git worktree remove`**: The guard binary blocks it — use `ExitWorktree` instead.
  - **Why no `--delete-branch` on merge**: `gh pr merge --squash --delete-branch` tries to delete the local branch while the worktree still holds it, causing an error. Always merge without `--delete-branch`.
  - **Why `reset --hard` before exit**: Squash merges create a new commit with no parent link to the branch. Git's `branch -d` checks ancestry, so it refuses. `reset --hard origin/main` moves the branch pointer to the merge commit, making `branch -d` work. (`branch -f` can't be used here — git refuses to force-update the currently checked-out branch.)
  - **NEVER `cd /workspace`**: Only the admin works from `/workspace`. Agents must stay in their worktree.
