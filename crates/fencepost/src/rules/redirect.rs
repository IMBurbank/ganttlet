use crate::{
    is_write_redirect, BashRule, ContextualSegment, ProjectContext, Severity, Token, Violation,
};

/// Blocks write redirects (>, >>, etc.) targeting protected paths.
pub struct RedirectToProtectedPath;

impl BashRule for RedirectToProtectedPath {
    fn name(&self) -> &'static str {
        "redirect-to-protected-path"
    }
    fn description(&self) -> &'static str {
        "Blocks write redirects (>, >>, >|, >&, <>, &>, &>>) targeting protected paths."
    }
    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        let tokens = seg.tokens();
        for j in 0..tokens.len() {
            if let Token::Operator(op) = &tokens[j] {
                if is_write_redirect(op) {
                    if let Some(Token::Word(path)) = tokens.get(j + 1) {
                        if !path.chars().all(|c| c.is_ascii_digit()) && ctx.is_protected_path(path)
                        {
                            return Some(Violation::new(
                                self.name(),
                                Severity::Block,
                                format!("redirect '{op} {path}'"),
                                format!(
                                    "this writes to a protected path under {}",
                                    ctx.root.display()
                                ),
                                format!(
                                    "Run from a worktree instead: git worktree add {}/<name> -b <branch>",
                                    ctx.worktrees_dir.display()
                                ),
                            ));
                        }
                    }
                }
            }
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

    #[test]
    fn l3_redirect_workspace() {
        assert!(check_bash(&test_ctx(), "echo hello > /workspace/src/test.ts").is_some());
    }

    #[test]
    fn l3_redirect_log_workspace() {
        assert!(check_bash(&test_ctx(), "git log > /workspace/log.txt").is_some());
    }

    #[test]
    fn l3_redirect_worktree_allow() {
        assert!(check_bash(
            &test_ctx(),
            "echo hello > /workspace/.claude/worktrees/my-wt/file.txt"
        )
        .is_none());
    }

    #[test]
    fn l3_append_workspace_block() {
        // >> is a write operation (append) — block same as >
        assert!(check_bash(&test_ctx(), "echo hello >> /workspace/file.txt").is_some());
    }

    #[test]
    fn l3_redirect_tmp_allow() {
        assert!(check_bash(&test_ctx(), "echo hello > /tmp/file.txt").is_none());
    }

    #[test]
    fn l3_redirect_chained_block() {
        assert!(check_bash(&test_ctx(), "echo ok && echo hello > /workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_sudo_block() {
        assert!(check_bash(&test_ctx(), "sudo echo hello > /workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_quoted_gt_allow() {
        // ">" is inside quotes, not a real redirect
        assert!(check_bash(&test_ctx(), "echo \"> /workspace/file\"").is_none());
    }

    #[test]
    fn l3_redirect_quoted_gt_with_real_redirect() {
        // First > is in quotes (not redirect), second > is real redirect
        assert!(check_bash(&test_ctx(), "echo \"some > text\" > /workspace/file.ts").is_some());
    }

    #[test]
    fn l3_redirect_single_quoted_gt_allow() {
        assert!(check_bash(&test_ctx(), "echo '> /workspace/file'").is_none());
    }

    #[test]
    fn l3_redirect_escaped_gt_allow() {
        // \> is escaped in bash — NOT a redirect. The tokenizer produces
        // Word(">") (not Operator(">")), so the type-safe check correctly
        // allows it. This was a false positive before the redirect operator refactor.
        assert!(check_bash(&test_ctx(), "echo \\> /workspace/file").is_none());
    }

    #[test]
    fn l3_redirect_clobber_block() {
        // >| is a write redirect (clobber) — should block
        assert!(check_bash(&test_ctx(), "echo >| /workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_fd_dup_number_allow() {
        // >&2 targets an fd number, not a path — allow
        assert!(check_bash(&test_ctx(), "echo >&2").is_none());
    }

    #[test]
    fn l3_redirect_fd_dup_stdout_allow() {
        // >&1 targets fd 1 (stdout) — allow
        assert!(check_bash(&test_ctx(), "echo >&1").is_none());
    }

    #[test]
    fn l3_redirect_fd_zero_allow() {
        // >0 is fd 0 — not a file path
        assert!(check_bash(&test_ctx(), "echo > 0").is_none());
    }

    #[test]
    fn l3_redirect_fd_dup_path_block() {
        // >&/workspace/file — in bash, >& with a non-digit target acts as
        // > file 2>&1 (writes both stdout and stderr to the file)
        assert!(check_bash(&test_ctx(), "echo >&/workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_readwrite_block() {
        // <> opens the file for both reading AND writing
        assert!(check_bash(&test_ctx(), "cmd <> /workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_input_allow() {
        // < reads from a file, doesn't write — allow
        assert!(check_bash(&test_ctx(), "cat < /workspace/file").is_none());
    }

    #[test]
    fn l3_redirect_input_fd_dup_allow() {
        // <& is fd dup for input, no write — allow
        assert!(check_bash(&test_ctx(), "cmd <&3").is_none());
    }

    #[test]
    fn l3_redirect_ampersand_gt_block() {
        // &> redirects both stdout and stderr — write operation
        assert!(check_bash(&test_ctx(), "echo hello &> /workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_ampersand_gt_append_block() {
        // &>> appends both stdout and stderr — write operation
        assert!(check_bash(&test_ctx(), "echo hello &>> /workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_ampersand_gt_worktree_allow() {
        // &> to worktree path — allow
        assert!(check_bash(&test_ctx(), "echo &> /workspace/.claude/worktrees/wt/file").is_none());
    }

    #[test]
    fn l3_redirect_ampersand_gt_tmp_allow() {
        // &> to /tmp — allow
        assert!(check_bash(&test_ctx(), "echo &> /tmp/file").is_none());
    }

    #[test]
    fn l3_redirect_quoted_word_nospace_block() {
        // "echo">/workspace/file — echo is quoted but > is unquoted operator
        assert!(check_bash(&test_ctx(), "\"echo\">/workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_double_quoted_gt_nospace_allow() {
        // echo">"path — the > is inside quotes, not an operator
        assert!(check_bash(&test_ctx(), "echo\">\"path").is_none());
    }

    #[test]
    fn l3_redirect_in_heredoc_body_allow() {
        // Redirect syntax in heredoc body is NOT a real redirect.
        assert!(check_bash(&test_ctx(), "cat << EOF\n> /workspace/file.txt\nEOF").is_none());
    }

    #[test]
    fn l3_redirect_in_commit_heredoc_allow() {
        // The exact pattern that blocked a commit
        assert!(check_bash(
            &test_ctx(),
            "git commit -m \"$(cat <<'EOF'\necho > /workspace/file\nEOF\n)\""
        )
        .is_none());
    }

    #[test]
    fn l3_redirect_nospace_block() {
        assert!(check_bash(&test_ctx(), "echo hello>/workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_nospace_cat_block() {
        assert!(check_bash(&test_ctx(), "cat>/workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_nospace_git_status_block() {
        assert!(check_bash(&test_ctx(), "git status>/workspace/log.txt").is_some());
    }

    #[test]
    fn l3_redirect_nospace_append_block() {
        // >> is a write operation (append) — block same as >
        assert!(check_bash(&test_ctx(), "echo hello>>/workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_nospace_worktree_allow() {
        assert!(check_bash(
            &test_ctx(),
            "echo hello>/workspace/.claude/worktrees/wt/file"
        )
        .is_none());
    }

    #[test]
    fn l3_redirect_nospace_in_json_allow() {
        // >/workspace/ inside a JSON string (from quoting) is NOT a redirect
        let cmd = r#"echo '{"command":"echo>/workspace/file"}'"#;
        assert!(check_bash(&test_ctx(), cmd).is_none());
    }

    #[test]
    fn l3_redirect_fd_nospace_block() {
        // fd redirect: 2>/workspace/file
        assert!(check_bash(&test_ctx(), "cmd 2>/workspace/file").is_some());
    }

    #[test]
    fn l3_redirect_dotdot_escape_block() {
        // Redirect that escapes worktree via ..
        assert!(check_bash(
            &test_ctx(),
            "echo hello > /workspace/.claude/worktrees/wt/../../../file"
        )
        .is_some());
    }
}
