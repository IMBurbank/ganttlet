use std::io::{self, Read};

/// Read all of stdin. Returns Err on OS-level infrastructure errors (ENXIO, EAGAIN, ENOENT)
/// so the caller can fail-open. Other IO errors are returned as-is.
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

/// Serialize a block decision to JSON.
pub fn block_json(reason: &str) -> String {
    serde_json::json!({"decision": "block", "reason": reason}).to_string()
}

// ============================================================
// Tokenizer: single-pass POSIX-aligned shell command tokenizer
// ============================================================

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Word(String),
    Operator(String),
}

/// Tokenize a shell command string into Words and Operators.
/// Handles quotes, backslash escaping, operators, heredocs,
/// command substitution ($() and backticks), and comments.
///
/// On any parse error (unmatched quotes, etc.), returns a fail-open
/// fallback: the entire command whitespace-split into Word tokens.
pub fn tokenize(cmd: &str) -> (Vec<Token>, Vec<Vec<Segment>>) {
    tokenize_inner(cmd, 0)
}

/// Max recursion depth for command substitution parsing.
const MAX_SUBST_DEPTH: usize = 3;

/// Known command prefixes that wrap another command.
/// `exec` replaces the process with the command — semantically a prefix.
const COMMAND_PREFIXES: &[&str] = &["sudo", "env", "command", "nice", "nohup", "time", "exec"];

/// Shell interpreters whose -c argument should be recursively parsed.
const SHELL_COMMANDS: &[&str] = &["bash", "sh", "dash", "zsh", "ksh"];

/// Non-shell interpreters and the flag that introduces inline code.
/// (name, inline_flag) — e.g., python uses -c, node uses -e.
const SCRIPT_INTERPRETERS: &[(&str, &str)] = &[
    ("python", "-c"),
    ("python3", "-c"),
    ("node", "-e"),
    ("ruby", "-e"),
    ("perl", "-e"),
];

/// True if a token is a shell interpreter (handles full paths like /bin/bash).
fn is_shell_command(token: &str) -> bool {
    SHELL_COMMANDS.contains(&token)
        || SHELL_COMMANDS
            .iter()
            .any(|s| token.ends_with(&format!("/{}", s)))
}

/// True if a token is a non-shell script interpreter. Returns the flag
/// that introduces inline code (e.g., "-c" for python, "-e" for node).
fn script_interpreter_flag(token: &str) -> Option<&'static str> {
    let base = token.rsplit('/').next().unwrap_or(token);
    SCRIPT_INTERPRETERS
        .iter()
        .find(|(name, _)| *name == base)
        .map(|(_, flag)| *flag)
}

/// Git global flags that consume the NEXT token as a value.
const GIT_VALUE_FLAGS: &[&str] = &[
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--super-prefix",
];

fn tokenize_inner(cmd: &str, depth: usize) -> (Vec<Token>, Vec<Vec<Segment>>) {
    let chars: Vec<char> = cmd.chars().collect();
    let len = chars.len();
    let mut tokens: Vec<Token> = Vec::new();
    let mut inner_segment_groups: Vec<Vec<Segment>> = Vec::new();
    let mut word = String::new();
    let mut in_word = false;
    let mut i = 0;

    // Track last emitted token type for newline continuation
    // None = start, Some(op) = last emitted operator string
    let mut last_emitted_op: Option<String> = None;

    // Heredoc state: delimiter is captured, then we wait for \n to enter body
    let mut heredoc_delimiter: Option<String> = None;
    let mut heredoc_in_body = false;
    let mut heredoc_strip_tabs = false; // true for <<- (indented heredoc)

    while i < len {
        // Heredoc body: skip until delimiter line
        if heredoc_in_body {
            let delim = heredoc_delimiter.as_ref().unwrap();
            // Find end of current line
            let line_start = i;
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            let line: String = chars[line_start..i].iter().collect();
            // <<- strips leading tabs; << requires exact match
            let check_line = if heredoc_strip_tabs {
                line.trim_start_matches('\t')
            } else {
                &line
            };
            if check_line == delim.as_str() {
                heredoc_delimiter = None;
                heredoc_in_body = false;
                heredoc_strip_tabs = false;
            }
            if i < len {
                i += 1; // skip the \n
            }
            continue;
        }

        let ch = chars[i];

        // Skip \r (treat as whitespace, \r\n becomes just \n)
        if ch == '\r' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
                last_emitted_op = None;
            }
            i += 1;
            continue;
        }

        // Whitespace: space, tab
        if ch == ' ' || ch == '\t' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
                last_emitted_op = None;
            }
            i += 1;
            continue;
        }

        // Comment: # at start of token (not mid-word)
        if ch == '#' && !in_word {
            // Skip rest of line
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            // Don't consume the \n — let it be processed as an operator
            continue;
        }

        // Newline: command separator, continuation, or heredoc body start
        if ch == '\n' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
                last_emitted_op = None;
            }
            // If heredoc delimiter is set but body hasn't started, enter body mode
            if heredoc_delimiter.is_some() && !heredoc_in_body {
                heredoc_in_body = true;
                i += 1;
                continue;
            }
            // After |, &&, || → continuation (skip newline)
            let is_continuation = match &last_emitted_op {
                Some(op) => op == "|" || op == "&&" || op == "||",
                None => false,
            };
            if !is_continuation {
                let op = "\n".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
            }
            i += 1;
            continue;
        }

        // Single quote
        if ch == '\'' {
            in_word = true;
            i += 1;
            while i < len && chars[i] != '\'' {
                word.push(chars[i]);
                i += 1;
            }
            if i >= len {
                // Unmatched single quote — fail-open
                return fail_open(cmd);
            }
            i += 1; // skip closing '
            continue;
        }

        // Double quote
        if ch == '"' {
            in_word = true;
            i += 1;
            while i < len && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < len {
                    let next = chars[i + 1];
                    match next {
                        '"' | '\\' | '$' | '`' => {
                            word.push(next);
                            i += 2;
                        }
                        '\n' => {
                            // Line continuation inside double quotes
                            i += 2;
                        }
                        _ => {
                            word.push('\\');
                            word.push(next);
                            i += 2;
                        }
                    }
                    continue;
                }
                // $() inside double quotes — extract for recursive parsing
                if chars[i] == '$' && i + 1 < len && chars[i + 1] == '(' {
                    let start = i;
                    i += 2;
                    match find_matching_close_paren(&chars, i) {
                        Some((inner, new_i)) => {
                            i = new_i;
                            let subst_text: String = chars[start..i].iter().collect();
                            word.push_str(&subst_text);
                            if depth < MAX_SUBST_DEPTH {
                                let inner_segs = parse_segments_inner(&inner, depth + 1);
                                if !inner_segs.is_empty() {
                                    inner_segment_groups.push(inner_segs);
                                }
                            }
                        }
                        None => return fail_open(cmd),
                    }
                    continue;
                }
                // Backtick inside double quotes
                if chars[i] == '`' {
                    let start = i;
                    i += 1;
                    let mut inner = String::new();
                    while i < len && chars[i] != '`' {
                        inner.push(chars[i]);
                        i += 1;
                    }
                    if i >= len {
                        return fail_open(cmd);
                    }
                    i += 1; // skip closing `
                    let bt_text: String = chars[start..i].iter().collect();
                    word.push_str(&bt_text);
                    if depth < MAX_SUBST_DEPTH {
                        let inner_segs = parse_segments_inner(&inner, depth + 1);
                        if !inner_segs.is_empty() {
                            inner_segment_groups.push(inner_segs);
                        }
                    }
                    continue;
                }
                word.push(chars[i]);
                i += 1;
            }
            if i >= len {
                return fail_open(cmd);
            }
            i += 1; // skip closing "
            continue;
        }

        // Backslash outside quotes
        if ch == '\\' {
            if i + 1 >= len {
                // Dangling backslash — fail-open
                return fail_open(cmd);
            }
            let next = chars[i + 1];
            if next == '\n' {
                // Line continuation
                i += 2;
                continue;
            }
            in_word = true;
            word.push(next);
            i += 2;
            continue;
        }

        // $() command substitution outside quotes
        if ch == '$' && i + 1 < len && chars[i + 1] == '(' {
            let start = i;
            i += 2;
            match find_matching_close_paren(&chars, i) {
                Some((inner, new_i)) => {
                    i = new_i;
                    let subst_text: String = chars[start..i].iter().collect();
                    in_word = true;
                    word.push_str(&subst_text);
                    if depth < MAX_SUBST_DEPTH {
                        let inner_segs = parse_segments_inner(&inner, depth + 1);
                        if !inner_segs.is_empty() {
                            inner_segment_groups.push(inner_segs);
                        }
                    }
                }
                None => return fail_open(cmd),
            }
            continue;
        }

        // Backtick command substitution outside quotes
        if ch == '`' {
            let start = i;
            i += 1;
            let mut inner = String::new();
            while i < len && chars[i] != '`' {
                inner.push(chars[i]);
                i += 1;
            }
            if i >= len {
                return fail_open(cmd);
            }
            i += 1; // skip closing `
            let bt_text: String = chars[start..i].iter().collect();
            in_word = true;
            word.push_str(&bt_text);
            if depth < MAX_SUBST_DEPTH {
                let inner_segs = parse_segments_inner(&inner, depth + 1);
                if !inner_segs.is_empty() {
                    inner_segment_groups.push(inner_segs);
                }
            }
            continue;
        }

        // Redirect operators: > >> >& >|
        // Must be checked BEFORE & and | to prevent >& and >| from being
        // consumed by the & and | handlers respectively.
        if ch == '>' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
            }
            if i + 1 < len && chars[i + 1] == '>' {
                let op = ">>".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 2;
            } else if i + 1 < len && chars[i + 1] == '&' {
                let op = ">&".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 2;
            } else if i + 1 < len && chars[i + 1] == '|' {
                let op = ">|".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 2;
            } else {
                let op = ">".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 1;
            }
            continue;
        }

        // Control operators: &&, ||, |, ;, &, (, )
        // Also &> and &>> (bash: redirect stdout+stderr)
        if ch == '&' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
            }
            if i + 1 < len && chars[i + 1] == '&' {
                let op = "&&".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 2;
            } else if i + 1 < len && chars[i + 1] == '>' {
                // &> or &>> (bash extension: redirect both stdout and stderr)
                if i + 2 < len && chars[i + 2] == '>' {
                    let op = "&>>".to_string();
                    last_emitted_op = Some(op.clone());
                    tokens.push(Token::Operator(op));
                    i += 3;
                } else {
                    let op = "&>".to_string();
                    last_emitted_op = Some(op.clone());
                    tokens.push(Token::Operator(op));
                    i += 2;
                }
            } else {
                let op = "&".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 1;
            }
            continue;
        }

        if ch == '|' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
            }
            if i + 1 < len && chars[i + 1] == '|' {
                let op = "||".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 2;
            } else {
                let op = "|".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 1;
            }
            continue;
        }

        if ch == ';' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
            }
            let op = ";".to_string();
            last_emitted_op = Some(op.clone());
            tokens.push(Token::Operator(op));
            i += 1;
            continue;
        }

        if ch == '(' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
            }
            let op = "(".to_string();
            last_emitted_op = Some(op.clone());
            tokens.push(Token::Operator(op));
            i += 1;
            continue;
        }

        if ch == ')' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
            }
            let op = ")".to_string();
            last_emitted_op = Some(op.clone());
            tokens.push(Token::Operator(op));
            i += 1;
            continue;
        }

        // Heredoc: << (consume << and delimiter, skip body)
        if ch == '<' && i + 1 < len && chars[i + 1] == '<' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
            }
            i += 2;
            // Check for <<- (indented heredoc: strips leading tabs)
            if i < len && chars[i] == '-' {
                heredoc_strip_tabs = true;
                i += 1;
            }
            // Skip whitespace before delimiter
            while i < len && (chars[i] == ' ' || chars[i] == '\t') {
                i += 1;
            }
            // Capture delimiter
            if i < len {
                let mut delim = String::new();
                if chars[i] == '\'' || chars[i] == '"' {
                    let quote = chars[i];
                    i += 1;
                    while i < len && chars[i] != quote {
                        delim.push(chars[i]);
                        i += 1;
                    }
                    if i < len {
                        i += 1; // skip closing quote
                    }
                } else {
                    while i < len
                        && chars[i] != ' '
                        && chars[i] != '\t'
                        && chars[i] != '\n'
                        && chars[i] != ';'
                        && chars[i] != '&'
                        && chars[i] != '|'
                    {
                        delim.push(chars[i]);
                        i += 1;
                    }
                }
                if !delim.is_empty() {
                    // Set delimiter; the \n handler will enter body mode.
                    // Tokens on the rest of this line (e.g., `<< EOF && echo done`)
                    // are processed normally by the main loop.
                    heredoc_delimiter = Some(delim);
                }
            }
            continue;
        }

        // Redirect operators: < <& <>
        // The heredoc handler above consumed << and continue'd, so if we reach
        // here with '<', it's a single < (possibly followed by & or >).
        if ch == '<' {
            if in_word {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                in_word = false;
            }
            if i + 1 < len && chars[i + 1] == '&' {
                let op = "<&".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 2;
            } else if i + 1 < len && chars[i + 1] == '>' {
                let op = "<>".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 2;
            } else {
                let op = "<".to_string();
                last_emitted_op = Some(op.clone());
                tokens.push(Token::Operator(op));
                i += 1;
            }
            continue;
        }

        // Default: regular character, accumulate into word
        in_word = true;
        word.push(ch);
        i += 1;
    }

    // Emit final word if any
    if in_word {
        tokens.push(Token::Word(std::mem::take(&mut word)));
    }

    (tokens, inner_segment_groups)
}

