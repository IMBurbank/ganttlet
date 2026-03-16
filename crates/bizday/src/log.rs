//! Unified logging for bizday operations.
//!
//! Logs to `.claude/logs/bizday.log` (or `$BIZDAY_LOG_DIR/bizday.log`).
//! All functions append to the log file — never overwrite.
//!
//! Many functions here are public API for use by the PostToolUse hook (Group A scope).
#![allow(dead_code)]

use std::fs;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static SESSION_INITIALIZED: AtomicBool = AtomicBool::new(false);

/// Get the log file path from env or default.
pub fn log_path() -> String {
    let dir = std::env::var("BIZDAY_LOG_DIR").unwrap_or_else(|_| ".claude/logs".to_string());
    format!("{dir}/bizday.log")
}

/// Get a timestamp string for log entries.
fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

/// Get the current session ID (from env or generate one).
fn session_id() -> String {
    std::env::var("BIZDAY_SESSION_ID").unwrap_or_else(|_| {
        // Use PID as a simple session identifier
        std::process::id().to_string()
    })
}

/// Append a line to the log file. Creates the directory and file if needed.
fn append_log(line: &str) {
    let path = log_path();
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", line);
    }
}

/// Write a SESSION marker on first call. Subsequent calls are no-ops.
pub fn init_session() {
    if SESSION_INITIALIZED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        let ts = timestamp();
        let sid = session_id();
        append_log(&format!("{ts} SESSION {sid}"));
    }
}

/// Log a COMPUTE event.
pub fn log_compute(cmd: &str, args: &str, result: &str) {
    init_session();
    let ts = timestamp();
    append_log(&format!("{ts} COMPUTE {cmd} {args} -> {result}"));
}

/// Log a VERIFIED event with elapsed time.
pub fn log_verified(details: &str, elapsed_ms: u64) {
    init_session();
    let ts = timestamp();
    append_log(&format!("{ts} VERIFIED {details} elapsed_ms={elapsed_ms}"));
}

/// Log a MISMATCH event with elapsed time.
pub fn log_mismatch(details: &str, elapsed_ms: u64) {
    init_session();
    let ts = timestamp();
    append_log(&format!("{ts} MISMATCH {details} elapsed_ms={elapsed_ms}"));
}

/// Log a WEEKEND event with elapsed time.
pub fn log_weekend(date: &str, context: &str, elapsed_ms: u64) {
    init_session();
    let ts = timestamp();
    append_log(&format!(
        "{ts} WEEKEND {date} context={context} elapsed_ms={elapsed_ms}"
    ));
}

/// Log an UNVERIFIABLE event with elapsed time.
pub fn log_unverifiable(date: &str, context: &str, elapsed_ms: u64) {
    init_session();
    let ts = timestamp();
    append_log(&format!(
        "{ts} UNVERIFIABLE {date} context={context} elapsed_ms={elapsed_ms}"
    ));
}

/// Log a SUPPRESSED event with elapsed time.
pub fn log_suppressed(date: &str, context: &str, elapsed_ms: u64) {
    init_session();
    let ts = timestamp();
    append_log(&format!(
        "{ts} SUPPRESSED {date} context={context} elapsed_ms={elapsed_ms}"
    ));
}

/// Log a FALSE_MATCH event.
pub fn record_false_match(file_line: &str) {
    init_session();
    let ts = timestamp();
    append_log(&format!("{ts} FALSE_MATCH {file_line}"));
}

/// Reset session state (for testing).
pub fn reset_session() {
    SESSION_INITIALIZED.store(false, Ordering::SeqCst);
}
