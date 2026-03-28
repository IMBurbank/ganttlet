# Hooks Skill — Fencepost & Claude Code Hooks

## Overview

Claude Code supports **PreToolUse** and **PostToolUse** hooks that run before/after tool
invocations. Fencepost (`crates/fencepost/`) is a project-agnostic PreToolUse hook
that enforces agent workflow invariants (no direct edits to the project root, no push to
the default branch, worktree isolation, etc.). Fencepost detects the project root from
`.git` at startup and parameterizes all checks — it works for any project, not just ganttlet.

## How Claude Code Hooks Work

### Hook Types

- **PreToolUse** — runs *before* the tool executes. Can **block** the tool by printing a
  JSON decision to stdout.
- **PostToolUse** — runs *after* the tool executes. Cannot block; used for linting,
  notifications, or post-edit verification.

### Registration: `settings.json` vs `settings.local.json`

Hooks live in two files under `.claude/`:

- **`settings.json`** (committed) — all hooks that every environment needs. Contains the guard
  binary (PreToolUse safety), verify.sh (PostToolUse tsc+vitest feedback), and bizday lint
  (PostToolUse date verification). These run in local dev, multi-agent phases, and CI workflows.
- **`settings.local.json`** (gitignored, per-developer) — personal overrides only (e.g.,
  extra permissions, plugin toggles). Create manually if needed.

Claude Code merges both files at runtime — local settings extend committed settings.

