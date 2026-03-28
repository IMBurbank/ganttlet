//! Lightweight debug logging via FENCEPOST_LOG=debug.
//!
//! Writes to stderr so it doesn't interfere with the hook protocol (stdout).
//! No external dependencies — just checks an env var and writes formatted output.

use std::sync::OnceLock;

static DEBUG_ENABLED: OnceLock<bool> = OnceLock::new();

/// Check if debug logging is enabled (FENCEPOST_LOG=debug).
/// Cached after first check — no repeated env var lookups.
pub fn is_debug() -> bool {
    *DEBUG_ENABLED.get_or_init(|| {
        std::env::var("FENCEPOST_LOG")
            .map(|v| v == "debug")
            .unwrap_or(false)
    })
}

/// Log a debug message to stderr if FENCEPOST_LOG=debug.
#[macro_export]
macro_rules! log_debug {
    ($($arg:tt)*) => {
        if $crate::log::is_debug() {
            eprintln!("[fencepost] {}", format!($($arg)*));
        }
    };
}
