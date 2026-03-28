use crate::context::ProjectContext;
use crate::log_debug;
use crate::rule::Severity;
use crate::rules::{BASH_RULES, EDIT_RULES};
use crate::segment::parse_segments;

/// Check whether an Edit/Write operation should be blocked.
/// Returns Some(reason) to block, None to allow.
///
/// This function is framework-agnostic — it takes a file path string,
/// not protocol-specific JSON. Protocol parsing belongs in the adapter (main.rs).
pub fn check_edit(ctx: &ProjectContext, file_path: &str) -> Option<String> {
    log_debug!("mode: edit, path: {}", file_path);

    for rule in EDIT_RULES {
        let effective_severity = ctx.rule_severity(rule.name(), &rule.severity());
        if effective_severity == Severity::Off {
            log_debug!("rule {}: skipped (off)", rule.name());
            continue;
        }

        if let Some(v) = rule.check_file(ctx, file_path) {
            match effective_severity {
                Severity::Block => {
                    log_debug!("rule {}: MATCH → block", v.rule());
                    return Some(v.reason());
                }
                Severity::Warn => {
                    log_debug!("rule {}: MATCH → warn (stderr only)", v.rule());
                    eprintln!("fencepost [{}]: {}", v.rule(), v.reason());
                }
                Severity::Off => unreachable!(),
            }
        } else {
            log_debug!("rule {}: no match", rule.name());
        }
    }

    log_debug!("result: allow");
    None
}

