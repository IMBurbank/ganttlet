use crate::segment::{parse_segments_inner, Segment};

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
pub(crate) const MAX_SUBST_DEPTH: usize = 3;

/// Known command prefixes that wrap another command.
/// `exec` replaces the process with the command — semantically a prefix.
pub(crate) const COMMAND_PREFIXES: &[&str] =
    &["sudo", "env", "command", "nice", "nohup", "time", "exec"];

/// Shell interpreters whose -c argument should be recursively parsed.
pub(crate) const SHELL_COMMANDS: &[&str] = &["bash", "sh", "dash", "zsh", "ksh"];

/// Non-shell interpreters and the flag that introduces inline code.
/// (name, inline_flag) — e.g., python uses -c, node uses -e.
const SCRIPT_INTERPRETERS: &[(&str, &str)] = &[
    ("python", "-c"),
    ("python3", "-c"),
    ("node", "-e"),
    ("ruby", "-e"),
    ("perl", "-e"),
];

/// True if a token is the `git` command (handles full and relative paths like /usr/bin/git, ./git).
pub(crate) fn is_git_command(token: &str) -> bool {
    token == "git" || token.ends_with("/git")
}

/// True if a token is a shell interpreter (handles full paths like /bin/bash).
pub(crate) fn is_shell_command(token: &str) -> bool {
    SHELL_COMMANDS.contains(&token)
        || SHELL_COMMANDS
            .iter()
            .any(|s| token.ends_with(&format!("/{}", s)))
}

/// True if a token is a non-shell script interpreter. Returns the flag
/// that introduces inline code (e.g., "-c" for python, "-e" for node).
pub(crate) fn script_interpreter_flag(token: &str) -> Option<&'static str> {
    let base = token.rsplit('/').next().unwrap_or(token);
    SCRIPT_INTERPRETERS
        .iter()
        .find(|(name, _)| *name == base)
        .map(|(_, flag)| *flag)
}

/// Substrings that indicate write or exec operations in interpreter code.
/// Organized by category. If any pattern appears in the code string alongside
/// a /workspace/ path, the command is blocked. Read-only operations (print,
/// listdir, open for read) don't match any of these.
const WRITE_INDICATORS: &[&str] = &[
    // Shell-out patterns (any language)
    "system(",
    "exec(",
    "popen(",
    "subprocess",
    "child_process",
    "execSync",
    "spawnSync",
    // File mode patterns (Python open() mode argument)
    "\"w\"",
    "'w'",
    "\"w+\"",
    "'w+'",
    "\"a\"",
    "'a'",
    "\"a+\"",
    "'a+'",
    // Python write/delete
    "shutil.",
    "rmtree",
    "os.remove(",
    "os.rename(",
    // Node.js write/delete
    "writeFile",
    "appendFile",
    "createWriteStream",
    "mkdirSync",
    "rmdirSync",
    "unlinkSync",
    "renameSync",
    // Perl/Ruby/cross-language write/delete
    "unlink(",
    "rename(",
    "File.write",
    "File.delete",
    "FileUtils",
];

/// True if a code string contains any write or exec indicator.
pub(crate) fn has_write_indicator(code: &str) -> bool {
    WRITE_INDICATORS
        .iter()
        .any(|pattern| code.contains(pattern))
}

/// Git global flags that consume the NEXT token as a value.
pub(crate) const GIT_VALUE_FLAGS: &[&str] = &[
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--super-prefix",
];

// ============================================================
// Tokenizer struct: encapsulates all mutable state for tokenize_inner
// ============================================================

struct Tokenizer<'a> {
    chars: &'a [char],
    len: usize,
    i: usize,
    tokens: Vec<Token>,
    word: String,
    in_word: bool,
    inner_segment_groups: Vec<Vec<Segment>>,
    last_emitted_op: Option<&'static str>,
    heredoc_delimiter: Option<String>,
    heredoc_in_body: bool,
    heredoc_strip_tabs: bool,
    depth: usize,
    cmd: &'a str, // for fail_open fallback
}

