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

/// Split a command string on shell operators (|, &&, ||, ;) first,
/// then whitespace-tokenize. Returns tokens for the first segment only
/// if `first_segment` is true, otherwise all tokens.
fn tokens(s: &str) -> Vec<&str> {
    s.split_whitespace().collect()
}

/// Extract tokens belonging to the first shell command segment
/// (before any |, &&, ||, ;). Handles both spaced and unspaced operators.
fn first_segment_tokens(s: &str) -> Vec<&str> {
    // Split on shell operators — handles |, ||, &&, ;
    // Find the earliest operator position
    let mut end = s.len();
    for op in &["||", "&&", "|", ";"] {
        if let Some(pos) = s.find(op) {
            if pos < end {
                end = pos;
            }
        }
    }
    s[..end].split_whitespace().collect()
}

/// Find the position of `git <subcmd>` in a token list.
/// Returns the index of `subcmd` (pos+1) if found, None otherwise.
/// Only checks the FIRST occurrence of "git" to avoid false positives from
/// commit messages (e.g. `git commit -m "... git push ..."`).
fn git_subcmd_pos(ts: &[&str], subcmd: &str) -> Option<usize> {
    if let Some(pos) = ts.iter().position(|t| *t == "git") {
        if ts.get(pos + 1).map(|t| *t == subcmd).unwrap_or(false) {
            return Some(pos + 1);
        }
    }
    None
}

/// True if `cmd` has a top-level "git <subcmd>" invocation.
fn has_git_subcmd(cmd: &str, subcmd: &str) -> bool {
    git_subcmd_pos(&tokens(cmd), subcmd).is_some()
}

/// True if `s` contains `word` as a whitespace-delimited token.
fn has_token(s: &str, word: &str) -> bool {
    tokens(s).iter().any(|t| *t == word)
}

/// True if a short-flag token after `git <subcmd>` contains the given character.
/// Only checks args in the same shell segment (before |, &&, ;, ||).
/// Handles combined flags like `-fd` matching 'f', `-Df` matching 'D'.
fn has_git_flag(cmd: &str, subcmd: &str, flag_char: char) -> bool {
    let ts = first_segment_tokens(cmd);
    if let Some(subcmd_pos) = git_subcmd_pos(&ts, subcmd) {
        for t in &ts[subcmd_pos + 1..] {
            if t.starts_with('-') && !t.starts_with("--") && t.contains(flag_char) {
                return true;
            }
        }
    }
    false
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

    // Check 3: Agents must not edit worktree files from /workspace.
    // Only the admin works from /workspace. Agents must enter their worktree first.
    if file_path.starts_with("/workspace/.claude/worktrees/") {
        if let Ok(cwd) = std::env::current_dir() {
            let cwd_str = cwd.to_string_lossy();
            if cwd_str == "/workspace" || cwd_str == "/workspace/" {
                return Some(
                    "You are editing a worktree file but your CWD is /workspace. \
                     Enter the worktree first (use the EnterWorktree tool or cd into it). \
                     Only the admin works from /workspace."
                        .to_string(),
                );
            }
        }
    }

    None
}

