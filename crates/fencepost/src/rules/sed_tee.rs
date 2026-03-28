use crate::{BashRule, ContextualSegment, ProjectContext, Severity, Violation};

/// Blocks sed -i and tee targeting protected paths.
pub struct SedTeeProtectedPath;

impl BashRule for SedTeeProtectedPath {
    fn name(&self) -> &'static str {
        "sed-tee-protected-path"
    }
    fn description(&self) -> &'static str {
        "Blocks sed -i/--in-place and tee targeting protected paths."
    }
    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
        let cmd_name = seg.effective_command().map(|(_, c)| c);
        if cmd_name == Some("sed")
            && (seg.has_arg("-i")
                || seg.has_arg_starting_with("-i")
                || seg.has_arg("--in-place")
                || seg.has_arg_starting_with("--in-place"))
            && seg.has_protected_path()
        {
            return Some(Violation::new(
                self.name(),
                Severity::Block,
                "sed -i on a protected file",
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
        if cmd_name == Some("tee") && seg.has_protected_path() {
            return Some(Violation::new(
                self.name(),
                Severity::Block,
                "tee to a protected file",
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
    fn l3_sed_workspace() {
        assert!(check_bash(&test_ctx(), "sed -i s/foo/bar/ /workspace/src/test.ts").is_some());
    }

    #[test]
    fn l3_sed_ibak_workspace() {
        assert!(check_bash(&test_ctx(), "sed -i.bak s/foo/bar/ /workspace/src/test.ts").is_some());
    }

    #[test]
    fn l3_sed_chained() {
        assert!(check_bash(
            &test_ctx(),
            "echo hi && sed -i s/foo/bar/ /workspace/src/test.ts"
        )
        .is_some());
    }

    #[test]
    fn l3_tee_workspace() {
        assert!(check_bash(&test_ctx(), "echo hello | tee /workspace/src/test.ts").is_some());
    }

    #[test]
    fn l3_sed_worktree_allow() {
        assert!(check_bash(
            &test_ctx(),
            "sed -i s/foo/bar/ /workspace/.claude/worktrees/my-wt/src/test.ts"
        )
        .is_none());
    }

    #[test]
    fn l3_sed_in_place_long_block() {
        // --in-place is the long form of -i
        assert!(check_bash(
            &test_ctx(),
            "sed --in-place s/foo/bar/ /workspace/src/test.ts"
        )
        .is_some());
    }

    #[test]
    fn l3_sed_in_place_suffix_block() {
        // --in-place=.bak is also a valid form
        assert!(check_bash(
            &test_ctx(),
            "sed --in-place=.bak s/foo/bar/ /workspace/src/test.ts"
        )
        .is_some());
    }

    #[test]
    fn l3_heredoc_sed() {
        assert!(check_bash(
            &test_ctx(),
            "cat << EOF\nsed -i s/x/y/ /workspace/src/file.ts\nEOF"
        )
        .is_none());
    }

    #[test]
    fn l3_subst_sed() {
        assert!(check_bash(&test_ctx(), "echo $(sed -i s/x/y/ /workspace/src/file.ts)").is_some());
    }

    #[test]
    fn l3_sudo_sed_workspace() {
        assert!(check_bash(&test_ctx(), "sudo sed -i s/x/y/ /workspace/src/file.ts").is_some());
    }

    #[test]
    fn l3_sed_dotdot_escape_block() {
        assert!(check_bash(
            &test_ctx(),
            "sed -i 's/x/y/' /workspace/.claude/worktrees/wt/../../../file"
        )
        .is_some());
    }
}
