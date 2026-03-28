//! Claude Code PreToolUse hook protocol adapter.
//!
//! Claude Code pipes a JSON object to the hook's stdin:
//!   {"tool_name": "Edit", "tool_input": {"file_path": "/path/to/file"}}
//!   {"tool_name": "Bash", "tool_input": {"command": "git push origin main"}}
//!
//! To block, print to stdout:
//!   {"decision": "block", "reason": "..."}
//!
//! To allow, print nothing (empty stdout).
//!
//! Exit code is always 0 — Claude Code reads the decision from stdout JSON.

use super::{CheckRequest, ProtocolAdapter};

/// Claude Code protocol adapter.
pub struct ClaudeAdapter;

impl ProtocolAdapter for ClaudeAdapter {
    fn name(&self) -> &'static str {
        "claude"
    }

    fn sample_edit_input(&self) -> &'static str {
        r#"{"tool_name":"Edit","tool_input":{"file_path":"/project/src/test.ts"}}"#
    }

    fn sample_bash_input(&self) -> &'static str {
        r#"{"tool_name":"Bash","tool_input":{"command":"git status"}}"#
    }

    fn parse_request(&self, mode: &str, stdin_data: &str) -> Result<CheckRequest, String> {
        let input: serde_json::Value = serde_json::from_str(stdin_data)
            .map_err(|e| format!("Hook error — blocking: {}", e))?;

        match mode {
            "edit" => {
                let path = input["tool_input"]["file_path"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                Ok(CheckRequest::Edit { file_path: path })
            }
            "bash" => {
                let cmd = input["tool_input"]["command"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                Ok(CheckRequest::Bash { command: cmd })
            }
            _ => Ok(CheckRequest::Unknown),
        }
    }

    fn format_block(&self, reason: &str) -> String {
        block_json(reason)
    }

    fn format_error(&self, error: &str) -> String {
        block_json(error)
    }
}

/// Format a block decision as Claude Code's expected JSON output.
pub fn block_json(reason: &str) -> String {
    serde_json::json!({"decision": "block", "reason": reason}).to_string()
}