/// Fail-open: return entire command as whitespace-split Word tokens, no inner segments.
fn fail_open(cmd: &str) -> (Vec<Token>, Vec<Vec<Segment>>) {
    let tokens: Vec<Token> = cmd
        .split_whitespace()
        .map(|w| Token::Word(w.to_string()))
        .collect();
    (tokens, Vec::new())
}

/// Find the matching `)` for a `$(` command substitution, tracking quote state
/// so that `)` inside quotes doesn't prematurely close the substitution.
/// Returns (inner_content, new_position) or None if unmatched.
fn find_matching_close_paren(chars: &[char], start: usize) -> Option<(String, usize)> {
    let len = chars.len();
    let mut i = start;
    let mut paren_depth = 1;
    let mut inner = String::new();
    let mut in_sq = false;
    let mut in_dq = false;

    while i < len && paren_depth > 0 {
        let c = chars[i];
        if in_sq {
            if c == '\'' {
                in_sq = false;
            }
            inner.push(c);
            i += 1;
            continue;
        }
        if in_dq {
            if c == '"' {
                in_dq = false;
            } else if c == '\\' && i + 1 < len {
                inner.push(c);
                inner.push(chars[i + 1]);
                i += 2;
                continue;
            }
            inner.push(c);
            i += 1;
            continue;
        }
        match c {
            '\'' => {
                in_sq = true;
                inner.push(c);
            }
            '"' => {
                in_dq = true;
                inner.push(c);
            }
            '(' => {
                paren_depth += 1;
                inner.push(c);
            }
            ')' => {
                paren_depth -= 1;
                if paren_depth > 0 {
                    inner.push(c);
                }
            }
            '\\' if i + 1 < len => {
                inner.push(c);
                inner.push(chars[i + 1]);
                i += 2;
                continue;
            }
            _ => {
                inner.push(c);
            }
        }
        i += 1;
    }

    if paren_depth > 0 {
        None
    } else {
        Some((inner, i))
    }
}

// ============================================================
// Segments: split tokens on operators, check each independently
// ============================================================

#[derive(Debug, Clone)]
pub struct Segment {
    pub tokens: Vec<Token>,
}

/// True if a token is the `git` command (handles full paths like /usr/bin/git).
fn is_git_command(token: &str) -> bool {
    token == "git" || token.ends_with("/git")
}

