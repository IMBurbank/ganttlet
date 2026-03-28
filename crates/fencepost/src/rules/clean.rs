use crate::{BashRule, ContextualSegment, ProjectContext, Severity, Violation};

/// Blocks git clean -f at the project root (shared state).
pub struct CleanForce;

impl BashRule for CleanForce {
    fn name(&self) -> &'static str {
        "clean-force"
    }
    fn description(&self) -> &'static str {
        "Blocks git clean -f/--force at the project root. Agents should clean in worktrees."
    }
    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        if seg.is_git("clean")
            && (seg.has_short_flag('f') || seg.has_arg("--force"))
            && ctx.is_project_root_cwd()
        {
            Some(Violation::new(
                self.name(),
                Severity::Block,
                format!("git clean -f in {}", ctx.root.display()),
                "this permanently deletes untracked files in shared state",
                "Run git clean in your own worktree instead. Review files first with git clean -n.",
            ))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{check_bash, ProjectContext};
    use std::path::PathBuf;

    fn test_ctx() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/workspace"),
            PathBuf::from("/workspace/.claude/worktrees/default-test"),
        )
    }

    fn test_ctx_at_root() -> ProjectContext {
        ProjectContext::from_root_and_cwd(PathBuf::from("/workspace"), PathBuf::from("/workspace"))
    }

    fn test_ctx_in_worktree() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/workspace"),
            PathBuf::from("/workspace/.claude/worktrees/test-wt"),
        )
    }

    #[test]
    fn l3_clean_fd_worktree_allow() {
        assert!(check_bash(&test_ctx(), "git clean -fd").is_none());
    }

    #[test]
    fn l3_clean_f_worktree_allow() {
        assert!(check_bash(&test_ctx(), "git clean -f").is_none());
    }

    #[test]
    fn l3_clean_force_worktree_allow() {
        assert!(check_bash(&test_ctx(), "git clean --force").is_none());
    }

    #[test]
    fn l3_clean_xfd_worktree_allow() {
        assert!(check_bash(&test_ctx(), "git clean -xfd").is_none());
    }

    #[test]
    fn l3_clean_chained_worktree_allow() {
        assert!(check_bash(&test_ctx(), "echo hi && git clean -fd").is_none());
    }

    #[test]
    fn l3_clean_semi_nospace_worktree_allow() {
        assert!(check_bash(&test_ctx(), "echo hi;git clean --force").is_none());
    }

    #[test]
    fn l3_clean_sudo_worktree_allow() {
        assert!(check_bash(&test_ctx(), "sudo git clean -fd").is_none());
    }

    #[test]
    fn l3_clean_c_flag_worktree_allow() {
        assert!(check_bash(&test_ctx(), "git -C /tmp clean -fd").is_none());
    }

    #[test]
    fn l3_clean_dry_allow() {
        assert!(check_bash(&test_ctx(), "git clean -n").is_none());
    }

    #[test]
    fn l3_clean_nd_allow() {
        assert!(check_bash(&test_ctx(), "git clean -nd").is_none());
    }

    #[test]
    fn l3_clean_quoted_allow() {
        assert!(check_bash(&test_ctx(), "git commit -m \"warn about git clean -fd\"").is_none());
    }

    #[test]
    fn l3_clean_cross_segment_allow() {
        // BUG FIX: --force in echo segment, not clean segment
        assert!(check_bash(&test_ctx(), "git clean -n && echo --force").is_none());
    }

    #[test]
    fn l3_clean_workspace_block() {
        // CWD-dependent: blocked in /workspace
        assert!(check_bash(&test_ctx_at_root(), "git clean -fd").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "git clean -fd").is_none());
    }

    #[test]
    fn l3_clean_heredoc_allow() {
        assert!(check_bash(&test_ctx(), "cat << EOF\ngit clean -fd\nEOF").is_none());
    }

    #[test]
    fn l3_clean_subst_cwd_dependent() {
        assert!(check_bash(&test_ctx_at_root(), "echo $(git clean -fd)").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "echo $(git clean -fd)").is_none());
    }

    #[test]
    fn l3_heredoc_clean() {
        assert!(check_bash(&test_ctx(), "cat << 'DELIM'\ngit clean --force\nDELIM").is_none());
    }

    #[test]
    fn l3_subst_backtick_clean() {
        assert!(check_bash(&test_ctx_at_root(), "VAR=`git clean -fd`").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "VAR=`git clean -fd`").is_none());
    }

    #[test]
    fn l3_fullpath_clean() {
        // CWD-dependent: blocked in /workspace, allowed in worktrees
        assert!(check_bash(&test_ctx_at_root(), "/usr/bin/git clean -fd").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "/usr/bin/git clean -fd").is_none());
    }

    #[test]
    fn l3_background_clean() {
        assert!(check_bash(&test_ctx_at_root(), "git clean -fd & echo done").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "git clean -fd & echo done").is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_clean() {
        assert!(check_bash(
            &test_ctx(),
            "git commit -m \"docs: warn about git clean -f\""
        )
        .is_none());
    }

    #[test]
    fn bash_allows_clean_chained_no_spaces() {
        assert!(check_bash(&test_ctx(), "git clean -n&&echo done").is_none());
    }

    #[test]
    fn l3_background_clean_cwd_dependent() {
        assert!(check_bash(&test_ctx_at_root(), "git clean -fd &").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "git clean -fd &").is_none());
    }

    #[test]
    fn l3_bash_c_clean_cwd_dependent() {
        assert!(check_bash(&test_ctx_at_root(), "bash -c \"echo hi && git clean -fd\"").is_some());
        assert!(check_bash(
            &test_ctx_in_worktree(),
            "bash -c \"echo hi && git clean -fd\""
        )
        .is_none());
    }
}
