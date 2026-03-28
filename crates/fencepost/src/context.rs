use std::path::{Path, PathBuf};

use crate::segment::{ContextualSegment, Segment};

// ============================================================
// Path resolution
// ============================================================

/// Normalize a path logically (without filesystem access).
/// Resolves `.` and `..` components. Does NOT follow symlinks or
/// check existence — the target may not exist yet (write operations).
pub(crate) fn normalize_path(path: &std::path::Path) -> std::path::PathBuf {
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

/// Heuristic: does a token look like a file path rather than a flag, sed pattern, etc.?
/// Used by has_protected_path to skip non-path tokens in segment scanning.
///
/// Accepts: absolute paths (/foo), relative paths (./foo, ~/foo, ../foo),
///          and tokens with path-like structure (src/file.ts, dir/subdir).
/// Rejects: flags (-f, --force), sed patterns (s/x/y/), bare words (main, HEAD).
pub(crate) fn looks_like_path(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    // Absolute paths
    if token.starts_with('/') {
        return true;
    }
    // Relative path markers
    if token.starts_with("./") || token.starts_with("../") || token.starts_with("~/") {
        return true;
    }
    // Flags
    if token.starts_with('-') {
        return false;
    }
    // Must contain a path separator to be a relative path
    if !token.contains('/') {
        return false;
    }
    // Skip sed substitution/transliteration patterns: s/x/y/ or y/x/y/
    // These start with 's' or 'y' followed by a non-alphanumeric delimiter.
    // Real paths like a/b/c or src/lib are NOT rejected.
    if token.len() >= 4 {
        let bytes = token.as_bytes();
        if (bytes[0] == b's' || bytes[0] == b'y') && bytes[1] == b'/' {
            let slash_count = token.chars().filter(|&c| c == '/').count();
            if slash_count >= 2 {
                return false; // sed pattern: s/old/new/ or y/abc/def/
            }
        }
    }
    true
}

/// Simple glob matching for file basenames. Supports:
/// - `*.ext` (suffix match)
/// - `prefix*` (prefix match)
/// - `*substring*` (contains match)
/// - `exact` (exact match, no wildcards)
pub(crate) fn glob_match(pattern: &str, name: &str) -> bool {
    if !pattern.contains('*') {
        return name == pattern;
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    match parts.len() {
        2 => {
            let (prefix, suffix) = (parts[0], parts[1]);
            if prefix.is_empty() && suffix.is_empty() {
                true // "*" matches everything
            } else if prefix.is_empty() {
                name.ends_with(suffix) // "*.ext"
            } else if suffix.is_empty() {
                name.starts_with(prefix) // "prefix*"
            } else {
                name.len() >= prefix.len() + suffix.len()
                    && name.starts_with(prefix)
                    && name.ends_with(suffix) // "pre*suf"
            }
        }
        3 if parts[0].is_empty() && parts[2].is_empty() => {
            // "*substring*"
            name.contains(parts[1])
        }
        _ => false, // Complex globs not supported
    }
}

// ============================================================
// Config file loading
// ============================================================

/// Load project-specific configuration from {root}/.claude/fencepost.json.
/// All fields are optional — omitted fields use auto-detection / defaults.
///
/// Example config:
/// ```json
/// {
///   "default_branch": "develop",
///   "remote": "upstream",
///   "protected_files": [
///     { "basename": "package-lock.json", "reason": "Managed by npm" },
///     { "basename_prefix": ".env", "reason": "Contains secrets" },
///     { "path_contains": "dist/", "reason": "Build output" },
///     { "glob": "*.lock", "reason": "Lock files are generated" }
///   ]
/// }
/// ```
/// Load fencepost config. Resolution order:
/// 1. `FENCEPOST_CONFIG` env var (absolute or relative to root)
/// 2. Default: `{root}/.claude/fencepost.json`
///
/// FROZEN CONVENTION: the default path `.claude/fencepost.json` is used by every
/// project that adopts fencepost. Do not change this default without a migration
/// strategy for all consuming projects. See config_v1_frozen_contract test.
pub(crate) fn load_config(root: &Path) -> Option<serde_json::Value> {
    let config_path = if let Ok(custom) = std::env::var("FENCEPOST_CONFIG") {
        let p = std::path::Path::new(&custom);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            root.join(&custom)
        }
    } else {
        root.join(".claude/fencepost.json")
    };
    let from_env = std::env::var("FENCEPOST_CONFIG").is_ok();
    match std::fs::read_to_string(&config_path) {
        Ok(contents) => serde_json::from_str(&contents).ok(),
        Err(_) if from_env => {
            // User explicitly set FENCEPOST_CONFIG but file doesn't exist — warn loudly
            eprintln!(
                "fencepost: FENCEPOST_CONFIG={} not found — using defaults",
                config_path.display()
            );
            None
        }
        Err(_) => None, // Default path not found — normal, use defaults silently
    }
}

/// Parse protected file patterns from config JSON.
pub(crate) fn parse_protected_patterns(
    config: &serde_json::Value,
) -> Option<Vec<ProtectedPattern>> {
    let arr = config.get("protected_files")?.as_array()?;
    let mut patterns = Vec::new();
    for entry in arr {
        let reason = entry
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if let Some(val) = entry.get("basename").and_then(|v| v.as_str()) {
            patterns.push(ProtectedPattern::BasenameExact {
                pattern: val.to_string(),
                reason,
            });
        } else if let Some(val) = entry.get("basename_prefix").and_then(|v| v.as_str()) {
            patterns.push(ProtectedPattern::BasenamePrefix {
                prefix: val.to_string(),
                reason,
            });
        } else if let Some(val) = entry.get("path_contains").and_then(|v| v.as_str()) {
            patterns.push(ProtectedPattern::PathContains {
                substring: val.to_string(),
                reason,
            });
        } else if let Some(val) = entry.get("glob").and_then(|v| v.as_str()) {
            patterns.push(ProtectedPattern::Glob {
                pattern: val.to_string(),
                reason,
            });
        }
    }
    if patterns.is_empty() {
        None
    } else {
        Some(patterns)
    }
}

/// Parse per-rule severity overrides from config.
/// Example: `{"rules": {"checkout-switch": "off", "clean-force": "warn"}}`
fn parse_rule_overrides(
    config: &serde_json::Value,
) -> Option<std::collections::HashMap<String, crate::rule::Severity>> {
    let obj = config.get("rules")?.as_object()?;
    let mut overrides = std::collections::HashMap::new();
    for (name, val) in obj {
        if let Some(severity_str) = val.as_str() {
            let severity = match severity_str {
                "block" => crate::rule::Severity::Block,
                "warn" => crate::rule::Severity::Warn,
                "off" => crate::rule::Severity::Off,
                _ => continue, // skip unknown severity values
            };
            overrides.insert(name.clone(), severity);
        }
    }
    if overrides.is_empty() {
        None
    } else {
        Some(overrides)
    }
}

// ============================================================
// ProjectContext: runtime detection of project root and policy
// ============================================================

/// How a protected file pattern is matched against a file path.
/// Each variant includes a `reason` explaining WHY the file is protected,
/// so agents can self-correct when blocked.
#[derive(Debug, Clone)]
pub enum ProtectedPattern {
    /// Match the basename exactly (e.g. "package-lock.json")
    BasenameExact { pattern: String, reason: String },
    /// Match basenames starting with a prefix (e.g. ".env" matches ".env", ".env.local")
    BasenamePrefix { prefix: String, reason: String },
    /// Match if the path contains this substring (e.g. "src/wasm/scheduler/")
    PathContains { substring: String, reason: String },
    /// Match the basename against a glob pattern (e.g. "*.lock", "*.pyc")
    Glob { pattern: String, reason: String },
}

/// Runtime context for the project the guard is protecting.
/// Replaces all hardcoded /workspace/ paths with detected values.
/// CWD is captured at construction time, making all checks deterministic
/// and testable without process-global side effects.
#[derive(Debug, Clone)]
pub struct ProjectContext {
    /// Project root directory (detected from nearest .git ancestor)
    pub(crate) root: PathBuf,
    /// Worktree directory ({root}/.claude/worktrees)
    pub(crate) worktrees_dir: PathBuf,
    /// Working directory at the time the context was created
    pub(crate) cwd: PathBuf,
    /// Default branch name (e.g. "main")
    pub(crate) default_branch: String,
    /// Remote name (e.g. "origin")
    pub(crate) remote_name: String,
    /// Protected file patterns — basenames or path-contains matches
    pub(crate) protected_file_patterns: Vec<ProtectedPattern>,
    /// Per-rule severity overrides from config (rule_name → severity).
    /// Unmentioned rules keep their default severity.
    pub(crate) rule_overrides: std::collections::HashMap<String, crate::rule::Severity>,
    /// Warnings generated during config loading (unknown fields, invalid rule names, etc.)
    pub(crate) config_warnings: Vec<String>,
}

impl ProjectContext {
    /// Detect the project context by walking up from CWD to find the nearest .git.
    /// Auto-detects the default branch and remote name from git config.
    /// Captures CWD at detection time. Returns None if CWD is unavailable or no
    /// .git is found (fail-open).
    pub fn detect() -> Option<Self> {
        let cwd = std::env::current_dir().ok()?;
        let root = find_project_root(&cwd)?;
        let git_dir = root.join(".git");
        let mut config_warnings = Vec::new();

        // Load project config (optional — all fields have auto-detected defaults)
        let config = load_config(&root);

        // Validate known config fields
        const KNOWN_FIELDS: &[&str] = &[
            "version",
            "protocol",
            "default_branch",
            "remote",
            "worktrees_dir",
            "protected_files",
            "protected_files_override",
            "rules",
        ];
        if let Some(obj) = config.as_ref().and_then(|c| c.as_object()) {
            for key in obj.keys() {
                if !KNOWN_FIELDS.contains(&key.as_str()) {
                    config_warnings.push(format!(
                        "Unknown config field '{}' in .claude/fencepost.json (typo? known fields: {})",
                        key,
                        KNOWN_FIELDS.join(", ")
                    ));
                }
            }
        }

        // Validate config version
        if let Some(version) = config
            .as_ref()
            .and_then(|c| c.get("version"))
            .and_then(|v| v.as_u64())
        {
            if version != 1 {
                config_warnings.push(format!(
                    "Config version {} is not supported by this fencepost binary (supports v1). \
                     Config may be misinterpreted. Update fencepost or downgrade your config.",
                    version
                ));
            }
        }

        // Configurable worktree directory (default: {root}/.claude/worktrees)
        let worktrees_dir = config
            .as_ref()
            .and_then(|c| c.get("worktrees_dir"))
            .and_then(|v| v.as_str())
            .map(|s| {
                if Path::new(s).is_absolute() {
                    PathBuf::from(s)
                } else {
                    root.join(s)
                }
            })
            .unwrap_or_else(|| root.join(".claude/worktrees"));

        // Config precedence: env var > config file > git detection > hardcoded default
        let remote_name = std::env::var("FENCEPOST_REMOTE")
            .ok()
            .or_else(|| {
                config
                    .as_ref()
                    .and_then(|c| c.get("remote"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| detect_remote_name(&git_dir));

        let default_branch = std::env::var("FENCEPOST_DEFAULT_BRANCH")
            .ok()
            .or_else(|| {
                config
                    .as_ref()
                    .and_then(|c| c.get("default_branch"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| detect_default_branch(&git_dir));

        // Config protected_files EXTEND defaults (not replace).
        // To start fresh, set "protected_files_override": true.
        let mut protected_file_patterns = Self::default_patterns();
        if let Some(config_patterns) = config.as_ref().and_then(parse_protected_patterns) {
            let override_defaults = config
                .as_ref()
                .and_then(|c| c.get("protected_files_override"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if override_defaults {
                protected_file_patterns = config_patterns;
            } else {
                protected_file_patterns.extend(config_patterns);
            }
        }

        // Parse per-rule severity overrides (config file)
        let mut rule_overrides = config
            .as_ref()
            .and_then(parse_rule_overrides)
            .unwrap_or_default();

        // Env var overrides: FENCEPOST_RULES_OFF=rule1,rule2 disables rules
        if let Ok(off_rules) = std::env::var("FENCEPOST_RULES_OFF") {
            for name in off_rules.split(',') {
                let name = name.trim();
                if !name.is_empty() {
                    rule_overrides.insert(name.to_string(), crate::rule::Severity::Off);
                }
            }
        }

        Some(Self {
            root,
            worktrees_dir,
            cwd,
            default_branch,
            remote_name,
            protected_file_patterns,
            rule_overrides,
            config_warnings,
        })
    }

    /// Construct a context from a known project root, capturing current CWD.
    pub fn from_root(root: PathBuf) -> Self {
        let cwd = std::env::current_dir().unwrap_or_else(|_| root.clone());
        Self::from_root_and_cwd(root, cwd)
    }

    /// Construct a context with explicit root and CWD (for testing).
    pub fn from_root_and_cwd(root: PathBuf, cwd: PathBuf) -> Self {
        let worktrees_dir = root.join(".claude/worktrees");
        Self {
            root,
            worktrees_dir,
            cwd,
            default_branch: "main".to_string(),
            remote_name: "origin".to_string(),
            protected_file_patterns: Self::default_patterns(),
            rule_overrides: std::collections::HashMap::new(),
            config_warnings: Vec::new(),
        }
    }

    /// Universal protected file patterns — safe defaults for any project.
    /// Project-specific patterns go in `.claude/fencepost.json`.
    pub fn default_patterns() -> Vec<ProtectedPattern> {
        vec![
            ProtectedPattern::BasenamePrefix {
                prefix: ".env".into(),
                reason: "Environment files may contain secrets. Never modify directly.".into(),
            },
            ProtectedPattern::Glob {
                pattern: "*.lock".into(),
                reason: "Lock files are auto-generated. Run the appropriate install command."
                    .into(),
            },
            ProtectedPattern::BasenameExact {
                pattern: "package-lock.json".into(),
                reason: "Managed by npm. Run `npm install` to regenerate.".into(),
            },
            ProtectedPattern::BasenameExact {
                pattern: "pnpm-lock.yaml".into(),
                reason: "Managed by pnpm. Run `pnpm install` to regenerate.".into(),
            },
            ProtectedPattern::BasenameExact {
                pattern: "go.sum".into(),
                reason: "Managed by Go modules. Run `go mod tidy` to regenerate.".into(),
            },
        ]
    }

    // -- Builder methods --

    /// Set the default branch name. Returns self for chaining.
    pub fn with_default_branch(mut self, branch: &str) -> Self {
        self.default_branch = branch.to_string();
        self
    }

    /// Set the remote name. Returns self for chaining.
    pub fn with_remote_name(mut self, remote: &str) -> Self {
        self.remote_name = remote.to_string();
        self
    }

    // -- Accessors --

    /// The project root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }
    /// The worktrees directory ({root}/.claude/worktrees).
    pub fn worktrees_dir(&self) -> &Path {
        &self.worktrees_dir
    }
    /// The working directory captured at context creation.
    pub fn cwd(&self) -> &Path {
        &self.cwd
    }
    /// The default branch name.
    pub fn default_branch(&self) -> &str {
        &self.default_branch
    }
    /// The remote name.
    pub fn remote_name(&self) -> &str {
        &self.remote_name
    }

    /// Rule override names from config (for validation by doctor).
    pub fn rule_override_names(&self) -> Vec<&str> {
        self.rule_overrides.keys().map(|s| s.as_str()).collect()
    }

    /// Config warnings generated during loading (unknown fields, etc.)
    pub fn config_warnings(&self) -> &[String] {
        &self.config_warnings
    }

    /// Get the effective severity for a rule, accounting for config overrides.
    /// Returns the override if one exists, otherwise returns the rule's default.
    pub fn rule_severity(
        &self,
        rule_name: &str,
        default: &crate::rule::Severity,
    ) -> crate::rule::Severity {
        self.rule_overrides
            .get(rule_name)
            .cloned()
            .unwrap_or_else(|| default.clone())
    }

    // -- Path queries --

    /// The project root as a string with trailing slash, for prefix matching.
    pub fn root_prefix(&self) -> String {
        let s = self.root.to_string_lossy();
        if s.ends_with('/') {
            s.into_owned()
        } else {
            format!("{}/", s)
        }
    }

    /// The worktrees directory as a string with trailing slash, for prefix matching.
    pub fn worktrees_prefix(&self) -> String {
        let s = self.worktrees_dir.to_string_lossy();
        if s.ends_with('/') {
            s.into_owned()
        } else {
            format!("{}/", s)
        }
    }

    /// Resolve a path (absolute or relative) using the captured CWD.
    /// Relative paths are joined against self.cwd. Returns None for empty paths.
    pub fn resolve_path(&self, path: &str) -> Option<PathBuf> {
        if path.is_empty() {
            return None;
        }
        if path.starts_with('/') {
            Some(normalize_path(Path::new(path)))
        } else {
            Some(normalize_path(&self.cwd.join(path)))
        }
    }

    /// True if a resolved absolute path is under the project root but NOT under worktrees.
    pub fn is_protected_path(&self, path: &str) -> bool {
        match self.resolve_path(path) {
            Some(resolved) => {
                let s = resolved.to_string_lossy();
                s.starts_with(&self.root_prefix()) && !s.starts_with(&self.worktrees_prefix())
            }
            None => false, // fail-open
        }
    }

    /// True if the captured CWD is the project root itself.
    pub fn is_project_root_cwd(&self) -> bool {
        normalize_path(&self.cwd) == self.root
    }

    /// True if the captured CWD is inside the worktrees directory.
    pub fn is_worktree_cwd(&self) -> bool {
        self.cwd
            .to_string_lossy()
            .starts_with(&self.worktrees_prefix())
    }

    /// Check if a file path matches any protected file pattern.
    /// Returns a block reason message if matched, None if allowed.
    pub fn is_protected_file(&self, file_path: &str) -> Option<String> {
        let basename = file_path.rsplit('/').next().unwrap_or(file_path);
        for pat in &self.protected_file_patterns {
            let (matched, reason) = match pat {
                ProtectedPattern::BasenameExact { pattern, reason } => {
                    (basename == pattern, reason.as_str())
                }
                ProtectedPattern::BasenamePrefix { prefix, reason } => (
                    basename == prefix || basename.starts_with(&format!("{}.", prefix)),
                    reason.as_str(),
                ),
                ProtectedPattern::PathContains { substring, reason } => {
                    (file_path.contains(substring.as_str()), reason.as_str())
                }
                ProtectedPattern::Glob { pattern, reason } => {
                    (glob_match(pattern, basename), reason.as_str())
                }
            };
            if matched {
                return Some(reason.to_string());
            }
        }
        None
    }

    // -- Context binding --

    /// Bind a segment to this context, producing a ContextualSegment with
    /// safe query methods and policy-aware checks.
    pub fn bind<'a>(&'a self, seg: &'a Segment) -> ContextualSegment<'a> {
        ContextualSegment::new(seg, self)
    }

    // -- Block messages (dynamically interpolate project paths) --

    pub fn msg_worktree_docs(&self) -> String {
        format!(
            "See {}/.claude/worktrees/CLAUDE.md for the full cleanup procedure.",
            self.root.display()
        )
    }
}

/// Walk up from a directory to find the nearest .git (directory or file).
/// If .git is a file (git worktree), parse it to find the real project root.
pub fn find_project_root(start: &Path) -> Option<PathBuf> {
    let mut dir = start.to_path_buf();
    loop {
        let git_path = dir.join(".git");
        if git_path.is_dir() {
            return Some(dir);
        }
        if git_path.is_file() {
            // Git worktree: .git is a file containing "gitdir: <path>"
            // The real root is the parent of the commondir.
            if let Ok(contents) = std::fs::read_to_string(&git_path) {
                if let Some(gitdir) = contents.trim().strip_prefix("gitdir: ") {
                    let gitdir_path = if Path::new(gitdir).is_absolute() {
                        PathBuf::from(gitdir)
                    } else {
                        normalize_path(&dir.join(gitdir))
                    };
                    // The gitdir typically points to <root>/.git/worktrees/<name>.
                    // Walk up to find the parent that contains a .git directory.
                    let mut candidate = gitdir_path.as_path();
                    while let Some(parent) = candidate.parent() {
                        if parent.join(".git").is_dir() {
                            return Some(parent.to_path_buf());
                        }
                        // Also check if this IS the .git dir (gitdir points inside it)
                        if parent.file_name().map(|n| n == ".git").unwrap_or(false) {
                            if let Some(root) = parent.parent() {
                                return Some(root.to_path_buf());
                            }
                        }
                        candidate = parent;
                    }
                }
            }
            // Couldn't parse the gitdir file — treat this dir as root
            return Some(dir);
        }
        if !dir.pop() {
            return None; // reached filesystem root
        }
    }
}

/// Detect the remote name from .git/config. Returns the first [remote "..."] name found.
/// Falls back to "origin" if config is unreadable or has no remotes.
fn detect_remote_name(git_dir: &Path) -> String {
    let config_path = git_dir.join("config");
    if let Ok(contents) = std::fs::read_to_string(&config_path) {
        for line in contents.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("[remote \"") {
                if let Some(name) = rest.strip_suffix("\"]") {
                    return name.to_string();
                }
            }
        }
    }
    "origin".to_string()
}

/// Detect the default branch by checking which common branch names exist as refs.
/// Checks: main, master, develop, dev, trunk (in order of convention preference).
/// Falls back to "main" if none are found.
fn detect_default_branch(git_dir: &Path) -> String {
    // 1. Check init.defaultBranch in local git config
    let config_path = git_dir.join("config");
    if let Ok(contents) = std::fs::read_to_string(&config_path) {
        let mut in_init = false;
        for line in contents.lines() {
            let trimmed = line.trim();
            if trimmed == "[init]" {
                in_init = true;
            } else if trimmed.starts_with('[') {
                in_init = false;
            } else if in_init {
                if let Some(val) = trimmed.strip_prefix("defaultBranch = ") {
                    return val.trim().to_string();
                }
                if let Some(val) = trimmed.strip_prefix("defaultBranch=") {
                    return val.trim().to_string();
                }
            }
        }
    }

    // 2. Check which common branch names exist as refs
    let candidates = ["main", "master", "develop", "dev", "trunk"];
    for name in &candidates {
        if git_dir.join(format!("refs/heads/{}", name)).exists() {
            return name.to_string();
        }
    }

    // 3. Check packed-refs file
    if let Ok(packed) = std::fs::read_to_string(git_dir.join("packed-refs")) {
        for name in &candidates {
            let ref_path = format!("refs/heads/{}", name);
            if packed.lines().any(|line| line.ends_with(&ref_path)) {
                return name.to_string();
            }
        }
    }

    "main".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::segment::Segment;
    use crate::token::Token;

    /// Default test context with deterministic CWD in a worktree.
    fn test_ctx() -> ProjectContext {
        ProjectContext::from_root_and_cwd(
            PathBuf::from("/workspace"),
            PathBuf::from("/workspace/.claude/worktrees/default-test"),
        )
    }

    #[test]
    fn ctx_root_prefix() {
        let ctx = test_ctx();
        assert_eq!(ctx.root_prefix(), "/workspace/");
    }

    #[test]
    fn ctx_worktrees_prefix() {
        let ctx = test_ctx();
        assert_eq!(ctx.worktrees_prefix(), "/workspace/.claude/worktrees/");
    }

    #[test]
    fn ctx_is_protected_path_workspace_file() {
        let ctx = test_ctx();
        assert!(ctx.is_protected_path("/workspace/src/foo.ts"));
    }

    #[test]
    fn ctx_is_protected_path_worktree_file_allowed() {
        let ctx = test_ctx();
        assert!(!ctx.is_protected_path("/workspace/.claude/worktrees/wt/src/foo.ts"));
    }

    #[test]
    fn ctx_is_protected_path_outside_root() {
        let ctx = test_ctx();
        assert!(!ctx.is_protected_path("/tmp/foo.ts"));
    }

    #[test]
    fn ctx_is_protected_path_empty() {
        let ctx = test_ctx();
        assert!(!ctx.is_protected_path(""));
    }

    #[test]
    fn ctx_default_blocks_lock_files() {
        let ctx = test_ctx();
        assert!(ctx
            .is_protected_file("/workspace/package-lock.json")
            .is_some());
        assert!(ctx.is_protected_file("/workspace/Cargo.lock").is_some());
        assert!(ctx.is_protected_file("/workspace/poetry.lock").is_some());
    }

    #[test]
    fn ctx_default_blocks_env_files() {
        let ctx = test_ctx();
        assert!(ctx.is_protected_file("/workspace/.env").is_some());
        assert!(ctx.is_protected_file("/workspace/.env.local").is_some());
    }

    #[test]
    fn ctx_default_allows_non_protected() {
        let ctx = test_ctx();
        // wasm/scheduler is NOT a universal default — it's project-specific
        assert!(ctx
            .is_protected_file("/workspace/src/wasm/scheduler/foo.js")
            .is_none());
        assert!(ctx.is_protected_file("/workspace/src/App.tsx").is_none());
    }

    #[test]
    fn ctx_is_protected_file_normal_file_allowed() {
        let ctx = test_ctx();
        assert!(ctx.is_protected_file("/workspace/src/App.tsx").is_none());
    }

    // -- Protected file pattern negative tests (false positive prevention) --

    #[test]
    fn ctx_env_no_match_environment() {
        let ctx = test_ctx();
        assert!(ctx.is_protected_file("/workspace/.environment").is_none());
    }

    #[test]
    fn ctx_env_no_match_dash_suffix() {
        let ctx = test_ctx();
        assert!(ctx.is_protected_file("/workspace/.env-backup").is_none());
    }

    #[test]
    fn ctx_env_no_match_envrc() {
        let ctx = test_ctx();
        assert!(ctx.is_protected_file("/workspace/.envrc").is_none());
    }

    #[test]
    fn ctx_env_no_match_no_dot_prefix() {
        let ctx = test_ctx();
        assert!(ctx.is_protected_file("/workspace/dotenv").is_none());
    }

    #[test]
    fn ctx_env_no_match_in_dir_name() {
        let ctx = test_ctx();
        assert!(ctx
            .is_protected_file("/workspace/.env-templates/README.md")
            .is_none());
    }

    #[test]
    fn ctx_package_lock_no_match_backup() {
        let ctx = test_ctx();
        assert!(ctx
            .is_protected_file("/workspace/package-lock.json.bak")
            .is_none());
    }

    // -- Glob matching tests --

    #[test]
    fn glob_suffix_match() {
        assert!(glob_match("*.lock", "Cargo.lock"));
        assert!(glob_match("*.lock", "poetry.lock"));
        assert!(!glob_match("*.lock", "Cargo.lock.bak"));
    }

    #[test]
    fn glob_prefix_match() {
        assert!(glob_match("build*", "build-output"));
        assert!(!glob_match("build*", "prebuild"));
    }

    #[test]
    fn glob_contains_match() {
        assert!(glob_match("*test*", "my-test-file"));
        assert!(!glob_match("*test*", "production"));
    }

    #[test]
    fn glob_exact_no_wildcards() {
        assert!(glob_match("Makefile", "Makefile"));
        assert!(!glob_match("Makefile", "makefile"));
    }

    #[test]
    fn glob_star_matches_all() {
        assert!(glob_match("*", "anything"));
    }

    #[test]
    fn glob_protected_file_pattern() {
        let ctx = ProjectContext::from_root_and_cwd(
            PathBuf::from("/proj"),
            PathBuf::from("/proj/.claude/worktrees/wt"),
        );
        // Add a glob pattern
        let mut ctx = ctx;
        ctx.protected_file_patterns.push(ProtectedPattern::Glob {
            pattern: "*.lock".to_string(),
            reason: "Lock files are generated".to_string(),
        });
        assert!(ctx.is_protected_file("/proj/Cargo.lock").is_some());
        assert!(ctx.is_protected_file("/proj/poetry.lock").is_some());
        assert!(ctx.is_protected_file("/proj/README.md").is_none());
    }

    // -- Config parsing tests --

    #[test]
    fn config_parse_protected_patterns() {
        let config: serde_json::Value = serde_json::from_str(
            r#"{
            "protected_files": [
                { "basename": "yarn.lock", "reason": "Managed by yarn" },
                { "basename_prefix": ".secret", "reason": "Secrets" },
                { "path_contains": "dist/", "reason": "Build output" },
                { "glob": "*.pyc", "reason": "Python bytecode" }
            ]
        }"#,
        )
        .unwrap();
        let patterns = parse_protected_patterns(&config).unwrap();
        assert_eq!(patterns.len(), 4);
    }

    #[test]
    fn config_parse_empty_returns_none() {
        let config: serde_json::Value = serde_json::from_str(r#"{}"#).unwrap();
        assert!(parse_protected_patterns(&config).is_none());
    }

    // -- looks_like_path heuristic tests --

    #[test]
    fn path_absolute() {
        assert!(looks_like_path("/foo/bar"));
        assert!(looks_like_path("/"));
    }

    #[test]
    fn path_relative_dot() {
        assert!(looks_like_path("./foo"));
        assert!(looks_like_path("../foo"));
        assert!(looks_like_path("~/foo"));
    }

    #[test]
    fn path_relative_dir() {
        assert!(looks_like_path("src/main.rs"));
        assert!(looks_like_path("crates/fencepost/src/lib.rs"));
    }

    #[test]
    fn path_rejects_flags() {
        assert!(!looks_like_path("-f"));
        assert!(!looks_like_path("--force"));
        assert!(!looks_like_path("-i.bak"));
    }

    #[test]
    fn path_rejects_sed_patterns() {
        assert!(!looks_like_path("s/x/y/"));
        assert!(!looks_like_path("s/foo/bar/g"));
        assert!(!looks_like_path("y/abc/def/"));
    }

    #[test]
    fn path_accepts_single_char_dirs() {
        // Single-char directory names are valid paths (not sed patterns)
        assert!(looks_like_path("a/b/c"));
        assert!(looks_like_path("x/file.txt"));
        // But s/ and y/ with 2+ slashes are still sed patterns
        assert!(!looks_like_path("s/old/new/"));
        assert!(!looks_like_path("y/a/b/"));
    }

    #[test]
    fn path_rejects_bare_words() {
        assert!(!looks_like_path("main"));
        assert!(!looks_like_path("HEAD"));
        assert!(!looks_like_path("origin"));
    }

    #[test]
    fn path_rejects_empty() {
        assert!(!looks_like_path(""));
    }

    #[test]
    fn ctx_from_root_sets_worktrees() {
        let ctx = ProjectContext::from_root(PathBuf::from("/home/user/myproject"));
        assert_eq!(
            ctx.worktrees_dir,
            PathBuf::from("/home/user/myproject/.claude/worktrees")
        );
        assert_eq!(ctx.default_branch, "main");
        assert_eq!(ctx.remote_name, "origin");
    }

    #[test]
    fn ctx_alt_root_protected_path() {
        let ctx = ProjectContext::from_root(PathBuf::from("/home/user/proj"));
        assert!(ctx.is_protected_path("/home/user/proj/src/foo.ts"));
        assert!(!ctx.is_protected_path("/home/user/proj/.claude/worktrees/wt/src/foo.ts"));
        assert!(!ctx.is_protected_path("/workspace/src/foo.ts")); // different root
    }

    #[test]
    fn ctx_segment_targets_worktree_root() {
        let ctx = test_ctx();
        let seg = Segment {
            tokens: vec![
                Token::Word("git".to_string()),
                Token::Word("worktree".to_string()),
                Token::Word("remove".to_string()),
                Token::Word("/workspace/.claude/worktrees/my-wt".to_string()),
            ],
        };
        assert!(ctx.bind(&seg).targets_worktree_root());
    }

    #[test]
    fn ctx_segment_targets_worktree_root_subdir_no_match() {
        let ctx = test_ctx();
        let seg = Segment {
            tokens: vec![
                Token::Word("rm".to_string()),
                Token::Word("/workspace/.claude/worktrees/my-wt/node_modules".to_string()),
            ],
        };
        assert!(!ctx.bind(&seg).targets_worktree_root());
    }

    #[test]
    fn ctx_segment_has_protected_path() {
        let ctx = test_ctx();
        let seg = Segment {
            tokens: vec![
                Token::Word("sed".to_string()),
                Token::Word("-i".to_string()),
                Token::Word("/workspace/src/foo.ts".to_string()),
            ],
        };
        assert!(ctx.bind(&seg).has_protected_path());
    }

    #[test]
    fn ctx_segment_has_protected_path_worktree_allowed() {
        let ctx = test_ctx();
        let seg = Segment {
            tokens: vec![
                Token::Word("sed".to_string()),
                Token::Word("-i".to_string()),
                Token::Word("/workspace/.claude/worktrees/wt/src/foo.ts".to_string()),
            ],
        };
        assert!(!ctx.bind(&seg).has_protected_path());
    }

    #[test]
    fn ctx_msg_worktree_docs_uses_root_path() {
        let ctx = ProjectContext::from_root(PathBuf::from("/my/project"));
        assert!(ctx.msg_worktree_docs().contains("/my/project"));
    }

    // ================================================================
    // find_project_root Tests
    // ================================================================

    #[test]
    fn find_root_regular_repo() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".git")).unwrap();

        let result = find_project_root(tmp.path());
        assert_eq!(result, Some(tmp.path().to_path_buf()));
    }

    #[test]
    fn find_root_walks_up() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
        let deep = tmp.path().join("src/deeply/nested");
        std::fs::create_dir_all(&deep).unwrap();

        let result = find_project_root(&deep);
        assert_eq!(result, Some(tmp.path().to_path_buf()));
    }

    #[test]
    fn find_root_nested_repos_closest_wins() {
        let tmp = tempfile::tempdir().unwrap();
        // Parent repo
        std::fs::create_dir_all(tmp.path().join(".git")).unwrap();

        // Child repo
        let child = tmp.path().join("services/api");
        std::fs::create_dir_all(child.join(".git")).unwrap();
        std::fs::create_dir_all(child.join("src")).unwrap();

        // From child's src/ → should find child, not parent
        let result = find_project_root(&child.join("src"));
        assert_eq!(result, Some(child.clone()));

        // From parent root → should find parent
        let result = find_project_root(tmp.path());
        assert_eq!(result, Some(tmp.path().to_path_buf()));
    }

    #[test]
    fn find_root_worktree_relative_gitdir() {
        let tmp = tempfile::tempdir().unwrap();
        // Main repo with worktrees dir
        let main_repo = tmp.path().join("main");
        std::fs::create_dir_all(main_repo.join(".git/worktrees/wt")).unwrap();
        // Worktree directory with .git file (relative path)
        let wt = tmp.path().join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join(".git"), "gitdir: ../main/.git/worktrees/wt\n").unwrap();

        let result = find_project_root(&wt);
        assert_eq!(result, Some(main_repo));
    }

    #[test]
    fn find_root_worktree_absolute_gitdir() {
        let tmp = tempfile::tempdir().unwrap();
        let main_repo = tmp.path().join("main");
        std::fs::create_dir_all(main_repo.join(".git/worktrees/wt")).unwrap();
        let wt = tmp.path().join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        // Absolute gitdir path
        let gitdir = main_repo.join(".git/worktrees/wt");
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", gitdir.display())).unwrap();

        let result = find_project_root(&wt);
        assert_eq!(result, Some(main_repo));
    }

    #[test]
    fn find_root_unparseable_git_file() {
        let tmp = tempfile::tempdir().unwrap();
        // .git is a file but not a valid gitdir reference
        std::fs::write(tmp.path().join(".git"), "garbage content\n").unwrap();

        // Falls back to treating this dir as root
        let result = find_project_root(tmp.path());
        assert_eq!(result, Some(tmp.path().to_path_buf()));
    }

    #[test]
    fn find_root_no_git_returns_none() {
        let tmp = tempfile::tempdir().unwrap();
        let deep = tmp.path().join("a/b/c");
        std::fs::create_dir_all(&deep).unwrap();

        let result = find_project_root(&deep);
        assert_eq!(result, None);
    }

    #[test]
    fn find_root_from_worktree_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let main_repo = tmp.path().join("main");
        std::fs::create_dir_all(main_repo.join(".git/worktrees/wt")).unwrap();
        let wt = tmp.path().join("wt");
        std::fs::create_dir_all(wt.join("src/deep")).unwrap();
        std::fs::write(wt.join(".git"), "gitdir: ../main/.git/worktrees/wt\n").unwrap();

        // From deep inside the worktree, should still find main repo
        let result = find_project_root(&wt.join("src/deep"));
        assert_eq!(result, Some(main_repo));
    }

    // --- detect_remote_name tests ---

    #[test]
    fn detect_remote_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(
            git_dir.join("config"),
            "[remote \"origin\"]\n\turl = git@github.com:user/repo.git\n",
        )
        .unwrap();
        assert_eq!(detect_remote_name(&git_dir), "origin");
    }

    #[test]
    fn detect_remote_upstream() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(
            git_dir.join("config"),
            "[remote \"upstream\"]\n\turl = git@github.com:org/repo.git\n",
        )
        .unwrap();
        assert_eq!(detect_remote_name(&git_dir), "upstream");
    }

    #[test]
    fn detect_remote_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        // No config file → fallback
        assert_eq!(detect_remote_name(&git_dir), "origin");
    }

    // --- detect_default_branch tests ---

    #[test]
    fn detect_branch_main() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        std::fs::write(git_dir.join("refs/heads/main"), "abc123\n").unwrap();
        assert_eq!(detect_default_branch(&git_dir), "main");
    }

    #[test]
    fn detect_branch_master() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        std::fs::write(git_dir.join("refs/heads/master"), "abc123\n").unwrap();
        assert_eq!(detect_default_branch(&git_dir), "master");
    }

    #[test]
    fn detect_branch_develop() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        std::fs::write(git_dir.join("refs/heads/develop"), "abc123\n").unwrap();
        assert_eq!(detect_default_branch(&git_dir), "develop");
    }

    #[test]
    fn detect_branch_main_preferred_over_master() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        std::fs::write(git_dir.join("refs/heads/main"), "abc123\n").unwrap();
        std::fs::write(git_dir.join("refs/heads/master"), "def456\n").unwrap();
        assert_eq!(detect_default_branch(&git_dir), "main");
    }

    #[test]
    fn detect_branch_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        // No known branch names → fallback
        assert_eq!(detect_default_branch(&git_dir), "main");
    }

    #[test]
    fn detect_branch_packed_refs() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        // No loose refs, but packed-refs has master
        std::fs::write(
            git_dir.join("packed-refs"),
            "# pack-refs with: peeled fully-peeled sorted\nabc123 refs/heads/master\n",
        )
        .unwrap();
        assert_eq!(detect_default_branch(&git_dir), "master");
    }

    #[test]
    fn detect_branch_init_default_branch() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(
            git_dir.join("config"),
            "[init]\n\tdefaultBranch = develop\n",
        )
        .unwrap();
        assert_eq!(detect_default_branch(&git_dir), "develop");
    }

    #[test]
    fn detect_branch_init_overrides_refs() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        std::fs::write(git_dir.join("refs/heads/main"), "abc\n").unwrap();
        std::fs::write(git_dir.join("config"), "[init]\n\tdefaultBranch = trunk\n").unwrap();
        // init.defaultBranch takes priority over ref existence
        assert_eq!(detect_default_branch(&git_dir), "trunk");
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
        let ctx = test_ctx();
        assert!(ctx.is_protected_path("/workspace/file"));
        assert!(ctx.is_protected_path("/workspace/src/test.ts"));
        assert!(!ctx.is_protected_path("/workspace/.claude/worktrees/wt/file"));
        assert!(!ctx.is_protected_path("/tmp/file"));
        assert!(!ctx.is_protected_path(""));
    }

    #[test]
    fn path_protected_dotdot_absolute() {
        let ctx = test_ctx();
        // /workspace/.claude/worktrees/wt/../../file → /workspace/.claude/file → protected
        assert!(ctx.is_protected_path("/workspace/.claude/worktrees/wt/../../file"));
        // /workspace/.claude/worktrees/wt/./file → not protected (stays in worktree)
        assert!(!ctx.is_protected_path("/workspace/.claude/worktrees/wt/./file"));
    }

    #[test]
    fn path_protected_relative() {
        let ctx = test_ctx();
        // This test depends on CWD. If CWD is under /workspace/.claude/worktrees/,
        // a relative path like ../../ could escape to /workspace/.
        // We test with absolute paths containing .. since CWD varies.
        assert!(ctx.is_protected_path("/workspace/.claude/worktrees/wt/../../../CLAUDE.md"));
    }

    // --- resolve_path unit tests ---

    #[test]
    fn resolve_path_absolute() {
        let ctx = test_ctx();
        assert_eq!(
            ctx.resolve_path("/workspace/file"),
            Some(PathBuf::from("/workspace/file"))
        );
    }

    #[test]
    fn resolve_path_absolute_dotdot() {
        let ctx = test_ctx();
        assert_eq!(
            ctx.resolve_path("/workspace/.claude/worktrees/wt/../../file"),
            Some(PathBuf::from("/workspace/.claude/file"))
        );
    }

    #[test]
    fn resolve_path_relative_dot() {
        // "." resolves to the context's CWD
        let ctx = test_ctx();
        assert_eq!(ctx.resolve_path("."), Some(normalize_path(&ctx.cwd)));
    }

    #[test]
    fn resolve_path_relative_dotslash() {
        let ctx = test_ctx();
        assert_eq!(ctx.resolve_path("./"), Some(normalize_path(&ctx.cwd)));
    }

    #[test]
    fn resolve_path_relative_subdir() {
        let ctx = test_ctx();
        assert_eq!(
            ctx.resolve_path("subdir/file"),
            Some(normalize_path(&ctx.cwd.join("subdir/file")))
        );
    }

    #[test]
    fn resolve_path_empty() {
        let ctx = test_ctx();
        assert_eq!(ctx.resolve_path(""), None);
    }
}
