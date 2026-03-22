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
const COMMAND_PREFIXES: &[&str] = &["sudo", "env", "command", "nice", "nohup", "time"];

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
            let trimmed = line.trim();
            if trimmed == delim.as_str() {
                heredoc_delimiter = None;
                heredoc_in_body = false;
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
                    let mut paren_depth = 1;
                    let mut inner = String::new();
                    while i < len && paren_depth > 0 {
                        if chars[i] == '(' {
                            paren_depth += 1;
                            inner.push(chars[i]);
                        } else if chars[i] == ')' {
                            paren_depth -= 1;
                            if paren_depth > 0 {
                                inner.push(chars[i]);
                            }
                        } else {
                            inner.push(chars[i]);
                        }
                        i += 1;
                    }
                    if paren_depth > 0 {
                        return fail_open(cmd);
                    }
                    // Add the $(...) text to the word
                    let subst_text: String = chars[start..i].iter().collect();
                    word.push_str(&subst_text);
                    // Recursively parse inner content
                    if depth < MAX_SUBST_DEPTH {
                        let inner_segs = parse_segments_inner(&inner, depth + 1);
                        if !inner_segs.is_empty() {
                            inner_segment_groups.push(inner_segs);
                        }
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
            let mut paren_depth = 1;
            let mut inner = String::new();
            while i < len && paren_depth > 0 {
                if chars[i] == '(' {
                    paren_depth += 1;
                    inner.push(chars[i]);
                } else if chars[i] == ')' {
                    paren_depth -= 1;
                    if paren_depth > 0 {
                        inner.push(chars[i]);
                    }
                } else {
                    inner.push(chars[i]);
                }
                i += 1;
            }
            if paren_depth > 0 {
                return fail_open(cmd);
            }
            let subst_text: String = chars[start..i].iter().collect();
            in_word = true;
            word.push_str(&subst_text);
            if depth < MAX_SUBST_DEPTH {
                let inner_segs = parse_segments_inner(&inner, depth + 1);
                if !inner_segs.is_empty() {
                    inner_segment_groups.push(inner_segs);
                }
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

        // Operators: &&, ||, |, ;, &, (, )
        // Also << for heredoc detection
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
            // Skip optional - (for <<-)
            if i < len && chars[i] == '-' {
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
                    // Process rest of current line (tokens after << DELIM on same line)
                    // These belong to the command context, not the heredoc body
                    // We'll let normal processing handle them — just set heredoc_delimiter
                    // so the body gets skipped starting from the next newline
                    heredoc_delimiter = Some(delim);
                    // We need to skip to the next newline to start heredoc body
                    // But first, any tokens on this line (e.g., `<< EOF && echo done`)
                    // should still be parsed. The heredoc body starts after the newline.
                    // We'll handle this by NOT entering heredoc body until we see \n.
                    // The heredoc_delimiter is set, and the \n handler will transition.
                    // Actually, the main loop will continue processing. When it hits \n,
                    // the newline code emits Operator("\n"), then the top of the loop
                    // checks heredoc_delimiter and enters body mode.
                    // But we DON'T want the \n to be emitted as an operator here.
                    // Let's handle it differently: after setting delimiter, continue
                    // normal parsing until we see \n. When we see \n, skip it and
                    // enter heredoc body mode (don't emit it as operator).

                    // Actually, let's process rest-of-line tokens, then enter heredoc
                    // body mode. The approach: continue the main loop normally.
                    // When we encounter \n while heredoc_delimiter is Some, we enter
                    // body mode instead of emitting an operator.
                    // This means we need to check heredoc_delimiter in the \n handler.
                }
            }
            continue;
        }

        // < and > are NOT operators for segment purposes — treat as word chars
        // (Redirects are handled by separate string scan)

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

// ============================================================
// Segments: split tokens on operators, check each independently
// ============================================================

#[derive(Debug, Clone)]
pub struct Segment {
    pub tokens: Vec<String>,
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

impl Segment {
    /// Find the effective command, skipping variable assignments and known prefixes.
    pub fn effective_command(&self) -> Option<(usize, &str)> {
        let mut i = 0;
        while i < self.tokens.len() {
            let tok = &self.tokens[i];

            // Skip variable assignments
            if is_var_assignment(tok) {
                i += 1;
                continue;
            }

            // Skip known command prefixes and all their flag-like arguments
            if COMMAND_PREFIXES.contains(&tok.as_str()) {
                i += 1;
                // Skip flags (starting with -) and assignments (containing =).
                // For short flags (single char like -u), also skip the next token
                // as it may be the flag's value (e.g., sudo -u root → skip -u AND root).
                while i < self.tokens.len() {
                    let t = &self.tokens[i];
                    if is_var_assignment(t) {
                        i += 1;
                    } else if t.starts_with("--") {
                        // Long flag: skip it. If --flag=value, it's one token.
                        // If --flag value, we can't tell — just skip the flag.
                        i += 1;
                    } else if t.starts_with('-') && t.len() == 2 {
                        // Short flag with single char (e.g., -u): likely takes a value.
                        // Skip the flag AND the next token (its value).
                        i += 2;
                    } else if t.starts_with('-') {
                        // Combined short flags (e.g., -xvf): skip just the flags.
                        i += 1;
                    } else {
                        break;
                    }
                }
                continue;
            }

            return Some((i, tok));
        }
        None
    }

    /// Find the git subcommand, skipping global git flags.
    pub fn git_subcmd(&self) -> Option<(usize, &str)> {
        let (cmd_pos, cmd) = self.effective_command()?;
        if !is_git_command(cmd) {
            return None;
        }

        let mut i = cmd_pos + 1;
        while i < self.tokens.len() {
            let tok = &self.tokens[i];
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
            if GIT_VALUE_FLAGS.contains(&tok.as_str()) {
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

    /// True if any token AFTER the subcommand (for git) or command exactly equals `val`.
    pub fn has_arg(&self, val: &str) -> bool {
        let start = if let Some((pos, _)) = self.git_subcmd() {
            pos + 1
        } else if let Some((pos, _)) = self.effective_command() {
            pos + 1
        } else {
            return false;
        };
        self.tokens[start..].iter().any(|t| t == val)
    }

    /// True if any token AFTER the subcommand/command is a short flag containing `ch`.
    pub fn has_short_flag(&self, ch: char) -> bool {
        let start = if let Some((pos, _)) = self.git_subcmd() {
            pos + 1
        } else if let Some((pos, _)) = self.effective_command() {
            pos + 1
        } else {
            return false;
        };
        self.tokens[start..]
            .iter()
            .any(|t| t.starts_with('-') && !t.starts_with("--") && t.contains(ch))
    }

    /// True if any token starts with `prefix`.
    pub fn has_token_starting_with(&self, prefix: &str) -> bool {
        self.tokens.iter().any(|t| t.starts_with(prefix))
    }

    /// True if any token contains `substring`.
    pub fn has_token_containing(&self, substring: &str) -> bool {
        self.tokens.iter().any(|t| t.contains(substring))
    }

    /// True if any token is a worktree ROOT directory path.
    pub fn targets_worktree_root(&self) -> bool {
        let prefix = "/workspace/.claude/worktrees/";
        self.tokens.iter().any(|t| {
            if let Some(rest) = t.strip_prefix(prefix) {
                let trimmed = rest.trim_end_matches('/');
                !trimmed.is_empty() && !trimmed.contains('/')
            } else {
                false
            }
        })
    }

    /// True if any token is a path under /workspace/ that is NOT under worktrees.
    pub fn has_workspace_path(&self) -> bool {
        self.tokens.iter().any(|t| {
            t.starts_with("/workspace/") && !t.starts_with("/workspace/.claude/worktrees/")
        })
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
    let mut current: Vec<String> = Vec::new();

    for tok in &tokens {
        match tok {
            Token::Operator(_) => {
                if !current.is_empty() {
                    segments.push(Segment {
                        tokens: std::mem::take(&mut current),
                    });
                }
            }
            Token::Word(w) => {
                current.push(w.clone());
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

    segments
}

// ============================================================
// Helpers kept from old code
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
    if file_path.contains("package-lock.json")
        || file_path.contains("src/wasm/scheduler/")
        || file_path.contains(".env")
    {
        return Some(format!("Protected file: {}", file_path));
    }

    // Workspace isolation
    if file_path.starts_with("/workspace/")
        && !file_path.starts_with("/workspace/.claude/worktrees/")
    {
        return Some(
            "Do not edit files directly on main in /workspace. \
             Create a worktree first: git worktree add /workspace/.claude/worktrees/<name> -b <branch>"
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

    // push-to-main
    for seg in &segments {
        if seg.is_git("push") && seg.has_arg("main") {
            return Some("Cannot push directly to main. Use a feature branch and PR.".to_string());
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
        {
            if !is_worktree_cwd() {
                return Some(
                    "Do not use git checkout/switch in /workspace. \
                     Use a worktree: git worktree add /workspace/.claude/worktrees/<name> -b <branch>"
                        .to_string(),
                );
            }
        }
    }

    // reset-hard-workspace: block ALL reset --hard in /workspace (even origin/*)
    for seg in &segments {
        if seg.is_git("reset") && seg.has_arg("--hard") && is_workspace_cwd() {
            return Some(
                "Do not run git reset --hard in /workspace — it modifies shared state \
                 that other agents depend on. If you need to sync after a squash merge, \
                 run git reset --hard origin/<branch> in your own worktree instead. \
                 See .claude/worktrees/CLAUDE.md."
                    .to_string(),
            );
        }
    }

    // reset-hard-destructive: block reset --hard without origin/ ref (in worktrees)
    for seg in &segments {
        if seg.is_git("reset") && seg.has_arg("--hard") && !seg.has_token_starting_with("origin/") {
            return Some(
                "git reset --hard is destructive and can discard uncommitted work. \
                 If syncing after a squash merge, use: git reset --hard origin/<branch>"
                    .to_string(),
            );
        }
    }

    // clean-force
    for seg in &segments {
        if seg.is_git("clean") && (seg.has_short_flag('f') || seg.has_arg("--force")) {
            return Some(
                "git clean -f is destructive and permanently deletes untracked files. \
                 Review untracked files with git clean -n first."
                    .to_string(),
            );
        }
    }

    // branch-force-delete
    for seg in &segments {
        if seg.is_git("branch") && seg.has_short_flag('D') {
            return Some(
                "git branch -D force-deletes a branch even if not fully merged. \
                 Use git branch -d (lowercase) which checks merge status first."
                    .to_string(),
            );
        }
    }

    // worktree-remove
    for seg in &segments {
        if seg.is_git("worktree") && seg.has_arg("remove") {
            return Some(
                "Do not use git worktree remove directly. \
                 Use ExitWorktree with action: \"remove\" to safely clean up \
                 your own worktree (restores CWD, deletes directory and branch). \
                 Never remove other agents' worktrees. \
                 See .claude/worktrees/CLAUDE.md for the full cleanup procedure."
                    .to_string(),
            );
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
            && seg.has_workspace_path()
        {
            return Some(
                "Do not modify files directly in /workspace via Bash. Use a worktree.".to_string(),
            );
        }
        // tee
        if cmd_name == Some("tee") && seg.has_workspace_path() {
            return Some(
                "Do not modify files directly in /workspace via Bash. Use a worktree.".to_string(),
            );
        }
    }

    // Redirect check: > /workspace/... (string scan on raw command, not segment-based)
    {
        let mut pos = 0;
        let bytes = cmd.as_bytes();
        while pos < bytes.len() {
            if bytes[pos] == b'>' {
                if bytes.get(pos + 1) == Some(&b'>') {
                    pos += 2;
                    continue;
                }
                let after = cmd[pos + 1..].trim_start();
                if after.starts_with("/workspace/")
                    && !after.starts_with("/workspace/.claude/worktrees/")
                {
                    return Some(
                        "Do not modify files directly in /workspace via Bash. Use a worktree."
                            .to_string(),
                    );
                }
            }
            pos += 1;
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
            vec![w("echo"), w("hello"), w(">"), w("/tmp/file")]
        );
    }

    #[test]
    fn l1_redirect_append() {
        assert_eq!(
            tok("echo hello >> /tmp/file"),
            vec![w("echo"), w("hello"), w(">>"), w("/tmp/file")]
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

    fn segs(cmd: &str) -> Vec<Vec<String>> {
        parse_segments(cmd)
            .iter()
            .map(|s| s.tokens.clone())
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

    // --- 2b.1 effective_command ---

    fn ec(tokens: &[&str]) -> Option<(usize, String)> {
        let seg = Segment {
            tokens: tokens.iter().map(|s| s.to_string()).collect(),
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
        assert_eq!(
            ec(&["sudo", "-u", "root", "git", "push"]),
            Some((3, "git".to_string()))
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
            tokens: tokens.iter().map(|s| s.to_string()).collect(),
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
            tokens: tokens.iter().map(|s| s.to_string()).collect(),
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

    // --- 2b.11 has_workspace_path ---

    #[test]
    fn l2b_workspace_path_direct() {
        assert!(mk_seg(&["sed", "-i", "s/x/y/", "/workspace/src/file.ts"]).has_workspace_path());
    }

    #[test]
    fn l2b_workspace_path_worktree() {
        assert!(
            !mk_seg(&["sed", "-i", "s/x/y/", "/workspace/.claude/worktrees/wt/f"])
                .has_workspace_path()
        );
    }

    #[test]
    fn l2b_workspace_path_tmp() {
        assert!(!mk_seg(&["sed", "-i", "s/x/y/", "/tmp/file.ts"]).has_workspace_path());
    }

    #[test]
    fn l2b_workspace_path_tee() {
        assert!(mk_seg(&["tee", "/workspace/output.txt"]).has_workspace_path());
    }

    #[test]
    fn l2b_workspace_path_tee_worktree() {
        assert!(!mk_seg(&["tee", "/workspace/.claude/worktrees/wt/out.txt"]).has_workspace_path());
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

    #[test]
    fn l3_clean_fd() {
        let v = json!({"tool_input": {"command": "git clean -fd"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_clean_f() {
        let v = json!({"tool_input": {"command": "git clean -f"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_clean_force() {
        let v = json!({"tool_input": {"command": "git clean --force"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_clean_xfd() {
        let v = json!({"tool_input": {"command": "git clean -xfd"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_clean_chained() {
        // BUG FIX: was bypassing because has_git_flag only checked first segment
        let v = json!({"tool_input": {"command": "echo hi && git clean -fd"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_clean_semi_nospace() {
        let v = json!({"tool_input": {"command": "echo hi;git clean --force"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_clean_sudo() {
        let v = json!({"tool_input": {"command": "sudo git clean -fd"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_clean_c_flag() {
        let v = json!({"tool_input": {"command": "git -C /tmp clean -fd"}});
        assert!(check_bash(&v).is_some());
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

    #[test]
    fn l3_branch_d_upper() {
        let v = json!({"tool_input": {"command": "git branch -D feature"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_branch_df() {
        let v = json!({"tool_input": {"command": "git branch -Df feature"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_branch_d_chained() {
        // BUG FIX: was bypassing
        let v = json!({"tool_input": {"command": "echo hi && git branch -D feature"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_branch_d_sudo() {
        let v = json!({"tool_input": {"command": "sudo git branch -D feature"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_branch_d_no_pager() {
        let v = json!({"tool_input": {"command": "git --no-pager branch -D feature"}});
        assert!(check_bash(&v).is_some());
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

    #[test]
    fn l3_worktree_remove() {
        let v = json!({"tool_input": {"command": "git worktree remove /tmp/wt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_worktree_remove_chained() {
        let v = json!({"tool_input": {"command": "echo hi && git worktree remove /tmp/wt"}});
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_worktree_remove_sudo() {
        let v = json!({"tool_input": {"command": "sudo git worktree remove /tmp/wt"}});
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
    fn l3_append_workspace_allow() {
        let v = json!({"tool_input": {"command": "echo hello >> /workspace/file.txt"}});
        assert!(check_bash(&v).is_none());
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
        assert!(check_bash(&v).is_some());
    }

    #[test]
    fn l3_subst_dquote_branch() {
        let v = json!({"tool_input": {"command": "echo \"$(git branch -D feature)\""}});
        assert!(check_bash(&v).is_some());
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
    fn l3_subst_worktree_remove() {
        let v = json!({"tool_input": {"command": "echo $(git worktree remove /tmp/wt)"}});
        assert!(check_bash(&v).is_some());
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
        let v = json!({"tool_input": {"command": "/usr/bin/git clean -fd"}});
        assert!(check_bash(&v).is_some());
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
        assert!(check_bash(&v).is_some());
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
}