impl<'a> Tokenizer<'a> {
    fn new(chars: &'a [char], cmd: &'a str, depth: usize) -> Self {
        Tokenizer {
            chars,
            len: chars.len(),
            i: 0,
            tokens: Vec::new(),
            word: String::new(),
            in_word: false,
            inner_segment_groups: Vec::new(),
            last_emitted_op: None,
            heredoc_delimiter: None,
            heredoc_in_body: false,
            heredoc_strip_tabs: false,
            depth,
            cmd,
        }
    }

    /// Flush the current word if `in_word` is set.
    fn emit_word(&mut self) {
        if self.in_word {
            self.tokens
                .push(Token::Word(std::mem::take(&mut self.word)));
            self.in_word = false;
        }
    }

    /// Flush any pending word, then emit an operator token.
    fn emit_op(&mut self, op: &'static str) {
        self.emit_word();
        self.last_emitted_op = Some(op);
        self.tokens.push(Token::Operator(op.to_string()));
    }

    /// Handle `$()` command substitution at `self.i` (which points to `$`).
    /// Always sets `self.in_word = true` (idempotent when already inside quotes).
    /// Returns `false` if the substitution is unmatched (caller should fail-open).
    fn parse_dollar_subst(&mut self) -> bool {
        let start = self.i;
        self.i += 2; // skip '$' and '('
        match find_matching_close_paren(self.chars, self.i) {
            Some((inner, new_i)) => {
                self.i = new_i;
                let subst_text: String = self.chars[start..self.i].iter().collect();
                self.in_word = true;
                self.word.push_str(&subst_text);
                if self.depth < MAX_SUBST_DEPTH {
                    let inner_segs = parse_segments_inner(&inner, self.depth + 1);
                    if !inner_segs.is_empty() {
                        self.inner_segment_groups.push(inner_segs);
                    }
                }
                true
            }
            None => false,
        }
    }

    /// Handle a backtick command substitution at `self.i` (which points to `` ` ``).
    /// Always sets `self.in_word = true` (idempotent when already inside quotes).
    /// Returns `false` if the closing backtick is missing (caller should fail-open).
    fn parse_backtick(&mut self) -> bool {
        let start = self.i;
        self.i += 1; // skip opening `
        let mut inner = String::new();
        while self.i < self.len && self.chars[self.i] != '`' {
            inner.push(self.chars[self.i]);
            self.i += 1;
        }
        if self.i >= self.len {
            return false;
        }
        self.i += 1; // skip closing `
        let bt_text: String = self.chars[start..self.i].iter().collect();
        self.in_word = true;
        self.word.push_str(&bt_text);
        if self.depth < MAX_SUBST_DEPTH {
            let inner_segs = parse_segments_inner(&inner, self.depth + 1);
            if !inner_segs.is_empty() {
                self.inner_segment_groups.push(inner_segs);
            }
        }
        true
    }

    /// Handle `<<` heredoc at `self.i` (which points to the first `<`).
    /// Consumes `<<`, optional `-`, whitespace, and the delimiter.
    fn parse_heredoc(&mut self) {
        self.emit_word();
        self.i += 2; // skip '<<'
                     // Check for <<- (indented heredoc: strips leading tabs)
        if self.i < self.len && self.chars[self.i] == '-' {
            self.heredoc_strip_tabs = true;
            self.i += 1;
        }
        // Skip whitespace before delimiter
        while self.i < self.len && (self.chars[self.i] == ' ' || self.chars[self.i] == '\t') {
            self.i += 1;
        }
        // Capture delimiter
        if self.i < self.len {
            let mut delim = String::new();
            if self.chars[self.i] == '\'' || self.chars[self.i] == '"' {
                let quote = self.chars[self.i];
                self.i += 1;
                while self.i < self.len && self.chars[self.i] != quote {
                    delim.push(self.chars[self.i]);
                    self.i += 1;
                }
                if self.i < self.len {
                    self.i += 1; // skip closing quote
                }
            } else {
                while self.i < self.len
                    && self.chars[self.i] != ' '
                    && self.chars[self.i] != '\t'
                    && self.chars[self.i] != '\n'
                    && self.chars[self.i] != ';'
                    && self.chars[self.i] != '&'
                    && self.chars[self.i] != '|'
                {
                    delim.push(self.chars[self.i]);
                    self.i += 1;
                }
            }
            if !delim.is_empty() {
                // Set delimiter; the \n handler will enter body mode.
                // Tokens on the rest of this line (e.g., `<< EOF && echo done`)
                // are processed normally by the main loop.
                self.heredoc_delimiter = Some(delim);
            }
        }
    }

