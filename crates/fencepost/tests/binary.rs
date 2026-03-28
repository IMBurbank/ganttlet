//! End-to-end tests that spawn the fencepost binary as a subprocess.
//! These test the actual compiled binary, including main.rs, stdin
//! reading, JSON parsing, and stdout output format.
//!
//! These tests require the binary to be built first:
//!   cargo build -p fencepost
//!
//! They use the debug binary from target/debug/ (built by cargo test).

use std::io::Write;
use std::process::{Command, Stdio};

/// Path to the fencepost binary built by cargo.
fn binary_path() -> std::path::PathBuf {
    // cargo test builds binaries in target/debug/
    let mut path = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    path.push("fencepost");
    path
}

fn run_fencepost(mode: &str, json: &str) -> (String, String, i32) {
    let mut child = Command::new(binary_path())
        .arg(mode)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to spawn fencepost binary");

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(json.as_bytes()).ok();
    }

    let output = child
        .wait_with_output()
        .expect("Failed to wait on fencepost");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);
    (stdout, stderr, code)
}

fn run_fencepost_no_stdin(args: &[&str]) -> (String, String, i32) {
    let output = Command::new(binary_path())
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("Failed to run fencepost");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);
    (stdout, stderr, code)
}

// --- Hook mode E2E tests ---

#[test]
fn e2e_bash_blocks_push_to_main() {
    let (stdout, _, code) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"git push origin main"}}"#,
    );
    assert_eq!(code, 0);
    assert!(
        stdout.contains("\"decision\":\"block\""),
        "stdout: {}",
        stdout
    );
    assert!(
        stdout.contains("git push targeting main"),
        "stdout: {}",
        stdout
    );
}

#[test]
fn e2e_bash_allows_push_to_feature() {
    let (stdout, _, code) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"git push origin feature-branch"}}"#,
    );
    assert_eq!(code, 0);
    assert!(
        stdout.is_empty(),
        "Expected no output (allow), got: {}",
        stdout
    );
}

#[test]
fn e2e_edit_blocks_env_file() {
    let (stdout, _, code) = run_fencepost(
        "edit",
        r#"{"tool_input":{"file_path":"/any/project/.env"}}"#,
    );
    assert_eq!(code, 0);
    assert!(
        stdout.contains("\"decision\":\"block\""),
        "stdout: {}",
        stdout
    );
    assert!(stdout.contains("Environment files"), "stdout: {}", stdout);
}

#[test]
fn e2e_edit_allows_normal_file() {
    let (stdout, _, code) =
        run_fencepost("edit", r#"{"tool_input":{"file_path":"/tmp/scratch.txt"}}"#);
    assert_eq!(code, 0);
    assert!(stdout.is_empty(), "Expected allow, got: {}", stdout);
}

#[test]
fn e2e_malformed_json_blocks() {
    let (stdout, _, code) = run_fencepost("bash", "not json at all");
    assert_eq!(code, 0);
    assert!(
        stdout.contains("\"decision\":\"block\""),
        "stdout: {}",
        stdout
    );
    assert!(stdout.contains("Hook error"), "stdout: {}", stdout);
}

#[test]
fn e2e_empty_command_allows() {
    let (stdout, _, code) = run_fencepost("bash", r#"{"tool_input":{"command":""}}"#);
    assert_eq!(code, 0);
    assert!(stdout.is_empty(), "Expected allow, got: {}", stdout);
}

#[test]
fn e2e_unknown_mode_allows() {
    let (stdout, _, code) = run_fencepost("unknown", r#"{"tool_input":{"command":"anything"}}"#);
    assert_eq!(code, 0);
    assert!(
        stdout.is_empty(),
        "Expected allow for unknown mode, got: {}",
        stdout
    );
}

// --- CLI command E2E tests ---

#[test]
fn e2e_version_prints_version() {
    let (stdout, _, code) = run_fencepost_no_stdin(&["--version"]);
    assert_eq!(code, 0);
    assert!(stdout.starts_with("fencepost "), "stdout: {}", stdout);
    assert!(stdout.contains("0.1.0"), "stdout: {}", stdout);
}

#[test]
fn e2e_help_prints_usage() {
    let (_, stderr, code) = run_fencepost_no_stdin(&["--help"]);
    assert_eq!(code, 0);
    assert!(stderr.contains("USAGE"), "stderr: {}", stderr);
    assert!(stderr.contains("fencepost"), "stderr: {}", stderr);
}

#[test]
fn e2e_no_args_prints_help() {
    let (_, stderr, code) = run_fencepost_no_stdin(&[]);
    assert_eq!(code, 0);
    assert!(stderr.contains("USAGE"), "stderr: {}", stderr);
}

#[test]
fn e2e_list_rules_shows_all() {
    let (stdout, _, code) = run_fencepost_no_stdin(&["list-rules"]);
    assert_eq!(code, 0);
    assert!(
        stdout.contains("push-to-default-branch"),
        "stdout: {}",
        stdout
    );
    assert!(stdout.contains("checkout-switch"), "stdout: {}", stdout);
    assert!(stdout.contains("Bash rules (10)"), "stdout: {}", stdout);
    assert!(stdout.contains("Edit rules (3)"), "stdout: {}", stdout);
}

#[test]
fn e2e_doctor_runs() {
    let (stdout, _, code) = run_fencepost_no_stdin(&["doctor"]);
    // Doctor may exit 0 or 1 depending on hooks registration
    assert!(code == 0 || code == 1);
    assert!(stdout.contains("fencepost binary"), "stdout: {}", stdout);
    assert!(stdout.contains("project root"), "stdout: {}", stdout);
    assert!(stdout.contains("rules:"), "stdout: {}", stdout);
}

// --- Chained command E2E (tests tokenizer + segments end-to-end) ---

#[test]
fn e2e_chained_command_blocks() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"echo hi && git push origin main"}}"#,
    );
    assert!(
        stdout.contains("\"decision\":\"block\""),
        "Chained push should block"
    );
}

