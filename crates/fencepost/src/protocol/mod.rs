//! Agent framework protocol adapters.
//!
//! The fencepost library (check_bash, check_edit) is framework-agnostic.
//! This module provides adapters for specific agent framework hook protocols.
//!
//! ## Supported protocols
//!
//! - `claude` — Claude Code PreToolUse hooks (stdin JSON → stdout JSON)
//!
//! ## Adding a new protocol
//!
//! 1. Create a new module (e.g., `gemini.rs`) implementing `ProtocolAdapter`
//! 2. Add it to `get_adapter()` and `supported_protocols()` in this module
//! 3. Submit a PR — all adapters ship in the single fencepost binary
//!
//! ## Selecting a protocol
//!
//! Set `FENCEPOST_PROTOCOL=<name>` (default: `claude`).
//! Or in the hook command: `FENCEPOST_PROTOCOL=gemini fencepost edit`

pub mod claude;

use std::io::{self, Read};

use crate::context::ProjectContext;

/// Common interface for agent framework protocol adapters.
///
/// Each adapter translates between its framework's hook format and
/// fencepost's framework-agnostic check functions.
///
/// ## Implementing a new adapter
///
/// 1. Create a module (e.g., `gemini.rs`) with a struct implementing this trait
/// 2. Implement ALL methods — the compiler enforces this
/// 3. `sample_edit_input` and `sample_bash_input` provide test data —
///    the meta-test in tests/cli.rs uses these to verify the adapter works
/// 4. Add to `get_adapter()` and `supported_protocols()` below
pub trait ProtocolAdapter {
    /// Human-readable name of this protocol (e.g., "claude", "gemini").
    fn name(&self) -> &'static str;

    /// Parse raw stdin data into a structured request.
    /// Returns Err with a reason string if input is malformed (fail-closed).
    fn parse_request(&self, mode: &str, stdin_data: &str) -> Result<CheckRequest, String>;

    /// Format a block decision for this framework's expected output.
    fn format_block(&self, reason: &str) -> String;

    /// Format an error (e.g., malformed input) for this framework.
    fn format_error(&self, error: &str) -> String;

    /// A sample valid edit input for testing this adapter.
    /// Must parse successfully with mode "edit" and extract a non-empty file_path.
    fn sample_edit_input(&self) -> &'static str;

    /// A sample valid bash input for testing this adapter.
    /// Must parse successfully with mode "bash" and extract a non-empty command.
    fn sample_bash_input(&self) -> &'static str;
}

/// A parsed check request — the framework-agnostic operation to check.
pub enum CheckRequest {
    /// Check a file edit/write operation.
    Edit { file_path: String },
    /// Check a bash command.
    Bash { command: String },
    /// Unknown mode — fail-open.
    Unknown,
}

/// Run a hook check using the given protocol adapter.
/// This is the main entry point called by main.rs after selecting an adapter.
pub fn run_hook(adapter: &dyn ProtocolAdapter, ctx: &ProjectContext, mode: &str, stdin_data: &str) {
    let request = match adapter.parse_request(mode, stdin_data) {
        Ok(req) => req,
        Err(reason) => {
            // Malformed input — output error in the adapter's format
            println!("{}", adapter.format_error(&reason));
            return;
        }
    };

    let result = match request {
        CheckRequest::Edit { ref file_path } => crate::check_edit(ctx, file_path),
        CheckRequest::Bash { ref command } => crate::check_bash(ctx, command),
        CheckRequest::Unknown => None,
    };

    if let Some(reason) = result {
        println!("{}", adapter.format_block(&reason));
    }
}

/// Read all of stdin. Returns Err on OS-level infrastructure errors (ENXIO, EAGAIN, ENOENT)
/// so the caller can fail-open. Other IO errors are returned as-is.
/// Shared across all protocol adapters that use stdin.
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

/// Get the protocol adapter for the given name.
/// Returns None for unknown protocols.
pub fn get_adapter(name: &str) -> Option<Box<dyn ProtocolAdapter>> {
    match name {
        "claude" => Some(Box::new(claude::ClaudeAdapter)),
        // To add a new protocol:
        // 1. Create protocol/<name>.rs implementing ProtocolAdapter
        // 2. Add: "<name>" => Some(Box::new(<name>::<Name>Adapter)),
        // 3. Add "<name>" to supported_protocols() below
        // 4. The meta_all_protocols_pass_smoke_test in tests/cli.rs will
        //    automatically test your adapter using sample_*_input()
        _ => None,
    }
}

/// List all supported protocol names. Used by --help and doctor.
/// IMPORTANT: keep this in sync with get_adapter() match arms.
pub fn supported_protocols() -> &'static [&'static str] {
    &["claude"]
}

/// The default protocol name.
pub const DEFAULT_PROTOCOL: &str = "claude";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infra_error_enxio() {
        assert!(is_infra_error(&io::Error::from_raw_os_error(6)));
    }

    #[test]
    fn infra_error_eagain() {
        assert!(is_infra_error(&io::Error::from_raw_os_error(11)));
    }

    #[test]
    fn infra_error_enoent() {
        assert!(is_infra_error(&io::Error::from_raw_os_error(2)));
    }

    #[test]
    fn infra_error_other_is_not_infra() {
        assert!(!is_infra_error(&io::Error::from_raw_os_error(5)));
    }

    #[test]
    fn get_adapter_claude() {
        assert!(get_adapter("claude").is_some());
    }

    #[test]
    fn get_adapter_unknown() {
        assert!(get_adapter("unknown").is_none());
    }
}
