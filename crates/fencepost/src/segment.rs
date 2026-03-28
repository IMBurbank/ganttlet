use crate::context::ProjectContext;
use crate::token::{
    is_git_command, is_shell_command, tokenize_inner, Token, COMMAND_PREFIXES, GIT_VALUE_FLAGS,
    MAX_SUBST_DEPTH,
};

// ============================================================
// Segments: split tokens on operators, check each independently
// ============================================================

#[derive(Debug, Clone)]
pub struct Segment {
    pub tokens: Vec<Token>,
}

/// True if a token looks like a variable assignment (VAR=val).
pub(crate) fn is_var_assignment(token: &str) -> bool {
    if let Some(eq_pos) = token.find('=') {
        if eq_pos == 0 {
            return false; // "=value" is not an assignment
        }
        let name = &token[..eq_pos];
        let mut chars = name.chars();
        match chars.next() {
            Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
            _ => return false,
        }
        chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    } else {
        false
    }
}

/// True if an operator separates commands (splits segments).
/// Redirect operators (>, >>, <, etc.) are NOT control operators —
/// they stay inside the segment with the command they modify.
fn is_control_operator(op: &str) -> bool {
    matches!(op, "&&" | "||" | "|" | ";" | "&" | "\n" | "(" | ")")
}

/// True if an operator can write to a file.
/// Used by the redirect check to block writes to protected paths.
pub(crate) fn is_write_redirect(op: &str) -> bool {
    matches!(op, ">" | ">>" | ">|" | ">&" | "<>" | "&>" | "&>>")
}

impl Segment {
    /// Find the effective command, skipping variable assignments, known prefixes,
    /// and redirect operators.
    pub fn effective_command(&self) -> Option<(usize, &str)> {
        let mut i = 0;
        while i < self.tokens.len() {
            // Skip redirect operators — they're not commands
            let tok = match &self.tokens[i] {
                Token::Word(w) => w.as_str(),
                Token::Operator(_) => {
                    i += 1;
                    continue;
                }
            };

            // Skip variable assignments
            if is_var_assignment(tok) {
                i += 1;
                continue;
            }

            // Skip brace group opener. In POSIX, { is a reserved word that
            // groups commands but doesn't change what command executes.
            // { git push; } → the effective command is git, not {.
            if tok == "{" || tok == "}" {
                i += 1;
                continue;
            }

            // Skip known command prefixes and their flag-like arguments.
            // After a prefix, skip tokens starting with - (flags) and assignments (=).
            // The first non-flag, non-assignment token is the command.
            //
            // Known gap: prefix flags that take values (e.g., sudo -u root) cause the
            // value ("root") to be returned as the command. This fails-open: "root" won't
            // match any dangerous command pattern, so the guard allows the command.
            // The alternative (enumerating value-consuming flags to skip flag+value pairs)
            // is fragile: a wrong enumeration could skip the actual command. For example,
            // if -u were enumerated but -C were not, "sudo -C /etc git push" would skip
            // -C AND /etc, returning "git" correctly — but a mis-enumeration would return
            // "push" instead, a more dangerous bypass than the current fail-open.
            if COMMAND_PREFIXES.contains(&tok) {
                i += 1;
                while i < self.tokens.len() {
                    match &self.tokens[i] {
                        Token::Operator(_) => {
                            i += 1;
                            continue;
                        }
                        Token::Word(t) => {
                            if t.starts_with('-') || is_var_assignment(t) {
                                i += 1;
                            } else {
                                break;
                            }
                        }
                    }
                }
                continue;
            }

            return Some((i, tok));
        }
        None
    }

    /// Find the git subcommand, skipping global git flags and redirect operators.
    pub fn git_subcmd(&self) -> Option<(usize, &str)> {
        let (cmd_pos, cmd) = self.effective_command()?;
        if !is_git_command(cmd) {
            return None;
        }

        let mut i = cmd_pos + 1;
        while i < self.tokens.len() {
            let tok = match &self.tokens[i] {
                Token::Word(w) => w.as_str(),
                Token::Operator(_) => {
                    i += 1;
                    continue;
                }
            };
            // --flag=value form
            if tok.contains('=')
                && GIT_VALUE_FLAGS
                    .iter()
                    .any(|f| tok.starts_with(&format!("{}=", f)))
            {
                i += 1;
                continue;
            }
            // --flag value form (two tokens)
            if GIT_VALUE_FLAGS.contains(&tok) {
                i += 2; // skip flag + value
                continue;
            }
            // Standalone flag (--no-pager, --bare, etc.)
            if tok.starts_with('-') {
                i += 1;
                continue;
            }
            return Some((i, tok));
        }
        None
    }

