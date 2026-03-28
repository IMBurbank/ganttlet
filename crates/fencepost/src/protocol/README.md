# Protocol Adapters

Each file in this directory implements a `ProtocolAdapter` for a specific agent framework's hook protocol.

## Supported protocols

| File | Protocol | Agent framework |
|------|----------|----------------|
| `claude.rs` | `claude` | [Claude Code](https://claude.ai/code) PreToolUse hooks |

## How it works

The fencepost library (`check_bash`, `check_edit`) is framework-agnostic — it takes plain strings. Protocol adapters translate between the agent framework's hook format and these plain strings:

```
Agent stdin JSON → adapter.parse_request() → CheckRequest → check_bash/check_edit → adapter.format_block() → Agent stdout
```

## Adding a protocol

1. Create `<name>.rs` implementing `ProtocolAdapter` (all 6 methods required)
2. Add to `get_adapter()` and `supported_protocols()` in `mod.rs`
3. The smoke tests in `tests/cli.rs` automatically verify your adapter
4. Submit a PR — all adapters ship in the single fencepost binary

The `ProtocolAdapter` trait requires `sample_edit_input()` and `sample_bash_input()` methods that provide test data. The meta-tests use these to verify parsing, formatting, and fail-open behavior without any manual test setup.

## Selecting a protocol

Users set `FENCEPOST_PROTOCOL=<name>` (default: `claude`). Projects can declare their primary protocol in `.claude/fencepost.json`:

```json
{"protocol": "claude"}
```

Contributors using a different agent override with the env var.
