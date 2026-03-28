use crate::{BashRule, ContextualSegment, ProjectContext, Severity, Violation};

/// Blocks git reset --hard at project root. In worktrees, blocks without remote ref.
pub struct ResetHard;

impl BashRule for ResetHard {
    fn name(&self) -> &'static str {
        "reset-hard"
    }
    fn description(&self) -> &'static str {
        "Blocks git reset --hard at project root (shared state). In worktrees, \
         requires a remote/ ref to prevent accidental data loss."
    }
    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        if !(seg.is_git("reset") && seg.has_arg("--hard")) {
            return None;
        }
        let remote_prefix = format!("{}/", ctx.remote_name);
        if ctx.is_project_root_cwd() {
            return Some(Violation::new(
                self.name(),
                Severity::Block,
                format!("git reset --hard in {}", ctx.root.display()),
                "this modifies shared state that other agents depend on",
                format!(
                    "Run git reset --hard {}<branch> in your own worktree instead. {}",
                    remote_prefix,
                    ctx.msg_worktree_docs()
                ),
            ));
        }
        if !seg.has_arg_starting_with(&remote_prefix) {
            return Some(Violation::new(
                self.name(),
                Severity::Block,
                "git reset --hard without a remote ref",
                format!(
                    "this will discard uncommitted work because no {}/ ref was specified",
                    ctx.remote_name
                ),
                format!(
                    "Use git reset --hard {}<branch> to sync, or specify the target explicitly. {}",
                    remote_prefix,
                    ctx.msg_worktree_docs()
                ),
            ));
        }
        None
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
    fn l3_reset_hard_blocks_at_root_even_with_origin() {
        // At project root, reset --hard is ALWAYS blocked (shared state)
        assert!(check_bash(&test_ctx_at_root(), "git reset --hard origin/main").is_some());
    }

    #[test]
    fn l3_reset_hard_allows_origin_in_worktree() {
        assert!(check_bash(&test_ctx_in_worktree(), "git reset --hard origin/main").is_none());
    }

    #[test]
    fn l3_reset_hard_basic() {
        assert!(check_bash(&test_ctx(), "git reset --hard HEAD~3").is_some());
    }

    #[test]
    fn l3_reset_hard_bare() {
        assert!(check_bash(&test_ctx(), "git reset --hard").is_some());
    }

    #[test]
    fn l3_reset_hard_chained() {
        assert!(check_bash(&test_ctx(), "echo hi && git reset --hard HEAD~3").is_some());
    }

    #[test]
    fn l3_reset_hard_sudo() {
        assert!(check_bash(&test_ctx(), "sudo git reset --hard").is_some());
    }

    #[test]
    fn l3_reset_hard_c_flag() {
        assert!(check_bash(&test_ctx(), "git -C /tmp reset --hard HEAD~3").is_some());
    }

    #[test]
    fn l3_reset_hard_origin_allow() {
        assert!(check_bash(&test_ctx(), "git reset --hard origin/main").is_none());
    }

    #[test]
    fn l3_reset_hard_origin_feature_allow() {
        assert!(check_bash(&test_ctx(), "git reset --hard origin/feature-branch").is_none());
    }

    #[test]
    fn l3_reset_soft_allow() {
        assert!(check_bash(&test_ctx(), "git reset --soft HEAD~1").is_none());
    }

    #[test]
    fn l3_reset_no_flag_allow() {
        assert!(check_bash(&test_ctx(), "git reset HEAD~1").is_none());
    }

    #[test]
    fn l3_reset_quoted_allow() {
        assert!(check_bash(&test_ctx(), "git commit -m \"undo git reset --hard\"").is_none());
    }

    #[test]
    fn l3_reset_cross_segment_allow() {
        // BUG FIX: --hard in echo segment, not reset segment
        assert!(check_bash(&test_ctx(), "git reset --soft HEAD~1 && echo --hard").is_none());
    }

    #[test]
    fn l3_heredoc_reset() {
        assert!(check_bash(&test_ctx(), "node << 'JS'\ngit reset --hard HEAD~3\nJS").is_none());
    }

    #[test]
    fn l3_subst_reset() {
        assert!(check_bash(&test_ctx(), "result=$(git reset --hard HEAD~3)").is_some());
    }

    #[test]
    fn l3_subst_dquote_reset() {
        assert!(check_bash(&test_ctx(), "echo \"result: $(git reset --hard HEAD~3)\"").is_some());
    }

    #[test]
    fn l3_subst_squote_reset_allow() {
        assert!(check_bash(&test_ctx(), "echo '$(git reset --hard)'").is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_reset() {
        assert!(check_bash(
            &test_ctx(),
            "git commit -m \"revert: undo git reset --hard changes\""
        )
        .is_none());
    }

    #[test]
    fn bash_allows_gh_pr_merge_body() {
        assert!(check_bash(
            &test_ctx(),
            "gh pr merge 72 --squash --body \"block git reset --hard in /workspace\""
        )
        .is_none());
    }

    #[test]
    fn l3_eval_reset_block() {
        assert!(check_bash(&test_ctx(), "eval git reset --hard HEAD~3").is_some());
    }
}