    /// True if this segment runs git with the given subcommand.
    pub fn is_git(&self, subcmd: &str) -> bool {
        self.git_subcmd().map(|(_, s)| s == subcmd).unwrap_or(false)
    }

    /// True if any Word token AFTER the subcommand (for git) or command exactly equals `val`.
    pub fn has_arg(&self, val: &str) -> bool {
        let start = if let Some((pos, _)) = self.git_subcmd() {
            pos + 1
        } else if let Some((pos, _)) = self.effective_command() {
            pos + 1
        } else {
            return false;
        };
        self.tokens[start..]
            .iter()
            .any(|t| matches!(t, Token::Word(w) if w == val))
    }

    /// True if any Word token AFTER the subcommand/command is a short flag containing `ch`.
    pub fn has_short_flag(&self, ch: char) -> bool {
        let start = if let Some((pos, _)) = self.git_subcmd() {
            pos + 1
        } else if let Some((pos, _)) = self.effective_command() {
            pos + 1
        } else {
            return false;
        };
        self.tokens[start..].iter().any(|t| {
            matches!(t, Token::Word(w) if w.starts_with('-') && !w.starts_with("--") && w.contains(ch))
        })
    }

    /// WARNING: Scans ALL Word tokens including command names, flags, and arguments.
    /// This can cause false positives when prefixes match in unrelated tokens.
    /// Prefer ContextualSegment::has_arg_starting_with() for argument-scoped checks.
    pub fn has_token_starting_with_raw(&self, prefix: &str) -> bool {
        self.tokens
            .iter()
            .any(|t| matches!(t, Token::Word(w) if w.starts_with(prefix)))
    }

    /// WARNING: Scans ALL Word tokens including command names, flags, and arguments.
    /// This can cause false positives when substrings match in unrelated tokens.
    /// Prefer ContextualSegment::has_arg() for exact argument matching.
    pub fn has_token_containing_raw(&self, substring: &str) -> bool {
        self.tokens
            .iter()
            .any(|t| matches!(t, Token::Word(w) if w.contains(substring)))
    }
}

// ============================================================
// ContextualSegment: a segment bound to a project context
// ============================================================

/// A segment bound to a ProjectContext. This is the primary type that check
/// implementations (Rules) work with. It exposes safe, structured query methods
/// and policy-aware path checks. Raw token access is available via `tokens()`
/// but requires an explicit opt-in.
///
/// Created via `ProjectContext::bind(&self, seg: &Segment)`.
pub struct ContextualSegment<'a> {
    seg: &'a Segment,
    ctx: &'a ProjectContext,
}

impl<'a> ContextualSegment<'a> {
    /// Create a new ContextualSegment (used by ProjectContext::bind).
    pub(crate) fn new(seg: &'a Segment, ctx: &'a ProjectContext) -> Self {
        Self { seg, ctx }
    }

    // -- Structural queries (delegated from Segment) --

    /// Find the effective command, skipping variable assignments, known prefixes,
    /// and redirect operators.
    pub fn effective_command(&self) -> Option<(usize, &str)> {
        self.seg.effective_command()
    }

    /// Extract the git subcommand (e.g., "push" from "git push origin main"),
    /// skipping git global flags like -C and -c.
    pub fn git_subcmd(&self) -> Option<(usize, &str)> {
        self.seg.git_subcmd()
    }

    /// True if this segment is a git command with the given subcommand.
    pub fn is_git(&self, subcmd: &str) -> bool {
        self.seg.is_git(subcmd)
    }

    /// True if any Word token AFTER the subcommand/command exactly equals `val`.
    pub fn has_arg(&self, val: &str) -> bool {
        self.seg.has_arg(val)
    }

    /// True if any Word token AFTER the subcommand/command is a short flag containing `ch`.
    pub fn has_short_flag(&self, ch: char) -> bool {
        self.seg.has_short_flag(ch)
    }

    /// True if any Word token AFTER the command contains `substring`.
    /// Scoped to arguments (after the command position), unlike Segment's
    /// has_token_containing_raw which scans ALL tokens.
    pub fn has_arg_containing(&self, substring: &str) -> bool {
        let start = if let Some((pos, _)) = self.seg.git_subcmd() {
            pos + 1
        } else if let Some((pos, _)) = self.seg.effective_command() {
            pos + 1
        } else {
            return false;
        };
        self.seg.tokens[start..]
            .iter()
            .any(|t| matches!(t, Token::Word(w) if w.contains(substring)))
    }

