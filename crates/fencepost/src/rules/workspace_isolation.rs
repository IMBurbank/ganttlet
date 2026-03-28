use crate::{EditRule, ProjectContext, Severity, Violation};

/// Blocks editing files under the project root (outside worktrees).
pub struct WorkspaceIsolation;

impl EditRule for WorkspaceIsolation {
    fn name(&self) -> &'static str {
        "workspace-isolation"
    }
    fn description(&self) -> &'static str {
        "Blocks editing files directly in the project root. Use a worktree."
    }
    fn check_file(&self, ctx: &ProjectContext, file_path: &str) -> Option<Violation> {
        if ctx.is_protected_path(file_path) {
            let relative = file_path
                .strip_prefix(&format!("{}/", ctx.root.display()))
                .unwrap_or(file_path);
            Some(Violation::new(
                self.name(),
                Severity::Block,
                format!("edit {}", file_path),
                format!(
                    "{} must stay on {}; editing files there directly modifies shared state",
                    ctx.root.display(),
                    ctx.default_branch
                ),
                format!(
                    "Create a worktree and edit there instead:\n  git worktree add {wt}/<name> -b <branch>\n  Then edit: {wt}/<name>/{relative}",
                    wt = ctx.worktrees_dir.display(),
                ),
            ))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{check_edit, ProjectContext};
    use std::path::PathBuf;

    fn test_ctx() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/workspace"),
            PathBuf::from("/workspace/.claude/worktrees/default-test"),
        )
    }

    #[test]
    fn l3_edit_blocks_workspace_direct() {
        assert!(check_edit(&test_ctx(), "/workspace/src/foo.ts").is_some());
    }

    #[test]
    fn l3_edit_allows_worktree() {
        assert!(check_edit(&test_ctx(), "/workspace/.claude/worktrees/test/src/foo.ts").is_none());
    }

    #[test]
    fn edit_allows_worktree_file() {
        assert!(check_edit(
            &test_ctx(),
            "/workspace/.claude/worktrees/issue-42/src/App.tsx"
        )
        .is_none());
    }
}