/// True if a token looks like a variable assignment (VAR=val).
fn is_var_assignment(token: &str) -> bool {
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
fn is_write_redirect(op: &str) -> bool {
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
            // The alternative (skipping flag+value) is worse: sudo -n git push would skip
            // -n AND git, returning "push" as the command — a more dangerous bypass.
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

    /// True if any Word token starts with `prefix`.
    pub fn has_token_starting_with(&self, prefix: &str) -> bool {
        self.tokens
            .iter()
            .any(|t| matches!(t, Token::Word(w) if w.starts_with(prefix)))
    }

    /// True if any Word token contains `substring`.
    pub fn has_token_containing(&self, substring: &str) -> bool {
        self.tokens
            .iter()
            .any(|t| matches!(t, Token::Word(w) if w.contains(substring)))
    }

    /// True if any Word token is a worktree ROOT directory path.
    pub fn targets_worktree_root(&self) -> bool {
        let prefix = "/workspace/.claude/worktrees/";
        self.tokens.iter().any(|t| {
            if let Token::Word(w) = t {
                if let Some(rest) = w.strip_prefix(prefix) {
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

    /// True if any Word token resolves to a protected workspace path.
    /// Handles both absolute and relative paths via is_protected_path().
    pub fn has_protected_path(&self) -> bool {
        self.tokens
            .iter()
            .any(|t| matches!(t, Token::Word(w) if is_protected_path(w)))
    }
}

/// Parse a command string into segments. Each segment is a separate command
/// (split on operators like &&, ||, |, ;, &, newline, (, )).
/// Also returns segments from command substitutions ($() and backticks).
pub fn parse_segments(cmd: &str) -> Vec<Segment> {
    parse_segments_inner(cmd, 0)
}

fn parse_segments_inner(cmd: &str, depth: usize) -> Vec<Segment> {
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

// ============================================================
// Path resolution
// ============================================================

/// Normalize a path logically (without filesystem access).
/// Resolves `.` and `..` components. Does NOT follow symlinks or
/// check existence — the target may not exist yet (write operations).
fn normalize_path(path: &std::path::Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                // Pop the last Normal component (go up one level).
                // Never pop RootDir or Prefix — can't go above filesystem root.
                if matches!(components.last(), Some(Component::Normal(_))) {
                    components.pop();
                }
            }
            Component::CurDir => {
                // Skip . (current directory)
            }
            c => {
                components.push(c);
            }
        }
    }
    components.iter().collect()
}

/// True if a path (absolute or relative) resolves to a protected location.
/// Protected = under /workspace/ but NOT under /workspace/.claude/worktrees/.
/// Relative paths are resolved against CWD. Fails open if CWD is unavailable.
fn is_protected_path(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    let resolved = if path.starts_with('/') {
        normalize_path(std::path::Path::new(path))
    } else {
        match std::env::current_dir() {
            Ok(cwd) => normalize_path(&cwd.join(path)),
            Err(_) => return false, // fail-open
        }
    };
    let s = resolved.to_string_lossy();
    s.starts_with("/workspace/") && !s.starts_with("/workspace/.claude/worktrees/")
}

// ============================================================
// CWD helpers
// ============================================================

fn is_workspace_cwd() -> bool {
    std::env::current_dir()
        .map(|p| {
            let s = p.to_string_lossy();
            s == "/workspace" || s == "/workspace/"
        })
        .unwrap_or(false) // fail-open: don't block CWD-dependent checks
}

fn is_worktree_cwd() -> bool {
    std::env::current_dir()
        .map(|p| {
            p.to_string_lossy()
                .starts_with("/workspace/.claude/worktrees/")
        })
        .unwrap_or(true) // fail-open: assume worktree, allow checkout/switch
}

// ============================================================
// Check functions
// ============================================================

/// Run all Edit/Write checks. Returns Some(reason) to block, None to allow.
pub fn check_edit(input: &serde_json::Value) -> Option<String> {
    let file_path = input["tool_input"]["file_path"].as_str().unwrap_or("");

    // Protected files
    let basename = file_path.rsplit('/').next().unwrap_or(file_path);
    if file_path.contains("package-lock.json")
        || file_path.contains("src/wasm/scheduler/")
        || basename == ".env"
        || basename.starts_with(".env.")
    {
        return Some(format!(
            "Protected file — do not modify: {}. \
             package-lock.json is managed by npm, .env files contain secrets, \
             and src/wasm/scheduler/ is generated by the Rust build. \
             See CLAUDE.md for architecture constraints.",
            file_path
        ));
    }

    // Workspace isolation
    if is_protected_path(file_path) {
        return Some(
            "Do not edit files directly in /workspace — it must stay on main. \
             Create a worktree first: git worktree add /workspace/.claude/worktrees/<name> -b <branch>. \
             See .claude/worktrees/CLAUDE.md for the full worktree workflow."
                .to_string(),
        );
    }

    // CWD enforcement for worktree files
    if file_path.starts_with("/workspace/.claude/worktrees/") {
        if let Ok(cwd) = std::env::current_dir() {
            let cwd_str = cwd.to_string_lossy();
            if cwd_str == "/workspace" || cwd_str == "/workspace/" {
                return Some(
                    "You are editing a worktree file but your CWD is /workspace. \
                     Enter the worktree first (use the EnterWorktree tool or cd into it). \
                     Only the admin works from /workspace."
                        .to_string(),
                );
            }
        }
    }

    None
}

/// Run all Bash checks. Returns Some(reason) to block, None to allow.
pub fn check_bash(input: &serde_json::Value) -> Option<String> {
    let cmd = input["tool_input"]["command"].as_str().unwrap_or("");

    let segments = parse_segments(cmd);

    // push-to-main: block any push targeting the default branch.
    // Catches: git push origin main, git push origin HEAD:main,
    // git push origin feature:refs/heads/main, etc.
    for seg in &segments {
        if seg.is_git("push") {
            let targets_main = seg.tokens.iter().any(|t| {
                if let Token::Word(w) = t {
                    w == "main" || w.ends_with(":main") || w.ends_with(":refs/heads/main")
                } else {
                    false
                }
            });
            if targets_main {
                return Some(
                    "Cannot push directly to main. Use a feature branch and PR.".to_string(),
                );
            }
        }
    }

    // checkout-switch (CWD-dependent)
    for seg in &segments {
        if (seg.is_git("checkout") || seg.is_git("switch"))
            && !seg.has_arg("--")
            && !seg.has_short_flag('b')
            && !seg.has_short_flag('B')
            && !seg.has_short_flag('c')
            && !seg.has_token_containing("worktree")
            && !is_worktree_cwd()
        {
            return Some(
                "Do not use git checkout/switch in /workspace. \
                 Use a worktree: git worktree add /workspace/.claude/worktrees/<name> -b <branch>"
                    .to_string(),
            );
        }
    }

    // reset-hard: always block in /workspace (shared state).
    // In worktrees, only block without origin/ ref (likely mistake).
    // reset --hard origin/main is the documented squash-merge cleanup step.
    for seg in &segments {
        if seg.is_git("reset") && seg.has_arg("--hard") {
            if is_workspace_cwd() {
                return Some(
                    "Do not run git reset --hard in /workspace — it modifies shared state \
                     that other agents depend on. If you need to sync after a squash merge, \
                     run git reset --hard origin/<branch> in your own worktree instead. \
                     See .claude/worktrees/CLAUDE.md."
                        .to_string(),
                );
            }
            if !seg.has_token_starting_with("origin/") {
                return Some(
                    "git reset --hard without an origin/ ref will discard uncommitted work. \
                     If syncing after a squash merge, use: git reset --hard origin/<branch>. \
                     If you intend to discard local changes, specify the target explicitly. \
                     See .claude/worktrees/CLAUDE.md for the cleanup procedure."
                        .to_string(),
                );
            }
        }
    }

    // clean-force: block in /workspace (shared state).
    // Allow in worktrees — agents legitimately clean build artifacts.
    for seg in &segments {
        if seg.is_git("clean")
            && (seg.has_short_flag('f') || seg.has_arg("--force"))
            && is_workspace_cwd()
        {
            return Some(
                "Do not run git clean -f in /workspace — it permanently deletes \
                 untracked files in shared state. Run this in your own worktree instead. \
                 Review files first with git clean -n."
                    .to_string(),
            );
        }
    }

    // branch-force-delete: block in /workspace (could delete other agents' branches).
    // Allow in worktrees — needed for squash-merge cleanup where -d fails.
    for seg in &segments {
        if seg.is_git("branch") && seg.has_short_flag('D') && is_workspace_cwd() {
            return Some(
                "Do not run git branch -D in /workspace — it could delete another agent's \
                 branch. Use git branch -d (lowercase) which checks merge status, or run \
                 from your own worktree. See .claude/worktrees/CLAUDE.md for cleanup procedure."
                    .to_string(),
            );
        }
    }

    // worktree-remove
    for seg in &segments {
        if seg.is_git("worktree") && seg.has_arg("remove") {
            // Check if the target worktree is the agent's own CWD.
            // Removing your own CWD breaks all subsequent Bash calls.
            // Removing a DIFFERENT worktree is safe for the caller but risks
            // destroying another agent's in-progress work.
            let target_is_cwd = if let Ok(cwd) = std::env::current_dir() {
                let cwd_normalized = normalize_path(&cwd);
                seg.tokens.iter().any(|t| {
                    if let Token::Word(w) = t {
                        let w_normalized = normalize_path(std::path::Path::new(w));
                        w_normalized == cwd_normalized
                    } else {
                        false
                    }
                })
            } else {
                true // fail-safe: can't determine CWD, assume self-removal
            };

            if target_is_cwd {
                return Some(
                    "Do not use git worktree remove on your own CWD — it will break \
                     all subsequent Bash calls. Use ExitWorktree with action: \"remove\" \
                     to safely clean up (restores CWD, deletes directory and branch). \
                     See .claude/worktrees/CLAUDE.md for the full cleanup procedure."
                        .to_string(),
                );
            }

            // Check if target is under the worktrees directory — if so, it could
            // be another agent's active workspace. Block with strong warning.
            // Normalize paths to catch ../ escape attempts.
            let targets_worktree_dir = seg.tokens.iter().any(|t| {
                if let Token::Word(w) = t {
                    let normalized = normalize_path(std::path::Path::new(w));
                    normalized
                        .to_string_lossy()
                        .starts_with("/workspace/.claude/worktrees/")
                } else {
                    false
                }
            });
            if targets_worktree_dir {
                return Some(
                    "⚠️  STOP — You are about to remove a worktree that may belong to \
                     another agent. Read this FULLY before proceeding.\n\n\
                     NEVER remove another agent's worktree. Other agents may be \
                     actively working in sibling worktrees even if they look idle.\n\n\
                     You may ONLY remove a worktree if ALL of these are true:\n\
                     1. YOU created it (in this session or a previous one)\n\
                     2. Its PR is merged OR it was a test/scratch worktree\n\
                     3. You have verified no other agent is using it\n\n\
                     If this is your own orphaned worktree, ask the user to remove it, \
                     or use: git -C /workspace worktree remove <path>"
                        .to_string(),
                );
            }

            // Target is not under /workspace/.claude/worktrees/ (e.g. /tmp/wt) —
            // not an agent worktree, safe to remove.
        }
    }

    // rm-worktree-root
    for seg in &segments {
        let cmd_name = seg.effective_command().map(|(_, c)| c);
        if cmd_name == Some("rm")
            && (seg.has_short_flag('r') || seg.has_short_flag('f'))
            && seg.targets_worktree_root()
        {
            return Some(
                "Do not use rm -rf to delete worktrees. It breaks your CWD and leaves \
                 orphaned branches. Use ExitWorktree with action: \"remove\" instead — \
                 it safely restores CWD, deletes the directory, and removes the branch. \
                 See .claude/worktrees/CLAUDE.md for the full cleanup procedure."
                    .to_string(),
            );
        }
    }

    // workspace-file-modification: sed -i
    for seg in &segments {
        let cmd_name = seg.effective_command().map(|(_, c)| c);
        if cmd_name == Some("sed")
            && (seg.has_arg("-i") || seg.has_token_starting_with("-i"))
            && seg.has_protected_path()
        {
            return Some(
                "Do not modify files directly in /workspace via Bash. Use a worktree.".to_string(),
            );
        }
        // tee
        if cmd_name == Some("tee") && seg.has_protected_path() {
            return Some(
                "Do not modify files directly in /workspace via Bash. Use a worktree.".to_string(),
            );
        }
    }

    // interpreter-workspace: scan code arguments to python/node/perl/ruby
    // for workspace paths. We can't parse these languages, but we can detect
    // hardcoded /workspace/ paths in inline code — agents have no legitimate
    // reason to embed absolute workspace paths in interpreter code.
    for seg in &segments {
        if let Some((cmd_pos, cmd)) = seg.effective_command() {
            if let Some(flag) = script_interpreter_flag(cmd) {
                // Find the inline code flag and its argument
                if let Some(f_pos) = seg.tokens[cmd_pos + 1..]
                    .iter()
                    .position(|t| matches!(t, Token::Word(w) if w == flag))
                {
                    let arg_pos = cmd_pos + 1 + f_pos + 1;
                    if let Some(Token::Word(code)) = seg.tokens.get(arg_pos) {
                        if code.contains("/workspace/")
                            && !code.contains("/workspace/.claude/worktrees/")
                        {
                            return Some(
                                "Do not use interpreter code to access /workspace/ directly. \
                                 Use a worktree. Detected /workspace/ path in inline code \
                                 argument to a script interpreter."
                                    .to_string(),
                            );
                        }
                    }
                }
            }
        }
    }

    // Redirect check: type-safe via Token::Operator.
    // All write-capable redirect operators are blocked:
    //   >  (truncate), >> (append), >| (clobber),
    //   >& (dup — with path target, acts as > + 2>&1),
    //   <> (read-write open).
    // Not blocked: < (input only), <& (fd dup, no path write).
    // Quoted/escaped > produces Word(">") and is naturally excluded.
    // No-space redirects (echo>/workspace/file) are properly tokenized as
    // [Word("echo"), Operator(">"), Word("/workspace/file")].
    for seg in &segments {
        for j in 0..seg.tokens.len() {
            if let Token::Operator(op) = &seg.tokens[j] {
                if is_write_redirect(op) {
                    if let Some(Token::Word(path)) = seg.tokens.get(j + 1) {
                        if is_protected_path(path) {
                            return Some(
                                "Do not modify files directly in /workspace via Bash. Use a worktree."
                                    .to_string(),
                            );
                        }
                    }
                }
            }
        }
    }

    None
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// True if tests are running from /workspace (vs a worktree).
    /// CWD-dependent checks (clean -f, branch -D) block in /workspace, allow in worktrees.
    fn in_workspace() -> bool {
        is_workspace_cwd()
    }

    // Helper to extract word strings from tokens
    fn words(tokens: &[Token]) -> Vec<&str> {
        tokens
            .iter()
            .filter_map(|t| match t {
                Token::Word(w) => Some(w.as_str()),
                _ => None,
            })
            .collect()
    }

    fn tok(cmd: &str) -> Vec<Token> {
        tokenize(cmd).0
    }

    fn w(s: &str) -> Token {
        Token::Word(s.to_string())
    }

    fn op(s: &str) -> Token {
        Token::Operator(s.to_string())
    }

    // ================================================================
    // Layer 1: Tokenizer Tests
    // ================================================================

    // --- 1.1 Basic word splitting ---

    #[test]
    fn l1_empty() {
        assert_eq!(tok(""), Vec::<Token>::new());
    }

    #[test]
    fn l1_whitespace_only() {
        assert_eq!(tok("   "), Vec::<Token>::new());
    }

    #[test]
    fn l1_single_word() {
        assert_eq!(tok("hello"), vec![w("hello")]);
    }

    #[test]
    fn l1_two_words() {
        assert_eq!(tok("hello world"), vec![w("hello"), w("world")]);
    }

    #[test]
    fn l1_multi_space() {
        assert_eq!(tok("hello  world"), vec![w("hello"), w("world")]);
    }

    #[test]
    fn l1_tabs() {
        assert_eq!(tok("\thello\tworld"), vec![w("hello"), w("world")]);
    }

    #[test]
    fn l1_leading_trailing() {
        assert_eq!(tok("  hello  world  "), vec![w("hello"), w("world")]);
    }

    // --- 1.2 Single quotes ---

    #[test]
    fn l1_single_quote_basic() {
        assert_eq!(tok("'hello world'"), vec![w("hello world")]);
    }

    #[test]
    fn l1_single_quote_empty() {
        assert_eq!(tok("''"), vec![w("")]);
    }

    #[test]
    fn l1_single_quote_with_cmd() {
        assert_eq!(tok("echo 'hello world'"), vec![w("echo"), w("hello world")]);
    }

    #[test]
    fn l1_single_quote_adjacent() {
        assert_eq!(tok("'hello'world"), vec![w("helloworld")]);
    }

    #[test]
    fn l1_single_quote_mid_word() {
        assert_eq!(tok("hello'world'"), vec![w("helloworld")]);
    }

    #[test]
    fn l1_single_quote_adjacent_quoted() {
        assert_eq!(tok("'hello''world'"), vec![w("helloworld")]);
    }

    #[test]
    fn l1_single_quote_operators_literal() {
        assert_eq!(tok("echo ';&&||'"), vec![w("echo"), w(";&&||")]);
    }

    #[test]
    fn l1_single_quote_unmatched() {
        // Fail-open: whitespace split
        let result = tok("echo 'hello");
        assert!(result.iter().all(|t| matches!(t, Token::Word(_))));
    }

    // --- 1.3 Double quotes ---

    #[test]
    fn l1_double_quote_basic() {
        assert_eq!(tok("\"hello world\""), vec![w("hello world")]);
    }

    #[test]
    fn l1_double_quote_empty() {
        assert_eq!(tok("\"\""), vec![w("")]);
    }

    #[test]
    fn l1_double_quote_with_cmd() {
        assert_eq!(
            tok("echo \"hello world\""),
            vec![w("echo"), w("hello world")]
        );
    }

    #[test]
    fn l1_double_quote_adjacent() {
        assert_eq!(tok("\"hello\"world"), vec![w("helloworld")]);
    }

    #[test]
    fn l1_double_quote_mid_word() {
        assert_eq!(tok("hello\"world\""), vec![w("helloworld")]);
    }

    #[test]
    fn l1_double_quote_escaped_inner() {
        assert_eq!(tok("\"he said \\\"hi\\\"\""), vec![w("he said \"hi\"")]);
    }

    #[test]
    fn l1_double_quote_escaped_backslash() {
        assert_eq!(tok("\"path\\\\to\\\\file\""), vec![w("path\\to\\file")]);
    }

    #[test]
    fn l1_double_quote_backslash_n() {
        // \n inside double quotes is NOT special (literal \n)
        assert_eq!(tok("\"hello\\nworld\""), vec![w("hello\\nworld")]);
    }

    #[test]
    fn l1_double_quote_dollar() {
        assert_eq!(tok("\"$HOME/dir\""), vec![w("$HOME/dir")]);
    }

    #[test]
    fn l1_double_quote_unmatched() {
        let result = tok("echo \"hello");
        assert!(result.iter().all(|t| matches!(t, Token::Word(_))));
    }

    #[test]
    fn l1_double_quote_operators_literal() {
        assert_eq!(tok("\"hello;world&&test\""), vec![w("hello;world&&test")]);
    }

    #[test]
    fn l1_double_quote_escaped_dollar() {
        assert_eq!(tok("\"\\$HOME/dir\""), vec![w("$HOME/dir")]);
    }

    #[test]
    fn l1_double_quote_escaped_backtick() {
        assert_eq!(tok("\"\\`git push\\`\""), vec![w("`git push`")]);
    }

    #[test]
    fn l1_double_quote_line_continuation() {
        assert_eq!(tok("\"hello\\\nworld\""), vec![w("helloworld")]);
    }

    // --- 1.4 Backslash escaping ---

    #[test]
    fn l1_backslash_space() {
        assert_eq!(tok("hello\\ world"), vec![w("hello world")]);
    }

    #[test]
    fn l1_backslash_semicolon() {
        assert_eq!(tok("hello\\;world"), vec![w("hello;world")]);
    }

    #[test]
    fn l1_backslash_ampersand() {
        assert_eq!(tok("hello\\&world"), vec![w("hello&world")]);
    }

    #[test]
    fn l1_backslash_double_quote() {
        assert_eq!(tok("hello\\\"world"), vec![w("hello\"world")]);
    }

    #[test]
    fn l1_backslash_backslash() {
        assert_eq!(tok("hello\\\\world"), vec![w("hello\\world")]);
    }

    #[test]
    fn l1_backslash_n_outside() {
        // \n outside quotes = literal 'n' (not newline)
        assert_eq!(tok("hello\\nworld"), vec![w("hellonworld")]);
    }

    #[test]
    fn l1_dangling_backslash() {
        let result = tok("hello\\");
        assert!(result.iter().all(|t| matches!(t, Token::Word(_))));
    }

    // --- 1.5 Operators ---

    #[test]
    fn l1_op_and() {
        assert_eq!(tok("a && b"), vec![w("a"), op("&&"), w("b")]);
    }

    #[test]
    fn l1_op_or() {
        assert_eq!(tok("a || b"), vec![w("a"), op("||"), w("b")]);
    }

    #[test]
    fn l1_op_pipe() {
        assert_eq!(tok("a | b"), vec![w("a"), op("|"), w("b")]);
    }

    #[test]
    fn l1_op_semi() {
        assert_eq!(tok("a ; b"), vec![w("a"), op(";"), w("b")]);
    }

    #[test]
    fn l1_op_bg() {
        assert_eq!(tok("a & b"), vec![w("a"), op("&"), w("b")]);
    }

    #[test]
    fn l1_op_and_nospace() {
        assert_eq!(tok("a&&b"), vec![w("a"), op("&&"), w("b")]);
    }

    #[test]
    fn l1_op_or_nospace() {
        assert_eq!(tok("a||b"), vec![w("a"), op("||"), w("b")]);
    }

    #[test]
    fn l1_op_pipe_nospace() {
        assert_eq!(tok("a|b"), vec![w("a"), op("|"), w("b")]);
    }

    #[test]
    fn l1_op_semi_nospace() {
        assert_eq!(tok("a;b"), vec![w("a"), op(";"), w("b")]);
    }

    #[test]
    fn l1_op_bg_nospace() {
        assert_eq!(tok("a&b"), vec![w("a"), op("&"), w("b")]);
    }

    #[test]
    fn l1_op_only() {
        assert_eq!(tok("&&"), vec![op("&&")]);
    }

    #[test]
    fn l1_op_all() {
        assert_eq!(
            tok("a && b || c ; d | e & f"),
            vec![
                w("a"),
                op("&&"),
                w("b"),
                op("||"),
                w("c"),
                op(";"),
                w("d"),
                op("|"),
                w("e"),
                op("&"),
                w("f")
            ]
        );
    }

    #[test]
    fn l1_op_leading_semi() {
        assert_eq!(tok("; echo hi"), vec![op(";"), w("echo"), w("hi")]);
    }

    #[test]
    fn l1_op_trailing_semi() {
        assert_eq!(tok("echo hi;"), vec![w("echo"), w("hi"), op(";")]);
    }

    #[test]
    fn l1_op_all_nospace() {
        assert_eq!(
            tok("a&&b||c;d|e&f"),
            vec![
                w("a"),
                op("&&"),
                w("b"),
                op("||"),
                w("c"),
                op(";"),
                w("d"),
                op("|"),
                w("e"),
                op("&"),
                w("f")
            ]
        );
    }

    #[test]
    fn l1_op_double_semi() {
        assert_eq!(tok(";;"), vec![op(";"), op(";")]);
    }

    #[test]
    fn l1_op_double_semi_spaced() {
        assert_eq!(tok("a ;; b"), vec![w("a"), op(";"), op(";"), w("b")]);
    }

    // --- 1.6 Newlines as operators ---

    #[test]
    fn l1_newline_separator() {
        assert_eq!(
            tok("echo a\necho b"),
            vec![w("echo"), w("a"), op("\n"), w("echo"), w("b")]
        );
    }

    #[test]
    fn l1_double_newline() {
        assert_eq!(
            tok("echo a\n\necho b"),
            vec![w("echo"), w("a"), op("\n"), op("\n"), w("echo"), w("b")]
        );
    }

    #[test]
    fn l1_crlf() {
        assert_eq!(
            tok("echo a\r\necho b"),
            vec![w("echo"), w("a"), op("\n"), w("echo"), w("b")]
        );
    }

    #[test]
    fn l1_bare_cr() {
        assert_eq!(
            tok("echo a\recho b"),
            vec![w("echo"), w("a"), w("echo"), w("b")]
        );
    }

    // --- 1.7 Newlines inside quotes ---

    #[test]
    fn l1_newline_in_single_quotes() {
        assert_eq!(
            tok("echo 'hello\nworld'"),
            vec![w("echo"), w("hello\nworld")]
        );
    }

    #[test]
    fn l1_newline_in_double_quotes() {
        assert_eq!(
            tok("echo \"hello\nworld\""),
            vec![w("echo"), w("hello\nworld")]
        );
    }

    // --- 1.8 Line continuation ---

    #[test]
    fn l1_continuation() {
        assert_eq!(tok("echo hello\\\nworld"), vec![w("echo"), w("helloworld")]);
    }

    #[test]
    fn l1_continuation_with_indent() {
        assert_eq!(tok("echo \\\n  world"), vec![w("echo"), w("world")]);
    }

    // --- 1.9 Comments ---

    #[test]
    fn l1_comment_inline() {
        assert_eq!(tok("echo hi # comment"), vec![w("echo"), w("hi")]);
    }

    #[test]
    fn l1_comment_full_line() {
        assert_eq!(tok("# full line comment"), Vec::<Token>::new());
    }

    #[test]
    fn l1_hash_mid_word() {
        assert_eq!(
            tok("echo hi#notcomment"),
            vec![w("echo"), w("hi#notcomment")]
        );
    }

    #[test]
    fn l1_hash_in_single_quotes() {
        assert_eq!(
            tok("echo '#not comment'"),
            vec![w("echo"), w("#not comment")]
        );
    }

    #[test]
    fn l1_hash_in_double_quotes() {
        assert_eq!(
            tok("echo \"#not comment\""),
            vec![w("echo"), w("#not comment")]
        );
    }

    #[test]
    fn l1_comment_then_newline() {
        assert_eq!(
            tok("echo hi # comment\necho b"),
            vec![w("echo"), w("hi"), op("\n"), w("echo"), w("b")]
        );
    }

    // --- 1.10 Heredocs ---

    #[test]
    fn l1_heredoc_basic() {
        assert_eq!(words(&tok("cat << EOF\nhello\nworld\nEOF")), vec!["cat"]);
    }

    #[test]
    fn l1_heredoc_quoted_delimiter() {
        assert_eq!(words(&tok("cat << 'EOF'\nhello\nworld\nEOF")), vec!["cat"]);
    }

    #[test]
    fn l1_heredoc_indented() {
        assert_eq!(words(&tok("cat <<- EOF\n\thello\nEOF")), vec!["cat"]);
    }

    #[test]
    fn l1_heredoc_with_post_command() {
        let tokens = tok("cat << EOF && echo done\nbody\nEOF");
        assert_eq!(tokens, vec![w("cat"), op("&&"), w("echo"), w("done")]);
    }

    #[test]
    fn l1_heredoc_empty_body() {
        assert_eq!(words(&tok("cat << EOF\nEOF")), vec!["cat"]);
    }

    #[test]
    fn l1_heredoc_no_body() {
        // EOF without body — fail-open to just [cat]
        assert_eq!(words(&tok("cat << EOF")), vec!["cat"]);
    }

    #[test]
    fn l1_heredoc_unclosed() {
        // No closing delimiter — fail-open
        assert_eq!(words(&tok("cat << EOF\nhello world")), vec!["cat"]);
    }

    // --- 1.11 Command substitution ---

    #[test]
    fn l1_cmd_subst_basic() {
        let (tokens, inner) = tokenize("echo $(cmd)");
        assert_eq!(tokens, vec![w("echo"), w("$(cmd)")]);
        assert!(!inner.is_empty());
    }

    #[test]
    fn l1_cmd_subst_git_push() {
        let (tokens, inner) = tokenize("echo $(git push origin main)");
        assert_eq!(tokens, vec![w("echo"), w("$(git push origin main)")]);
        assert!(!inner.is_empty());
        assert!(inner[0].iter().any(|s| s.is_git("push")));
    }

    #[test]
    fn l1_cmd_subst_assignment() {
        let (tokens, inner) = tokenize("result=$(cmd1 && cmd2)");
        assert_eq!(tokens.len(), 1); // one word: result=$(...)
        assert!(!inner.is_empty());
    }

    #[test]
    fn l1_cmd_subst_backtick() {
        let (tokens, inner) = tokenize("echo `git push origin main`");
        assert_eq!(tokens.len(), 2);
        assert!(!inner.is_empty());
        assert!(inner[0].iter().any(|s| s.is_git("push")));
    }

    #[test]
    fn l1_cmd_subst_unclosed_paren() {
        let result = tok("echo $(echo");
        assert!(result.iter().all(|t| matches!(t, Token::Word(_))));
    }

    #[test]
    fn l1_cmd_subst_unclosed_backtick() {
        let result = tok("echo `git push");
        assert!(result.iter().all(|t| matches!(t, Token::Word(_))));
    }

    #[test]
    fn l1_cmd_subst_in_dquotes() {
        let (tokens, inner) = tokenize("echo \"$(git push origin main)\"");
        assert_eq!(tokens.len(), 2);
        assert!(!inner.is_empty());
        assert!(inner[0].iter().any(|s| s.is_git("push")));
    }

    // --- 1.12 Subshells ---

    #[test]
    fn l1_subshell_parens() {
        assert_eq!(
            tok("(git push origin main)"),
            vec![
                op("("),
                w("git"),
                w("push"),
                w("origin"),
                w("main"),
                op(")")
            ]
        );
    }

    #[test]
    fn l1_subshell_with_chain() {
        let tokens = tok("(cd /tmp && git push origin main)");
        assert!(tokens.contains(&op("(")));
        assert!(tokens.contains(&op("&&")));
        assert!(tokens.contains(&op(")")));
    }

    #[test]
    fn l1_brace_group() {
        let tokens = tok("{ git push origin main; }");
        assert_eq!(tokens[0], w("{"));
        assert!(tokens.contains(&op(";")));
    }

    // --- 1.13 Redirects ---

    #[test]
    fn l1_redirect_gt() {
        assert_eq!(
            tok("echo hello > /tmp/file"),
            vec![w("echo"), w("hello"), op(">"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_append() {
        assert_eq!(
            tok("echo hello >> /tmp/file"),
            vec![w("echo"), w("hello"), op(">>"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_clobber() {
        assert_eq!(
            tok("echo hello >| /tmp/file"),
            vec![w("echo"), w("hello"), op(">|"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_fd_dup() {
        assert_eq!(tok("echo >&2"), vec![w("echo"), op(">&"), w("2")]);
    }

    #[test]
    fn l1_redirect_input() {
        assert_eq!(
            tok("cat < /tmp/file"),
            vec![w("cat"), op("<"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_input_dup() {
        assert_eq!(tok("cmd <& 3"), vec![w("cmd"), op("<&"), w("3")]);
    }

    #[test]
    fn l1_redirect_readwrite() {
        assert_eq!(
            tok("cmd <> /tmp/file"),
            vec![w("cmd"), op("<>"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_nospace() {
        // Bash: echo>/tmp/file is a redirect — > splits the token
        assert_eq!(
            tok("echo>/tmp/file"),
            vec![w("echo"), op(">"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_fd_nospace() {
        // Bash: 2>/dev/null — digit before > is the fd number
        assert_eq!(tok("2>/dev/null"), vec![w("2"), op(">"), w("/dev/null")]);
    }

    #[test]
    fn l1_redirect_append_nospace() {
        assert_eq!(
            tok("echo>>/tmp/file"),
            vec![w("echo"), op(">>"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_escaped_gt() {
        // Backslash escapes > — becomes Word, not Operator
        assert_eq!(
            tok("echo \\> /tmp/file"),
            vec![w("echo"), w(">"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_single_quoted_gt() {
        assert_eq!(
            tok("echo '>' /tmp/file"),
            vec![w("echo"), w(">"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_double_quoted_gt() {
        assert_eq!(
            tok("echo \">\" /tmp/file"),
            vec![w("echo"), w(">"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_quoted_word_then_gt() {
        // Quoted word immediately followed by > — word ends, > is operator
        assert_eq!(
            tok("\"echo\">/tmp/file"),
            vec![w("echo"), op(">"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_backslash_nospace() {
        // echo 2\>/dev/null — backslash escapes >, preventing split
        assert_eq!(tok("echo 2\\>/dev/null"), vec![w("echo"), w("2>/dev/null")]);
    }

    #[test]
    fn l1_redirect_fd_dup_stderr() {
        assert_eq!(
            tok("echo >&2 hello"),
            vec![w("echo"), op(">&"), w("2"), w("hello")]
        );
    }

    #[test]
    fn l1_redirect_ampersand_gt() {
        // &> redirects both stdout and stderr (bash extension)
        assert_eq!(
            tok("echo hello &> /tmp/file"),
            vec![w("echo"), w("hello"), op("&>"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_ampersand_gt_append() {
        // &>> appends both stdout and stderr
        assert_eq!(
            tok("echo hello &>> /tmp/file"),
            vec![w("echo"), w("hello"), op("&>>"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_ampersand_gt_nospace() {
        // echo&>/tmp/file
        assert_eq!(
            tok("echo&>/tmp/file"),
            vec![w("echo"), op("&>"), w("/tmp/file")]
        );
    }

    // --- 1.14 Unicode ---

    #[test]
    fn l1_unicode() {
        assert_eq!(
            tok("git commit -m '日本語'"),
            vec![w("git"), w("commit"), w("-m"), w("日本語")]
        );
    }

    #[test]
    fn l1_escaped_space_in_filename() {
        assert_eq!(
            tok("git add file\\ name.txt"),
            vec![w("git"), w("add"), w("file name.txt")]
        );
    }

    // --- 1.15 Quote nesting ---

    #[test]
    fn l1_double_in_single() {
        assert_eq!(tok("'he said \"hi\"'"), vec![w("he said \"hi\"")]);
    }

    #[test]
    fn l1_single_in_double() {
        assert_eq!(tok("\"he said 'hi'\""), vec![w("he said 'hi'")]);
    }

    // --- 1.16 Adjacent quoting ---

    #[test]
    fn l1_adjacent_dquote_word() {
        assert_eq!(tok("hello\"world\""), vec![w("helloworld")]);
    }

    #[test]
    fn l1_adjacent_word_dquote() {
        assert_eq!(tok("\"hello\"world"), vec![w("helloworld")]);
    }

    #[test]
    fn l1_adjacent_mixed() {
        assert_eq!(tok("'a'\"b\"'c'"), vec![w("abc")]);
    }

    #[test]
    fn l1_adjacent_with_space() {
        assert_eq!(tok("\"first\"' '\"second\""), vec![w("first second")]);
    }

    // --- 1.17 Operator longest match ---

    #[test]
    fn l1_quadruple_and() {
        assert_eq!(tok("a&&&&b"), vec![w("a"), op("&&"), op("&&"), w("b")]);
    }

    #[test]
    fn l1_triple_pipe() {
        assert_eq!(tok("a|||b"), vec![w("a"), op("||"), op("|"), w("b")]);
    }

    #[test]
    fn l1_triple_and() {
        assert_eq!(tok("a&&&b"), vec![w("a"), op("&&"), op("&"), w("b")]);
    }

    // --- 1.18 Context-dependent newlines ---

    #[test]
    fn l1_newline_after_pipe() {
        assert_eq!(
            tok("echo a |\necho b"),
            vec![w("echo"), w("a"), op("|"), w("echo"), w("b")]
        );
    }

    #[test]
    fn l1_newline_after_and() {
        assert_eq!(
            tok("echo a &&\necho b"),
            vec![w("echo"), w("a"), op("&&"), w("echo"), w("b")]
        );
    }

    #[test]
    fn l1_newline_after_or() {
        assert_eq!(
            tok("echo a ||\necho b"),
            vec![w("echo"), w("a"), op("||"), w("echo"), w("b")]
        );
    }

    #[test]
    fn l1_bare_newline_is_separator() {
        assert_eq!(
            tok("echo a\necho b"),
            vec![w("echo"), w("a"), op("\n"), w("echo"), w("b")]
        );
    }

    // --- 1.19 Variable assignments ---

    #[test]
    fn l1_var_assignment_prefix() {
        assert_eq!(
            tok("VAR=val git push"),
            vec![w("VAR=val"), w("git"), w("push")]
        );
    }

    #[test]
    fn l1_multi_assignment() {
        assert_eq!(
            tok("A=1 B=2 git push"),
            vec![w("A=1"), w("B=2"), w("git"), w("push")]
        );
    }

    #[test]
    fn l1_assignment_only() {
        assert_eq!(tok("VAR=val"), vec![w("VAR=val")]);
    }

    // --- 1.20 $() in dquotes vs squotes ---

    #[test]
    fn l1_subst_in_dquotes() {
        let (_, inner) = tokenize("\"$(git push origin main)\"");
        assert!(!inner.is_empty());
    }

    #[test]
    fn l1_subst_in_squotes() {
        let (_, inner) = tokenize("'$(git push origin main)'");
        assert!(inner.is_empty()); // NOT extracted in single quotes
    }

    // --- 1.21 Background operator ---

    #[test]
    fn l1_background() {
        assert_eq!(
            tok("echo hi & git push"),
            vec![w("echo"), w("hi"), op("&"), w("git"), w("push")]
        );
    }

    #[test]
    fn l1_background_trailing() {
        assert_eq!(tok("cmd&"), vec![w("cmd"), op("&")]);
    }

    #[test]
    fn l1_and_not_double_bg() {
        assert_eq!(tok("cmd &&"), vec![w("cmd"), op("&&")]);
    }

    // --- 1.22 Adversarial ---

    #[test]
    fn l1_all_and_ops() {
        assert_eq!(
            tok("&&&&&&&&"),
            vec![op("&&"), op("&&"), op("&&"), op("&&")]
        );
    }

    #[test]
    fn l1_all_pipe_ops() {
        assert_eq!(
            tok("||||||||"),
            vec![op("||"), op("||"), op("||"), op("||")]
        );
    }

    #[test]
    fn l1_all_semi_ops() {
        assert_eq!(tok(";;;;"), vec![op(";"), op(";"), op(";"), op(";")]);
    }

    #[test]
    fn l1_mixed_special() {
        // Just verify no panic
        let _ = tok("|;&(){}[]<>$`\"'\\!~*?#");
    }

    #[test]
    fn l1_long_input() {
        let input = "a".repeat(10000);
        let result = tok(&input);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn l1_many_unmatched_single_quotes() {
        let input = "'".repeat(100);
        let result = tok(&input);
        // Should fail-open
        assert!(result.iter().all(|t| matches!(t, Token::Word(_))));
    }

    #[test]
    fn l1_depth_3_subst() {
        // depth 3 should still parse (recursion_depth 0,1,2 < 3)
        let (_, inner) = tokenize("$($($(a)))");
        assert!(!inner.is_empty());
    }

    #[test]
    fn l1_depth_4_subst() {
        // depth 4: innermost should be opaque (no inner segments beyond depth 3)
        let (_, inner) = tokenize("$($($($(a))))");
        // Should not panic; exact behavior depends on recursion limit
        let _ = inner;
    }

    // ================================================================
    // Layer 2: Segment Tests
    // ================================================================

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

    // --- 2b.1 effective_command ---

    fn ec(tokens: &[&str]) -> Option<(usize, String)> {
        let seg = Segment {
            tokens: tokens.iter().map(|s| Token::Word(s.to_string())).collect(),
        };
        seg.effective_command().map(|(i, s)| (i, s.to_string()))
    }

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

    // --- 2b.2 git_subcmd ---

    fn gs(tokens: &[&str]) -> Option<(usize, String)> {
        let seg = Segment {
            tokens: tokens.iter().map(|s| Token::Word(s.to_string())).collect(),
        };
        seg.git_subcmd().map(|(i, s)| (i, s.to_string()))
    }

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

    // --- 2b.3 is_git ---

    fn mk_seg(tokens: &[&str]) -> Segment {
        Segment {
            tokens: tokens.iter().map(|s| Token::Word(s.to_string())).collect(),
        }
    }

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
        assert!(
            mk_seg(&["git", "reset", "--hard", "origin/main"]).has_token_starting_with("origin/")
        );
    }

    #[test]
    fn l2b_starts_with_no_match() {
        assert!(!mk_seg(&["git", "reset", "--hard", "HEAD~3"]).has_token_starting_with("origin/"));
    }

    // --- 2b.7 has_token_containing ---

    #[test]
    fn l2b_contains_worktree_false() {
        assert!(!mk_seg(&["git", "checkout", "main"]).has_token_containing("worktree"));
    }

    #[test]
    fn l2b_contains_worktree_true() {
        assert!(mk_seg(&["git", "worktree", "add", "/tmp"]).has_token_containing("worktree"));
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
        assert!(
            mk_seg(&["rm", "-rf", "/workspace/.claude/worktrees/my-wt"]).targets_worktree_root()
        );
    }

    #[test]
    fn l2b_wt_root_trailing_slash() {
        assert!(
            mk_seg(&["rm", "-rf", "/workspace/.claude/worktrees/my-wt/"]).targets_worktree_root()
        );
    }

    #[test]
    fn l2b_wt_subdir() {
        assert!(!mk_seg(&[
            "rm",
            "-rf",
            "/workspace/.claude/worktrees/my-wt/node_modules"
        ])
        .targets_worktree_root());
    }

    #[test]
    fn l2b_wt_deep_subdir() {
        assert!(
            !mk_seg(&["rm", "-rf", "/workspace/.claude/worktrees/my-wt/src/old/"])
                .targets_worktree_root()
        );
    }

    #[test]
    fn l2b_wt_non_worktree() {
        assert!(!mk_seg(&["rm", "-rf", "/tmp/something"]).targets_worktree_root());
    }

    #[test]
    fn l2b_wt_bare_prefix() {
        assert!(!mk_seg(&["rm", "-rf", "/workspace/.claude/worktrees/"]).targets_worktree_root());
    }

    // --- 2b.11 has_protected_path ---

    #[test]
    fn l2b_workspace_path_direct() {
        assert!(mk_seg(&["sed", "-i", "s/x/y/", "/workspace/src/file.ts"]).has_protected_path());
    }

    #[test]
    fn l2b_workspace_path_worktree() {
        assert!(
            !mk_seg(&["sed", "-i", "s/x/y/", "/workspace/.claude/worktrees/wt/f"])
                .has_protected_path()
        );
    }

    #[test]
    fn l2b_workspace_path_tmp() {
        assert!(!mk_seg(&["sed", "-i", "s/x/y/", "/tmp/file.ts"]).has_protected_path());
    }

    #[test]
    fn l2b_workspace_path_tee() {
        assert!(mk_seg(&["tee", "/workspace/output.txt"]).has_protected_path());
    }

    #[test]
    fn l2b_workspace_path_tee_worktree() {
        assert!(!mk_seg(&["tee", "/workspace/.claude/worktrees/wt/out.txt"]).has_protected_path());
    }

    // --- path resolution unit tests ---

    #[test]
    fn path_normalize_basic() {
        assert_eq!(
            normalize_path(std::path::Path::new("/a/b/../c")),
            std::path::PathBuf::from("/a/c")
        );
    }

    #[test]
    fn path_normalize_double_dotdot() {
        assert_eq!(
            normalize_path(std::path::Path::new("/a/b/c/../../d")),
            std::path::PathBuf::from("/a/d")
        );
    }

    #[test]
    fn path_normalize_dot() {
        assert_eq!(
            normalize_path(std::path::Path::new("/a/./b/./c")),
            std::path::PathBuf::from("/a/b/c")
        );
    }

    #[test]
    fn path_normalize_past_root() {
        // Can't go above root
        assert_eq!(
            normalize_path(std::path::Path::new("/a/../../b")),
            std::path::PathBuf::from("/b")
        );
    }

    #[test]
    fn path_protected_absolute() {
        assert!(is_protected_path("/workspace/file"));
        assert!(is_protected_path("/workspace/src/test.ts"));
        assert!(!is_protected_path("/workspace/.claude/worktrees/wt/file"));
        assert!(!is_protected_path("/tmp/file"));
        assert!(!is_protected_path(""));
    }

    #[test]
    fn path_protected_dotdot_absolute() {
        // /workspace/.claude/worktrees/wt/../../file → /workspace/.claude/file → protected
        assert!(is_protected_path(
            "/workspace/.claude/worktrees/wt/../../file"
        ));
        // /workspace/.claude/worktrees/wt/./file → not protected (stays in worktree)
        assert!(!is_protected_path("/workspace/.claude/worktrees/wt/./file"));
    }

    #[test]
    fn path_protected_relative() {
        // This test depends on CWD. If CWD is under /workspace/.claude/worktrees/,
        // a relative path like ../../ could escape to /workspace/.
        // We test with absolute paths containing .. since CWD varies.
        assert!(is_protected_path(
            "/workspace/.claude/worktrees/wt/../../../CLAUDE.md"
        ));
    }

    #[test]
    fn l2b_protected_path_with_dotdot() {
        // sed -i targeting a path that escapes via ..
        assert!(mk_seg(&[
            "sed",
            "-i",
            "s/x/y/",
            "/workspace/.claude/worktrees/wt/../../../file"
        ])
        .has_protected_path());
    }

    #[test]
    fn l3_redirect_dotdot_escape_block() {
        // Redirect that escapes worktree via ..
        let v = json!({"tool_input": {"command": "echo hello > /workspace/.claude/worktrees/wt/../../../file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_sed_dotdot_escape_block() {
        let v = json!({"tool_input": {"command": "sed -i 's/x/y/' /workspace/.claude/worktrees/wt/../../../file"}});
        assert!(check_bash(&v).is_some());
    }

    // ================================================================
    // Layer 3: Guard Check Tests
    // ================================================================

    // --- 3.1 push-to-main ---

    #[test]
    fn l3_push_main_basic() {
        let v = json!({"tool_input": {"command": "git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_main_chained() {
        let v = json!({"tool_input": {"command": "echo hi && git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_main_semi_nospace() {
        let v = json!({"tool_input": {"command": "echo hi;git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_main_pipe() {
        let v = json!({"tool_input": {"command": "echo hi|git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_main_sudo() {
        let v = json!({"tool_input": {"command": "sudo git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_main_env() {
        let v = json!({"tool_input": {"command": "env GIT_SSH=/usr/bin/ssh git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_main_c_flag() {
        let v = json!({"tool_input": {"command": "git -C /tmp push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_main_subst() {
        let v = json!({"tool_input": {"command": "echo $(git push origin main)"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_main_subshell() {
        let v = json!({"tool_input": {"command": "(git push origin main)"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_refspec_head_main_block() {
        let v = json!({"tool_input": {"command": "git push origin HEAD:main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_refspec_branch_main_block() {
        let v = json!({"tool_input": {"command": "git push origin feature:main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_refspec_refs_heads_main_block() {
        let v = json!({"tool_input": {"command": "git push origin HEAD:refs/heads/main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_push_refspec_feature_allow() {
        // Refspec targeting a non-main branch — allow
        let v = json!({"tool_input": {"command": "git push origin HEAD:feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_push_feature_allow() {
        let v = json!({"tool_input": {"command": "git push origin feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_push_maintain_allow() {
        let v = json!({"tool_input": {"command": "git push origin maintain-branch"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_push_refspec_allow() {
        let v = json!({"tool_input": {"command": "git push origin HEAD:refs/heads/feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_push_delete_allow() {
        let v = json!({"tool_input": {"command": "git push origin --delete feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_log_main_allow() {
        let v = json!({"tool_input": {"command": "git log main"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_push_main_quoted_allow() {
        let v = json!({"tool_input": {"command": "git commit -m \"git push origin main\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_push_main_cross_segment_allow() {
        // BUG FIX: main is in log segment, not push segment
        let v = json!({"tool_input": {"command": "git push origin feature && git log main"}});
        assert!(check_bash(&v).is_none());
    }

    // --- 3.2 checkout-switch ---

    #[test]
    fn l3_checkout_file_allow() {
        let v = json!({"tool_input": {"command": "git checkout -- src/file.ts"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_checkout_b_allow() {
        let v = json!({"tool_input": {"command": "git checkout -b new-branch"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_checkout_b_upper_allow() {
        let v = json!({"tool_input": {"command": "git checkout -B new-branch"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_switch_c_allow() {
        let v = json!({"tool_input": {"command": "git switch -c new-branch"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_checkout_worktree_keyword_allow() {
        let v = json!({"tool_input": {"command": "git worktree add /tmp/test"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_checkout_quoted_allow() {
        let v = json!({"tool_input": {"command": "git commit -m \"git checkout main\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_checkout_worktree_cwd() {
        // CWD-dependent: in worktree → allowed; in /workspace → blocked
        let v = json!({"tool_input": {"command": "git checkout main"}});
        let result = check_bash(&v);
        let cwd = std::env::current_dir().unwrap();
        let in_worktree = cwd
            .to_string_lossy()
            .starts_with("/workspace/.claude/worktrees/");
        if in_worktree {
            assert!(result.is_none());
        } else {
            assert!(result.is_some());
        }
    }

    #[test]
    fn l3_switch_worktree_cwd() {
        let v = json!({"tool_input": {"command": "git switch feature"}});
        let result = check_bash(&v);
        let cwd = std::env::current_dir().unwrap();
        let in_worktree = cwd
            .to_string_lossy()
            .starts_with("/workspace/.claude/worktrees/");
        if in_worktree {
            assert!(result.is_none());
        } else {
            assert!(result.is_some());
        }
    }

    // --- 3.3 reset-hard-workspace (CWD-dependent) ---
    // Block path tested in integration tests (CWD must be /workspace)

    // --- 3.4 reset-hard-destructive ---

    #[test]
    fn l3_reset_hard_basic() {
        let v = json!({"tool_input": {"command": "git reset --hard HEAD~3"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_reset_hard_bare() {
        let v = json!({"tool_input": {"command": "git reset --hard"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_reset_hard_chained() {
        let v = json!({"tool_input": {"command": "echo hi && git reset --hard HEAD~3"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_reset_hard_sudo() {
        let v = json!({"tool_input": {"command": "sudo git reset --hard"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_reset_hard_c_flag() {
        let v = json!({"tool_input": {"command": "git -C /tmp reset --hard HEAD~3"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_reset_hard_origin_allow() {
        let v = json!({"tool_input": {"command": "git reset --hard origin/main"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_reset_hard_origin_feature_allow() {
        let v = json!({"tool_input": {"command": "git reset --hard origin/feature-branch"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_reset_soft_allow() {
        let v = json!({"tool_input": {"command": "git reset --soft HEAD~1"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_reset_no_flag_allow() {
        let v = json!({"tool_input": {"command": "git reset HEAD~1"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_reset_quoted_allow() {
        let v = json!({"tool_input": {"command": "git commit -m \"undo git reset --hard\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_reset_cross_segment_allow() {
        // BUG FIX: --hard in echo segment, not reset segment
        let v = json!({"tool_input": {"command": "git reset --soft HEAD~1 && echo --hard"}});
        assert!(check_bash(&v).is_none());
    }

    // --- 3.5 clean-force ---
    // clean -f is only blocked in /workspace (shared state).
    // In worktrees (where these tests run), it's allowed — agents
    // legitimately clean build artifacts in their own workspace.
    // The /workspace blocking is verified by integration tests (test-hooks.sh).

    #[test]
    fn l3_clean_fd_worktree_allow() {
        let v = json!({"tool_input": {"command": "git clean -fd"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_f_worktree_allow() {
        let v = json!({"tool_input": {"command": "git clean -f"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_force_worktree_allow() {
        let v = json!({"tool_input": {"command": "git clean --force"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_xfd_worktree_allow() {
        let v = json!({"tool_input": {"command": "git clean -xfd"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_chained_worktree_allow() {
        let v = json!({"tool_input": {"command": "echo hi && git clean -fd"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_semi_nospace_worktree_allow() {
        let v = json!({"tool_input": {"command": "echo hi;git clean --force"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_sudo_worktree_allow() {
        let v = json!({"tool_input": {"command": "sudo git clean -fd"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_c_flag_worktree_allow() {
        let v = json!({"tool_input": {"command": "git -C /tmp clean -fd"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_dry_allow() {
        let v = json!({"tool_input": {"command": "git clean -n"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_nd_allow() {
        let v = json!({"tool_input": {"command": "git clean -nd"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_quoted_allow() {
        let v = json!({"tool_input": {"command": "git commit -m \"warn about git clean -fd\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_clean_cross_segment_allow() {
        // BUG FIX: --force in echo segment, not clean segment
        let v = json!({"tool_input": {"command": "git clean -n && echo --force"}});
        assert!(check_bash(&v).is_none());
    }

    // --- 3.6 branch-force-delete ---
    // branch -D is only blocked in /workspace (could delete other agents' branches).
    // In worktrees, it's allowed — needed for squash-merge cleanup where -d fails.
    // The /workspace blocking is verified by integration tests (test-hooks.sh).

    #[test]
    fn l3_branch_d_upper_worktree_allow() {
        let v = json!({"tool_input": {"command": "git branch -D feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_branch_df_worktree_allow() {
        let v = json!({"tool_input": {"command": "git branch -Df feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_branch_d_chained_worktree_allow() {
        let v = json!({"tool_input": {"command": "echo hi && git branch -D feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_branch_d_sudo_worktree_allow() {
        let v = json!({"tool_input": {"command": "sudo git branch -D feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_branch_d_no_pager_worktree_allow() {
        let v = json!({"tool_input": {"command": "git --no-pager branch -D feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_branch_d_lower_allow() {
        let v = json!({"tool_input": {"command": "git branch -d feature"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_branch_a_allow() {
        let v = json!({"tool_input": {"command": "git branch -a"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_branch_piped_grep_d() {
        // -D on grep, not branch
        let v = json!({"tool_input": {"command": "git branch -a | grep -D 3 pattern"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_branch_quoted_allow() {
        let v = json!({"tool_input": {"command": "git commit -m \"guard git branch -D\""}});
        assert!(check_bash(&v).is_none());
    }

    // --- 3.7 worktree-remove ---
    // Three tiers:
    // 1. Own CWD → hard block (breaks Bash)
    // 2. Agent worktree path (/workspace/.claude/worktrees/*) → block with warning
    //    (could be another agent's active work)
    // 3. Non-worktree path (e.g. /tmp/wt) → allow (not an agent workspace)

    #[test]
    fn l3_worktree_remove_non_agent_path_allow() {
        // Target /tmp/wt is not under worktrees dir — allow
        let v = json!({"tool_input": {"command": "git worktree remove /tmp/wt"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_worktree_remove_non_agent_chained_allow() {
        let v = json!({"tool_input": {"command": "echo hi && git worktree remove /tmp/wt"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_worktree_remove_non_agent_sudo_allow() {
        let v = json!({"tool_input": {"command": "sudo git worktree remove /tmp/wt"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_worktree_remove_agent_path_block() {
        // Target is under /workspace/.claude/worktrees/ — block with warning
        let v = json!({"tool_input": {"command": "git worktree remove /workspace/.claude/worktrees/other-agent"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_worktree_remove_agent_path_chained_block() {
        let v = json!({"tool_input": {"command": "echo hi && git worktree remove /workspace/.claude/worktrees/stale-wt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_worktree_remove_dotdot_escape_block() {
        // Attempt to bypass tier-2 warning via .. that resolves to a worktree path
        let v = json!({"tool_input": {"command": "git worktree remove /workspace/.claude/worktrees/../worktrees/other-agent"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_worktree_remove_cwd_dotdot_block() {
        // Attempt to bypass tier-1 CWD check via .. that resolves to own CWD
        let cwd = std::env::current_dir().unwrap();
        // Add a bogus subdir and .. to resolve back to CWD
        let cmd = format!("git worktree remove {}/subdir/..", cwd.to_string_lossy());
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_worktree_remove_own_cwd_block() {
        // If the target path matches CWD, block — removing your own CWD breaks Bash
        let cwd = std::env::current_dir().unwrap();
        let cwd_str = cwd.to_string_lossy().to_string();
        let cmd = format!("git worktree remove {}", cwd_str);
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_worktree_remove_own_cwd_trailing_slash_block() {
        let cwd = std::env::current_dir().unwrap();
        let cwd_str = format!("{}/", cwd.to_string_lossy());
        let cmd = format!("git worktree remove {}", cwd_str);
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_worktree_add_allow() {
        let v = json!({"tool_input": {"command": "git worktree add /tmp/wt"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_worktree_prune_allow() {
        let v = json!({"tool_input": {"command": "git worktree prune"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_worktree_list_allow() {
        let v = json!({"tool_input": {"command": "git worktree list"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_worktree_remove_quoted_allow() {
        let v = json!({"tool_input": {"command": "git commit -m \"block git worktree remove\""}});
        assert!(check_bash(&v).is_none());
    }

    // --- 3.8 rm-worktree-root ---

    #[test]
    fn l3_rm_rf_worktree() {
        let v = json!({"tool_input": {"command": "rm -rf /workspace/.claude/worktrees/my-wt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_rm_r_worktree() {
        let v = json!({"tool_input": {"command": "rm -r /workspace/.claude/worktrees/my-wt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_rm_rf_trailing_slash() {
        let v = json!({"tool_input": {"command": "rm -rf /workspace/.claude/worktrees/my-wt/"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_rm_rf_chained() {
        let v = json!({"tool_input": {"command": "cd /tmp && rm -rf /workspace/.claude/worktrees/my-wt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_rm_rf_semi() {
        let v = json!({"tool_input": {"command": "echo hi; rm -rf /workspace/.claude/worktrees/my-wt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_rm_rf_subdir_allow() {
        let v = json!({"tool_input": {"command": "rm -rf /workspace/.claude/worktrees/my-wt/node_modules"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_rm_rf_deep_subdir_allow() {
        let v = json!({"tool_input": {"command": "rm -rf /workspace/.claude/worktrees/my-wt/src/old/"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_rm_rf_tmp_allow() {
        let v = json!({"tool_input": {"command": "rm -rf /tmp/something"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_rm_no_flags_allow() {
        let v =
            json!({"tool_input": {"command": "rm /workspace/.claude/worktrees/my-wt/file.txt"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_rm_f_file_allow() {
        let v =
            json!({"tool_input": {"command": "rm -f /workspace/.claude/worktrees/my-wt/temp.txt"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_cp_r_allow() {
        let v = json!({"tool_input": {"command": "cp -r /workspace/.claude/worktrees/my-wt/src /tmp/backup"}});
        assert!(check_bash(&v).is_none());
    }

    // --- 3.9 workspace-file-modification ---

    #[test]
    fn l3_sed_workspace() {
        let v = json!({"tool_input": {"command": "sed -i s/foo/bar/ /workspace/src/test.ts"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_sed_ibak_workspace() {
        let v = json!({"tool_input": {"command": "sed -i.bak s/foo/bar/ /workspace/src/test.ts"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_sed_chained() {
        let v = json!({"tool_input": {"command": "echo hi && sed -i s/foo/bar/ /workspace/src/test.ts"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_tee_workspace() {
        let v = json!({"tool_input": {"command": "echo hello | tee /workspace/src/test.ts"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_workspace() {
        let v = json!({"tool_input": {"command": "echo hello > /workspace/src/test.ts"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_log_workspace() {
        let v = json!({"tool_input": {"command": "git log > /workspace/log.txt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_sed_worktree_allow() {
        let v = json!({"tool_input": {"command": "sed -i s/foo/bar/ /workspace/.claude/worktrees/my-wt/src/test.ts"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_worktree_allow() {
        let v = json!({"tool_input": {"command": "echo hello > /workspace/.claude/worktrees/my-wt/file.txt"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_append_workspace_block() {
        // >> is a write operation (append) — block same as >
        let v = json!({"tool_input": {"command": "echo hello >> /workspace/file.txt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_tmp_allow() {
        let v = json!({"tool_input": {"command": "echo hello > /tmp/file.txt"}});
        assert!(check_bash(&v).is_none());
    }

    // --- 3.10 check_edit ---

    #[test]
    fn l3_edit_blocks_workspace_direct() {
        let v = json!({"tool_input": {"file_path": "/workspace/src/foo.ts"}});
        assert!(check_edit(&v).is_some());
    }

    #[test]
    fn l3_edit_allows_worktree() {
        let v =
            json!({"tool_input": {"file_path": "/workspace/.claude/worktrees/test/src/foo.ts"}});
        assert!(check_edit(&v).is_none());
    }

    #[test]
    fn l3_edit_blocks_env() {
        let v = json!({"tool_input": {"file_path": "/foo/.env"}});
        assert!(check_edit(&v).is_some());
    }

    #[test]
    fn l3_edit_blocks_package_lock() {
        let v = json!({"tool_input": {"file_path": "/workspace/package-lock.json"}});
        assert!(check_edit(&v).is_some());
    }

    // --- 3.11 Heredoc body (ALLOW) ---

    #[test]
    fn l3_heredoc_push() {
        let v = json!({"tool_input": {"command": "python3 << EOF\ngit push origin main\nEOF"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_heredoc_clean() {
        let v = json!({"tool_input": {"command": "cat << 'DELIM'\ngit clean --force\nDELIM"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_heredoc_branch() {
        let v = json!({"tool_input": {"command": "bash << END\ngit branch -D feature\nEND && echo done"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_heredoc_reset() {
        let v = json!({"tool_input": {"command": "node << 'JS'\ngit reset --hard HEAD~3\nJS"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_heredoc_rm() {
        let v = json!({"tool_input": {"command": "python3 << EOF\nrm -rf /workspace/.claude/worktrees/my-wt\nEOF"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_heredoc_worktree_remove() {
        let v = json!({"tool_input": {"command": "cat << END\ngit worktree remove /tmp/wt\nEND"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_heredoc_sed() {
        let v = json!({"tool_input": {"command": "cat << EOF\nsed -i s/x/y/ /workspace/src/file.ts\nEOF"}});
        assert!(check_bash(&v).is_none());
    }

    // --- 3.12 Command substitution (BLOCK) ---

    #[test]
    fn l3_subst_push() {
        let v = json!({"tool_input": {"command": "echo $(git push origin main)"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_subst_reset() {
        let v = json!({"tool_input": {"command": "result=$(git reset --hard HEAD~3)"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_subst_backtick_clean() {
        let v = json!({"tool_input": {"command": "VAR=`git clean -fd`"}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    #[test]
    fn l3_subst_dquote_branch() {
        let v = json!({"tool_input": {"command": "echo \"$(git branch -D feature)\""}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    #[test]
    fn l3_subst_chained() {
        let v = json!({"tool_input": {"command": "echo hi && echo $(git push origin main)"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_subst_rm() {
        let v =
            json!({"tool_input": {"command": "echo $(rm -rf /workspace/.claude/worktrees/my-wt)"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_subst_worktree_remove_other_allow() {
        // Target /tmp/wt is not CWD — allow even inside $()
        let v = json!({"tool_input": {"command": "echo $(git worktree remove /tmp/wt)"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_subst_sed() {
        let v = json!({"tool_input": {"command": "echo $(sed -i s/x/y/ /workspace/src/file.ts)"}});
        assert!(check_bash(&v).is_some());
    }

    // --- 3.13 Fail-open on parse errors ---

    #[test]
    fn l3_failopen_unmatched_dquote() {
        let v = json!({"tool_input": {"command": "echo \"unmatched quote"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_failopen_unmatched_squote() {
        let v = json!({"tool_input": {"command": "echo 'unmatched single"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_failopen_dangling_backslash() {
        let v = json!({"tool_input": {"command": "echo hello\\"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_failopen_unclosed_backtick() {
        let v = json!({"tool_input": {"command": "echo `git push"}});
        // Fail-open: whitespace split won't have proper segment
        assert!(check_bash(&v).is_none());
    }

    // --- 3.14 Full-path git (BLOCK) ---

    #[test]
    fn l3_fullpath_push() {
        let v = json!({"tool_input": {"command": "/usr/bin/git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_relpath_push() {
        let v = json!({"tool_input": {"command": "./git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_sudo_fullpath_push() {
        let v = json!({"tool_input": {"command": "sudo /usr/bin/git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_fullpath_c_flag_push() {
        let v = json!({"tool_input": {"command": "/usr/bin/git -C /tmp push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_fullpath_clean() {
        // CWD-dependent: blocked in /workspace, allowed in worktrees
        let v = json!({"tool_input": {"command": "/usr/bin/git clean -fd"}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    // --- 3.15 Assignment-prefixed (BLOCK) ---

    #[test]
    fn l3_assign_push() {
        let v = json!({"tool_input": {"command": "VAR=val git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_assign_git_ssh_push() {
        let v = json!({"tool_input": {"command": "GIT_SSH=/usr/bin/ssh git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_multi_assign_push() {
        let v = json!({"tool_input": {"command": "A=1 B=2 git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_assign_sudo_push() {
        let v = json!({"tool_input": {"command": "VAR=val sudo git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_assign_c_flag_push() {
        let v = json!({"tool_input": {"command": "VAR=val git -C /tmp push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    // --- 3.16 Continuation after operator ---

    #[test]
    fn l3_line_continuation_push() {
        let v = json!({"tool_input": {"command": "git push origin \\\nmain"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_line_continuation_push2() {
        let v = json!({"tool_input": {"command": "git push \\\norigin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_pipe_continuation_push() {
        let v = json!({"tool_input": {"command": "echo a |\ngit push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_and_continuation_push() {
        let v = json!({"tool_input": {"command": "echo a &&\ngit push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    // --- 3.17 Background operator ---

    #[test]
    fn l3_background_push() {
        let v = json!({"tool_input": {"command": "git push origin main &"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_background_sep_push() {
        let v = json!({"tool_input": {"command": "echo hi & git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_background_clean() {
        let v = json!({"tool_input": {"command": "git clean -fd & echo done"}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    // --- 3.19 $() in dquotes (BLOCK) ---

    #[test]
    fn l3_subst_dquote_push() {
        let v = json!({"tool_input": {"command": "echo \"$(git push origin main)\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_subst_dquote_reset() {
        let v = json!({"tool_input": {"command": "echo \"result: $(git reset --hard HEAD~3)\""}});
        assert!(check_bash(&v).is_some());
    }

    // --- 3.20 $() in squotes (ALLOW) ---

    #[test]
    fn l3_subst_squote_push_allow() {
        let v = json!({"tool_input": {"command": "echo '$(git push origin main)'"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_subst_squote_reset_allow() {
        let v = json!({"tool_input": {"command": "echo '$(git reset --hard)'"}});
        assert!(check_bash(&v).is_none());
    }

    // --- 3.21 Non-git with prefix (BLOCK) ---

    #[test]
    fn l3_sudo_rm_worktree() {
        let v =
            json!({"tool_input": {"command": "sudo rm -rf /workspace/.claude/worktrees/my-wt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_env_rm_worktree() {
        let v = json!({"tool_input": {"command": "env PATH=/tmp rm -rf /workspace/.claude/worktrees/my-wt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_sudo_sed_workspace() {
        let v = json!({"tool_input": {"command": "sudo sed -i s/x/y/ /workspace/src/file.ts"}});
        assert!(check_bash(&v).is_some());
    }

    // --- 3.22 Adversarial (no panic) ---

    #[test]
    fn l3_adversarial_long_input() {
        let cmd = "a".repeat(10000);
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_adversarial_many_chains() {
        let cmd = (0..1000)
            .map(|i| format!("echo {}", i))
            .collect::<Vec<_>>()
            .join(" && ");
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_adversarial_mixed() {
        let v = json!({"tool_input": {"command": "|;&(){}[]<>$`\"'\\!~*?#"}});
        // Should not panic
        let _ = check_bash(&v);
    }

    // --- Legacy regression tests (all must still pass) ---

    #[test]
    fn infra_error_enxio() {
        let e = io::Error::from_raw_os_error(6);
        assert!(is_infra_error(&e));
    }

    #[test]
    fn infra_error_eagain() {
        let e = io::Error::from_raw_os_error(11);
        assert!(is_infra_error(&e));
    }

    #[test]
    fn infra_error_enoent() {
        let e = io::Error::from_raw_os_error(2);
        assert!(is_infra_error(&e));
    }

    #[test]
    fn infra_error_other_is_not_infra() {
        let e = io::Error::from_raw_os_error(5);
        assert!(!is_infra_error(&e));
    }

    #[test]
    fn edit_blocks_env_file() {
        let v = json!({"tool_input": {"file_path": "/foo/.env"}});
        assert!(check_edit(&v).is_some());
    }

    #[test]
    fn edit_blocks_wasm_scheduler() {
        let v = json!({"tool_input": {"file_path": "/workspace/src/wasm/scheduler/scheduler.js"}});
        assert!(check_edit(&v).is_some());
    }

    #[test]
    fn edit_allows_normal_file() {
        let v = json!({"tool_input": {"file_path": "/home/user/project/src/App.tsx"}});
        assert!(check_edit(&v).is_none());
    }

    #[test]
    fn edit_allows_worktree_file() {
        let v = json!({"tool_input": {"file_path": "/workspace/.claude/worktrees/issue-42/src/App.tsx"}});
        assert!(check_edit(&v).is_none());
    }

    #[test]
    fn edit_fail_closed_bad_json() {
        let v = json!({"tool_input": {}});
        assert!(check_edit(&v).is_none());
    }

    #[test]
    fn bash_allows_normal_commands() {
        let v = json!({"tool_input": {"command": "git status"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_commit_with_worktree_mention() {
        let cmd = "git commit -m \"block direct edits in /workspace/ must use worktrees\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_push() {
        let cmd = "git commit -m \"block git push to the default branch\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_reset() {
        let cmd = "git commit -m \"revert: undo git reset --hard changes\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_clean() {
        let cmd = "git commit -m \"docs: warn about git clean -f\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_commit_referencing_branch_d() {
        let cmd = "git commit -m \"fix: guard git branch -D\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_branch_piped_no_spaces() {
        let v = json!({"tool_input": {"command": "git branch -a|grep -D 3 foo"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_clean_chained_no_spaces() {
        let v = json!({"tool_input": {"command": "git clean -n&&echo done"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_gh_pr_merge_body() {
        let cmd = "gh pr merge 72 --squash --body \"block git reset --hard in /workspace\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_gh_push_main_body() {
        let cmd = "gh pr comment 1 --body \"guard blocks git push to main\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_echo_checkout() {
        let cmd = "echo \"use git checkout to switch branches\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_grep_git_push() {
        let cmd = "grep -r \"git push\" scripts/";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_git_branch_force_set() {
        let v = json!({"tool_input": {"command": "git branch -f feature-branch origin/main"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_git_pull() {
        let v = json!({"tool_input": {"command": "git pull origin main"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_git_fetch() {
        let v = json!({"tool_input": {"command": "git fetch origin main"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_git_merge() {
        let v = json!({"tool_input": {"command": "git merge feature/phase19 --no-edit"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_push_delete_remote() {
        let v = json!({"tool_input": {"command": "git push origin --delete feature/old"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_commit_rm_rf_worktree() {
        let cmd = "git commit -m \"fix: guard blocks rm -rf /workspace/.claude/worktrees/\"";
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_empty_command() {
        let v = json!({"tool_input": {"command": ""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_whitespace_command() {
        let v = json!({"tool_input": {"command": "   "}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn bash_allows_multi_space_push_feature() {
        let v = json!({"tool_input": {"command": "git  push  origin  feature"}});
        assert!(check_bash(&v).is_none());
    }

    // ================================================================
    // Edge case tests from first-principles audit
    // ================================================================

    // --- effective_command() known gaps ---

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

    #[test]
    fn l3_sudo_u_push_known_gap() {
        // Known gap: sudo -u root git push origin main is NOT blocked
        // because effective_command returns "root", which isn't git.
        // This is acceptable: fail-open, and sudo -u is rare in agent commands.
        let v = json!({"tool_input": {"command": "sudo -u root git push origin main"}});
        assert!(check_bash(&v).is_none()); // known gap: not blocked
    }

    #[test]
    fn l3_sudo_n_push_blocked() {
        // sudo -n git push origin main IS blocked (correct)
        let v = json!({"tool_input": {"command": "sudo -n git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_sudo_e_push_blocked() {
        let v = json!({"tool_input": {"command": "sudo -E git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    // --- Redirect check: quote-aware ---

    #[test]
    fn l3_redirect_quoted_gt_allow() {
        // ">" is inside quotes, not a real redirect
        let v = json!({"tool_input": {"command": "echo \"> /workspace/file\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_quoted_gt_with_real_redirect() {
        // First > is in quotes (not redirect), second > is real redirect
        let v = json!({"tool_input": {"command": "echo \"some > text\" > /workspace/file.ts"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_single_quoted_gt_allow() {
        let v = json!({"tool_input": {"command": "echo '> /workspace/file'"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_escaped_gt_allow() {
        // \> is escaped in bash — NOT a redirect. The tokenizer produces
        // Word(">") (not Operator(">")), so the type-safe check correctly
        // allows it. This was a false positive before the redirect operator refactor.
        let v = json!({"tool_input": {"command": "echo \\> /workspace/file"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_clobber_block() {
        // >| is a write redirect (clobber) — should block
        let v = json!({"tool_input": {"command": "echo >| /workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_fd_dup_number_allow() {
        // >&2 targets an fd number, not a path — allow
        let v = json!({"tool_input": {"command": "echo >&2"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_fd_dup_path_block() {
        // >&/workspace/file — in bash, >& with a non-digit target acts as
        // > file 2>&1 (writes both stdout and stderr to the file)
        let v = json!({"tool_input": {"command": "echo >&/workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_readwrite_block() {
        // <> opens the file for both reading AND writing
        let v = json!({"tool_input": {"command": "cmd <> /workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_input_allow() {
        // < reads from a file, doesn't write — allow
        let v = json!({"tool_input": {"command": "cat < /workspace/file"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_input_fd_dup_allow() {
        // <& is fd dup for input, no write — allow
        let v = json!({"tool_input": {"command": "cmd <&3"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_ampersand_gt_block() {
        // &> redirects both stdout and stderr — write operation
        let v = json!({"tool_input": {"command": "echo hello &> /workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_ampersand_gt_append_block() {
        // &>> appends both stdout and stderr — write operation
        let v = json!({"tool_input": {"command": "echo hello &>> /workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_ampersand_gt_worktree_allow() {
        // &> to worktree path — allow
        let v = json!({"tool_input": {"command": "echo &> /workspace/.claude/worktrees/wt/file"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_ampersand_gt_tmp_allow() {
        // &> to /tmp — allow
        let v = json!({"tool_input": {"command": "echo &> /tmp/file"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_quoted_word_nospace_block() {
        // "echo">/workspace/file — echo is quoted but > is unquoted operator
        let v = json!({"tool_input": {"command": "\"echo\">/workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_double_quoted_gt_nospace_allow() {
        // echo">"path — the > is inside quotes, not an operator
        let v = json!({"tool_input": {"command": "echo\">\"path"}});
        assert!(check_bash(&v).is_none());
    }

    // --- Bash ground truth: redirect classification ---
    // These tests verify our tokenizer matches bash behavior for every
    // edge case discovered during the first-principles audit.

    #[test]
    fn l1_bash_gt_spaced_redirect_is_operator() {
        // Bash: echo hello > /tmp/file → redirect
        let tokens = tok("echo hello > /tmp/file");
        assert!(tokens.contains(&op(">")));
    }

    #[test]
    fn l1_bash_gt_nospace_splits() {
        // Bash: echo>/tmp/file → [echo] [>] [/tmp/file]
        let tokens = tok("echo>/tmp/file");
        assert_eq!(tokens, vec![w("echo"), op(">"), w("/tmp/file")]);
    }

    #[test]
    fn l1_bash_gt_escaped_is_word() {
        // Bash: echo \> /tmp/file → prints "> /tmp/file", no redirect
        let tokens = tok("echo \\> /tmp/file");
        assert!(tokens.contains(&w(">")));
        assert!(!tokens.contains(&op(">")));
    }

    #[test]
    fn l1_bash_gt_dquoted_is_word() {
        // Bash: echo ">" /tmp/file → prints "> /tmp/file", no redirect
        let tokens = tok("echo \">\" /tmp/file");
        assert!(tokens.contains(&w(">")));
        assert!(!tokens.contains(&op(">")));
    }

    #[test]
    fn l1_bash_gt_squoted_is_word() {
        // Bash: echo '>' /tmp/file → no redirect
        let tokens = tok("echo '>' /tmp/file");
        assert!(tokens.contains(&w(">")));
        assert!(!tokens.contains(&op(">")));
    }

    #[test]
    fn l1_bash_gt_fd_redirect_splits() {
        // Bash: echo 2>/dev/null → fd 2 redirect
        let tokens = tok("echo 2>/dev/null");
        assert_eq!(tokens, vec![w("echo"), w("2"), op(">"), w("/dev/null")]);
    }

    #[test]
    fn l1_bash_gt_fd_escaped_no_split() {
        // Bash: echo 2\>/dev/null → prints "2>/dev/null"
        let tokens = tok("echo 2\\>/dev/null");
        assert_eq!(tokens, vec![w("echo"), w("2>/dev/null")]);
    }

    #[test]
    fn l1_bash_gt_clobber_is_operator() {
        // Bash: echo >| /tmp/file → clobber redirect
        let tokens = tok("echo >| /tmp/file");
        assert!(tokens.contains(&op(">|")));
    }

    #[test]
    fn l1_bash_gt_dup_is_operator() {
        // Bash: echo >&2 → fd dup redirect
        let tokens = tok("echo >&2");
        assert!(tokens.contains(&op(">&")));
    }

    #[test]
    fn l1_bash_gt_quoted_cmd_nospace() {
        // Bash: "echo">/tmp/file → echo is command, > is redirect
        let tokens = tok("\"echo\">/tmp/file");
        assert_eq!(tokens, vec![w("echo"), op(">"), w("/tmp/file")]);
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

    // --- Heredoc: strict delimiter matching ---

    #[test]
    fn l1_heredoc_indented_delimiter_no_dash() {
        // << EOF with indented closing should NOT match (only <<- allows indentation)
        // The body should include everything until exact "EOF" line
        let result = tok("cat << EOF\nhello\n   EOF\nEOF");
        // "   EOF" doesn't match, body continues. "EOF" matches.
        // Only "cat" is emitted as a word
        assert_eq!(words(&result), vec!["cat"]);
    }

    #[test]
    fn l1_heredoc_indented_delimiter_with_dash() {
        // <<- EOF: tab-indented closing delimiter SHOULD match
        let result = tok("cat <<- EOF\nhello\n\tEOF");
        assert_eq!(words(&result), vec!["cat"]);
    }

    #[test]
    fn l3_heredoc_strict_no_early_close() {
        // Dangerous command after indented non-matching delimiter
        // << EOF: "   EOF" doesn't close, "git push" is still body, "EOF" closes
        let v = json!({"tool_input": {"command": "cat << EOF\n   EOF\ngit push origin main\nEOF"}});
        assert!(check_bash(&v).is_none()); // all body, not commands
    }

    // --- $() with quotes inside ---

    #[test]
    fn l1_cmd_subst_quoted_close_paren() {
        // $(echo ")") — the ) inside quotes should NOT close the substitution
        let (tokens, inner) = tokenize("echo $(echo \")\")");
        // Should extract inner content correctly
        assert_eq!(tokens.len(), 2);
        assert!(!inner.is_empty());
    }

    #[test]
    fn l1_cmd_subst_single_quoted_paren() {
        // $(echo ')') — ) in single quotes
        let (tokens, inner) = tokenize("echo $(echo ')')");
        assert_eq!(tokens.len(), 2);
        assert!(!inner.is_empty());
    }

    #[test]
    fn l3_subst_quoted_paren_push() {
        // $(echo ")" && git push origin main) — ) in quotes doesn't close
        let v = json!({"tool_input": {"command": "echo $(echo \")\" && git push origin main)"}});
        assert!(check_bash(&v).is_some());
    }

    // --- Brace group known gap ---

    #[test]
    fn l3_brace_group_blocked() {
        // { git push origin main; } — brace group: { is skipped, git is found
        let v = json!({"tool_input": {"command": "{ git push origin main; }"}});
        assert!(check_bash(&v).is_some());
    }

    // --- is_var_assignment edge cases ---

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

    // --- Newline continuation edge cases ---

    #[test]
    fn l3_or_continuation_push() {
        // || continuation: newline after || doesn't separate
        let v = json!({"tool_input": {"command": "echo a ||\ngit push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    // --- Background + push ---

    #[test]
    fn l3_background_clean_cwd_dependent() {
        let v = json!({"tool_input": {"command": "git clean -fd &"}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    // --- Redirect in heredoc body (ALLOW) ---

    #[test]
    fn l3_redirect_in_heredoc_body_allow() {
        // Redirect syntax in heredoc body is NOT a real redirect.
        // This was a real false positive: git commit -m "$(cat <<'EOF'\n> /workspace/...\nEOF)"
        let v = json!({"tool_input": {"command": "cat << EOF\n> /workspace/file.txt\nEOF"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_in_commit_heredoc_allow() {
        // The exact pattern that blocked a commit
        let v = json!({"tool_input": {"command": "git commit -m \"$(cat <<'EOF'\necho > /workspace/file\nEOF\n)\""}});
        assert!(check_bash(&v).is_none());
    }

    // --- No-space redirects (BLOCK) ---

    #[test]
    fn l3_redirect_nospace_block() {
        let v = json!({"tool_input": {"command": "echo hello>/workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_nospace_cat_block() {
        let v = json!({"tool_input": {"command": "cat>/workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_nospace_git_status_block() {
        let v = json!({"tool_input": {"command": "git status>/workspace/log.txt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_nospace_append_block() {
        // >> is a write operation (append) — block same as >
        let v = json!({"tool_input": {"command": "echo hello>>/workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_redirect_nospace_worktree_allow() {
        let v =
            json!({"tool_input": {"command": "echo hello>/workspace/.claude/worktrees/wt/file"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_nospace_in_json_allow() {
        // >/workspace/ inside a JSON string (from quoting) is NOT a redirect
        let cmd = r#"echo '{"command":"echo>/workspace/file"}'"#;
        let v = json!({"tool_input": {"command": cmd}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_redirect_fd_nospace_block() {
        // fd redirect: 2>/workspace/file
        let v = json!({"tool_input": {"command": "cmd 2>/workspace/file"}});
        assert!(check_bash(&v).is_some());
    }

    // --- bash -c / sh -c / eval (BLOCK) ---

    #[test]
    fn l3_bash_c_push_block() {
        let v = json!({"tool_input": {"command": "bash -c \"git push origin main\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_sh_c_push_block() {
        let v = json!({"tool_input": {"command": "sh -c \"git push origin main\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_bash_c_clean_cwd_dependent() {
        let v = json!({"tool_input": {"command": "bash -c \"echo hi && git clean -fd\""}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    #[test]
    fn l3_sh_c_branch_d_cwd_dependent() {
        let v = json!({"tool_input": {"command": "sh -c \"git branch -D mybranch\""}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    #[test]
    fn l3_fullpath_bash_c_block() {
        let v = json!({"tool_input": {"command": "/bin/bash -c \"git push origin main\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_bash_c_multi_cmd_block() {
        let v = json!({"tool_input": {"command": "bash -c \"echo hi; git push origin main\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_eval_push_block() {
        let v = json!({"tool_input": {"command": "eval \"git push origin main\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_eval_reset_block() {
        let v = json!({"tool_input": {"command": "eval git reset --hard HEAD~3"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_bash_c_safe_allow() {
        let v = json!({"tool_input": {"command": "bash -c \"echo hello\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_bash_c_push_feature_allow() {
        let v = json!({"tool_input": {"command": "bash -c \"git push origin feature\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_sudo_bash_c_push_block() {
        let v = json!({"tool_input": {"command": "sudo bash -c \"git push origin main\""}});
        assert!(check_bash(&v).is_some());
    }

    // --- exec (BLOCK) ---

    #[test]
    fn l3_exec_push_block() {
        let v = json!({"tool_input": {"command": "exec git push origin main"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_exec_clean_cwd_dependent() {
        let v = json!({"tool_input": {"command": "exec git clean -fd"}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    #[test]
    fn l3_exec_safe_allow() {
        let v = json!({"tool_input": {"command": "exec git status"}});
        assert!(check_bash(&v).is_none());
    }

    // --- Interpreter workspace scanning ---

    #[test]
    fn l3_python_workspace_block() {
        let v = json!({"tool_input": {"command": "python3 -c \"open('/workspace/file', 'w').write('x')\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_python_system_workspace_block() {
        let v = json!({"tool_input": {"command": "python3 -c \"import os; os.system('echo > /workspace/file')\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_node_workspace_block() {
        let v = json!({"tool_input": {"command": "node -e \"require('fs').writeFileSync('/workspace/file', 'x')\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_perl_workspace_block() {
        let v = json!({"tool_input": {"command": "perl -e \"system('echo > /workspace/file')\""}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_python_worktree_allow() {
        // Worktree paths are allowed
        let v = json!({"tool_input": {"command": "python3 -c \"open('/workspace/.claude/worktrees/wt/file', 'w')\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_python_safe_allow() {
        // No /workspace/ path — allow
        let v = json!({"tool_input": {"command": "python3 -c \"print('hello')\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_node_safe_allow() {
        let v = json!({"tool_input": {"command": "node -e \"console.log('hello')\""}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_python_fullpath_block() {
        // Full path to interpreter
        let v = json!({"tool_input": {"command": "/usr/bin/python3 -c \"open('/workspace/file', 'w')\""}});
        assert!(check_bash(&v).is_some());
    }

    // --- Brace groups (BLOCK) ---

    #[test]
    fn l3_brace_clean_cwd_dependent() {
        let v = json!({"tool_input": {"command": "{ git clean -fd; }"}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    #[test]
    fn l3_brace_clean_and_cwd_dependent() {
        let v = json!({"tool_input": {"command": "{ git clean -fd && echo done; }"}});
        assert_eq!(check_bash(&v).is_some(), in_workspace());
    }

    #[test]
    fn l3_brace_safe_allow() {
        let v = json!({"tool_input": {"command": "{ echo hello; }"}});
        assert!(check_bash(&v).is_none());
    }

    #[test]
    fn l3_nested_brace_block() {
        let v = json!({"tool_input": {"command": "{ { git push origin main; }; }"}});
        assert!(check_bash(&v).is_some());
    }
}
