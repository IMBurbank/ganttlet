//! Date verification and lint module.
//!
//! Detects date math mismatches and weekend dates in scheduling contexts.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Warning {
    pub warning: String,
}

/// Lint from stdin (PostToolUse JSON).
pub fn lint_stdin() -> Vec<Warning> {
    let mut input = String::new();
    if std::io::Read::read_to_string(&mut std::io::stdin(), &mut input).is_ok() {
        lint_content(&input)
    } else {
        Vec::new()
    }
}

/// Lint a file for date math issues.
pub fn lint_file(path: &str) -> Vec<Warning> {
    match std::fs::read_to_string(path) {
        Ok(content) => lint_content(&content),
        Err(e) => vec![Warning {
            warning: format!("Could not read file {path}: {e}"),
        }],
    }
}

/// Core lint logic — analyzes content for date math issues.
pub fn lint_content(_content: &str) -> Vec<Warning> {
    // Stub — full implementation in B3
    Vec::new()
}
