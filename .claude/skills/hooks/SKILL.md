# Hooks Skill — Guard Binary & Claude Code Hooks

## Overview

Claude Code supports **PreToolUse** and **PostToolUse** hooks that run before/after tool
invocations. Ganttlet uses a compiled Rust binary (`crates/guard/`) as the PreToolUse hook
to enforce project invariants (no direct edits to `/workspace/`, no push to main, etc.).

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
        "hooks": [{ "type": "command", "command": "test -x ./target/release/guard && ./target/release/guard edit || true" }]
      },
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "test -x ./target/release/guard && ./target/release/guard bash || true" }]
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

## How the Guard Binary Works

### Location and Build

- Source: `crates/guard/` (a Rust crate with `src/lib.rs` and `src/main.rs`)
- Build: `cargo build --release -p guard`
- Binary: `./target/release/guard`
- Auto-built by `docker-entrypoint.sh` on container start

### Subcommands

The binary takes one positional argument — the check mode:

- `guard edit` — runs `check_edit()` for Edit/Write tool invocations
- `guard bash` — runs `check_bash()` for Bash tool invocations
- Unknown mode — fail-open (no checks, exit 0)

### Execution Flow

1. Read all of stdin via `read_stdin()`
2. If stdin read fails with an infrastructure error (ENXIO, EAGAIN, ENOENT) — **fail-open** (exit 0)
3. If stdin read fails with another IO error — **fail-closed** (print block JSON)
4. Parse stdin as JSON — if malformed, **fail-closed** (print block JSON)
5. Dispatch to `check_edit()` or `check_bash()` based on the subcommand
6. If a check returns `Some(reason)` — print block JSON; otherwise print nothing

### Fail-Open vs Fail-Closed

- **Fail-open**: Infrastructure errors (stdin FD unavailable) and unknown modes. This
  prevents bricking Claude Code sessions when hooks run in unexpected contexts (subagents,
  background processes).
- **Fail-closed**: Malformed JSON input and non-infrastructure IO errors. These indicate
  a logic error that should be investigated.

### Check Registry

**`check_edit(input)`** — for Edit and Write tools:
1. **Protected files** — blocks edits to paths containing `package-lock.json`, `src/wasm/scheduler/`, or `.env` (uses substring matching — adding a new pattern like `.gitignore` would also block paths containing that substring, e.g. `.gitignore-backup`)
2. **Workspace isolation** — blocks edits to `/workspace/` that are not under `/workspace/.claude/worktrees/`

**`check_bash(input)`** — for the Bash tool:
1. **Push to main** — blocks `git push ... main`
2. **Checkout/switch** — blocks `git checkout`/`git switch` (allows `-- ` file separator and `worktree` commands)
3. **Destructive git commands** — blocks `git reset --hard`, `git clean -f`/`--force`, `git branch -D` (allows `git reset --soft`, `git clean -n`, `git branch -d`)
4. **Worktree removal** — blocks `git worktree remove` (allows `git worktree prune` — it only cleans stale references)
5. **File modification via bash** — blocks `sed -i`, `>` redirect, and `tee` targeting `/workspace/` directly (not worktrees)

## How to Add a New Check

### Step 1: Add the check function in `lib.rs`

Add a helper function or inline logic in `check_edit()` or `check_bash()`:

```rust
// In check_bash():
// Check N: Block dangerous-command
if cmd.contains("dangerous-command") {
    return Some("Reason this is blocked".to_string());
}
```

### Step 2: Add tests

Add test cases in the `#[cfg(test)] mod tests` block in `lib.rs`:

```rust
#[test]
fn bash_blocks_dangerous_command() {
    let v = json!({"tool_input": {"command": "dangerous-command --flag"}});
    assert!(check_bash(&v).is_some());
}

#[test]
fn bash_allows_safe_variant() {
    let v = json!({"tool_input": {"command": "safe-command --flag"}});
    assert!(check_bash(&v).is_none());
}
```

Always add both a positive test (blocked) and a negative test (allowed) to prevent
false positives.

### Step 3: Run tests

```bash
cd crates/guard && cargo test
```

### Step 4: Rebuild the binary

**Critical**: The guard binary in `target/release/guard` is what the hooks actually run.
After modifying `lib.rs`, you MUST rebuild or the hooks will use the old binary with
the old behavior. Your new check won't take effect until you rebuild.

```bash
cargo build --release -p guard
```

Verify your new check works end-to-end:
```bash
echo '{"tool_input":{"command":"dangerous-command --flag"}}' | ./target/release/guard bash
# Should output: {"decision":"block","reason":"..."}
```

## How to Add a New Hook Entry

To hook a new tool (e.g., a custom Read guard):

1. Add an entry in `.claude/settings.json`:

```json
{
  "matcher": "Read",
  "hooks": [{ "type": "command", "command": "./target/release/guard read" }]
}
```

2. Add a `"read"` arm in `main.rs`:

```rust
let result = match mode {
    "edit" => check_edit(&input),
    "bash" => check_bash(&input),
    "read" => check_read(&input),  // new
    _ => None,
};
```

3. Implement `check_read()` in `lib.rs` with tests.

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
  compiled guard binary

### The `is_infra_error()` Function

```rust
pub fn is_infra_error(e: &io::Error) -> bool {
    matches!(e.raw_os_error(), Some(6) | Some(11) | Some(2))
}
```

This checks raw OS error codes rather than `ErrorKind` because Rust maps ENXIO to
`ErrorKind::Other`, which is too broad to match on.

## Testing Hooks Locally

Test the guard binary directly by piping JSON to stdin:

```bash
# Should block (push to main):
echo '{"tool_input":{"command":"git push origin main"}}' | ./target/release/guard bash

# Should allow (push to feature branch):
echo '{"tool_input":{"command":"git push origin feature-branch"}}' | ./target/release/guard bash

# Should block (edit /workspace/ directly):
echo '{"tool_input":{"file_path":"/workspace/src/App.tsx"}}' | ./target/release/guard edit

# Should allow (edit in worktree):
echo '{"tool_input":{"file_path":"/workspace/.claude/worktrees/test/src/App.tsx"}}' | ./target/release/guard edit
```

Run the full test suite:

```bash
cd crates/guard && cargo test
```

## Lessons Learned

- Token-based matching (`has_token`) is essential to avoid false positives — e.g.,
  "worktrees" contains "tee" as a substring, which would trigger the `tee` redirect check
  without token-level matching.
- The `has_git_subcmd()` function only checks the FIRST `git` token in the command to avoid
  false positives from commit messages that mention git subcommands (e.g.,
  `git commit -m "block git push to main"`).
- Always check raw OS error codes for ENXIO detection — `ErrorKind::Other` is too broad.
