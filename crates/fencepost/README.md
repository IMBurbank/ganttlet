# Fencepost

An agent workflow guard that protects AI agents from themselves — and each other.

Fencepost is not a permission system. The major code assistants already ship with robust human-in-the-loop approval flows, and those get better with every release ([Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode) is a recent example). We leave that layer of protection in the model companies' hands.

If model companies' permission systems are the pen — letting users decide how agents can come and go — fencepost is the fence post, ensuring the edges of the boundary stay firm.

Fencepost solves a different problem: **agent footguns**. When multiple agents share a codebase, they can switch each other's branches mid-work, delete the directory they're standing in, force-push to main, or silently overwrite lock files. These aren't permission issues — they're workflow hazards that no amount of human approval prevents, because the agent doesn't know it's about to break things.

Fencepost leans into the Rust model: don't just stop agents from doing the wrong thing — **make it trivially easy to get back on the golden path**. Every block message tells the agent exactly what it tried, why it's blocked, and the corrected command to run instead.

## Quick Start

```bash
cargo install fencepost
cd your-project
fencepost init
fencepost doctor
```

`init` detects your project stack (Node, Rust, Python, Go, Ruby), registers hooks, and generates config with sensible defaults. `doctor` verifies everything is working.

## What It Protects Against

| Category | Examples | What the agent sees |
|----------|---------|-------------------|
| **Branch safety** | `git push origin main`, `git checkout main` at root | "Use a feature branch" / "Use a worktree" |
| **Shared state** | `git reset --hard`, `git clean -f`, `git branch -D` at project root | "Run from your worktree instead" |
| **File protection** | Editing `.env`, lock files, build output | Why it's protected + how to regenerate |
| **Worktree isolation** | `rm -rf` on worktree roots, removing another agent's worktree | "Use ExitWorktree" / ownership checklist |
| **Write operations** | `sed -i`, `tee`, `>` redirects to protected paths | "Run from a worktree" with the exact command |
| **Interpreter writes** | `python -c "os.remove(...)"` targeting project root | "Use a worktree or write a script file" |

All blocks are **fail-open** — if fencepost can't determine what to protect (no `.git`, stdin unavailable), it allows the operation rather than bricking the session.

## CLI

```bash
fencepost init        # Set up hooks and config for this project
fencepost doctor      # Verify installation, show config provenance
fencepost list-rules  # Show all 13 rules with descriptions
fencepost --version   # Print version
fencepost --help      # Full usage
```

Debug any check with `FENCEPOST_LOG=debug`:

```bash
FENCEPOST_LOG=debug echo '{"tool_input":{"command":"git push origin main"}}' | fencepost bash
```

## Configuration

Create `.claude/fencepost.json` in your project root. All fields are optional — omitted fields use auto-detection.

```json
{
  "version": 1,
  "protocol": "claude",
  "default_branch": "develop",
  "remote": "upstream",
  "protected_files": [
    { "path_contains": "dist/", "reason": "Build output. Run npm run build." },
    { "glob": "*.pyc", "reason": "Python bytecode. Auto-generated." }
  ],
  "rules": {
    "checkout-switch": "off",
    "clean-force": "warn"
  }
}
```

**Config precedence:** environment variable > config file > git detection > built-in fallback.

<details>
<summary>Full configuration reference</summary>

### Protected file patterns

Config patterns **extend** built-in defaults (`.env*`, `*.lock`, common lock files). Set `"protected_files_override": true` to replace defaults entirely.

| Type | Example | Matches |
|------|---------|---------|
| `basename` | `"yarn.lock"` | Exact filename |
| `basename_prefix` | `".env"` | `.env`, `.env.local`, `.env.production` |
| `path_contains` | `"dist/"` | Any path containing `dist/` |
| `glob` | `"*.pyc"` | Suffix/prefix/contains glob |

### Rule severity

| Level | Behavior | Agent sees message? |
|-------|----------|-------------------|
| `"block"` | Hard stop | Yes — with corrected command |
| `"warn"` | Stderr message | No (proceeds, user sees stderr) |
| `"off"` | Rule skipped | No |

Some rules support **confirm** behavior — the first attempt blocks with a checklist, and the agent re-runs with an acknowledgment prefix (e.g., `I_CREATED_THIS=1`) after verifying conditions.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `FENCEPOST_CONFIG` | Config file path override |
| `FENCEPOST_DEFAULT_BRANCH` | Override default branch |
| `FENCEPOST_REMOTE` | Override remote name |
| `FENCEPOST_RULES_OFF` | Comma-separated rules to disable |
| `FENCEPOST_PROTOCOL` | Protocol adapter (default: `claude`) |
| `FENCEPOST_LOG` | Set to `debug` for full decision trace |

</details>

## Architecture

```
Agent hook → Protocol adapter → POSIX tokenizer → Segments → Rules → Allow/Block
```

The library API (`check_bash`, `check_edit`) is **framework-agnostic** — it takes plain strings, not protocol-specific JSON. Protocol adapters (currently Claude Code, extensible to Gemini/Copilot/etc.) handle translation. All adapters ship in one binary; set `FENCEPOST_PROTOCOL=<name>` to switch.

13 named rules (10 bash, 3 edit) implement the `BashRule` or `EditRule` trait. Each is a separate file with collocated tests. The type system enforces that every block message includes what was attempted, why it's blocked, and what to do instead.

## Contributing

See [src/rules/README.md](src/rules/README.md) for adding rules and [src/protocol/README.md](src/protocol/README.md) for adding protocol adapters. Both have meta-tests that automatically verify new contributions — follow the compiler and test errors.

```bash
cargo test -p fencepost              # Unit + integration tests
cargo test -p fencepost --test binary  # E2E binary tests
```

After changing source: `cargo install --path crates/fencepost` to update the active binary on PATH.

## Known Limitations

Static analysis of shell commands — no runtime execution:

- **Variable indirection** — `DIR=/workspace; rm $DIR` not caught
- **Alias expansion** — `alias yolo='git push origin main'; yolo` not caught
- **`sudo -u` flags** — sudo flag parsing is best-effort
- **Symlinks** — paths resolved logically, not via filesystem
- **Nested CWD** — `bash -c "cd /root && git reset --hard"` checks outer CWD

All gaps fail-open. False negatives are preferable to bricking sessions.

## License

Apache License 2.0 — see [LICENSE](LICENSE)
