use crate::{EditRule, ProjectContext, Severity, Violation};

/// Blocks editing protected files (.env, package-lock.json, etc.).
pub struct ProtectedFilePattern;

impl EditRule for ProtectedFilePattern {
    fn name(&self) -> &'static str {
        "protected-file-pattern"
    }
    fn description(&self) -> &'static str {
        "Blocks editing files matching protected patterns (.env, package-lock.json, etc.)."
    }
    fn check_file(&self, ctx: &ProjectContext, file_path: &str) -> Option<Violation> {
        ctx.is_protected_file(file_path).map(|reason| {
            Violation::new(
                self.name(),
                Severity::Block,
                format!("edit {}", file_path),
                reason,
                "This file should not be edited directly. If you must change it, ask the user.",
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::{check_edit, ProjectContext};
    use std::path::PathBuf;

    fn test_ctx() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/workspace"),
            PathBuf::from("/workspace/.claude/worktrees/default-test"),
        )
    }

    #[test]
    fn l3_edit_blocks_env() {
        assert!(check_edit(&test_ctx(), "/foo/.env").is_some());
    }

    #[test]
    fn l3_edit_blocks_package_lock() {
        assert!(check_edit(&test_ctx(), "/workspace/package-lock.json").is_some());
    }

    #[test]
    fn edit_blocks_env_file() {
        assert!(check_edit(&test_ctx(), "/foo/.env").is_some());
    }

    #[test]
    fn edit_blocks_wasm_scheduler() {
        assert!(check_edit(&test_ctx(), "/workspace/src/wasm/scheduler/scheduler.js").is_some());
    }

    #[test]
    fn edit_allows_normal_file() {
        assert!(check_edit(&test_ctx(), "/home/user/project/src/App.tsx").is_none());
    }
}
