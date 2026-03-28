# Rules

Each file in this directory implements a single guard rule as a struct implementing `BashRule` or `EditRule`.

## Bash rules (10)

| File | Rule | What it blocks |
|------|------|---------------|
| `push.rs` | push-to-default-branch | Pushing to the default branch |
| `checkout.rs` | checkout-switch | Checkout/switch at project root |
| `reset.rs` | reset-hard | `git reset --hard` (at root: always; in worktree: without remote ref) |
| `clean.rs` | clean-force | `git clean -f` at project root |
| `branch.rs` | branch-force-delete | `git branch -D` at project root |
| `worktree_remove.rs` | worktree-remove | Removing worktrees (3-tier: own CWD, agent path, non-agent) |
| `rm_worktree.rs` | rm-worktree-root | `rm -rf` on worktree root directories |
| `sed_tee.rs` | sed-tee-protected-path | `sed -i` and `tee` targeting protected paths |
| `interpreter.rs` | interpreter-write | Inline `python -c`/`node -e` code writing to project root |
| `redirect.rs` | redirect-to-protected-path | Write redirects (`>`, `>>`, etc.) to protected paths |

## Edit rules (3)

| File | Rule | What it blocks |
|------|------|---------------|
| `protected_file.rs` | protected-file-pattern | Editing files matching protected patterns |
| `workspace_isolation.rs` | workspace-isolation | Editing files under project root (outside worktrees) |
| `cwd_enforcement.rs` | cwd-enforcement | Editing worktree files when CWD is project root |

## Adding a rule

1. Create a new file with a struct implementing `BashRule` or `EditRule`
2. Add collocated `#[cfg(test)] mod tests` in the same file
3. Register in `mod.rs` (`BASH_RULES` or `EDIT_RULES`)
4. The meta-tests in `tests/cli.rs` will fail until you add a triggering input — follow the error message