    /// True if any Word token AFTER the command starts with `prefix`.
    /// Scoped to arguments (after the command position), unlike Segment's
    /// has_token_starting_with_raw which scans ALL tokens.
    pub fn has_arg_starting_with(&self, prefix: &str) -> bool {
        let start = if let Some((pos, _)) = self.seg.git_subcmd() {
            pos + 1
        } else if let Some((pos, _)) = self.seg.effective_command() {
            pos + 1
        } else {
            return false;
        };
        self.seg.tokens[start..]
            .iter()
            .any(|t| matches!(t, Token::Word(w) if w.starts_with(prefix)))
    }

    // -- Policy-aware queries (require ProjectContext) --

    /// True if any Word token resolves to a protected path (under project root,
    /// outside worktrees directory). Skips tokens that don't look like file paths
    /// (flags, sed patterns, etc.) to avoid false positives.
    pub fn has_protected_path(&self) -> bool {
        use crate::context::looks_like_path;
        self.seg.tokens.iter().any(|t| {
            if let Token::Word(w) = t {
                looks_like_path(w) && self.ctx.is_protected_path(w)
            } else {
                false
            }
        })
    }

    /// True if any Word token resolves to a worktree ROOT directory path
    /// (e.g., {worktrees_dir}/my-wt but NOT {worktrees_dir}/my-wt/subdir).
    pub fn targets_worktree_root(&self) -> bool {
        let prefix = self.ctx.worktrees_prefix();
        self.seg.tokens.iter().any(|t| {
            if let Token::Word(w) = t {
                let resolved = self.ctx.resolve_path(w);
                let s = resolved
                    .as_ref()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if let Some(rest) = s.strip_prefix(prefix.as_str()) {
                    let trimmed = rest.trim_end_matches('/');
                    !trimmed.is_empty() && !trimmed.contains('/')
                } else {
                    false
                }
            } else {
                false
            }
        })
    }

    // -- Raw access escape hatch --

    /// Access the underlying token slice directly. Use this for checks that
    /// need positional extraction (e.g., finding the token after "remove" in
    /// `git worktree remove <path>`). Prefer structured methods when possible.
    pub fn tokens(&self) -> &[Token] {
        &self.seg.tokens
    }
}

/// Parse a command string into segments. Each segment is a separate command
/// (split on operators like &&, ||, |, ;, &, newline, (, )).
/// Also returns segments from command substitutions ($() and backticks).
pub fn parse_segments(cmd: &str) -> Vec<Segment> {
    parse_segments_inner(cmd, 0)
}