    /// Try to match a simple (table-driven) operator at `self.i`.
    /// Returns `true` and advances `self.i` if matched.
    ///
    /// Operator matching: greedy longest-first, table-driven.
    /// Ordered longest-first so ">>" matches before ">", "&&" before "&", etc.
    /// This is the same algorithm bash uses (shellmeta + peek-ahead).
    ///
    /// Includes `<` redirect variants (`<>`, `<&`, `<`) because heredoc (`<<`)
    /// is checked before this method is called — `<<` is never in the remaining
    /// input when we reach here for a `<` character.
    fn match_simple_op(&mut self) -> bool {
        const SIMPLE_OPS: &[&str] = &[
            "&>>", "&&", "&>", ">>", ">&", ">|", "||", ">", "&", "|", ";", "(", ")", "<>", "<&",
            "<",
        ];
        if let Some(&op) = SIMPLE_OPS.iter().find(|op| {
            let ob = op.as_bytes();
            self.i + ob.len() <= self.len
                && ob
                    .iter()
                    .enumerate()
                    .all(|(j, &b)| self.chars[self.i + j] == b as char)
        }) {
            self.emit_op(op);
            self.i += op.len();
            true
        } else {
            false
        }
    }

    /// Main tokenizer loop. Returns `(tokens, inner_segment_groups)` on success,
    /// or the fail-open result if an unmatched delimiter is encountered.
    fn run(mut self) -> (Vec<Token>, Vec<Vec<Segment>>) {
        while self.i < self.len {
            // Heredoc body: skip until delimiter line
            if self.heredoc_in_body {
                let delim = self.heredoc_delimiter.as_ref().unwrap().clone();
                let line_start = self.i;
                while self.i < self.len && self.chars[self.i] != '\n' {
                    self.i += 1;
                }
                let line: String = self.chars[line_start..self.i].iter().collect();
                // <<- strips leading tabs; << requires exact match
                let matches = if self.heredoc_strip_tabs {
                    line.trim_start_matches('\t') == delim.as_str()
                } else {
                    line.as_str() == delim.as_str()
                };
                if matches {
                    self.heredoc_delimiter = None;
                    self.heredoc_in_body = false;
                    self.heredoc_strip_tabs = false;
                }
                if self.i < self.len {
                    self.i += 1; // skip the \n
                }
                continue;
            }

            let ch = self.chars[self.i];

            // Skip \r (treat as whitespace, \r\n becomes just \n)
            if ch == '\r' {
                self.emit_word();
                self.last_emitted_op = None;
                self.i += 1;
                continue;
            }

            // Whitespace: space, tab
            if ch == ' ' || ch == '\t' {
                self.emit_word();
                self.last_emitted_op = None;
                self.i += 1;
                continue;
            }

            // Comment: # at start of token (not mid-word)
            if ch == '#' && !self.in_word {
                // Skip rest of line
                while self.i < self.len && self.chars[self.i] != '\n' {
                    self.i += 1;
                }
                // Don't consume the \n — let it be processed as an operator
                continue;
            }

            // Newline: command separator, continuation, or heredoc body start
            if ch == '\n' {
                // Only reset last_emitted_op if we flush a word (mirrors original logic:
                // the continuation check must see the operator that preceded the newline).
                if self.in_word {
                    self.emit_word();
                    self.last_emitted_op = None;
                }
                // If heredoc delimiter is set but body hasn't started, enter body mode
                if self.heredoc_delimiter.is_some() && !self.heredoc_in_body {
                    self.heredoc_in_body = true;
                    self.i += 1;
                    continue;
                }
                // After |, &&, || → continuation (skip newline)
                let is_continuation = matches!(self.last_emitted_op, Some("|" | "&&" | "||"));
                if !is_continuation {
                    self.last_emitted_op = Some("\n");
                    self.tokens.push(Token::Operator("\n".to_string()));
                }
                self.i += 1;
                continue;
            }

            // Single quote
            if ch == '\'' {
                self.in_word = true;
                self.i += 1;
                while self.i < self.len && self.chars[self.i] != '\'' {
                    self.word.push(self.chars[self.i]);
                    self.i += 1;
                }
                if self.i >= self.len {
                    // Unmatched single quote — fail-open
                    return fail_open(self.cmd);
                }
                self.i += 1; // skip closing '
                continue;
            }

            // Double quote
            if ch == '"' {
                self.in_word = true;
                self.i += 1;
                while self.i < self.len && self.chars[self.i] != '"' {
                    if self.chars[self.i] == '\\' && self.i + 1 < self.len {
                        let next = self.chars[self.i + 1];
                        match next {
                            '"' | '\\' | '$' | '`' => {
                                self.word.push(next);
                                self.i += 2;
                            }
                            '\n' => {
                                // Line continuation inside double quotes
                                self.i += 2;
                            }
                            _ => {
                                self.word.push('\\');
                                self.word.push(next);
                                self.i += 2;
                            }
                        }
                        continue;
                    }
                    // $() inside double quotes — extract for recursive parsing
                    if self.chars[self.i] == '$'
                        && self.i + 1 < self.len
                        && self.chars[self.i + 1] == '('
                    {
                        if !self.parse_dollar_subst() {
                            return fail_open(self.cmd);
                        }
                        continue;
                    }
                    // Backtick inside double quotes
                    if self.chars[self.i] == '`' {
                        if !self.parse_backtick() {
                            return fail_open(self.cmd);
                        }
                        continue;
                    }
                    self.word.push(self.chars[self.i]);
                    self.i += 1;
                }
                if self.i >= self.len {
                    return fail_open(self.cmd);
                }
                self.i += 1; // skip closing "
                continue;
            }

            // Backslash outside quotes
            if ch == '\\' {
                if self.i + 1 >= self.len {
                    // Dangling backslash — fail-open
                    return fail_open(self.cmd);
                }
                let next = self.chars[self.i + 1];
                if next == '\n' {
                    // Line continuation
                    self.i += 2;
                    continue;
                }
                self.in_word = true;
                self.word.push(next);
                self.i += 2;
                continue;
            }

            // $() command substitution outside quotes
            if ch == '$' && self.i + 1 < self.len && self.chars[self.i + 1] == '(' {
                if !self.parse_dollar_subst() {
                    return fail_open(self.cmd);
                }
                continue;
            }

            // Backtick command substitution outside quotes
            if ch == '`' {
                if !self.parse_backtick() {
                    return fail_open(self.cmd);
                }
                continue;
            }

            // Heredoc: << must be checked BEFORE the table-driven operator match
            // so that `<<` is consumed here and `<`, `<&`, `<>` can live in SIMPLE_OPS.
            if ch == '<' && self.i + 1 < self.len && self.chars[self.i + 1] == '<' {
                self.parse_heredoc();
                continue;
            }

            // Operator matching: greedy longest-first, table-driven.
            // Includes <>, <&, < (safe now that << was caught above).
            if self.match_simple_op() {
                continue;
            }

            // Default: regular character, accumulate into word
            self.in_word = true;
            self.word.push(ch);
            self.i += 1;
        }

        // Emit final word if any
        self.emit_word();

        (self.tokens, self.inner_segment_groups)
    }
}

pub(crate) fn tokenize_inner(cmd: &str, depth: usize) -> (Vec<Token>, Vec<Vec<Segment>>) {
    let chars: Vec<char> = cmd.chars().collect();
    let tok = Tokenizer::new(&chars, cmd, depth);
    tok.run()
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

#[cfg(test)]
mod tests {
    use super::*;

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

    // --- 1.23 Bash ground truth (redirect classification) ---

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
}
