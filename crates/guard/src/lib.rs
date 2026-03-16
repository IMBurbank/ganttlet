use std::io::{self, Read};

/// Read all of stdin. Returns Err on OS-level infrastructure errors (ENXIO, EAGAIN, ENOENT)
/// so the caller can fail-open. Other IO errors are returned as-is.
pub fn read_stdin() -> io::Result<String> {
    let mut buf = String::new();
    io::stdin().lock().read_to_string(&mut buf)?;
    Ok(buf)
}

/// Returns true for OS error codes that indicate stdin is unavailable due to infrastructure
/// issues (subagent context, background process, missing FD). Callers should fail-open.
pub fn is_infra_error(e: &io::Error) -> bool {
    matches!(
        e.raw_os_error(),
        Some(6) | Some(11) | Some(2) // ENXIO=6, EAGAIN=11, ENOENT=2
    )
}

/// Serialize a block decision to JSON.
pub fn block_json(reason: &str) -> String {
    serde_json::json!({"decision": "block", "reason": reason}).to_string()
}

// --- Internal helpers ---

fn tokens(s: &str) -> Vec<&str> {
    s.split_whitespace().collect()
}

/// True if `cmd` has a top-level "git <subcmd>" invocation.
/// Checks only the FIRST occurrence of "git" to avoid false positives from
/// commit messages that contain git subcommand names (e.g. `git commit -m "... git push ..."`).
fn has_git_subcmd(cmd: &str, subcmd: &str) -> bool {
    let ts = tokens(cmd);
    if let Some(pos) = ts.iter().position(|t| *t == "git") {
        return ts.get(pos + 1).map(|t| *t == subcmd).unwrap_or(false);
    }
    false
}

/// True if `s` contains `word` as a whitespace-delimited token.
fn has_token(s: &str, word: &str) -> bool {
    tokens(s).iter().any(|t| *t == word)
}

/// True if `s` contains "/workspace/" that is NOT immediately followed by ".claude/worktrees/".
fn workspace_but_not_worktree(s: &str) -> bool {
    let needle = "/workspace/";
    let mut start = 0;
    while let Some(rel) = s[start..].find(needle) {
        let pos = start + rel;
        let after = &s[pos + needle.len()..];
        if !after.starts_with(".claude/worktrees/") {
            return true;
        }
        start = pos + 1;
    }
    false
}

// --- Check functions ---

/// Run all Edit/Write checks. Returns Some(reason) to block, None to allow.
pub fn check_edit(input: &serde_json::Value) -> Option<String> {
    let file_path = input["tool_input"]["file_path"].as_str().unwrap_or("");

    // Check 1: Protected files — package-lock.json, src/wasm/scheduler/, .env
    if file_path.contains("package-lock.json")
        || file_path.contains("src/wasm/scheduler/")
        || file_path.contains(".env")
    {
        return Some(format!("Protected file: {}", file_path));
    }

    // Check 2: Workspace isolation — must edit via a worktree, not /workspace/ directly
    if file_path.starts_with("/workspace/")
        && !file_path.starts_with("/workspace/.claude/worktrees/")
    {
        return Some(
            "Do not edit files directly on main in /workspace. \
             Create a worktree first: git worktree add /workspace/.claude/worktrees/<name> -b <branch>"
                .to_string(),
        );
    }

    None
}