#[test]
fn e2e_bash_c_blocks() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"bash -c \"git push origin main\""}}"#,
    );
    assert!(
        stdout.contains("\"decision\":\"block\""),
        "bash -c push should block"
    );
}

#[test]
fn e2e_heredoc_allows() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"cat << EOF\ngit push origin main\nEOF"}}"#,
    );
    assert!(
        stdout.is_empty(),
        "Heredoc body should not trigger block, got: {}",
        stdout
    );
}

#[test]
fn e2e_quoted_allows() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"echo \"git push origin main\""}}"#,
    );
    assert!(
        stdout.is_empty(),
        "Quoted string should not trigger block, got: {}",
        stdout
    );
}

// ===================================================================
// Message quality journey tests
// ===================================================================
// These verify that block messages are specific to the agent's scenario
// and contain everything they need to self-correct. This is a first-class
// design concern — every message must follow the pattern:
//   1. What you tried (the specific command/file)
//   2. Why it's blocked (the rule and reason)
//   3. What to do instead (the exact corrected command)

fn parse_reason(stdout: &str) -> String {
    serde_json::from_str::<serde_json::Value>(stdout)
        .map(|v| v["reason"].as_str().unwrap_or("").to_string())
        .unwrap_or_default()
}

#[test]
fn msg_push_names_branch_and_suggests_alternative() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"git push origin main"}}"#,
    );
    let reason = parse_reason(&stdout);
    assert!(reason.contains("main"), "Should name the branch: {reason}");
    assert!(
        reason.contains("feature branch"),
        "Should suggest alternative: {reason}"
    );
}

#[test]
fn msg_edit_workspace_shows_file_and_corrected_worktree_path() {
    let (stdout, _, _) = run_fencepost(
        "edit",
        r#"{"tool_input":{"file_path":"/workspace/src/App.tsx"}}"#,
    );
    let reason = parse_reason(&stdout);
    assert!(
        reason.contains("/workspace/src/App.tsx"),
        "Should name the exact file: {reason}"
    );
    assert!(
        reason.contains("git worktree add"),
        "Should show worktree creation command: {reason}"
    );
    assert!(
        reason.contains("src/App.tsx"),
        "Should show the relative path to edit in worktree: {reason}"
    );
}

#[test]
fn msg_protected_file_names_file_and_explains_why() {
    let (stdout, _, _) = run_fencepost(
        "edit",
        r#"{"tool_input":{"file_path":"/workspace/.env.production"}}"#,
    );
    let reason = parse_reason(&stdout);
    assert!(
        reason.contains(".env.production"),
        "Should name the exact file: {reason}"
    );
    assert!(
        reason.contains("secrets"),
        "Should explain why it's protected: {reason}"
    );
}

#[test]
fn msg_lock_file_explains_how_to_regenerate() {
    let (stdout, _, _) = run_fencepost(
        "edit",
        r#"{"tool_input":{"file_path":"/workspace/.claude/worktrees/wt/Cargo.lock"}}"#,
    );
    let reason = parse_reason(&stdout);
    assert!(
        reason.contains("Cargo.lock"),
        "Should name the file: {reason}"
    );
    assert!(
        reason.contains("auto-generated") || reason.contains("install"),
        "Should explain how to regenerate: {reason}"
    );
}

#[test]
fn msg_redirect_shows_exact_operator_and_target() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"echo hello > /workspace/output.txt"}}"#,
    );
    let reason = parse_reason(&stdout);
    assert!(
        reason.contains("> /workspace/output.txt"),
        "Should show the exact redirect and target: {reason}"
    );
    assert!(
        reason.contains("worktree"),
        "Should suggest worktree: {reason}"
    );
}

#[test]
fn msg_sed_names_operation_and_suggests_worktree() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"sed -i s/x/y/ /workspace/src/file.ts"}}"#,
    );
    let reason = parse_reason(&stdout);
    assert!(
        reason.contains("sed"),
        "Should mention the command: {reason}"
    );
    assert!(
        reason.contains("worktree"),
        "Should suggest worktree: {reason}"
    );
}

#[test]
fn msg_rm_worktree_names_target_and_shows_safe_alternative() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"rm -rf /workspace/.claude/worktrees/my-wt"}}"#,
    );
    let reason = parse_reason(&stdout);
    assert!(
        reason.contains("my-wt") || reason.contains("/workspace/.claude/worktrees/my-wt"),
        "Should name the target path: {reason}"
    );
    assert!(
        reason.contains("ExitWorktree"),
        "Should suggest the safe cleanup tool: {reason}"
    );
}

#[test]
fn msg_reset_hard_shows_corrected_command() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"git reset --hard HEAD~3"}}"#,
    );
    let reason = parse_reason(&stdout);
    assert!(
        reason.contains("origin/"),
        "Should show the corrected command with origin/ ref: {reason}"
    );
}

#[test]
fn msg_worktree_remove_shows_acknowledgment_flow() {
    let (stdout, _, _) = run_fencepost(
        "bash",
        r#"{"tool_input":{"command":"git worktree remove /workspace/.claude/worktrees/other"}}"#,
    );
    let reason = parse_reason(&stdout);
    assert!(
        reason.contains("I_CREATED_THIS=1"),
        "Should show the acknowledgment command: {reason}"
    );
    assert!(
        reason.contains("YOU created it"),
        "Should list ownership criteria: {reason}"
    );
}
