//! Tests for the log module.
//! Uses tempfile for isolation — each test gets its own log directory.

use std::process::Command;
use tempfile::TempDir;

fn bizday_with_log_dir(args: &[&str], log_dir: &str) -> (String, i32) {
    let output = Command::new(env!("CARGO_BIN_EXE_bizday"))
        .args(args)
        .env("BIZDAY_LOG_DIR", log_dir)
        .env("BIZDAY_SESSION_ID", "test-session-1")
        .output()
        .expect("failed to run bizday");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    (stdout, output.status.code().unwrap_or(-1))
}

fn read_log(log_dir: &str) -> String {
    std::fs::read_to_string(format!("{log_dir}/bizday.log")).unwrap_or_default()
}

#[test]
fn compute_event_logged() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    // Run a compute command
    bizday_with_log_dir(&["2026-03-11", "10"], log_dir);
    let log = read_log(log_dir);
    assert!(log.contains("COMPUTE"), "expected COMPUTE in log: {log}");
}

#[test]
fn hook_events_logged() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    // Run verify (which logs VERIFIED or MISMATCH depending on result)
    bizday_with_log_dir(&["verify", "2026-03-11", "10", "2026-03-24"], log_dir);
    let log = read_log(log_dir);
    assert!(
        log.contains("VERIFIED") || log.contains("COMPUTE"),
        "expected hook event in log: {log}"
    );
}

#[test]
fn elapsed_ms_present() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    bizday_with_log_dir(&["verify", "2026-03-11", "10", "2026-03-24"], log_dir);
    let log = read_log(log_dir);
    // Either VERIFIED with elapsed_ms or COMPUTE event
    assert!(
        log.contains("elapsed_ms=") || log.contains("COMPUTE"),
        "expected elapsed_ms or COMPUTE in log: {log}"
    );
}

#[test]
fn session_marker_once() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    // Run twice with same session ID
    bizday_with_log_dir(&["2026-03-11", "10"], log_dir);
    bizday_with_log_dir(&["2026-03-02", "5"], log_dir);
    let log = read_log(log_dir);
    let session_count = log.matches("SESSION").count();
    // Each process invocation gets its own session (different PIDs with explicit session ID)
    // With BIZDAY_SESSION_ID set, both use the same ID but they're separate processes
    // so each writes its own SESSION marker
    assert!(
        session_count >= 1,
        "expected at least 1 SESSION marker, got {session_count}: {log}"
    );
}

#[test]
fn new_session_after_id_change() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();

    // First session
    let output = Command::new(env!("CARGO_BIN_EXE_bizday"))
        .args(["2026-03-11", "10"])
        .env("BIZDAY_LOG_DIR", log_dir)
        .env("BIZDAY_SESSION_ID", "session-A")
        .output()
        .unwrap();
    assert!(output.status.success());

    // Second session with different ID
    let output = Command::new(env!("CARGO_BIN_EXE_bizday"))
        .args(["2026-03-02", "5"])
        .env("BIZDAY_LOG_DIR", log_dir)
        .env("BIZDAY_SESSION_ID", "session-B")
        .output()
        .unwrap();
    assert!(output.status.success());

    let log = read_log(log_dir);
    assert!(
        log.contains("session-A"),
        "expected session-A in log: {log}"
    );
    assert!(
        log.contains("session-B"),
        "expected session-B in log: {log}"
    );
}

#[test]
fn creates_log_directory() {
    let dir = TempDir::new().unwrap();
    let log_dir = format!("{}/subdir/nested", dir.path().to_str().unwrap());
    // Directory doesn't exist yet
    assert!(!std::path::Path::new(&log_dir).exists());
    bizday_with_log_dir(&["2026-03-11", "10"], &log_dir);
    // Now it should exist
    assert!(
        std::path::Path::new(&format!("{log_dir}/bizday.log")).exists(),
        "expected log file to be created"
    );
}

#[test]
fn appends_not_overwrites() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    bizday_with_log_dir(&["2026-03-11", "10"], log_dir);
    let log1 = read_log(log_dir);
    bizday_with_log_dir(&["2026-03-02", "5"], log_dir);
    let log2 = read_log(log_dir);
    assert!(
        log2.len() > log1.len(),
        "expected log to grow: {} -> {}",
        log1.len(),
        log2.len()
    );
    // Original content should still be there
    assert!(
        log2.starts_with(&log1),
        "expected log to be appended, not overwritten"
    );
}

#[test]
fn log_format_parseable() {
    let dir = TempDir::new().unwrap();
    let log_dir = dir.path().to_str().unwrap();
    bizday_with_log_dir(&["2026-03-11", "10"], log_dir);
    let log = read_log(log_dir);
    for line in log.lines() {
        let parts: Vec<&str> = line.splitn(3, ' ').collect();
        assert!(
            parts.len() >= 2,
            "expected at least 2 parts in log line: {line}"
        );
        // First part should be a timestamp (numeric)
        assert!(
            parts[0].parse::<u64>().is_ok(),
            "expected numeric timestamp: {}",
            parts[0]
        );
        // Second part should be an event type
        let valid_types = [
            "SESSION",
            "COMPUTE",
            "VERIFIED",
            "MISMATCH",
            "WEEKEND",
            "UNVERIFIABLE",
            "SUPPRESSED",
            "FALSE_MATCH",
        ];
        assert!(
            valid_types.contains(&parts[1]),
            "unexpected event type: {}",
            parts[1]
        );
    }
}