/// Check whether a Bash command should be blocked.
/// Returns Some(reason) to block, None to allow.
pub fn check_bash(ctx: &ProjectContext, command: &str) -> Option<String> {
    log_debug!("mode: bash, command: {:?}", command);

    let segments = parse_segments(command);
    log_debug!("parsed {} segment(s)", segments.len());

    for seg in &segments {
        let seg = ctx.bind(seg);
        for rule in BASH_RULES {
            let effective_severity = ctx.rule_severity(rule.name(), &rule.severity());
            if effective_severity == Severity::Off {
                log_debug!("rule {}: skipped (off)", rule.name());
                continue;
            }

            // Check confirm token: if present in the command, skip this rule
            if let Some(token) = rule.confirm_token() {
                let cmd_pos = seg.effective_command().map(|(i, _)| i).unwrap_or(0);
                let acknowledged = seg.tokens()[..cmd_pos]
                    .iter()
                    .any(|t| matches!(t, crate::token::Token::Word(w) if w == token));
                if acknowledged {
                    log_debug!("rule {}: confirmed via {}", rule.name(), token);
                    continue;
                }
            }

            if let Some(v) = rule.check_segment(ctx, &seg) {
                match effective_severity {
                    Severity::Block => {
                        log_debug!("rule {}: MATCH → block", v.rule());
                        return Some(v.reason());
                    }
                    Severity::Warn => {
                        log_debug!("rule {}: MATCH → warn (stderr only)", v.rule());
                        eprintln!("fencepost [{}]: {}", v.rule(), v.reason());
                    }
                    Severity::Off => unreachable!(),
                }
            }
        }
    }

    log_debug!("result: allow");
    None
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn bash_allows_commit_with_worktree_mention() {
        assert!(check_bash(
            &test_ctx(),
            "git commit -m \"block direct edits in /workspace/ must use worktrees\""
        )
        .is_none());
    }

    #[test]
    fn l3_brace_group_blocked() {
        assert!(check_bash(&test_ctx(), "{ git push origin main; }").is_some());
    }

    #[test]
    fn l3_exec_push_block() {
        assert!(check_bash(&test_ctx(), "exec git push origin main").is_some());
    }

    #[test]
    fn l3_exec_clean_cwd_dependent() {
        assert!(check_bash(&test_ctx_at_root(), "exec git clean -fd").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "exec git clean -fd").is_none());
    }

    #[test]
    fn l3_exec_safe_allow() {
        assert!(check_bash(&test_ctx(), "exec git status").is_none());
    }

    #[test]
    fn l3_brace_clean_cwd_dependent() {
        assert!(check_bash(&test_ctx_at_root(), "{ git clean -fd; }").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "{ git clean -fd; }").is_none());
    }

    #[test]
    fn l3_brace_clean_and_cwd_dependent() {
        assert!(check_bash(&test_ctx_at_root(), "{ git clean -fd && echo done; }").is_some());
        assert!(check_bash(&test_ctx_in_worktree(), "{ git clean -fd && echo done; }").is_none());
    }

    #[test]
    fn l3_brace_safe_allow() {
        assert!(check_bash(&test_ctx(), "{ echo hello; }").is_none());
    }

    #[test]
    fn l3_nested_brace_block() {
        assert!(check_bash(&test_ctx(), "{ { git push origin main; }; }").is_some());
    }

    #[test]
    fn l3_heredoc_strict_no_early_close() {
        assert!(check_bash(&test_ctx(), "cat << EOF\n   EOF\ngit push origin main\nEOF").is_none());
    }

    #[test]
    fn l3_failopen_unmatched_dquote() {
        assert!(check_bash(&test_ctx(), "echo \"unmatched quote").is_none());
    }

    #[test]
    fn l3_failopen_unmatched_squote() {
        assert!(check_bash(&test_ctx(), "echo 'unmatched single").is_none());
    }

    #[test]
    fn l3_failopen_dangling_backslash() {
        assert!(check_bash(&test_ctx(), "echo hello\\").is_none());
    }

    #[test]
    fn l3_failopen_unclosed_backtick() {
        assert!(check_bash(&test_ctx(), "echo `git push").is_none());
    }

    #[test]
    fn l3_adversarial_long_input() {
        assert!(check_bash(&test_ctx(), &"a".repeat(10000)).is_none());
    }

    #[test]
    fn l3_adversarial_many_chains() {
        let cmd = (0..1000)
            .map(|i| format!("echo {}", i))
            .collect::<Vec<_>>()
            .join(" && ");
        assert!(check_bash(&test_ctx(), &cmd).is_none());
    }

    #[test]
    fn l3_adversarial_mixed() {
        let _ = check_bash(&test_ctx(), "|;&(){}[]<>$`\"'\\!~*?#");
    }

    #[test]
    fn bash_allows_normal_commands() {
        assert!(check_bash(&test_ctx(), "git status").is_none());
    }

    #[test]
    fn bash_allows_empty_command() {
        assert!(check_bash(&test_ctx(), "").is_none());
    }

    #[test]
    fn bash_allows_whitespace_command() {
        assert!(check_bash(&test_ctx(), "   ").is_none());
    }

    #[test]
    fn rule_override_off_disables_push_check() {
        let mut ctx = test_ctx();
        ctx.rule_overrides
            .insert("push-to-default-branch".to_string(), Severity::Off);
        assert!(check_bash(&ctx, "git push origin main").is_none());
    }

    #[test]
    fn rule_override_off_disables_checkout_check() {
        let mut ctx = test_ctx_at_root();
        ctx.rule_overrides
            .insert("checkout-switch".to_string(), Severity::Off);
        assert!(check_bash(&ctx, "git checkout main").is_none());
    }

    #[test]
    fn rule_override_does_not_affect_other_rules() {
        let mut ctx = test_ctx();
        ctx.rule_overrides
            .insert("checkout-switch".to_string(), Severity::Off);
        assert!(check_bash(&ctx, "git push origin main").is_some());
    }

    #[test]
    fn rule_override_off_disables_edit_rule() {
        let mut ctx = test_ctx();
        ctx.rule_overrides
            .insert("protected-file-pattern".to_string(), Severity::Off);
        assert!(check_edit(&ctx, "/workspace/.claude/worktrees/wt/.env").is_none());
    }
}
