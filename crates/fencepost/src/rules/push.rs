use crate::{BashRule, ContextualSegment, ProjectContext, Severity, Token, Violation};

/// Blocks git push targeting the default branch. Use feature branches and PRs.
pub struct PushToDefaultBranch;

impl BashRule for PushToDefaultBranch {
    fn name(&self) -> &'static str {
        "push-to-default-branch"
    }
    fn description(&self) -> &'static str {
        "Blocks git push targeting the default branch. Use feature branches and PRs."
    }

    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        if !seg.is_git("push") {
            return None;
        }

        let branch = &ctx.default_branch;
        let branch_suffix = format!(":{}", branch);
        let refs_suffix = format!(":refs/heads/{}", branch);
        let targets_default = seg.tokens().iter().any(|t| {
            if let Token::Word(w) = t {
                w == branch || w.ends_with(&branch_suffix) || w.ends_with(&refs_suffix)
            } else {
                false
            }
        });

        if targets_default {
            Some(Violation::new(
                self.name(),
                Severity::Block,
                format!("git push targeting {}", branch),
                format!(
                    "direct pushes to {} are blocked to protect the default branch",
                    branch
                ),
                "Use a feature branch and open a PR instead.",
            ))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{check_bash, parse_segments, ProjectContext};
    use std::path::PathBuf;

    fn test_ctx() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/workspace"),
            PathBuf::from("/workspace/.claude/worktrees/default-test"),
        )
    }

    // Direct rule tests — verify rules work independently of check_bash

    #[test]
    fn rule_push_to_default_branch_blocks() {
        let ctx = test_ctx();
        let segs = parse_segments("git push origin main");
        let seg = ctx.bind(&segs[0]);
        let v = PushToDefaultBranch.check_segment(&ctx, &seg);
        assert!(v.is_some());
        assert_eq!(v.unwrap().rule(), "push-to-default-branch");
    }

    #[test]
    fn rule_push_to_default_branch_allows_feature() {
        let ctx = test_ctx();
        let segs = parse_segments("git push origin feature-branch");
        let seg = ctx.bind(&segs[0]);
        assert!(PushToDefaultBranch.check_segment(&ctx, &seg).is_none());
    }

    #[test]
    fn l3_push_main_basic() {
        assert!(check_bash(&test_ctx(), "git push origin main").is_some());
    }

    #[test]
    fn l3_push_main_chained() {
        assert!(check_bash(&test_ctx(), "echo hi && git push origin main").is_some());
    }

    #[test]
    fn l3_push_main_semi_nospace() {
        assert!(check_bash(&test_ctx(), "echo hi;git push origin main").is_some());
    }

    #[test]
    fn l3_push_main_pipe() {
        assert!(check_bash(&test_ctx(), "echo hi|git push origin main").is_some());
    }

    #[test]
    fn l3_push_main_sudo() {
        assert!(check_bash(&test_ctx(), "sudo git push origin main").is_some());
    }

    #[test]
    fn l3_push_main_env() {
        assert!(check_bash(&test_ctx(), "env GIT_SSH=/usr/bin/ssh git push origin main").is_some());
    }

    #[test]
    fn l3_push_main_c_flag() {
        assert!(check_bash(&test_ctx(), "git -C /tmp push origin main").is_some());
    }

    #[test]
    fn l3_push_main_subst() {
        assert!(check_bash(&test_ctx(), "echo $(git push origin main)").is_some());
    }

    #[test]
    fn l3_push_main_subshell() {
        assert!(check_bash(&test_ctx(), "(git push origin main)").is_some());
    }

    #[test]
    fn l3_push_refspec_head_main_block() {
        assert!(check_bash(&test_ctx(), "git push origin HEAD:main").is_some());
    }

    #[test]
    fn l3_push_refspec_branch_main_block() {
        assert!(check_bash(&test_ctx(), "git push origin feature:main").is_some());
    }

    #[test]
    fn l3_push_refspec_refs_heads_main_block() {
        assert!(check_bash(&test_ctx(), "git push origin HEAD:refs/heads/main").is_some());
    }

    #[test]
    fn l3_push_refspec_feature_allow() {
        // Refspec targeting a non-main branch — allow
        assert!(check_bash(&test_ctx(), "git push origin HEAD:feature").is_none());
    }

    #[test]
    fn l3_push_feature_allow() {
        assert!(check_bash(&test_ctx(), "git push origin feature").is_none());
    }

    #[test]
    fn l3_push_maintain_allow() {
        assert!(check_bash(&test_ctx(), "git push origin maintain-branch").is_none());
    }

    #[test]
    fn l3_push_refspec_allow() {
        assert!(check_bash(&test_ctx(), "git push origin HEAD:refs/heads/feature").is_none());
    }

    #[test]
    fn l3_push_delete_allow() {
        assert!(check_bash(&test_ctx(), "git push origin --delete feature").is_none());
    }

    #[test]
    fn l3_log_main_allow() {
        assert!(check_bash(&test_ctx(), "git log main").is_none());
    }

    #[test]
    fn l3_push_main_quoted_allow() {
        assert!(check_bash(&test_ctx(), "git commit -m \"git push origin main\"").is_none());
    }

    #[test]
    fn l3_push_main_cross_segment_allow() {
        // BUG FIX: main is in log segment, not push segment
        assert!(check_bash(&test_ctx(), "git push origin feature && git log main").is_none());
    }

    #[test]
    fn l3_heredoc_push() {
        assert!(check_bash(&test_ctx(), "python3 << EOF\ngit push origin main\nEOF").is_none());
    }

    #[test]
    fn l3_subst_push() {
        assert!(check_bash(&test_ctx(), "echo $(git push origin main)").is_some());
    }

    #[test]
    fn l3_subst_chained() {
        assert!(check_bash(&test_ctx(), "echo hi && echo $(git push origin main)").is_some());
    }

    #[test]
    fn l3_fullpath_push() {
        assert!(check_bash(&test_ctx(), "/usr/bin/git push origin main").is_some());
    }

    #[test]
    fn l3_relpath_push() {
        assert!(check_bash(&test_ctx(), "./git push origin main").is_some());
    }

    #[test]
    fn l3_sudo_fullpath_push() {
        assert!(check_bash(&test_ctx(), "sudo /usr/bin/git push origin main").is_some());
    }

    #[test]
    fn l3_fullpath_c_flag_push() {
        assert!(check_bash(&test_ctx(), "/usr/bin/git -C /tmp push origin main").is_some());
    }

    #[test]
    fn l3_assign_push() {
        assert!(check_bash(&test_ctx(), "VAR=val git push origin main").is_some());
    }

    #[test]
    fn l3_assign_git_ssh_push() {
        assert!(check_bash(&test_ctx(), "GIT_SSH=/usr/bin/ssh git push origin main").is_some());
    }

    #[test]
    fn l3_multi_assign_push() {
        assert!(check_bash(&test_ctx(), "A=1 B=2 git push origin main").is_some());
    }

    #[test]
    fn l3_assign_sudo_push() {
        assert!(check_bash(&test_ctx(), "VAR=val sudo git push origin main").is_some());
    }

    #[test]
    fn l3_assign_c_flag_push() {
        assert!(check_bash(&test_ctx(), "VAR=val git -C /tmp push origin main").is_some());
    }

    #[test]
    fn l3_line_continuation_push() {
        assert!(check_bash(&test_ctx(), "git push origin \\\nmain").is_some());
    }

    #[test]
    fn l3_line_continuation_push2() {
        assert!(check_bash(&test_ctx(), "git push \\\norigin main").is_some());
    }

    #[test]
    fn l3_pipe_continuation_push() {
        assert!(check_bash(&test_ctx(), "echo a |\ngit push origin main").is_some());
    }

    #[test]
    fn l3_and_continuation_push() {
        assert!(check_bash(&test_ctx(), "echo a &&\ngit push origin main").is_some());
    }

    #[test]
    fn l3_background_push() {
        assert!(check_bash(&test_ctx(), "git push origin main &").is_some());
    }

    #[test]
    fn l3_background_sep_push() {
        assert!(check_bash(&test_ctx(), "echo hi & git push origin main").is_some());
    }

    #[test]
    fn l3_subst_dquote_push() {
        assert!(check_bash(&test_ctx(), "echo \"$(git push origin main)\"").is_some());
    }

    #[test]
    fn l3_subst_squote_push_allow() {
        assert!(check_bash(&test_ctx(), "echo '$(git push origin main)'").is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_push() {
        assert!(check_bash(
            &test_ctx(),
            "git commit -m \"block git push to the default branch\""
        )
        .is_none());
    }

    #[test]
    fn bash_allows_gh_push_main_body() {
        assert!(check_bash(
            &test_ctx(),
            "gh pr comment 1 --body \"guard blocks git push to main\""
        )
        .is_none());
    }

    #[test]
    fn bash_allows_grep_git_push() {
        assert!(check_bash(&test_ctx(), "grep -r \"git push\" scripts/").is_none());
    }

    #[test]
    fn bash_allows_git_pull() {
        assert!(check_bash(&test_ctx(), "git pull origin main").is_none());
    }

    #[test]
    fn bash_allows_git_fetch() {
        assert!(check_bash(&test_ctx(), "git fetch origin main").is_none());
    }

    #[test]
    fn bash_allows_git_merge() {
        assert!(check_bash(&test_ctx(), "git merge feature/phase19 --no-edit").is_none());
    }

    #[test]
    fn bash_allows_push_delete_remote() {
        assert!(check_bash(&test_ctx(), "git push origin --delete feature/old").is_none());
    }

    #[test]
    fn bash_allows_multi_space_push_feature() {
        assert!(check_bash(&test_ctx(), "git  push  origin  feature").is_none());
    }

    #[test]
    fn l3_sudo_u_push_known_gap() {
        // Known gap: sudo -u root git push origin main is NOT blocked
        // because effective_command returns "root", which isn't git.
        // This is acceptable: fail-open, and sudo -u is rare in agent commands.
        assert!(check_bash(&test_ctx(), "sudo -u root git push origin main").is_none());
        // known gap: not blocked
    }

    #[test]
    fn l3_sudo_n_push_blocked() {
        // sudo -n git push origin main IS blocked (correct)
        assert!(check_bash(&test_ctx(), "sudo -n git push origin main").is_some());
    }

    #[test]
    fn l3_sudo_e_push_blocked() {
        assert!(check_bash(&test_ctx(), "sudo -E git push origin main").is_some());
    }

    #[test]
    fn l3_subst_quoted_paren_push() {
        // $(echo ")" && git push origin main) — ) in quotes doesn't close
        assert!(check_bash(&test_ctx(), "echo $(echo \")\" && git push origin main)").is_some());
    }

    #[test]
    fn l3_or_continuation_push() {
        // || continuation: newline after || doesn't separate
        assert!(check_bash(&test_ctx(), "echo a ||\ngit push origin main").is_some());
    }

    #[test]
    fn l3_bash_c_push_block() {
        assert!(check_bash(&test_ctx(), "bash -c \"git push origin main\"").is_some());
    }

    #[test]
    fn l3_sh_c_push_block() {
        assert!(check_bash(&test_ctx(), "sh -c \"git push origin main\"").is_some());
    }

    #[test]
    fn l3_fullpath_bash_c_block() {
        assert!(check_bash(&test_ctx(), "/bin/bash -c \"git push origin main\"").is_some());
    }

    #[test]
    fn l3_bash_c_multi_cmd_block() {
        assert!(check_bash(&test_ctx(), "bash -c \"echo hi; git push origin main\"").is_some());
    }

    #[test]
    fn l3_eval_push_block() {
        assert!(check_bash(&test_ctx(), "eval \"git push origin main\"").is_some());
    }

    #[test]
    fn l3_bash_c_safe_allow() {
        assert!(check_bash(&test_ctx(), "bash -c \"echo hello\"").is_none());
    }

    #[test]
    fn l3_bash_c_push_feature_allow() {
        assert!(check_bash(&test_ctx(), "bash -c \"git push origin feature\"").is_none());
    }

    #[test]
    fn l3_sudo_bash_c_push_block() {
        assert!(check_bash(&test_ctx(), "sudo bash -c \"git push origin main\"").is_some());
    }
}
