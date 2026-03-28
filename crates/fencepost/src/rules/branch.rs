use crate::{BashRule, ContextualSegment, ProjectContext, Severity, Violation};

/// Blocks git branch -D at the project root.
pub struct BranchForceDelete;

impl BashRule for BranchForceDelete {
    fn name(&self) -> &'static str {
        "branch-force-delete"
    }
    fn description(&self) -> &'static str {
        "Blocks git branch -D/--delete --force at the project root to protect other agents' branches."
    }
    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        if seg.is_git("branch")
            && (seg.has_short_flag('D') || (seg.has_arg("--delete") && seg.has_arg("--force")))
            && ctx.is_project_root_cwd()
        {
            Some(Violation::new(
                self.name(),
                Severity::Block,
                format!("git branch -D in {}", ctx.root.display()),
                "force-deleting a branch at the project root could remove another agent's work",
                format!(
                    "Use git branch -d (lowercase) which checks merge status, or run from your own worktree. {}",
                    ctx.msg_worktree_docs()
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
    fn l3_branch_d_upper_worktree_allow() {
        assert!(check_bash(&test_ctx(), "git branch -D feature").is_none());
    }

    #[test]
    fn l3_branch_df_worktree_allow() {
        assert!(check_bash(&test_ctx(), "git branch -Df feature").is_none());
    }

    #[test]
    fn l3_branch_d_chained_worktree_allow() {
        assert!(check_bash(&test_ctx(), "echo hi && git branch -D feature").is_none());
    }

    #[test]
    fn l3_branch_d_sudo_worktree_allow() {
        assert!(check_bash(&test_ctx(), "sudo git branch -D feature").is_none());
    }

    #[test]
    fn l3_branch_d_no_pager_worktree_allow() {
        assert!(check_bash(&test_ctx(), "git --no-pager branch -D feature").is_none());
    }

    #[test]
    fn l3_branch_d_lower_allow() {
        assert!(check_bash(&test_ctx(), "git branch -d feature").is_none());
    }

    #[test]
    fn l3_branch_a_allow() {
        assert!(check_bash(&test_ctx(), "git branch -a").is_none());
    }

    #[test]
    fn l3_branch_piped_grep_d() {
        // -D on grep, not branch
        assert!(check_bash(&test_ctx(), "git branch -a | grep -D 3 pattern").is_none());
    }

    #[test]
    fn l3_branch_quoted_allow() {
        assert!(check_bash(&test_ctx(), "git commit -m \"guard git branch -D\"").is_none());
    }

    #[test]
    fn l3_branch_d_workspace_block() {
        // CWD-dependent: blocked in /workspace
        assert!(check_bash(&test_ctx_at_root(), "git branch -D feature").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "git branch -D feature").is_none());
    }

    #[test]
    fn l3_branch_delete_force_long_workspace_block() {
        // Long form --delete --force is equivalent to -D
        assert!(check_bash(&test_ctx_at_root(), "git branch --delete --force feature").is_some());
        assert!(check_bash(
            &test_ctx_in_worktree(),
            "git branch --delete --force feature"
        )
        .is_none());
    }

    #[test]
    fn l3_branch_d_heredoc_allow() {
        assert!(check_bash(&test_ctx(), "cat << EOF\ngit branch -D feature\nEOF").is_none());
    }

    #[test]
    fn l3_branch_d_subst_cwd_dependent() {
        assert!(check_bash(&test_ctx_at_root(), "echo $(git branch -D feature)").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "echo $(git branch -D feature)").is_none());
    }

    #[test]
    fn l3_heredoc_branch() {
        assert!(check_bash(
            &test_ctx(),
            "bash << END\ngit branch -D feature\nEND && echo done"
        )
        .is_none());
    }

    #[test]
    fn l3_subst_dquote_branch() {
        assert!(check_bash(&test_ctx_at_root(), "echo \"$(git branch -D feature)\"").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "echo \"$(git branch -D feature)\"").is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_branch_d() {
        assert!(check_bash(&test_ctx(), "git commit -m \"fix: guard git branch -D\"").is_none());
    }

    #[test]
    fn bash_allows_branch_piped_no_spaces() {
        assert!(check_bash(&test_ctx(), "git branch -a|grep -D 3 foo").is_none());
    }

    #[test]
    fn bash_allows_git_branch_force_set() {
        assert!(check_bash(&test_ctx(), "git branch -f feature-branch origin/main").is_none());
    }

    #[test]
    fn l3_sh_c_branch_d_cwd_dependent() {
        assert!(check_bash(&test_ctx_at_root(), "sh -c \"git branch -D mybranch\"").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "sh -c \"git branch -D mybranch\"").is_none());
    }
}
