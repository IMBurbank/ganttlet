use crate::{
    has_write_indicator, script_interpreter_flag, BashRule, ContextualSegment, ProjectContext,
    Severity, Token, Violation,
};

/// Blocks interpreter -c/-e code that writes to the project root.
pub struct InterpreterWrite;

impl BashRule for InterpreterWrite {
    fn name(&self) -> &'static str {
        "interpreter-write"
    }
    fn description(&self) -> &'static str {
        "Blocks python/node/perl/ruby inline code that writes to the project root."
    }
    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        if let Some((cmd_pos, cmd)) = seg.effective_command() {
            if let Some(flag) = script_interpreter_flag(cmd) {
                let tokens = seg.tokens();
                if let Some(f_pos) = tokens[cmd_pos + 1..]
                    .iter()
                    .position(|t| matches!(t, Token::Word(w) if w == flag))
                {
                    let arg_pos = cmd_pos + 1 + f_pos + 1;
                    if let Some(Token::Word(code)) = tokens.get(arg_pos) {
                        let root_str = ctx.root_prefix();
                        let wt_prefix = ctx.worktrees_prefix();
                        if code.contains(root_str.as_str())
                            && !code.contains(wt_prefix.as_str())
                            && has_write_indicator(code)
                        {
                            return Some(Violation::new(
                                self.name(),
                                Severity::Block,
                                format!("`{cmd} {flag} ...` with a write operation targeting {}", ctx.root.display()),
                                "inline interpreter code must not modify protected files under the project root",
                                format!(
                                    "Use a worktree, or write a script file and run it from there: git worktree add {}/<name> -b <branch>",
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
    fn l3_python_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"open('/workspace/file', 'w').write('x')\""
        )
        .is_some());
    }

    #[test]
    fn l3_python_system_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"import os; os.system('echo > /workspace/file')\""
        )
        .is_some());
    }

    #[test]
    fn l3_node_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "node -e \"require('fs').writeFileSync('/workspace/file', 'x')\""
        )
        .is_some());
    }

    #[test]
    fn l3_perl_workspace_block() {
        assert!(check_bash(&test_ctx(), "perl -e \"system('echo > /workspace/file')\"").is_some());
    }

    #[test]
    fn l3_python_worktree_allow() {
        // Worktree paths are allowed
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"open('/workspace/.claude/worktrees/wt/file', 'w')\""
        )
        .is_none());
    }

    #[test]
    fn l3_python_safe_allow() {
        // No /workspace/ path — allow
        assert!(check_bash(&test_ctx(), "python3 -c \"print('hello')\"").is_none());
    }

    #[test]
    fn l3_node_safe_allow() {
        assert!(check_bash(&test_ctx(), "node -e \"console.log('hello')\"").is_none());
    }

    #[test]
    fn l3_python_fullpath_block() {
        // Full path to interpreter
        assert!(check_bash(
            &test_ctx(),
            "/usr/bin/python3 -c \"open('/workspace/file', 'w')\""
        )
        .is_some());
    }

    #[test]
    fn l3_python_read_workspace_allow() {
        // Reading from /workspace/ is not a write — allow
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"data = open('/workspace/package.json').read()\""
        )
        .is_none());
    }

    #[test]
    fn l3_python_print_workspace_allow() {
        // Just printing a path — allow
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"print('/workspace/src/file.ts')\""
        )
        .is_none());
    }

    #[test]
    fn l3_python_listdir_workspace_allow() {
        // Listing directory contents — allow
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"import os; print(os.listdir('/workspace/src/'))\""
        )
        .is_none());
    }

    #[test]
    fn l3_python_exists_workspace_allow() {
        // Checking file existence — allow
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"import os; print(os.path.exists('/workspace/file'))\""
        )
        .is_none());
    }

    #[test]
    fn l3_node_read_workspace_allow() {
        // Reading file in node — allow
        assert!(check_bash(
            &test_ctx(),
            "node -e \"console.log(require('fs').readFileSync('/workspace/file', 'utf8'))\""
        )
        .is_none());
    }

    #[test]
    fn l3_python_subprocess_workspace_block() {
        // subprocess with /workspace/ — block (shell-out)
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"import subprocess; subprocess.run(['rm', '/workspace/file'])\""
        )
        .is_some());
    }

    #[test]
    fn l3_python_shutil_workspace_block() {
        // shutil with /workspace/ — block (destructive)
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"import shutil; shutil.rmtree('/workspace/src/')\""
        )
        .is_some());
    }

    #[test]
    fn l3_python_append_mode_workspace_block() {
        // open with 'a' mode — block (write)
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"open('/workspace/file', 'a').write('x')\""
        )
        .is_some());
    }

    #[test]
    fn l3_node_writefile_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "node -e \"require('fs').writeFileSync('/workspace/file', 'x')\""
        )
        .is_some());
    }

    #[test]
    fn l3_node_appendfile_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "node -e \"require('fs').appendFileSync('/workspace/file', 'x')\""
        )
        .is_some());
    }

    #[test]
    fn l3_node_writestream_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "node -e \"require('fs').createWriteStream('/workspace/file')\""
        )
        .is_some());
    }

    #[test]
    fn l3_node_unlink_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "node -e \"require('fs').unlinkSync('/workspace/file')\""
        )
        .is_some());
    }

    #[test]
    fn l3_node_exec_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "node -e \"require('child_process').execSync('rm /workspace/file')\""
        )
        .is_some());
    }

    #[test]
    fn l3_node_readfile_workspace_allow() {
        assert!(check_bash(
            &test_ctx(),
            "node -e \"console.log(require('fs').readFileSync('/workspace/file', 'utf8'))\""
        )
        .is_none());
    }

    #[test]
    fn l3_node_stat_workspace_allow() {
        assert!(check_bash(
            &test_ctx(),
            "node -e \"console.log(require('fs').statSync('/workspace/file'))\""
        )
        .is_none());
    }

    #[test]
    fn l3_node_readdir_workspace_allow() {
        assert!(check_bash(
            &test_ctx(),
            "node -e \"console.log(require('fs').readdirSync('/workspace/src/'))\""
        )
        .is_none());
    }

    #[test]
    fn l3_perl_unlink_workspace_block() {
        assert!(check_bash(&test_ctx(), "perl -e \"unlink('/workspace/file')\"").is_some());
    }

    #[test]
    fn l3_perl_rename_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "perl -e \"rename('/workspace/old', '/workspace/new')\""
        )
        .is_some());
    }

    #[test]
    fn l3_perl_read_workspace_allow() {
        assert!(check_bash(
            &test_ctx(),
            "perl -e \"open(F, '/workspace/file'); print <F>\""
        )
        .is_none());
    }

    #[test]
    fn l3_ruby_filewrite_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "ruby -e \"File.write('/workspace/file', 'x')\""
        )
        .is_some());
    }

    #[test]
    fn l3_ruby_filedelete_workspace_block() {
        assert!(check_bash(&test_ctx(), "ruby -e \"File.delete('/workspace/file')\"").is_some());
    }

    #[test]
    fn l3_ruby_fileutils_workspace_block() {
        assert!(check_bash(
            &test_ctx(),
            "ruby -e \"require 'fileutils'; FileUtils.rm_rf('/workspace/src/')\""
        )
        .is_some());
    }

    #[test]
    fn l3_ruby_system_workspace_block() {
        assert!(check_bash(&test_ctx(), "ruby -e \"system('echo > /workspace/file')\"").is_some());
    }

    #[test]
    fn l3_ruby_read_workspace_allow() {
        assert!(check_bash(&test_ctx(), "ruby -e \"puts File.read('/workspace/file')\"").is_none());
    }

    #[test]
    fn l3_interpreter_worktree_write_allow() {
        // Write to worktree path — always allowed
        assert!(check_bash(
            &test_ctx(),
            "python3 -c \"open('/workspace/.claude/worktrees/wt/file', 'w').write('x')\""
        )
        .is_none());
    }

    #[test]
    fn l3_interpreter_no_flag_allow() {
        // python3 with no -c flag — running a script file, not inline code
        assert!(check_bash(&test_ctx(), "python3 /workspace/scripts/test.py").is_none());
    }

    #[test]
    fn l3_interpreter_flag_not_first() {
        // python3 -u -c "code" — -c is not the first flag, should still be caught
        assert!(check_bash(
            &test_ctx(),
            "python3 -u -c \"open('/workspace/file', 'w')\""
        )
        .is_some());
    }
}