All hooks are declared in `.claude/settings.json` under the `"hooks"` key:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "fencepost edit || true" }]
      },
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "fencepost bash || true" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "./scripts/verify.sh" },
          { "type": "command", "command": "./crates/bizday/target/release/bizday lint --stdin 2>/dev/null || true" }
        ]
      }
    ]
  }
}
```

### Matcher Syntax

The `"matcher"` field is a **pipe-delimited list** of tool names. Claude Code matches the
current tool name against each segment:

- `"Bash"` — matches the Bash tool only
- `"Edit|Write"` — matches either Edit or Write tools
- `"Edit"` — matches Edit only

### Stdin JSON Schema (PreToolUse Events)

Claude Code pipes a JSON object to the hook's stdin. The shape depends on the tool:

**Edit tool:**
```json
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/workspace/.claude/worktrees/issue-42/src/App.tsx",
    "old_string": "...",
    "new_string": "..."
  }
}
```

**Write tool:**
```json
{
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/workspace/.claude/worktrees/issue-42/src/App.tsx",
    "content": "..."
  }
}
```

**Bash tool:**
```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "git push origin feature-branch"
  }
}
```

### Decision Format (stdout)

To **block** a tool invocation, print a JSON object to stdout:

```json
{"decision": "block", "reason": "Cannot push directly to main. Use a feature branch and PR."}
```

To **allow**, print nothing (empty stdout) or exit cleanly. The exit code is always 0 —
Claude Code interprets a block decision from the JSON output, not the exit code.

## How Fencepost Works

### Installation

Install fencepost to PATH (one-time):

```bash
cargo install --path crates/fencepost  # from source (dev)
# or: cargo install fencepost          # from crates.io (future)
```

Docker environments: `docker-entrypoint.sh` auto-installs on container start.

The hook commands use bare `fencepost edit` / `fencepost bash` — no paths.

### Source

- Source: `crates/fencepost/` (Rust crate with `src/lib.rs`, `src/main.rs`, `src/rules/`)

### Subcommands

The binary takes one positional argument — the check mode:

- `fencepost edit` — runs `check_edit()` for Edit/Write tool invocations
- `fencepost bash` — runs `check_bash()` for Bash tool invocations
- Unknown mode — fail-open (no checks, exit 0)

### Execution Flow

1. Detect project root via `ProjectContext::detect()` — walks up from CWD to find `.git`
2. If no `.git` found — **fail-open** (exit 0, can't determine what to protect)
3. Read all of stdin via `read_stdin()`
4. If stdin read fails with an infrastructure error (ENXIO, EAGAIN, ENOENT) — **fail-open** (exit 0)
5. If stdin read fails with another IO error — **fail-closed** (print block JSON)
6. Parse stdin as JSON — if malformed, **fail-closed** (print block JSON)
7. Dispatch to `check_edit(&ctx, &input)` or `check_bash(&ctx, &input)` based on the subcommand
8. If a check returns `Some(reason)` — print block JSON; otherwise print nothing

### ProjectContext (Runtime Detection)

All checks receive a `ProjectContext` that replaces hardcoded paths:

```rust
pub struct ProjectContext {
    pub root: PathBuf,          // detected from nearest .git ancestor
    pub worktrees_dir: PathBuf, // {root}/.claude/worktrees
    pub cwd: PathBuf,           // captured at startup
    pub default_branch: String, // "main" (configurable)
    pub remote_name: String,    // "origin" (configurable)
    pub protected_file_patterns: Vec<ProtectedPattern>,
}
```

- **Project root**: detected by walking up from CWD to find `.git`. Handles both regular
  repos (`.git/` directory) and git worktrees (`.git` file with `gitdir:` reference).
- **CWD**: captured once at startup, threaded through all checks. No check reads the
  process CWD at check time — this makes fencepost deterministic and testable.
- **Protected paths**: any path under `root/` but NOT under `worktrees_dir/` is protected.
- **Multi-repo**: nested `.git` roots are handled correctly — the nearest `.git` wins.
- **Monorepo**: all packages share a single root and the same protection rules.

### Fail-Open vs Fail-Closed

- **Fail-open**: Infrastructure errors (stdin FD unavailable) and unknown modes. This
  prevents bricking Claude Code sessions when hooks run in unexpected contexts (subagents,
  background processes).
- **Fail-closed**: Malformed JSON input and non-infrastructure IO errors. These indicate
  a logic error that should be investigated.

### Check Registry — Complete Decision Table

All paths below (e.g., "project root", "worktrees dir") are relative to the detected
`ProjectContext`. When this doc shows `/workspace/`, read it as "the project root" —
fencepost dynamically detects the actual root from `.git`.

**`check_edit(ctx, input)`** — for Edit and Write tools:
1. **Protected files** — blocks edits to `.env`, `.env.*`, `package-lock.json`, `src/wasm/scheduler/` (pattern-based, configurable via `protected_file_patterns`)
2. **Workspace isolation** — blocks edits to project root paths that resolve (after `../` normalization) to outside the worktrees directory
3. **CWD enforcement** — blocks editing worktree files when CWD is the project root (agent should enter the worktree first)

**`check_bash(ctx, input)`** — for the Bash tool. Uses a POSIX-aligned tokenizer that distinguishes `Token::Word` (quoted/escaped text) from `Token::Operator` (unquoted shell operators). All path checks normalize `../` and resolve relative paths against the captured CWD.

#### Hard block — no override

| Check | Trigger |
|---|---|
| Push to default branch | `git push <remote> <branch>`, `HEAD:<branch>`, `feature:<branch>`, `HEAD:refs/heads/<branch>` (default: main/origin) |
| Reset --hard (no remote ref) | `git reset --hard` without `<remote>/` ref prefix (default: origin/) |
| Worktree remove own CWD | `git worktree remove <path-matching-CWD>` |
| rm worktree root | `rm` with `-r`, `-R`, `--recursive`, `-f`, or `--force` on `{worktrees_dir}/<name>` |
| File writes (sed/tee) | `sed -i`, `tee` targeting protected paths (under project root, outside worktrees) |
| All write redirects | `>` `>>` `>|` `>&` `<>` `&>` `&>>` targeting protected paths |
| Interpreter writes | `python -c`, `node -e`, `perl -e`, `ruby -e` with project root path AND write/exec indicator |

#### CWD-dependent — blocked at project root, allowed in worktrees

| Check | Trigger | Why allowed in worktrees |
|---|---|---|
| Checkout/switch | `git checkout main`, `git switch feature` | Agent's own workspace |
| Reset --hard with remote ref | `git reset --hard origin/main` | Squash-merge cleanup step |
| Clean -f | `git clean -fd`, `--force` | Clean build artifacts |
| Branch -D | `git branch -D feature` | Squash-merge cleanup (where -d fails) |

#### Acknowledged — blocked until agent confirms with `I_CREATED_THIS=1` prefix

| Check | Without prefix | With `I_CREATED_THIS=1` |
|---|---|---|
| Worktree remove agent path (`{worktrees_dir}/*`) | BLOCK — STOP warning with 3 ownership criteria | ALLOW |

The 3 criteria the agent must verify before acknowledging:
1. They created the worktree (this session or a previous one)
2. Its PR is merged OR it was a test/scratch worktree
3. They have verified no other agent is using it

#### Always allow

| Scenario | Why |
|---|---|
| Input redirects (`<`, `<&`) | Read-only |
| Escaped/quoted redirects (`\>`, `">"`, `'>'`) | Literal text, not operators |
| Redirects to worktree paths or non-workspace paths | Not protected |
| `git clean -n`, `git branch -d`, `git branch -f` | Safe operations |
| `git push origin feature-branch` | Feature branches are the workflow |
| `git worktree add`, `prune`, `list` | Standard worktree lifecycle |
| `git worktree remove /tmp/*` | Not an agent workspace |
| Interpreter reads (`print`, `readFileSync`, `os.listdir`) | No write indicator in code |

#### Open gaps (static analysis limits — all fail-open)

| Gap | Why |
|---|---|
| Variable indirection (`> $VAR`) | Can't resolve variables |
| `sudo -u` flag values | Can't enumerate flag semantics |
| Symlinks | Can't resolve without filesystem access on non-existent paths |

## How to Add a New Check

Every check is a struct implementing `BashRule` or `EditRule`. The trait enforces that
each rule has a name, description, and a check method that receives `ContextualSegment`
(not raw `Segment`). This makes the right thing the default path.

### Step 1: Create a rule struct in `lib.rs`

```rust
/// Blocks dangerous-cmd on protected paths.
pub struct DangerousCommandRule;

impl BashRule for DangerousCommandRule {
    fn name(&self) -> &'static str { "dangerous-command" }
    fn description(&self) -> &'static str {
        "Blocks dangerous-cmd on protected paths. Use a worktree."
    }

    fn check_segment(
        &self,
        ctx: &ProjectContext,
        seg: &ContextualSegment,
    ) -> Option<Violation> {
        if seg.effective_command().map(|(_, c)| c) == Some("dangerous-cmd")
            && seg.has_protected_path()
        {
            Some(Violation::new(
                self.name(),
                Severity::Block,
                "dangerous-cmd targeting protected path",
                "this would modify files under the project root",
                format!("Run from a worktree: git worktree add {}/<name> -b <branch>",
                    ctx.worktrees_dir().display()),
            ))
        } else {
            None
        }
    }
}
```

**Key API points:**
- `seg.is_git("subcmd")` — check if the segment is a git subcommand
- `seg.has_arg("--flag")` — exact argument match (scoped to args after command)
- `seg.has_short_flag('f')` — short flag check
- `seg.has_arg_starting_with("prefix")` — argument prefix match (scoped)
- `seg.has_protected_path()` — any token resolves to a protected path
- `seg.targets_worktree_root()` — any token is a worktree root directory
- `seg.tokens()` — escape hatch for raw token access (positional extraction)
- `ctx.is_project_root_cwd()` — CWD is at the project root
- `ctx.is_worktree_cwd()` — CWD is inside the worktrees directory

**Do NOT use** `Segment::has_token_containing_raw()` or `has_token_starting_with_raw()` —
these scan all tokens including command names and can cause false positives. Use the
scoped methods on `ContextualSegment` instead.

### Step 2: Register the rule

Add it to `BASH_RULES` (or `EDIT_RULES` for edit checks):

```rust
pub static BASH_RULES: &[&(dyn BashRule + Sync)] = &[
    // ... existing rules ...
    &DangerousCommandRule,
];
```

### Step 3: Add tests

Test the rule both directly (via `check_segment`) and end-to-end (via `check_bash`):

```rust
#[test]
fn rule_dangerous_command_blocks() {
    let ctx = test_ctx();
    let segs = parse_segments("dangerous-cmd /workspace/file");
    let seg = ctx.bind(&segs[0]);
    let v = DangerousCommandRule.check_segment(&ctx, &seg);
    assert!(v.is_some());
    assert_eq!(v.unwrap().rule, "dangerous-command");
}

#[test]
fn bash_blocks_dangerous_command() {
    let v = json!({"tool_input": {"command": "dangerous-cmd /workspace/file"}});
    assert!(check_bash(&test_ctx(), &v).is_some());
}
```

For CWD-dependent checks, test both paths deterministically:

```rust
#[test]
fn rule_blocks_at_root_allows_in_worktree() {
    let v = json!({"tool_input": {"command": "git clean -fd"}});
    assert!(check_bash(&test_ctx_at_root(), &v).is_some());
    assert!(check_bash(&test_ctx_in_worktree(), &v).is_none());
}
```

Always add both a positive test (blocked) and a negative test (allowed).

### Step 3: Run tests

```bash
cd crates/fencepost
cargo test
```

### Step 4: Reinstall the binary

**Critical**: The hooks run the fencepost binary on PATH. After modifying
source, you MUST reinstall or the hooks will use the old binary.

```bash
cargo install --path crates/fencepost
```

Verify your new check works end-to-end:
```bash
echo '{"tool_input":{"command":"dangerous-command --flag"}}' | fencepost bash
# Should output: {"decision":"block","reason":"..."}
```

## How to Add a New Hook Entry

To hook a new tool (e.g., a custom Read guard):

1. Add an entry in `.claude/settings.json`:

```json
{
  "matcher": "Read",
  "hooks": [{ "type": "command", "command": "./target/release/fencepost read" }]
}
```

2. Add a `CheckRequest::Read` variant to `protocol/mod.rs` and handle it in `run_hook()`.

3. Add parsing for the new mode in `protocol/claude.rs` (and any other adapters).

4. Implement `check_read()` in `check.rs` with tests.

## ENXIO/Stdin Pitfalls

### The Problem

Claude Code hooks receive input via stdin, but in certain contexts (subagent spawning,
background processes, missing file descriptors), the stdin FD may not be available. On
Linux this manifests as:

- **ENXIO** (errno 6) — "No such device or address" when opening `/dev/stdin`
- **EAGAIN** (errno 11) — non-blocking read on unavailable FD
- **ENOENT** (errno 2) — `/dev/stdin` symlink target missing

### Why Fail-Open

If the hook fails-closed on these errors, the entire Claude Code session becomes unusable —
every tool invocation gets blocked. This is worse than the risk of a single unchecked
operation, so infrastructure errors fail-open.

### History

- **PR #53** (commit `8c49507`) — initial discovery: node-based hooks crashed on ENXIO in
  subagent contexts, blocking all tool use
- **PR #55** (commit `805d4a8`) — ENXIO-safe hooks + migration from node scripts to the
  compiled fencepost binary

### The `is_infra_error()` Function

```rust
pub fn is_infra_error(e: &io::Error) -> bool {
    matches!(e.raw_os_error(), Some(6) | Some(11) | Some(2))
}
```

This checks raw OS error codes rather than `ErrorKind` because Rust maps ENXIO to
`ErrorKind::Other`, which is too broad to match on.

## Testing Hooks Locally

Test fencepost directly by piping JSON to stdin:

```bash
# Should block (push to main):
echo '{"tool_input":{"command":"git push origin main"}}' | fencepost bash

# Should allow (push to feature branch):
echo '{"tool_input":{"command":"git push origin feature-branch"}}' | fencepost bash

# Should block (edit /workspace/ directly):
echo '{"tool_input":{"file_path":"/workspace/src/App.tsx"}}' | fencepost edit

# Should allow (edit in worktree):
echo '{"tool_input":{"file_path":"/workspace/.claude/worktrees/test/src/App.tsx"}}' | fencepost edit
```

Run the full test suite:

```bash
cd crates/fencepost
cargo test
```

## Architecture

Fencepost uses a 5-layer pipeline:

1. **Detection** — `ProjectContext::detect()` walks up from CWD to find `.git`, captures
   the project root, worktrees dir, and CWD. Handles git worktrees (`.git` file with
   `gitdir:` reference). Fields are `pub(crate)` with read-only accessors.
2. **Tokenizer** — single-pass POSIX-aligned state machine producing `Token::Word` and
   `Token::Operator`. Redirect operators recognized at lex time. Quoted/escaped characters
   always produce `Word`, never `Operator`. Zero project coupling — pure syntax parsing.
3. **Segments** — split on control operators (`&&`, `||`, `|`, `;`, `&`, `\n`). Redirect
   operators stay inside their segment. `Segment` is purely structural — methods:
   `effective_command`, `git_subcmd`, `is_git`, `has_arg`, `has_short_flag`. Raw methods
   `has_token_containing_raw` / `has_token_starting_with_raw` exist but are marked as
   escape hatches with warnings.
4. **Context binding** — `ctx.bind(&seg)` produces a `ContextualSegment` that combines
   structural queries (from Segment) with policy-aware queries (`has_protected_path`,
   `targets_worktree_root`, `has_arg_starting_with`). This is the type that rules work
   with. Raw token access requires explicit `seg.tokens()`.
5. **Rules** — each check is a named struct implementing `BashRule` or `EditRule`. The
   trait requires `name()`, `description()`, and a check method that receives
   `ContextualSegment`. Rules return `Violation::new(rule, severity, attempted, explanation, suggestion)`.
   `check_bash` and `check_edit` iterate the rule registries (`BASH_RULES`, `EDIT_RULES`).

**10 bash rules:** PushToDefaultBranch, CheckoutSwitch, ResetHard, CleanForce,
BranchForceDelete, WorktreeRemove, RmWorktreeRoot, SedTeeProtectedPath,
InterpreterWrite, RedirectToProtectedPath.

**3 edit rules:** ProtectedFilePattern, WorkspaceIsolation, CwdEnforcement.

Recursive parsing: `bash -c`, `eval`, `$()`, and backtick arguments are parsed at depth
up to 3. Non-shell interpreters (`python -c`, `node -e`, etc.) are scanned for write
indicators.

## Lessons Learned

- Redirect operators MUST be recognized at lex time (like bash, dash, zsh, conch-parser, ShellCheck). Treating `>` as a word character and string-matching later is unsound — `\>` and `>` become indistinguishable.
- Token type (`Word` vs `Operator`) must be carried through the entire pipeline to `Segment`. Flattening to `Vec<String>` loses the distinction.
- CWD-dependent checks must be tested from BOTH contexts using injected CWD (e.g., `test_ctx_at_root()` and `test_ctx_in_worktree()`). Never use `std::env::current_dir()` in test assertions — it makes tests environment-dependent.
- Inject CWD at construction time, not at check time. `ProjectContext` captures CWD once in `detect()`, then all checks use `ctx.cwd`. This eliminates process-global dependencies and makes tests fully deterministic.
- The `Segment` struct must be purely structural (tokens + query methods). Policy-aware methods like `has_protected_path()` belong on `ProjectContext`, not on `Segment` — they need project root context to decide what's protected.
- The `I_CREATED_THIS=1` acknowledgment pattern works within existing shell semantics — it's a variable assignment that the tokenizer parses and `effective_command` skips.
- Interpreter code scanning needs write indicators to avoid false positives on read-only operations. A bare path substring check blocks `print('/workspace/...')`.
- Always check raw OS error codes for ENXIO detection — `ErrorKind::Other` is too broad.
- For multi-repo support, `find_project_root()` must stop at the nearest `.git` — never walk past a child repo's `.git` to find a parent repo.
- Test contexts should default to worktree CWD (matching production behavior). Root CWD can cause false positives when relative paths in command arguments (e.g., sed's `s/x/y/`) resolve under the project root.
