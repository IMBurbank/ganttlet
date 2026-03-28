pub mod check;
pub mod context;
pub mod log;
pub mod protocol;
pub mod rule;
pub mod rules;
pub mod segment;
pub mod token;

// Public API — framework-agnostic, used by any adapter.
pub use check::{check_bash, check_edit};
pub use context::{find_project_root, ProjectContext, ProtectedPattern};
pub use rule::{BashRule, EditRule, Severity, Violation};
pub use rules::{BASH_RULES, EDIT_RULES};
pub use segment::{parse_segments, ContextualSegment, Segment};
pub use token::{tokenize, Token};

// Internal re-exports — accessible within the crate (rules, check, etc.)
pub(crate) use context::normalize_path;
pub(crate) use segment::{is_var_assignment, is_write_redirect};
pub(crate) use token::{has_write_indicator, script_interpreter_flag};