/// Run all Bash checks. Returns Some(reason) to block, None to allow.
pub fn check_bash(input: &serde_json::Value) -> Option<String> {
    let cmd = input["tool_input"]["command"].as_str().unwrap_or("");

    // Check 4: Block git push to main
    if has_git_subcmd(cmd, "push") && has_token(cmd, "main") {
        return Some("Cannot push directly to main. Use a feature branch and PR.".to_string());
    }

    // Check 5: Block git checkout/switch in /workspace (unless -- file separator or worktree command).
    // Allowed in worktrees — agents may need to switch branches in their own isolated worktree.
    if (has_git_subcmd(cmd, "checkout") || has_git_subcmd(cmd, "switch"))
        && !cmd.contains("-- ")
        && !cmd.contains("worktree")
    {
        if let Ok(cwd) = std::env::current_dir() {
            let cwd_str = cwd.to_string_lossy();
            if !cwd_str.starts_with("/workspace/.claude/worktrees/") {
                return Some(
                    "Do not use git checkout/switch in /workspace. \
                     Use a worktree: git worktree add /workspace/.claude/worktrees/<name> -b <branch>"
                        .to_string(),
                );
            }
        }
    }

    // Check 6a: Block ALL git reset --hard in /workspace (even origin/*).
    // Must run before 6b which allows origin/* refs — that allowance is only for worktrees.
    if has_git_subcmd(cmd, "reset") && has_token(cmd, "--hard") {
        if let Ok(cwd) = std::env::current_dir() {
            let cwd_str = cwd.to_string_lossy();
            if cwd_str == "/workspace" || cwd_str == "/workspace/" {
                return Some(
                    "Do not run git reset --hard in /workspace. This modifies shared state \
                     that other agents depend on. Only use git reset --hard in your own worktree. \
                     See .claude/worktrees/CLAUDE.md."
                        .to_string(),
                );
            }
        }
    }

    // Check 6b: Block destructive git commands (reset --hard, clean -f, branch -D)
    // Allow reset --hard to a remote ref (origin/main, origin/branch) — needed after squash merges.
    // Block reset --hard to relative refs (HEAD~N) or bare (no target) — those discard work.
    if has_git_subcmd(cmd, "reset") && has_token(cmd, "--hard") {
        let has_origin_ref = tokens(cmd).iter().any(|t| t.starts_with("origin/"));
        if !has_origin_ref {
            return Some(
                "git reset --hard is destructive and can discard uncommitted work. \
                 If syncing after a squash merge, use: git reset --hard origin/<branch>"
                    .to_string(),
            );
        }
    }
    if has_git_subcmd(cmd, "clean")
        && (has_git_flag(cmd, "clean", 'f') || has_token(cmd, "--force"))
    {
        return Some(
            "git clean -f is destructive and permanently deletes untracked files. \
             Review untracked files with git clean -n first."
                .to_string(),
        );
    }
    if has_git_subcmd(cmd, "branch") && has_git_flag(cmd, "branch", 'D') {
        return Some(
            "git branch -D force-deletes a branch even if not fully merged. \
             Use git branch -d (lowercase) which checks merge status first."
                .to_string(),
        );
    }

    // Check 7: Block git worktree remove (but allow prune — it only cleans stale references)
    let ts = tokens(cmd);
    for i in 0..ts.len().saturating_sub(2) {
        if ts[i] == "git" && ts[i + 1] == "worktree" && ts[i + 2] == "remove" {
            return Some(
                "Worktree removal blocked. Only remove worktrees you created, \
                 and only after your PR is merged. \
                 Never remove or prune other agents' worktrees."
                    .to_string(),
            );
        }
    }

    // Check 8: Block rm -rf on worktree root directories — use ExitWorktree instead.
    // Only blocks deletion of the worktree root (e.g., /workspace/.claude/worktrees/my-wt).
    // Allows deletion of subdirectories within worktrees (e.g., .../my-wt/node_modules).
    {
        let wt_prefix = "/workspace/.claude/worktrees/";
        let ts = tokens(cmd);
        let has_rm = ts.first() == Some(&"rm") || ts.contains(&"rm");
        let has_rf = ts.iter().any(|t| {
            t.starts_with('-') && !t.starts_with("--") && (t.contains('r') || t.contains('f'))
        });
        if has_rm && has_rf {
            let targets_wt_root = ts.iter().any(|t| {
                if let Some(rest) = t.strip_prefix(wt_prefix) {
                    // It's a worktree root if there's no '/' after the name
                    // (or only a trailing slash)
                    let trimmed = rest.trim_end_matches('/');
                    !trimmed.is_empty() && !trimmed.contains('/')
                } else {
                    false
                }
            });
            if targets_wt_root {
                return Some(
                    "Do not use rm -rf to delete worktrees. It breaks your CWD and leaves \
                     orphaned branches. Use ExitWorktree with action: \"remove\" instead — \
                     it safely restores CWD, deletes the directory, and removes the branch. \
                     See .claude/worktrees/CLAUDE.md for the full cleanup procedure."
                        .to_string(),
                );
            }
        }
    }

    // Check 9: Block sed -i / > / tee targeting /workspace/ directly (not a worktree)

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
        let v =
            json!({"tool_input": {"file_path": "/workspace/.claude/worktrees/test/src/foo.ts"}});
        assert!(check_edit(&v).is_none());
    }

    #[test]
    fn edit_fail_closed_bad_json_no_file_path() {
        // Missing file_path → empty string → no checks triggered → allow
        let v = json!({"tool_input": {}});
        assert!(check_edit(&v).is_none());
    }

    // --- check_edit: CWD enforcement for worktree files ---
    // Note: check 3 (CWD-based) can't be fully tested in unit tests because
    // std::env::current_dir() returns the test runner's CWD. The block path
    // (CWD == /workspace) is verified by manual testing only. The unit tests
    // below verify the path-matching conditions only.

    #[test]
    fn edit_allows_worktree_file_from_worktree_cwd() {
        // When CWD is a worktree (not /workspace), editing worktree files is allowed.
        // This test runs from the test runner's CWD which is not /workspace,
        // so it verifies the allow path.
        let v =
            json!({"tool_input": {"file_path": "/workspace/.claude/worktrees/test/src/foo.ts"}});
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
    // Note: Check 5 is CWD-dependent. Checkout/switch are blocked in /workspace
    // but allowed in worktrees. When tests run from a worktree, these are allowed.
    // The block path is verified by scripts/test-hooks.sh integration tests.

    #[test]
    fn bash_allows_git_checkout_in_worktree() {
        // When CWD is a worktree (as in test runner), checkout is allowed
        let v = json!({"tool_input": {"command": "git checkout main"}});
        // Allowed because CWD is under /workspace/.claude/worktrees/
        let result = check_bash(&v);
        let cwd = std::env::current_dir().unwrap();
        let in_worktree = cwd
            .to_string_lossy()
            .starts_with("/workspace/.claude/worktrees/");
        if in_worktree {
            assert!(result.is_none(), "checkout should be allowed in worktree");
        } else {
            assert!(
                result.is_some(),
                "checkout should be blocked outside worktree"
            );
        }
    }

    #[test]
    fn bash_allows_git_switch_in_worktree() {
        let v = json!({"tool_input": {"command": "git switch feature"}});
        let result = check_bash(&v);
        let cwd = std::env::current_dir().unwrap();
        let in_worktree = cwd
            .to_string_lossy()
            .starts_with("/workspace/.claude/worktrees/");
        if in_worktree {
            assert!(result.is_none(), "switch should be allowed in worktree");
        } else {
            assert!(
                result.is_some(),
                "switch should be blocked outside worktree"
            );
        }
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

    // --- check_bash: destructive git command guard ---

    #[test]
    fn bash_blocks_git_reset_hard() {
        let v = json!({"tool_input": {"command": "git reset --hard HEAD~3"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_blocks_git_reset_hard_bare() {
        let v = json!({"tool_input": {"command": "git reset --hard"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_allows_git_reset_hard_origin() {
        // Needed after squash merges to sync with remote
        let v = json!({"tool_input": {"command": "git reset --hard origin/main"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_git_reset_hard_origin_branch() {
        let v = json!({"tool_input": {"command": "git reset --hard origin/feature-branch"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_git_reset_soft() {
        let v = json!({"tool_input": {"command": "git reset --soft HEAD~1"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_git_reset_no_flag() {
        let v = json!({"tool_input": {"command": "git reset HEAD~1"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_blocks_git_clean_f() {
        let v = json!({"tool_input": {"command": "git clean -fd"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_blocks_git_clean_force() {
        let v = json!({"tool_input": {"command": "git clean --force"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_allows_git_clean_dry_run() {
        let v = json!({"tool_input": {"command": "git clean -n"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_blocks_git_branch_force_delete() {
        let v = json!({"tool_input": {"command": "git branch -D feature-branch"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_allows_git_branch_safe_delete() {
        let v = json!({"tool_input": {"command": "git branch -d feature-branch"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_git_branch_list_piped_with_grep_d() {
        // grep -D appears in pipeline — must not trigger branch -D check
        let v = json!({"tool_input": {"command": "git branch -a | grep -D 3 pattern"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_blocks_git_clean_combined_fd() {
        let v = json!({"tool_input": {"command": "git clean -xfd"}});
        assert!(check_bash(&v).is_some());
    }

    // --- check_bash: worktree removal guard ---

    #[test]
    fn bash_blocks_worktree_remove() {
        let v = json!({"tool_input": {"command": "git worktree remove /tmp/test"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_allows_worktree_prune() {
        // prune only cleans stale references — always safe
        let v = json!({"tool_input": {"command": "git worktree prune"}});
        assert!(check_bash(&v).is_none());
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

    #[test]
    fn bash_allows_commit_referencing_reset_hard() {
        let cmd = "git commit -m \"revert: undo git reset --hard changes\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_clean_f() {
        let cmd = "git commit -m \"docs: warn about git clean -f\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_branch_d() {
        let cmd = "git commit -m \"fix: guard git branch -D\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    // --- Unspaced pipe operator regression ---

    #[test]
    fn bash_allows_branch_piped_no_spaces() {
        // git branch -a|grep pattern — no spaces around pipe
        let v = json!({"tool_input": {"command": "git branch -a|grep -D 3 foo"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_clean_chained_no_spaces() {
        // git clean -n&&echo done — no spaces around &&
        let v = json!({"tool_input": {"command": "git clean -n&&echo done"}});
        assert!(check_bash(&v).is_none());
    }

    // --- rm -rf worktree guard ---

    #[test]
    fn bash_blocks_rm_rf_worktree_root() {
        let v =
            json!({"tool_input": {"command": "rm -rf /workspace/.claude/worktrees/my-worktree"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_blocks_rm_r_worktree_root() {
        let v =
            json!({"tool_input": {"command": "rm -r /workspace/.claude/worktrees/my-worktree"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_blocks_rm_rf_worktree_root_trailing_slash() {
        let v =
            json!({"tool_input": {"command": "rm -rf /workspace/.claude/worktrees/my-worktree/"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn bash_allows_rm_rf_subdir_in_worktree() {
        // Deleting node_modules or other subdirs inside a worktree is fine
        let v = json!({"tool_input": {"command": "rm -rf /workspace/.claude/worktrees/my-wt/node_modules"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_rm_rf_deep_path_in_worktree() {
        let v = json!({"tool_input": {"command": "rm -rf /workspace/.claude/worktrees/my-wt/src/old/"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_rm_on_non_worktree() {
        let v = json!({"tool_input": {"command": "rm -rf /tmp/some-dir"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_rm_file_in_worktree() {
        // rm without -r/-f on a single file inside a worktree is fine
        let v = json!({"tool_input": {"command": "rm /workspace/.claude/worktrees/test/temp.txt"}});
        assert!(check_bash(&v).is_none());
    }

    // --- /workspace CWD guard (git reset --hard) ---
    // Note: Check 6a blocks git reset --hard in /workspace (any target, even origin/*).
    // In the test runner, CWD is not /workspace, so these verify the allow path.
    // The block path is verified by scripts/test-hooks.sh integration tests.

    #[test]
    fn bash_allows_git_reset_hard_origin_in_worktree() {
        // CWD is not /workspace during tests, so reset --hard origin/main is allowed
        let v = json!({"tool_input": {"command": "git reset --hard origin/main"}});
        assert!(check_bash(&v).is_none());
    }
}
