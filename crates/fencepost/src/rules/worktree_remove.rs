use crate::{
    is_var_assignment, normalize_path, BashRule, ContextualSegment, ProjectContext, Severity,
    Token, Violation,
};

/// Three-tier worktree removal protection.
pub struct WorktreeRemove;

impl BashRule for WorktreeRemove {
    fn name(&self) -> &'static str {
        "worktree-remove"
    }
    fn description(&self) -> &'static str {
        "Three-tier worktree removal protection: blocks removing own CWD (tier 1), \
         requires acknowledgment for agent worktrees (tier 2), allows non-agent paths (tier 3)."
    }

    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        if !(seg.is_git("worktree") && seg.has_arg("remove")) {
            return None;
        }
        let tokens = seg.tokens();
        let remove_pos = tokens
            .iter()
            .position(|t| matches!(t, Token::Word(w) if w == "remove"));
        let target_path = remove_pos.and_then(|pos| {
            tokens[pos + 1..].iter().find_map(|t| match t {
                Token::Word(w) if !w.starts_with('-') && !is_var_assignment(w) => Some(w.as_str()),
                _ => None,
            })
        });
        let target = target_path?;
        let resolved = ctx.resolve_path(target);

        // Tier 1: target is own CWD — hard block (no confirm override)
        let cwd_resolved = normalize_path(&ctx.cwd);
        if matches!(&resolved, Some(r) if *r == cwd_resolved) {
            return Some(Violation::new(
                self.name(),
                Severity::Block,
                format!("git worktree remove {}", target),
                "this is your current working directory — removing it breaks all subsequent Bash calls",
                format!(
                    "{} {}",
                    crate::rule::MSG_USE_EXIT_WORKTREE,
                    ctx.msg_worktree_docs()
                ),
            ));
        }

        // Tier 2: target is under agent worktrees dir
        // Manual token check — confirm_token() is NOT used because the generic
        // confirm check in check.rs skips the ENTIRE rule, which would bypass
        // the tier-1 CWD hard-block above.
        let wt_prefix = ctx.worktrees_prefix();
        let is_agent_path = resolved
            .as_ref()
            .map(|r| r.to_string_lossy().starts_with(wt_prefix.as_str()))
            .unwrap_or(false);
        if is_agent_path {
            let cmd_pos = seg.effective_command().map(|(i, _)| i).unwrap_or(0);
            let acknowledged = seg.tokens()[..cmd_pos]
                .iter()
                .any(|t| matches!(t, crate::token::Token::Word(w) if w == "I_CREATED_THIS=1"));
            if acknowledged {
                return None;
            }
            return Some(Violation::new(
                self.name(),
                Severity::Block,
                format!("git worktree remove {}", target),
                "this worktree may belong to another agent — other agents may be \
                 actively working in sibling worktrees even if they look idle",
                "You may ONLY proceed if ALL of these are true:\n\
                 1. YOU created it (in this session or a previous one)\n\
                 2. Its PR is merged OR it was a test/scratch worktree\n\
                 3. You have verified no other agent is using it\n\n\
                 If all three are true, re-run with: I_CREATED_THIS=1 git worktree remove <path>\n\
                 If unsure, ask the user to remove it.",
            ));
        }

        // Tier 3: not an agent worktree — allow
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

    fn test_ctx_in_worktree() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/workspace"),
            PathBuf::from("/workspace/.claude/worktrees/test-wt"),
        )
    }

    // --- Tier 1: own CWD ---

    #[test]
    fn l3_worktree_remove_non_agent_path_allow() {
        assert!(check_bash(&test_ctx(), "git worktree remove /tmp/test").is_none());
    }

    #[test]
    fn l3_worktree_remove_non_agent_chained_allow() {
        assert!(check_bash(&test_ctx(), "echo hi && git worktree remove /tmp/wt").is_none());
    }

    #[test]
    fn l3_worktree_remove_non_agent_sudo_allow() {
        assert!(check_bash(&test_ctx(), "sudo git worktree remove /tmp/wt").is_none());
    }

    #[test]
    fn l3_worktree_remove_agent_path_block() {
        assert!(check_bash(
            &test_ctx(),
            "git worktree remove /workspace/.claude/worktrees/some-agent"
        )
        .is_some());
    }

    #[test]
    fn l3_worktree_remove_agent_path_acknowledged_allow() {
        assert!(check_bash(
            &test_ctx(),
            "I_CREATED_THIS=1 git worktree remove /workspace/.claude/worktrees/some-agent"
        )
        .is_none());
    }

    #[test]
    fn l3_worktree_remove_agent_path_acknowledged_with_env_allow() {
        assert!(check_bash(
            &test_ctx(),
            "ENV=x I_CREATED_THIS=1 git worktree remove /workspace/.claude/worktrees/some-agent"
        )
        .is_none());
    }

    #[test]
    fn l3_worktree_remove_agent_path_acknowledged_trailing_block() {
        // I_CREATED_THIS=1 AFTER the command is not a prefix — should block
        assert!(check_bash(
            &test_ctx(),
            "git worktree remove /workspace/.claude/worktrees/some-agent && I_CREATED_THIS=1"
        )
        .is_some());
    }

    #[test]
    fn l3_worktree_remove_agent_path_chained_block() {
        assert!(check_bash(
            &test_ctx(),
            "echo hi && git worktree remove /workspace/.claude/worktrees/some-agent"
        )
        .is_some());
    }

    #[test]
    fn l3_worktree_remove_agent_path_chained_acknowledged_allow() {
        assert!(check_bash(&test_ctx(), "echo hi && I_CREATED_THIS=1 git worktree remove /workspace/.claude/worktrees/some-agent").is_none());
    }

    #[test]
    fn l3_worktree_remove_dotdot_escape_block() {
        // "../" escapes to a parent, resolves to /workspace/.claude/worktrees/other
        assert!(check_bash(
            &test_ctx(),
            "git worktree remove /workspace/.claude/worktrees/test/../other"
        )
        .is_some());
    }

    #[test]
    fn l3_worktree_remove_cwd_dotdot_block() {
        let ctx = test_ctx();
        let cmd = format!(
            "git worktree remove {}/subdir/..",
            ctx.cwd.to_string_lossy()
        );
        assert!(check_bash(&ctx, &cmd).is_some());
    }

    #[test]
    fn l3_worktree_remove_own_cwd_block() {
        let ctx = test_ctx();
        let cmd = format!("git worktree remove {}", ctx.cwd.to_string_lossy());
        assert!(check_bash(&ctx, &cmd).is_some());
    }

    #[test]
    fn l3_worktree_remove_dot_cwd_block() {
        assert!(check_bash(&test_ctx(), "git worktree remove .").is_some());
    }

    #[test]
    fn l3_worktree_remove_dotslash_cwd_block() {
        assert!(check_bash(&test_ctx(), "git worktree remove ./").is_some());
    }

    #[test]
    fn l3_worktree_remove_relative_sibling_block() {
        assert!(check_bash(&test_ctx_in_worktree(), "git worktree remove ../other-wt").is_some());
    }

    #[test]
    fn l3_worktree_remove_own_cwd_trailing_slash_block() {
        let ctx = test_ctx();
        let cmd = format!("git worktree remove {}/", ctx.cwd.to_string_lossy());
        assert!(check_bash(&ctx, &cmd).is_some());
    }

    // --- Lifecycle ---

    #[test]
    fn l3_worktree_add_allow() {
        assert!(check_bash(&test_ctx(), "git worktree add /tmp/wt").is_none());
    }

    #[test]
    fn l3_worktree_list_allow() {
        assert!(check_bash(&test_ctx(), "git worktree list").is_none());
    }

    #[test]
    fn l3_worktree_prune_allow() {
        assert!(check_bash(&test_ctx(), "git worktree prune").is_none());
    }

    #[test]
    fn l3_worktree_remove_quoted_allow() {
        assert!(check_bash(
            &test_ctx(),
            "git commit -m \"git worktree remove /workspace/.claude/worktrees/x\""
        )
        .is_none());
    }

    // --- Heredoc ---

    #[test]
    fn l3_heredoc_worktree_remove() {
        assert!(check_bash(
            &test_ctx(),
            "cat << EOF\ngit worktree remove /workspace/.claude/worktrees/x\nEOF"
        )
        .is_none());
    }

    // --- Subst ---

    #[test]
    fn l3_subst_worktree_remove_other_allow() {
        assert!(check_bash(&test_ctx(), "echo $(git worktree remove /tmp/test)").is_none());
    }
}
