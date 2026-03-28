use crate::context::ProjectContext;
use crate::segment::ContextualSegment;

// ============================================================
// Block reason constants (non-project-specific)
// ============================================================

pub(crate) const MSG_USE_EXIT_WORKTREE: &str = "\
Use ExitWorktree with action: \"remove\" to safely clean up \
(restores CWD, deletes directory and branch).";

// ============================================================
// Rule infrastructure
// ============================================================

/// How severe a rule violation is, or whether the rule is disabled.
#[derive(Debug, Clone, PartialEq)]
pub enum Severity {
    /// Hard block — the operation cannot proceed.
    Block,
    /// Warning — the operation is allowed but a message is printed to stderr.
    Warn,
    /// Rule is disabled — skip entirely.
    Off,
}

/// A rule violation returned by a check. Constructed via `Violation::new()` which
/// validates that all three message parts are present and meaningful.
///
/// Every violation tells the agent:
/// 1. What they tried (attempted) — the specific command or file
/// 2. Why it's blocked (explanation) — the rule's rationale
/// 3. What to do instead (suggestion) — the corrected command or alternative
#[derive(Debug, Clone)]
pub struct Violation {
    rule: &'static str,
    severity: Severity,
    attempted: String,
    explanation: String,
    suggestion: String,
}

impl Violation {
    /// Create a new violation. Panics in debug builds if any message part is
    /// empty or too short (less than 10 characters) — this catches lazy messages
    /// like "blocked" or "use worktree" during development and testing.
    pub fn new(
        rule: &'static str,
        severity: Severity,
        attempted: impl Into<String>,
        explanation: impl Into<String>,
        suggestion: impl Into<String>,
    ) -> Self {
        let attempted = attempted.into();
        let explanation = explanation.into();
        let suggestion = suggestion.into();

        debug_assert!(
            !attempted.is_empty(),
            "Violation '{}': `attempted` must describe what the agent tried (got empty string)",
            rule
        );
        debug_assert!(
            !explanation.is_empty(),
            "Violation '{}': `explanation` must describe why it's blocked (got empty string)",
            rule
        );
        debug_assert!(
            !suggestion.is_empty(),
            "Violation '{}': `suggestion` must describe what to do instead (got empty string)",
            rule
        );
        debug_assert!(
            attempted.len() >= 10,
            "Violation '{}': `attempted` should be specific (got '{}' — too vague). \
             Include the actual command or file path.",
            rule,
            attempted
        );
        debug_assert!(
            suggestion.len() >= 10,
            "Violation '{}': `suggestion` should be actionable (got '{}' — too vague). \
             Include the corrected command or specific alternative.",
            rule,
            suggestion
        );

        Self {
            rule,
            severity,
            attempted,
            explanation,
            suggestion,
        }
    }

    /// The rule that triggered this violation.
    pub fn rule(&self) -> &'static str {
        self.rule
    }

    /// How severe this violation is.
    pub fn severity(&self) -> &Severity {
        &self.severity
    }

    /// Compose the three-part message into a single reason string for stdout.
    pub fn reason(&self) -> String {
        let explanation = self.explanation.trim_end_matches('.');
        format!("{} — {}. {}", self.attempted, explanation, self.suggestion)
    }
}

/// A rule that checks a single bash command segment.
///
/// Implement this trait to add a new bash check. The guard runs every registered
/// BashRule against every segment in the parsed command.
///
/// # Example
/// ```ignore
/// pub struct MyNewRule;
///
/// impl BashRule for MyNewRule {
///     fn name(&self) -> &'static str { "my-new-rule" }
///     fn description(&self) -> &'static str { "Blocks dangerous-cmd on protected paths." }
///
///     fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation> {
///         if seg.effective_command().map(|(_, c)| c) == Some("dangerous-cmd")
///             && seg.has_protected_path()
///         {
///             Some(Violation::new(
///                 self.name(),
///                 Severity::Block,
///                 "dangerous-cmd on protected path",
///                 "this would modify files under the project root",
///                 format!("Run from a worktree: git worktree add {}/<name> -b <branch>",
///                     ctx.worktrees_dir().display()),
///             ))
///         } else {
///             None
///         }
///     }
/// }
/// ```
pub trait BashRule {
    /// Unique identifier for this rule (e.g. "push-to-default-branch").
    fn name(&self) -> &'static str;

    /// Human-readable description of what this rule prevents and why.
    fn description(&self) -> &'static str;

    /// Default severity. Future: overridable via config.
    fn severity(&self) -> Severity {
        Severity::Block
    }

    /// If set, this rule uses **confirm** behavior: block on first attempt,
    /// allow if the command is prefixed with this token as a variable assignment.
    ///
    /// The token MUST:
    /// - Start with `I_` (it's an assertion the agent makes about their situation)
    /// - End with `=1` (it's a shell variable assignment)
    /// - Be descriptive of the condition being asserted (e.g. `I_CREATED_THIS=1`)
    ///
    /// The check loop handles the confirm logic generically — the rule's
    /// `check_segment` should NOT check for the token itself.
    ///
    /// When the rule triggers and the token is absent, the Violation's
    /// `suggestion` should tell the agent to re-run with the token prefix.
    fn confirm_token(&self) -> Option<&'static str> {
        None
    }

    /// Check a single command segment. Return Some(Violation) to block.
    fn check_segment(&self, ctx: &ProjectContext, seg: &ContextualSegment) -> Option<Violation>;
}

/// A rule that checks a file path operation (Edit/Write tools).
pub trait EditRule {
    /// Unique identifier for this rule.
    fn name(&self) -> &'static str;

    /// Human-readable description.
    fn description(&self) -> &'static str;

    /// Default severity.
    fn severity(&self) -> Severity {
        Severity::Block
    }

    /// Check a file path. Return Some(Violation) to block.
    fn check_file(&self, ctx: &ProjectContext, file_path: &str) -> Option<Violation>;
}
