use crate::{EditRule, ProjectContext, Severity, Violation};

/// Blocks editing worktree files when CWD is the project root.
pub struct CwdEnforcement;

impl EditRule for CwdEnforcement {
    fn name(&self) -> &'static str {
        "cwd-enforcement"
    }
    fn description(&self) -> &'static str {
        "Blocks editing worktree files when CWD is the project root. Enter the worktree first."
    }
    fn check_file(&self, ctx: &ProjectContext, file_path: &str) -> Option<Violation> {
        let wt_prefix = ctx.worktrees_prefix();
        if file_path.starts_with(&wt_prefix) && ctx.is_project_root_cwd() {
            Some(Violation::new(
                self.name(),
                Severity::Block,
                format!("edit {} from CWD {}", file_path, ctx.root.display()),
                format!(
                    "your CWD is {} but you are editing a worktree file — only the admin works from the project root",
                    ctx.root.display()
                ),
                "Enter the worktree first (use the EnterWorktree tool or cd into it).",
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

    fn alt_ctx_at_root() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/home/user/myproject"),
            PathBuf::from("/home/user/myproject"),
        )
        .with_default_branch("develop")
        .with_remote_name("upstream")
    }

    fn alt_ctx() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/home/user/myproject"),
            PathBuf::from("/home/user/myproject/.claude/worktrees/wt"),
        )
        .with_default_branch("develop")
        .with_remote_name("upstream")
    }

    #[test]
    fn cross_edit_cwd_enforcement_at_alt_root() {
        // Editing a worktree file while CWD is alt project root should block
        assert!(check_edit(
            &alt_ctx_at_root(),
            "/home/user/myproject/.claude/worktrees/wt/src/foo.ts"
        )
        .is_some());
    }

    #[test]
    fn cross_edit_cwd_enforcement_in_alt_worktree() {
        // Same file, but CWD is in a worktree — should allow
        assert!(check_edit(
            &alt_ctx(),
            "/home/user/myproject/.claude/worktrees/wt/src/foo.ts"
        )
        .is_none());
    }
}