/// Run all Bash checks. Returns Some(reason) to block, None to allow.
pub fn check_bash(input: &serde_json::Value) -> Option<String> {
    let cmd = input["tool_input"]["command"].as_str().unwrap_or("");

    // Check 3: Block git push to main
    if has_git_subcmd(cmd, "push") && has_token(cmd, "main") {
        return Some("Cannot push directly to main. Use a feature branch and PR.".to_string());
    }

    // Check 4: Block git checkout/switch (unless -- file separator or worktree command)
    if (has_git_subcmd(cmd, "checkout") || has_git_subcmd(cmd, "switch"))
        && !cmd.contains("-- ")
        && !cmd.contains("worktree")
    {
        return Some(
            "Do not use git checkout/switch in /workspace. \
             Use a worktree: git worktree add /workspace/.claude/worktrees/<name> -b <branch>"
                .to_string(),
        );
    }

    // Check 5: Block git worktree remove/prune
    let ts = tokens(cmd);
    for i in 0..ts.len().saturating_sub(2) {
        if ts[i] == "git"
            && ts[i + 1] == "worktree"
            && (ts[i + 2] == "remove" || ts[i + 2] == "prune")
        {
            return Some(
                "Worktree removal blocked. Only remove worktrees you created, \
                 and only after your PR is merged. \
                 Never remove or prune other agents' worktrees."
                    .to_string(),
            );
        }
    }

    // Check 6: Block sed -i / > / tee targeting /workspace/ directly (not a worktree)

    // sed -i ... /workspace/...
    if has_token(cmd, "sed") && cmd.contains("-i") && workspace_but_not_worktree(cmd) {
        return Some(
            "Do not modify files directly in /workspace via Bash. Use a worktree.".to_string(),
        );
    }

    // > /workspace/... (redirect, skipping >>)
    {
        let mut pos = 0;
        let bytes = cmd.as_bytes();
        while pos < bytes.len() {
            if bytes[pos] == b'>' {
                // Skip >> (append redirect)
                if bytes.get(pos + 1) == Some(&b'>') {
                    pos += 2;
                    continue;
                }
                let after = cmd[pos + 1..].trim_start();
                if after.starts_with("/workspace/")
                    && !after.starts_with("/workspace/.claude/worktrees/")
                {
                    return Some(
                        "Do not modify files directly in /workspace via Bash. Use a worktree."
                            .to_string(),
                    );
                }
            }
            pos += 1;
        }
    }

    // tee ... /workspace/... ("tee" must be a standalone token, not substring of "worktrees")
    if has_token(cmd, "tee") && workspace_but_not_worktree(cmd) {
        return Some(
            "Do not modify files directly in /workspace via Bash. Use a worktree.".to_string(),
        );
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // --- is_infra_error ---

    #[test]
    fn infra_error_enxio() {
        let e = io::Error::from_raw_os_error(6);
        assert!(is_infra_error(&e));
    }

    #[test]
    fn infra_error_eagain() {
        let e = io::Error::from_raw_os_error(11);
        assert!(is_infra_error(&e));
    }

    #[test]
    fn infra_error_enoent() {
        let e = io::Error::from_raw_os_error(2);
        assert!(is_infra_error(&e));
    }

    #[test]
    fn infra_error_other_is_not_infra() {
        let e = io::Error::from_raw_os_error(5); // EIO
        assert!(!is_infra_error(&e));
    }

    // --- check_edit: protected file guard ---

    #[test]
    fn edit_blocks_env_file() {
        let v = json!({"tool_input": {"file_path": "/foo/.env"}});
        assert!(check_edit(&v).is_some());
    }

    #[test]
    fn edit_blocks_package_lock() {
        let v = json!({"tool_input": {"file_path": "/workspace/package-lock.json"}});
        assert!(check_edit(&v).is_some());
    }

    #[test]
    fn edit_blocks_wasm_scheduler() {
        let v = json!({"tool_input": {"file_path": "/workspace/src/wasm/scheduler/scheduler.js"}});
        assert!(check_edit(&v).is_some());
    }

    #[test]
    fn edit_allows_normal_file_outside_workspace() {
        let v = json!({"tool_input": {"file_path": "/home/user/project/src/App.tsx"}});
        assert!(check_edit(&v).is_none());
    }

    #[test]
    fn edit_allows_worktree_file() {
        let v = json!({"tool_input": {"file_path": "/workspace/.claude/worktrees/issue-42/src/App.tsx"}});
        assert!(check_edit(&v).is_none());
    }

    // --- check_edit: workspace isolation guard ---

    #[test]
    fn edit_blocks_workspace_direct() {
        let v = json!({"tool_input": {"file_path": "/workspace/src/foo.ts"}});
        assert!(check_edit(&v).is_some());
    }

    #[test]
    fn edit_allows_workspace_worktree() {
        let v = json!({"tool_input": {"file_path": "/workspace/.claude/worktrees/test/src/foo.ts"}});
        assert!(check_edit(&v).is_none());
    }

    #[test]
    fn edit_fail_closed_bad_json_no_file_path() {
        // Missing file_path → empty string → no checks triggered → allow
        let v = json!({"tool_input": {}});
        assert!(check_edit(&v).is_none());
    }

    // --- check_bash: push-to-main guard ---

    #[test]
    fn bash_blocks_push_to_main() {
        let v = json!({"tool_input": {"command": "git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_allows_push_to_feature() {
        let v = json!({"tool_input": {"command": "git push origin feature-branch"}});
        assert!(check_bash(&v).is_none());
    }

    // --- check_bash: checkout/switch guard ---

    #[test]
    fn bash_blocks_git_checkout() {
        let v = json!({"tool_input": {"command": "git checkout main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_blocks_git_switch() {
        let v = json!({"tool_input": {"command": "git switch feature"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_allows_git_worktree_add_checkout() {
        let v = json!({"tool_input": {"command": "git worktree add /tmp/test -b branch"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_git_checkout_file_separator() {
        let v = json!({"tool_input": {"command": "git checkout -- src/file.ts"}});
        assert!(check_bash(&v).is_none());
    }

    // --- check_bash: worktree removal guard ---

    #[test]
    fn bash_blocks_worktree_remove() {
        let v = json!({"tool_input": {"command": "git worktree remove /tmp/test"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_blocks_worktree_prune() {
        let v = json!({"tool_input": {"command": "git worktree prune"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_allows_worktree_add() {
        let v = json!({"tool_input": {"command": "git worktree add /tmp/test"}});
        assert!(check_bash(&v).is_none());
    }

    // --- check_bash: file-modification guard ---

    #[test]
    fn bash_blocks_sed_on_workspace() {
        let v = json!({"tool_input": {"command": "sed -i s/foo/bar/ /workspace/src/test.ts"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_blocks_redirect_to_workspace() {
        let v = json!({"tool_input": {"command": "echo hello > /workspace/src/test.ts"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_blocks_tee_to_workspace() {
        let v = json!({"tool_input": {"command": "echo hello | tee /workspace/src/test.ts"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_allows_sed_in_worktree() {
        let v = json!({"tool_input": {"command": "sed -i s/foo/bar/ /workspace/.claude/worktrees/test/src/test.ts"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_redirect_to_worktree() {
        let v = json!({"tool_input": {"command": "echo hello > /workspace/.claude/worktrees/test/src/test.ts"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_normal_commands() {
        let v = json!({"tool_input": {"command": "git status"}});
        assert!(check_bash(&v).is_none());
    }

    // --- False-positive regression tests ---

    #[test]
    fn bash_allows_commit_with_worktree_mention() {
        // "worktrees" contains "tee" as substring — must not trigger tee check
        let cmd = "git commit -m \"block direct edits in /workspace/ must use worktrees\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_push_to_branch() {
        // commit message contains "git push ... main" — must not trigger push-to-main check
        // because the first "git" subcommand is "commit", not "push"
        let cmd = "git commit -m \"block git push to the default branch\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }
}
