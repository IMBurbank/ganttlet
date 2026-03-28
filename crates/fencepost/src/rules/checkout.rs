use crate::{BashRule, ContextualSegment, ProjectContext, Severity, Violation};

/// Blocks git checkout/switch at the project root. Use worktrees instead.
pub struct CheckoutSwitch;

impl BashRule for CheckoutSwitch {
    fn name(&self) -> &'static str {
        "checkout-switch"
    }
    fn description(&self) -> &'static str {
        "Blocks git checkout/switch at the project root. Use worktrees for branch isolation."
    }
    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        if (seg.is_git("checkout") || seg.is_git("switch"))
            && !seg.has_arg("--")
            && !seg.has_arg_containing("worktree")
            && !ctx.is_worktree_cwd()
        {
            Some(Violation::new(
                self.name(),
                Severity::Block,
                "git checkout/switch at the project root",
                format!(
                    "{} must stay on {}; switching branches here affects all agents",
                    ctx.root.display(),
                    ctx.default_branch
                ),
                format!(
                    "Use a worktree instead: git worktree add {}/<name> -b <branch>",
                    ctx.worktrees_dir.display()
                ),
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
    fn l3_checkout_file_allow() {
        assert!(check_bash(&test_ctx(), "git checkout -- src/file.ts").is_none());
    }

    #[test]
    fn l3_checkout_b_allow() {
        assert!(check_bash(&test_ctx(), "git checkout -b new-branch").is_none());
    }

    #[test]
    fn l3_checkout_b_upper_allow() {
        assert!(check_bash(&test_ctx(), "git checkout -B new-branch").is_none());
    }

    #[test]
    fn l3_switch_c_allow() {
        assert!(check_bash(&test_ctx(), "git switch -c new-branch").is_none());
    }

    #[test]
    fn l3_checkout_worktree_keyword_allow() {
        assert!(check_bash(&test_ctx(), "git worktree add /tmp/test").is_none());
    }

    #[test]
    fn l3_checkout_quoted_allow() {
        assert!(check_bash(&test_ctx(), "git commit -m \"git checkout main\"").is_none());
    }

    #[test]
    fn l3_checkout_blocks_at_root() {
        assert!(check_bash(&test_ctx_at_root(), "git checkout main").is_some());
    }

    #[test]
    fn l3_checkout_allows_in_worktree() {
        assert!(check_bash(&test_ctx_in_worktree(), "git checkout main").is_none());
    }

    #[test]
    fn l3_switch_blocks_at_root() {
        assert!(check_bash(&test_ctx_at_root(), "git switch feature").is_some());
    }

    #[test]
    fn l3_switch_allows_in_worktree() {
        assert!(check_bash(&test_ctx_in_worktree(), "git switch feature").is_none());
    }

    #[test]
    fn bash_allows_echo_checkout() {
        assert!(check_bash(&test_ctx(), "echo \"use git checkout to switch branches\"").is_none());
    }

    // --- 3.2b checkout-switch: chained, prefixed, recursive coverage ---

    #[test]
    fn l3_checkout_chained_blocks_at_root() {
        assert!(check_bash(&test_ctx_at_root(), "echo hi && git checkout main").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "echo hi && git checkout main").is_none());
    }

    #[test]
    fn l3_checkout_sudo_blocks_at_root() {
        assert!(check_bash(&test_ctx_at_root(), "sudo git checkout main").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "sudo git checkout main").is_none());
    }

    #[test]
    fn l3_checkout_env_prefix_blocks_at_root() {
        assert!(check_bash(&test_ctx_at_root(), "GIT_SSH_COMMAND=ssh git checkout main").is_some());
        assert!(check_bash(
            &test_ctx_in_worktree(),
            "GIT_SSH_COMMAND=ssh git checkout main"
        )
        .is_none());
    }

    #[test]
    fn l3_checkout_bash_c_blocks_at_root() {
        assert!(check_bash(&test_ctx_at_root(), "bash -c \"git checkout main\"").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "bash -c \"git checkout main\"").is_none());
    }

    #[test]
    fn l3_checkout_subst_blocks_at_root() {
        assert!(check_bash(&test_ctx_at_root(), "echo $(git checkout main)").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "echo $(git checkout main)").is_none());
    }

    #[test]
    fn l3_checkout_heredoc_body_allows() {
        assert!(check_bash(&test_ctx_at_root(), "cat << EOF\ngit checkout main\nEOF").is_none());
    }

    #[test]
    fn l3_checkout_worktree_in_branch_name_allows() {
        // Branch names containing "worktree" should suppress the checkout block
        // (the agent is likely doing worktree-related work)
        assert!(check_bash(&test_ctx_at_root(), "git checkout my-worktree-branch").is_none());
    }

    #[test]
    fn l3_checkout_worktree_flag_allows() {
        assert!(check_bash(&test_ctx_at_root(), "git checkout --worktree").is_none());
    }

    #[test]
    fn l3_switch_chained_blocks_at_root() {
        assert!(check_bash(&test_ctx_at_root(), "echo hi && git switch feature").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "echo hi && git switch feature").is_none());
    }
}
