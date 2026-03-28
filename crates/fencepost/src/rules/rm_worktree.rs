use crate::{BashRule, ContextualSegment, ProjectContext, Severity, Token, Violation};

/// Blocks rm -r/-f on worktree root directories.
pub struct RmWorktreeRoot;

impl BashRule for RmWorktreeRoot {
    fn name(&self) -> &'static str {
        "rm-worktree-root"
    }
    fn description(&self) -> &'static str {
        "Blocks rm with -r, -R, --recursive, -f, or --force on worktree root directories."
    }
    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        let cmd_name = seg.effective_command().map(|(_, c)| c);
        if cmd_name == Some("rm")
            && (seg.has_short_flag('r')
                || seg.has_short_flag('R')
                || seg.has_arg("--recursive")
                || seg.has_short_flag('f')
                || seg.has_arg("--force"))
            && seg.targets_worktree_root()
        {
            // Find the worktree path in the tokens for the error message
            let target = seg
                .tokens()
                .iter()
                .filter_map(|t| match t {
                    Token::Word(w) if !w.starts_with('-') => Some(w.as_str()),
                    _ => None,
                })
                .find(|w| *w != "rm")
                .unwrap_or("worktree");
            Some(Violation::new(
                self.name(),
                Severity::Block,
                format!("rm -rf {}", target),
                "recursive deletion of a worktree root breaks your CWD and leaves orphaned git branches",
                format!(
                    "{} {}",
                    crate::rule::MSG_USE_EXIT_WORKTREE,
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

    #[test]
    fn l3_rm_rf_worktree() {
        assert!(check_bash(&test_ctx(), "rm -rf /workspace/.claude/worktrees/my-wt").is_some());
    }

    #[test]
    fn l3_rm_r_worktree() {
        assert!(check_bash(&test_ctx(), "rm -r /workspace/.claude/worktrees/my-wt").is_some());
    }

    #[test]
    fn l3_rm_rf_trailing_slash() {
        assert!(check_bash(&test_ctx(), "rm -rf /workspace/.claude/worktrees/my-wt/").is_some());
    }

    #[test]
    fn l3_rm_rf_chained() {
        assert!(check_bash(
            &test_ctx(),
            "cd /tmp && rm -rf /workspace/.claude/worktrees/my-wt"
        )
        .is_some());
    }

    #[test]
    fn l3_rm_rf_semi() {
        assert!(check_bash(
            &test_ctx(),
            "echo hi; rm -rf /workspace/.claude/worktrees/my-wt"
        )
        .is_some());
    }

    #[test]
    fn l3_rm_rf_subdir_allow() {
        assert!(check_bash(
            &test_ctx(),
            "rm -rf /workspace/.claude/worktrees/my-wt/node_modules"
        )
        .is_none());
    }

    #[test]
    fn l3_rm_rf_deep_subdir_allow() {
        assert!(check_bash(
            &test_ctx(),
            "rm -rf /workspace/.claude/worktrees/my-wt/src/old/"
        )
        .is_none());
    }

    #[test]
    fn l3_rm_rf_tmp_allow() {
        assert!(check_bash(&test_ctx(), "rm -rf /tmp/something").is_none());
    }

    #[test]
    fn l3_rm_upper_r_block() {
        // rm -R is equivalent to rm -r — must also be caught
        assert!(check_bash(&test_ctx(), "rm -R /workspace/.claude/worktrees/my-wt").is_some());
    }

    #[test]
    fn l3_rm_upper_rf_block() {
        // rm -Rf is equivalent to rm -rf
        assert!(check_bash(&test_ctx(), "rm -Rf /workspace/.claude/worktrees/my-wt").is_some());
    }

    #[test]
    fn l3_rm_long_recursive_block() {
        // rm --recursive is equivalent to rm -r
        assert!(check_bash(
            &test_ctx(),
            "rm --recursive /workspace/.claude/worktrees/my-wt"
        )
        .is_some());
    }

    #[test]
    fn l3_rm_long_force_block() {
        // rm --force is equivalent to rm -f
        assert!(check_bash(&test_ctx(), "rm --force /workspace/.claude/worktrees/my-wt").is_some());
    }

    #[test]
    fn l3_rm_long_recursive_force_block() {
        assert!(check_bash(
            &test_ctx(),
            "rm --recursive --force /workspace/.claude/worktrees/my-wt"
        )
        .is_some());
    }

    #[test]
    fn l3_rm_no_flags_allow() {
        assert!(check_bash(
            &test_ctx(),
            "rm /workspace/.claude/worktrees/my-wt/file.txt"
        )
        .is_none());
    }

    #[test]
    fn l3_rm_f_file_allow() {
        assert!(check_bash(
            &test_ctx(),
            "rm -f /workspace/.claude/worktrees/my-wt/temp.txt"
        )
        .is_none());
    }

    #[test]
    fn l3_cp_r_allow() {
        assert!(check_bash(
            &test_ctx(),
            "cp -r /workspace/.claude/worktrees/my-wt/src /tmp/backup"
        )
        .is_none());
    }

    #[test]
    fn l3_rm_rf_dotdot_escape_block() {
        // ../worktrees/my-wt resolves to the worktree root after normalization
        assert!(check_bash(
            &test_ctx(),
            "rm -rf /workspace/.claude/worktrees/../worktrees/my-wt"
        )
        .is_some());
    }

    #[test]
    fn l3_heredoc_rm() {
        assert!(check_bash(
            &test_ctx(),
            "python3 << EOF\nrm -rf /workspace/.claude/worktrees/my-wt\nEOF"
        )
        .is_none());
    }

    #[test]
    fn l3_subst_rm() {
        assert!(check_bash(
            &test_ctx(),
            "echo $(rm -rf /workspace/.claude/worktrees/my-wt)"
        )
        .is_some());
    }

    #[test]
    fn l3_sudo_rm_worktree() {
        assert!(check_bash(
            &test_ctx(),
            "sudo rm -rf /workspace/.claude/worktrees/my-wt"
        )
        .is_some());
    }

    #[test]
    fn l3_env_rm_worktree() {
        assert!(check_bash(
            &test_ctx(),
            "env PATH=/tmp rm -rf /workspace/.claude/worktrees/my-wt"
        )
        .is_some());
    }

    #[test]
    fn bash_allows_commit_rm_rf_worktree() {
        assert!(check_bash(
            &test_ctx(),
            "git commit -m \"fix: guard blocks rm -rf /workspace/.claude/worktrees/\""
        )
        .is_none());
    }
}