pub(crate) fn parse_segments_inner(cmd: &str, depth: usize) -> Vec<Segment> {
    let (tokens, inner_segment_groups) = tokenize_inner(cmd, depth);

    let mut segments: Vec<Segment> = Vec::new();
    let mut current: Vec<Token> = Vec::new();

    for tok in &tokens {
        match tok {
            Token::Operator(op) => {
                if is_control_operator(op) {
                    // Control operators split segments
                    if !current.is_empty() {
                        segments.push(Segment {
                            tokens: std::mem::take(&mut current),
                        });
                    }
                } else {
                    // Redirect operators stay in the segment
                    current.push(tok.clone());
                }
            }
            Token::Word(_) => {
                current.push(tok.clone());
            }
        }
    }
    if !current.is_empty() {
        segments.push(Segment { tokens: current });
    }

    // Add segments from command substitutions
    for group in inner_segment_groups {
        segments.extend(group);
    }

    // Recursively parse shell -c arguments and eval arguments.
    // bash -c "git push origin main" → the string arg is a shell command.
    // eval "git push origin main" → the arg is a shell command.
    // This extends the same recursive parsing used for $() and backticks.
    if depth < MAX_SUBST_DEPTH {
        let mut extra_segments: Vec<Segment> = Vec::new();
        for seg in &segments {
            if let Some((cmd_pos, cmd)) = seg.effective_command() {
                if is_shell_command(cmd) {
                    // Look for -c flag and its argument (Word tokens only)
                    if let Some(c_pos) = seg.tokens[cmd_pos + 1..]
                        .iter()
                        .position(|t| matches!(t, Token::Word(w) if w == "-c"))
                    {
                        let arg_pos = cmd_pos + 1 + c_pos + 1;
                        if let Some(Token::Word(inner)) = seg.tokens.get(arg_pos) {
                            let inner_segs = parse_segments_inner(inner, depth + 1);
                            extra_segments.extend(inner_segs);
                        }
                    }
                } else if cmd == "eval" {
                    // eval concatenates all Word args and executes as a command
                    let args: Vec<&str> = seg.tokens[cmd_pos + 1..]
                        .iter()
                        .filter_map(|t| match t {
                            Token::Word(w) => Some(w.as_str()),
                            Token::Operator(_) => None,
                        })
                        .collect();
                    if !args.is_empty() {
                        let inner = args.join(" ");
                        let inner_segs = parse_segments_inner(&inner, depth + 1);
                        extra_segments.extend(inner_segs);
                    }
                }
            }
        }
        segments.extend(extra_segments);
    }

    segments
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::ProjectContext;
    use std::path::PathBuf;

    /// Default test context with deterministic CWD in a worktree.
    fn test_ctx() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/workspace"),
            PathBuf::from("/workspace/.claude/worktrees/default-test"),
        )
    }

    /// Extract Word token strings from segments (filters out Operator tokens).
    fn segs(cmd: &str) -> Vec<Vec<String>> {
        parse_segments(cmd)
            .iter()
            .map(|s| {
                s.tokens
                    .iter()
                    .filter_map(|t| match t {
                        Token::Word(w) => Some(w.clone()),
                        Token::Operator(_) => None,
                    })
                    .collect()
            })
            .collect()
    }

    // ================================================================
    // Layer 2: Segment Tests
    // ================================================================

    // --- 2.1 Basic segmentation ---

    #[test]
    fn l2_single_segment() {
        assert_eq!(segs("a"), vec![vec!["a"]]);
    }

    #[test]
    fn l2_and_segments() {
        assert_eq!(segs("a && b"), vec![vec!["a"], vec!["b"]]);
    }

    #[test]
    fn l2_pipe_segments() {
        assert_eq!(segs("a | b"), vec![vec!["a"], vec!["b"]]);
    }

    #[test]
    fn l2_semi_segments() {
        assert_eq!(segs("a ; b"), vec![vec!["a"], vec!["b"]]);
    }

    #[test]
    fn l2_bg_segments() {
        assert_eq!(segs("a & b"), vec![vec!["a"], vec!["b"]]);
    }

    #[test]
    fn l2_op_only() {
        assert_eq!(segs("&&"), Vec::<Vec<String>>::new());
    }

    #[test]
    fn l2_trailing_op() {
        assert_eq!(segs("a &&"), vec![vec!["a"]]);
    }

    #[test]
    fn l2_leading_op() {
        assert_eq!(segs("; a"), vec![vec!["a"]]);
    }

    // --- 2.2 Multi-segment ---

    #[test]
    fn l2_three_segments() {
        assert_eq!(segs("a && b || c"), vec![vec!["a"], vec!["b"], vec!["c"]]);
    }

    #[test]
    fn l2_complex_chain() {
        assert_eq!(
            segs("echo a ; git push && git status"),
            vec![
                vec!["echo", "a"],
                vec!["git", "push"],
                vec!["git", "status"]
            ]
        );
    }

    // --- 2.3 Heredoc segments ---

    #[test]
    fn l2_heredoc_with_post() {
        let s = segs("cat << EOF && echo done\nbody\nEOF");
        assert_eq!(s, vec![vec!["cat"], vec!["echo", "done"]]);
    }

    // --- 2.4 Command substitution segments ---

    #[test]
    fn l2_cmd_subst_segments() {
        let segments = parse_segments("echo $(git push origin main)");
        // Outer segment + inner segment from $()
        assert!(segments.len() >= 2);
        assert!(segments.iter().any(|s| s.is_git("push")));
    }

    // --- 2.5 Redirect operators stay in segments ---

    #[test]
    fn l2_redirect_stays_in_segment() {
        let segments = parse_segments("echo > /tmp/file");
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].tokens.len(), 3); // Word, Operator, Word
    }

    #[test]
    fn l2_redirect_with_control() {
        let segments = parse_segments("echo > /tmp && cat < /other");
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].tokens.len(), 3); // echo, >, /tmp
        assert_eq!(segments[1].tokens.len(), 3); // cat, <, /other
    }

    #[test]
    fn l2_redirect_nospace_segment() {
        let segments = parse_segments("echo>/tmp/file");
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].tokens.len(), 3); // echo, >, /tmp/file
    }

    #[test]
    fn l2_redirect_multiple_in_segment() {
        let segments = parse_segments("cmd > /tmp/out 2>&1");
        assert_eq!(segments.len(), 1);
        // cmd, >, /tmp/out, 2, >&, 1
        assert_eq!(segments[0].tokens.len(), 6);
    }

    #[test]
    fn l2_redirect_does_not_affect_word_segs() {
        // segs() filters out operators, so redirect operators don't appear
        assert_eq!(
            segs("echo > /tmp/file && cat"),
            vec![vec!["echo", "/tmp/file"], vec!["cat"]]
        );
    }

    fn ec(tokens: &[&str]) -> Option<(usize, String)> {
        let seg = Segment {
            tokens: tokens.iter().map(|s| Token::Word(s.to_string())).collect(),
        };
        seg.effective_command().map(|(i, s)| (i, s.to_string()))
    }

    // --- 2b.1 effective_command ---

    #[test]
    fn l2b_ec_git_push() {
        assert_eq!(ec(&["git", "push"]), Some((0, "git".to_string())));
    }

    #[test]
    fn l2b_ec_echo() {
        assert_eq!(ec(&["echo", "hello"]), Some((0, "echo".to_string())));
    }

    #[test]
    fn l2b_ec_sudo() {
        assert_eq!(ec(&["sudo", "git", "push"]), Some((1, "git".to_string())));
    }

    #[test]
    fn l2b_ec_sudo_u() {
        // Known gap: -u takes a value ("root") but we can't know without
        // enumerating sudo flags. "root" is returned as the command.
        // Safe: "root" doesn't match any dangerous command pattern (fail-open).
        assert_eq!(
            ec(&["sudo", "-u", "root", "git", "push"]),
            Some((2, "root".to_string()))
        );
    }

    #[test]
    fn l2b_ec_env() {
        assert_eq!(
            ec(&["env", "VAR=val", "git", "push"]),
            Some((2, "git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_env_flag() {
        assert_eq!(
            ec(&["env", "-i", "VAR=val", "git"]),
            Some((3, "git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_command() {
        assert_eq!(
            ec(&["command", "git", "push"]),
            Some((1, "git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_nice() {
        assert_eq!(ec(&["nice", "git", "push"]), Some((1, "git".to_string())));
    }

    #[test]
    fn l2b_ec_nohup() {
        assert_eq!(ec(&["nohup", "git", "push"]), Some((1, "git".to_string())));
    }

    #[test]
    fn l2b_ec_time() {
        assert_eq!(ec(&["time", "git", "push"]), Some((1, "git".to_string())));
    }

    #[test]
    fn l2b_ec_stacked_prefixes() {
        assert_eq!(
            ec(&["sudo", "env", "VAR=1", "git"]),
            Some((3, "git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_empty() {
        assert_eq!(ec(&[]), None);
    }

    #[test]
    fn l2b_ec_prefix_only() {
        assert_eq!(ec(&["sudo"]), None);
    }

    #[test]
    fn l2b_ec_sudo_n_finds_git() {
        // -n (no password) doesn't take a value, so git IS the command
        assert_eq!(
            ec(&["sudo", "-n", "git", "push"]),
            Some((2, "git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_sudo_v_finds_git() {
        // -v (validate) doesn't take a value
        assert_eq!(
            ec(&["sudo", "-v", "git", "push"]),
            Some((2, "git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_sudo_e_finds_git() {
        // -E (preserve env) doesn't take a value
        assert_eq!(
            ec(&["sudo", "-E", "git", "push"]),
            Some((2, "git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_sudo_u_known_gap() {
        // -u takes a value but we can't know without enumerating.
        // Returns "root" as command — fail-open (root != git)
        assert_eq!(
            ec(&["sudo", "-u", "root", "git", "push"]),
            Some((2, "root".to_string()))
        );
    }

    fn gs(tokens: &[&str]) -> Option<(usize, String)> {
        let seg = Segment {
            tokens: tokens.iter().map(|s| Token::Word(s.to_string())).collect(),
        };
        seg.git_subcmd().map(|(i, s)| (i, s.to_string()))
    }

    // --- 2b.2 git_subcmd ---

    #[test]
    fn l2b_gs_basic() {
        assert_eq!(gs(&["git", "push"]), Some((1, "push".to_string())));
    }

    #[test]
    fn l2b_gs_c_flag() {
        assert_eq!(
            gs(&["git", "-C", "/tmp", "push"]),
            Some((3, "push".to_string()))
        );
    }

    #[test]
    fn l2b_gs_config_flag() {
        assert_eq!(
            gs(&["git", "-c", "key=val", "push"]),
            Some((3, "push".to_string()))
        );
    }

    #[test]
    fn l2b_gs_no_pager() {
        assert_eq!(
            gs(&["git", "--no-pager", "push"]),
            Some((2, "push".to_string()))
        );
    }

    #[test]
    fn l2b_gs_bare() {
        assert_eq!(
            gs(&["git", "--bare", "status"]),
            Some((2, "status".to_string()))
        );
    }

    #[test]
    fn l2b_gs_git_dir_eq() {
        assert_eq!(
            gs(&["git", "--git-dir=/tmp/.git", "push"]),
            Some((2, "push".to_string()))
        );
    }

    #[test]
    fn l2b_gs_git_dir_space() {
        assert_eq!(
            gs(&["git", "--git-dir", "/tmp/.git", "push"]),
            Some((3, "push".to_string()))
        );
    }

    #[test]
    fn l2b_gs_work_tree() {
        assert_eq!(
            gs(&["git", "--work-tree", "/tmp", "push"]),
            Some((3, "push".to_string()))
        );
    }

    #[test]
    fn l2b_gs_multiple_flags() {
        assert_eq!(
            gs(&["git", "-C", "/a", "-c", "k=v", "--no-pager", "push"]),
            Some((6, "push".to_string()))
        );
    }

    #[test]
    fn l2b_gs_no_subcmd() {
        assert_eq!(gs(&["git"]), None);
    }

    #[test]
    fn l2b_gs_flag_no_value() {
        assert_eq!(gs(&["git", "-C"]), None);
    }

    #[test]
    fn l2b_gs_with_prefix() {
        assert_eq!(
            gs(&["sudo", "git", "-C", "/tmp", "push"]),
            Some((4, "push".to_string()))
        );
    }

    #[test]
    fn l2b_gs_not_git() {
        assert_eq!(gs(&["echo"]), None);
    }

    fn mk_seg(tokens: &[&str]) -> Segment {
        Segment {
            tokens: tokens.iter().map(|s| Token::Word(s.to_string())).collect(),
        }
    }

    // --- 2b.3 is_git ---

    #[test]
    fn l2b_is_git_true() {
        assert!(mk_seg(&["git", "push"]).is_git("push"));
    }

    #[test]
    fn l2b_is_git_wrong_subcmd() {
        assert!(!mk_seg(&["git", "push"]).is_git("pull"));
    }

    #[test]
    fn l2b_is_git_with_flags() {
        assert!(mk_seg(&["git", "-C", "/", "push"]).is_git("push"));
    }

    #[test]
    fn l2b_is_git_with_prefix() {
        assert!(mk_seg(&["sudo", "git", "push"]).is_git("push"));
    }

    #[test]
    fn l2b_is_git_not_cmd() {
        // "git" not in command position (echo is the command)
        assert!(!mk_seg(&["echo", "git", "push"]).is_git("push"));
    }

    // --- 2b.4 has_arg ---

    #[test]
    fn l2b_has_arg_main() {
        assert!(mk_seg(&["git", "push", "origin", "main"]).has_arg("main"));
    }

    #[test]
    fn l2b_has_arg_origin() {
        assert!(mk_seg(&["git", "push", "origin", "main"]).has_arg("origin"));
    }

    #[test]
    fn l2b_has_arg_not_subcmd() {
        // "push" is the subcmd, not an arg
        assert!(!mk_seg(&["git", "push", "origin", "main"]).has_arg("push"));
    }

    #[test]
    fn l2b_has_arg_not_cmd() {
        assert!(!mk_seg(&["git", "push", "origin", "main"]).has_arg("git"));
    }

    #[test]
    fn l2b_has_arg_substring_no_match() {
        // "main" should not match "maintain"
        assert!(!mk_seg(&["git", "push", "origin", "maintain"]).has_arg("main"));
    }

    #[test]
    fn l2b_has_arg_with_flags() {
        assert!(mk_seg(&["git", "-C", "/tmp", "push", "origin", "main"]).has_arg("main"));
    }

    #[test]
    fn l2b_has_arg_flag_value_not_arg() {
        // "main" is the value of -C flag, not an arg to push
        assert!(!mk_seg(&["git", "-C", "main", "push", "origin", "feat"]).has_arg("main"));
    }

    // --- 2b.5 has_short_flag ---

    #[test]
    fn l2b_flag_d_upper() {
        assert!(mk_seg(&["git", "branch", "-D"]).has_short_flag('D'));
    }

    #[test]
    fn l2b_flag_combined_df() {
        assert!(mk_seg(&["git", "branch", "-Df"]).has_short_flag('D'));
    }

    #[test]
    fn l2b_flag_combined_fd() {
        assert!(mk_seg(&["git", "branch", "-fD"]).has_short_flag('D'));
    }

    #[test]
    fn l2b_flag_case_sensitive() {
        assert!(!mk_seg(&["git", "branch", "-d"]).has_short_flag('D'));
    }

    #[test]
    fn l2b_flag_long_not_short() {
        assert!(!mk_seg(&["git", "branch", "--delete"]).has_short_flag('D'));
    }

    #[test]
    fn l2b_flag_clean_fd() {
        assert!(mk_seg(&["git", "clean", "-fd"]).has_short_flag('f'));
    }

    #[test]
    fn l2b_flag_clean_n() {
        assert!(!mk_seg(&["git", "clean", "-n"]).has_short_flag('f'));
    }

    #[test]
    fn l2b_flag_before_subcmd() {
        // -D before subcmd is a git flag, not a branch flag
        assert!(!mk_seg(&["git", "-D", "branch"]).has_short_flag('D'));
    }

    // --- 2b.6 has_token_starting_with ---

    #[test]
    fn l2b_starts_with_origin() {
        assert!(mk_seg(&["git", "reset", "--hard", "origin/main"])
            .has_token_starting_with_raw("origin/"));
    }

    #[test]
    fn l2b_starts_with_no_match() {
        assert!(
            !mk_seg(&["git", "reset", "--hard", "HEAD~3"]).has_token_starting_with_raw("origin/")
        );
    }

    // --- 2b.7 has_token_containing ---

    #[test]
    fn l2b_contains_worktree_false() {
        assert!(!mk_seg(&["git", "checkout", "main"]).has_token_containing_raw("worktree"));
    }

    #[test]
    fn l2b_contains_worktree_true() {
        assert!(mk_seg(&["git", "worktree", "add", "/tmp"]).has_token_containing_raw("worktree"));
    }

    // --- 2b.8 effective_command with assignments ---

    #[test]
    fn l2b_ec_assignment() {
        assert_eq!(
            ec(&["VAR=val", "git", "push"]),
            Some((1, "git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_multi_assignment() {
        assert_eq!(
            ec(&["A=1", "B=2", "git", "push"]),
            Some((2, "git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_assignment_only() {
        assert_eq!(ec(&["VAR=val"]), None);
    }

    #[test]
    fn l2b_ec_assignment_plus_prefix() {
        assert_eq!(
            ec(&["VAR=val", "sudo", "git", "push"]),
            Some((2, "git".to_string()))
        );
    }

    #[test]
    fn l2b_assignment_url_not_assignment() {
        // URL-like token: http://server=param — NOT an assignment because
        // name part contains : and / which aren't alphanumeric or _
        assert!(!is_var_assignment("http://server=param"));
    }

    #[test]
    fn l2b_assignment_flag_not_assignment() {
        // --flag=value — NOT an assignment (starts with -)
        assert!(!is_var_assignment("--flag=value"));
    }

    #[test]
    fn l2b_assignment_valid() {
        assert!(is_var_assignment("VAR=val"));
        assert!(is_var_assignment("_PRIVATE=1"));
        assert!(is_var_assignment("A123=test"));
    }

    #[test]
    fn l2b_assignment_invalid() {
        assert!(!is_var_assignment("=value")); // starts with =
        assert!(!is_var_assignment("123=val")); // starts with digit
        assert!(!is_var_assignment("no-equals"));
    }

    // --- 2b.9 effective_command with full paths ---

    #[test]
    fn l2b_ec_full_path() {
        assert_eq!(
            ec(&["/usr/bin/git", "push"]),
            Some((0, "/usr/bin/git".to_string()))
        );
    }

    #[test]
    fn l2b_ec_relative_path() {
        assert_eq!(ec(&["./git", "push"]), Some((0, "./git".to_string())));
    }

    #[test]
    fn l2b_ec_sudo_full_path() {
        assert_eq!(
            ec(&["sudo", "/usr/bin/git", "push"]),
            Some((1, "/usr/bin/git".to_string()))
        );
    }

    // --- 2b.10 targets_worktree_root ---

    #[test]
    fn l2b_wt_root() {
        let ctx = test_ctx();
        assert!(ctx
            .bind(&mk_seg(&[
                "rm",
                "-rf",
                "/workspace/.claude/worktrees/my-wt"
            ]))
            .targets_worktree_root());
    }

    #[test]
    fn l2b_wt_root_trailing_slash() {
        let ctx = test_ctx();
        assert!(ctx
            .bind(&mk_seg(&[
                "rm",
                "-rf",
                "/workspace/.claude/worktrees/my-wt/"
            ]))
            .targets_worktree_root());
    }

    #[test]
    fn l2b_wt_subdir() {
        let ctx = test_ctx();
        assert!(!ctx
            .bind(&mk_seg(&[
                "rm",
                "-rf",
                "/workspace/.claude/worktrees/my-wt/node_modules"
            ]))
            .targets_worktree_root());
    }

    #[test]
    fn l2b_wt_deep_subdir() {
        let ctx = test_ctx();
        assert!(!ctx
            .bind(&mk_seg(&[
                "rm",
                "-rf",
                "/workspace/.claude/worktrees/my-wt/src/old/"
            ]))
            .targets_worktree_root());
    }

    #[test]
    fn l2b_wt_non_worktree() {
        let ctx = test_ctx();
        assert!(!ctx
            .bind(&mk_seg(&["rm", "-rf", "/tmp/something"]))
            .targets_worktree_root());
    }

    #[test]
    fn l2b_wt_bare_prefix() {
        let ctx = test_ctx();
        assert!(!ctx
            .bind(&mk_seg(&["rm", "-rf", "/workspace/.claude/worktrees/"]))
            .targets_worktree_root());
    }

    // --- 2b.11 has_protected_path ---

    #[test]
    fn l2b_workspace_path_direct() {
        let ctx = test_ctx();
        assert!(ctx
            .bind(&mk_seg(&["sed", "-i", "s/x/y/", "/workspace/src/file.ts"]))
            .has_protected_path());
    }

    #[test]
    fn l2b_workspace_path_worktree() {
        let ctx = test_ctx();
        assert!(!ctx
            .bind(&mk_seg(&[
                "sed",
                "-i",
                "s/x/y/",
                "/workspace/.claude/worktrees/wt/f"
            ]))
            .has_protected_path());
    }

    #[test]
    fn l2b_workspace_path_tmp() {
        let ctx = test_ctx();
        assert!(!ctx
            .bind(&mk_seg(&["sed", "-i", "s/x/y/", "/tmp/file.ts"]))
            .has_protected_path());
    }

    #[test]
    fn l2b_workspace_path_tee() {
        let ctx = test_ctx();
        assert!(ctx
            .bind(&mk_seg(&["tee", "/workspace/output.txt"]))
            .has_protected_path());
    }

    #[test]
    fn l2b_workspace_path_tee_worktree() {
        let ctx = test_ctx();
        assert!(!ctx
            .bind(&mk_seg(&["tee", "/workspace/.claude/worktrees/wt/out.txt"]))
            .has_protected_path());
    }

    // --- Operator classification unit tests ---

    #[test]
    fn write_redirect_classification() {
        assert!(is_write_redirect(">"));
        assert!(is_write_redirect(">>"));
        assert!(is_write_redirect(">|"));
        assert!(is_write_redirect(">&"));
        assert!(is_write_redirect("<>"));
        assert!(is_write_redirect("&>"));
        assert!(is_write_redirect("&>>"));
        assert!(!is_write_redirect("<"));
        assert!(!is_write_redirect("<&"));
        assert!(!is_write_redirect("&&"));
        assert!(!is_write_redirect("|"));
    }

    #[test]
    fn control_operator_classification() {
        assert!(is_control_operator("&&"));
        assert!(is_control_operator("||"));
        assert!(is_control_operator("|"));
        assert!(is_control_operator(";"));
        assert!(is_control_operator("&"));
        assert!(is_control_operator("\n"));
        assert!(is_control_operator("("));
        assert!(is_control_operator(")"));
        assert!(!is_control_operator(">"));
        assert!(!is_control_operator(">>"));
        assert!(!is_control_operator("<"));
    }

    // --- protected_path_with_dotdot ---

    #[test]
    fn l2b_protected_path_with_dotdot() {
        // sed -i targeting a path that escapes via ..
        let ctx = test_ctx();
        assert!(ctx
            .bind(&mk_seg(&[
                "sed",
                "-i",
                "s/x/y/",
                "/workspace/.claude/worktrees/wt/../../../file"
            ]))
            .has_protected_path());
    }
}
