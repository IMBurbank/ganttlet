//! Tests for the report module.

use std::io::Write;
use std::process::Command;
use tempfile::TempDir;

fn bizday_with_log_dir(args: &[&str], log_dir: &str, session_id: &str) -> (String, i32) {
    let output = Command::new(env!("CARGO_BIN_EXE_bizday"))
        .args(args)
        .env("BIZDAY_LOG_DIR", log_dir)
        .env("BIZDAY_SESSION_ID", session_id)
        .output()
        .expect("failed to run bizday");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    (stdout, output.status.code().unwrap_or(-1))
}

fn setup_log_with_events(log_dir: &str) {
    // Generate some events by running bizday commands
    bizday_with_log_dir(&["2026-03-11", "10"], log_dir, "session-1");
    bizday_with_log_dir(
        &["verify", "2026-03-11", "10", "2026-03-24"],
        log_dir,
        "session-1",
    );
    bizday_with_log_dir(&["2026-03-02", "5"], log_dir, "session-2");
    // Intentional mismatch (will exit 1 but still logs)
    let _ = bizday_with_log_dir(
        &["verify", "2026-03-11", "10", "2026-03-25"],
        log_dir,
        "session-2",
    );
}

#[test]
fn empty_log() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    let (out, _) = bizday_with_log_dir(&["report"], log_dir, "test");
    assert!(
        out.contains("0 sessions"),
        "expected '0 sessions' for empty log: {out}"
    );
}

#[test]
fn known_session() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    setup_log_with_events(log_dir);

    let (out, _) = bizday_with_log_dir(
        &["report", "--session", "session-1"],
        log_dir,
        "report-runner",
    );
    // Should show stats for session-1 only
    assert!(
        out.contains("sessions") || out.contains("events"),
        "expected report output: {out}"
    );
}

#[test]
fn trend_mode() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    setup_log_with_events(log_dir);

    let (out, _) = bizday_with_log_dir(&["report", "--trend"], log_dir, "report-runner");
    assert!(
        out.contains("Session") && out.contains("Compute"),
        "expected trend table headers: {out}"
    );
    assert!(out.contains("TOTAL"), "expected TOTAL row: {out}");
}

#[test]
fn pr_summary_markdown() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    setup_log_with_events(log_dir);

    let (out, _) = bizday_with_log_dir(&["report", "--pr-summary"], log_dir, "report-runner");
    assert!(
        out.contains("| Metric | Value |"),
        "expected markdown table: {out}"
    );
    assert!(out.contains("Sessions"), "expected Sessions row: {out}");
}

#[test]
fn mismatches_drilldown() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    setup_log_with_events(log_dir);

    let (out, _) = bizday_with_log_dir(&["report", "--mismatches"], log_dir, "report-runner");
    // We generated a mismatch in setup
    assert!(
        out.contains("MISMATCH") || out.contains("mismatch"),
        "expected mismatch info: {out}"
    );
}

#[test]
fn false_match_rate() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    setup_log_with_events(log_dir);

    // Record a false match
    bizday_with_log_dir(&["false-match", "test.rs:42"], log_dir, "session-2");

    let (out, _) = bizday_with_log_dir(&["report", "--false-matches"], log_dir, "report-runner");
    assert!(
        out.contains("test.rs:42") || out.contains("false match"),
        "expected false match info: {out}"
    );
}

#[test]
fn latency_percentile() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();

    // Write a log entry with high elapsed_ms directly
    let log_path = format!("{log_dir}/bizday.log");
    std::fs::create_dir_all(log_dir).unwrap();
    let mut f = std::fs::File::create(&log_path).unwrap();
    writeln!(f, "1000 SESSION test-slow").unwrap();
    writeln!(f, "1001 VERIFIED some-check elapsed_ms=50").unwrap();
    writeln!(f, "1002 VERIFIED fast-check elapsed_ms=2").unwrap();

    let (out, _) = bizday_with_log_dir(&["report", "--slow"], log_dir, "report-runner");
    assert!(out.contains("50"), "expected slow event with 50ms: {out}");
}
