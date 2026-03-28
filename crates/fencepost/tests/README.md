# Tests

## Test organization

| File | Type | What it tests |
|------|------|--------------|
| `binary.rs` | E2E | Spawns the fencepost binary, pipes stdin, asserts stdout/stderr |
| `cli.rs` | Integration + Meta | Config loading, doctor, rule/message/protocol quality enforcement |
| `cross_root.rs` | Integration | Guard works with non-default project root, branch, remote |
| `integration.rs` | Integration | Multi-repo, worktree detection, monorepo (uses tempfile) |

## Unit tests

Unit tests live in each source file as `#[cfg(test)] mod tests` — collocated with the code they test. See `src/rules/*.rs` for examples.

## Meta-tests (tests/cli.rs)

These tests enforce quality standards for the entire project:

- **meta_all_bash_rules_produce_three_part_messages** — every rule's block message has attempted/explanation/suggestion
- **meta_every_registered_rule_is_exercised** — fails if a rule has no triggering test input
- **meta_confirm_tokens_follow_convention** — confirm tokens must be descriptive (`I_*=1`, ≥15 chars)
- **meta_all_protocols_pass_smoke_test** — every adapter parses its sample inputs correctly
- **meta_default_protocol_is_claude** — FROZEN: changing breaks all projects
- **config_v1_frozen_contract** — FROZEN: changing the config schema requires a version migration

When these fail, the error message tells you exactly what to fix and where.
