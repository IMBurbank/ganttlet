---
phase: 17
group: B
stage: 1
agent_count: 1
scope:
  modify:
    - crates/bizday/Cargo.toml
    - crates/bizday/src/main.rs
    - crates/bizday/src/compute.rs
    - crates/bizday/src/verify.rs
    - crates/bizday/src/log.rs
    - crates/bizday/src/report.rs
    - crates/bizday/tests/compute.rs
    - crates/bizday/tests/proptest.rs
    - crates/bizday/tests/verify.rs
    - crates/bizday/tests/log.rs
    - crates/bizday/tests/report.rs
    - package.json
  read_only:
    - docs/plans/datecalc-tool.md
    - crates/scheduler/src/date_utils.rs
    - crates/scheduler/Cargo.toml
depends_on: []
tasks:
  - id: B1
    summary: "Crate setup + compute module"
  - id: B2
    summary: "Compute + proptest tests"
  - id: B3
    summary: "Verify + lint module"
  - id: B4
    summary: "Log + report modules"
  - id: B5
    summary: "Add build:bizday to package.json"
---

# Phase 17 Group B — Rust `bizday` Binary

You are implementing Phase 17 Group B for the Ganttlet project.
Read `CLAUDE.md` for full project context.
Read `docs/plans/datecalc-tool.md` for the detailed design specification.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Worktree Rules (Non-Negotiable)

You are working in a **git worktree** — NOT in `/workspace`.
All file paths below are **relative to your worktree root** (your CWD).
**NEVER** modify, read from, or `cd` into `/workspace` — that is `main` and must not be touched.
All git operations (commit, push) happen in this worktree directory.

## Context

You are building the `bizday` binary — a native Rust CLI for date math that uses
the scheduler's own `date_utils` functions. It has three core operations:

1. `bizday <date> N` = `task_end_date(start, N)` — end date for N-day task (inclusive)
2. `bizday <date> <date>` = `task_duration(start, end)` — inclusive duration between dates
3. `bizday <date>` = weekend check + info

Plus subcommands: `verify`, `lint`, `false-match`, `report`, `help`.

**Critical design constraint**: `bizday <date> N` uses INCLUSIVE duration, not offset.
`bizday 2026-03-11 10` must return `2026-03-24` (= `task_end_date("2026-03-11", 10)`),
NOT `2026-03-25` (which would be `shift_date("2026-03-11", 10)`).

The scheduler crate is `ganttlet-scheduler`. Import as `use ganttlet_scheduler::date_utils::*;`.
There is no workspace Cargo.toml — `bizday` is a standalone crate with a path dependency.

## Your files (ONLY modify these):

**Create (paths relative to worktree root — entire new crate):**
- `crates/bizday/Cargo.toml`
- `crates/bizday/src/main.rs`
- `crates/bizday/src/compute.rs`
- `crates/bizday/src/verify.rs`
- `crates/bizday/src/log.rs`
- `crates/bizday/src/report.rs`
- `crates/bizday/tests/compute.rs`
- `crates/bizday/tests/proptest.rs`
- `crates/bizday/tests/verify.rs`
- `crates/bizday/tests/log.rs`
- `crates/bizday/tests/report.rs`
- `package.json` (add one script)

**Read-only:**
- `docs/plans/datecalc-tool.md` — full specification
- `crates/scheduler/src/date_utils.rs` — the functions you'll call
- `crates/scheduler/Cargo.toml` — package name is `ganttlet-scheduler`

## Tasks — execute in order:

### B1: Crate setup + compute module

Read `crates/scheduler/src/date_utils.rs` to understand the available functions.

Create `crates/bizday/Cargo.toml`:
```toml
[package]
name = "bizday"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "bizday"
path = "src/main.rs"

[dependencies]
ganttlet-scheduler = { path = "../scheduler" }
serde_json = "1"

[dev-dependencies]
proptest = "1"
tempfile = "3"
```

Create `src/compute.rs` — thin wrappers around `ganttlet_scheduler::date_utils`:
- `end_date(start: &str, duration: i32) -> String` — calls `task_end_date`
- `duration(start: &str, end: &str) -> i32` — calls `task_duration`
- `info(date: &str) -> String` — calls `is_weekend_date`, `day_of_week`, `ensure_business_day`

Create `src/main.rs` — CLI dispatch:
- Parse args positionally
- `bizday <date> <integer>` → `compute::end_date`
- `bizday <date> <date>` → `compute::duration` (also show calendar days)
- `bizday <date>` → `compute::info`
- `bizday verify <date> <integer> <expected>` → compare and exit 0/1
- `bizday lint <file>` → `verify::lint_file`
- `bizday false-match <file>:<line>` → `log::record_false_match`
- `bizday report [flags]` → `report::run`
- `bizday help` → usage text

Output format: line 1 = machine-readable answer, line 2+ = `#` comments.

Verify:
```bash
cargo build -p bizday
./target/debug/bizday 2026-03-11 10  # must output 2026-03-24
./target/debug/bizday 2026-03-11 2026-03-24  # must output 10
./target/debug/bizday 2026-03-07  # must say Saturday + next biz day
```

Commit: `"feat: bizday crate — compute module + CLI dispatch"`

### B2: Compute + proptest tests

Create `tests/compute.rs` — hand-written integration tests:
- `bizday 2026-03-11 10` → `2026-03-24`
- `bizday 2026-03-02 5` → `2026-03-06`
- `bizday 2026-03-02 1` → `2026-03-02` (same-day task)
- `bizday 2026-03-06 3` → `2026-03-10` (Friday + 3 = Tuesday, crossing weekend)
- `bizday 2026-03-11 2026-03-24` → `10`
- `bizday 2026-03-02 2026-03-02` → `1`
- `bizday 2026-03-07` → contains "Saturday" and "2026-03-09"
- `bizday verify 2026-03-11 10 2026-03-24` → exit 0
- `bizday verify 2026-03-11 10 2026-03-25` → exit 1

IMPORTANT: Verify ALL expected values with `node -e` BEFORE writing assertions.
NEVER compute dates mentally.

Create `tests/proptest.rs` — 6 properties using `PROPTEST_CASES` env var:
```rust
fn config() -> ProptestConfig {
    let cases = std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(256);
    ProptestConfig::with_cases(cases)
}
```

Properties (all use `ganttlet_scheduler::date_utils` public API only):
1. `task_duration(start, task_end_date(start, dur)) == dur`
2. `task_end_date(start, task_duration(start, end)) == end`
3. `task_start_date(task_end_date(start, dur), dur) == start`
4. `!is_weekend_date(&task_end_date(start, dur))`
5. `task_duration(start, end) >= 1` for ordered weekday pairs
6. `business_day_delta(start, end) + 1 == task_duration(start, end)`

Generators:
- `weekday_date()` — random weekday in 2020-2030
- `ordered_weekday_pair()` — two weekdays where start ≤ end

See `docs/plans/datecalc-tool.md` Property-Based Testing section for full code.

Verify:
```bash
cargo test -p bizday
PROPTEST_CASES=1000 cargo test -p bizday proptest
```

Commit: `"test: bizday compute + proptest (6 properties)"`

### B3: Verify + lint module

Create `src/verify.rs`:
- `lint_stdin()` — reads PostToolUse JSON from stdin, extracts date literals,
  verifies `taskEndDate`/`task_end_date` and `taskDuration`/`task_duration`
  calls with literal arguments. Detects weekend dates in scheduling contexts.
- `lint_file(path: &str)` — reads a file and runs the same checks.
- Returns JSON warnings with suggested shell function commands.

Pattern matching (regex-based):
- `task_end_date\("(\d{4}-\d{2}-\d{2})",\s*(\d+)\)` near `"(\d{4}-\d{2}-\d{2})"`
- `taskEndDate\("(\d{4}-\d{2}-\d{2})",\s*(\d+)\)` near `"(\d{4}-\d{2}-\d{2})"`
- Same for `task_duration` / `taskDuration` with two date args near an integer
- Weekend: `\d{4}-\d{2}-\d{2}` near `start_date` / `end_date` keywords
- Skip lines starting with `//`, `#`, `*`, `<!--`

Create `tests/verify.rs`:
- Mismatch detection: `task_end_date("2026-03-11", 10)` near `"2026-03-25"` → warns
- Correct value: `task_end_date("2026-03-11", 10)` near `"2026-03-24"` → no warn
- Weekend detection: `start_date: "2026-03-07"` → warns
- Comment exclusion: `// task_end_date("2026-03-11", 10)` → no warn
- Non-scheduling context: plain date in non-scheduling code → no warn

Commit: `"feat: bizday verify + lint — regex pattern matching for date verification"`

### B4: Log + report modules

Create `src/log.rs`:
- `init_session()` — write SESSION marker on first call (track via static/env)
- `log_compute(cmd: &str, args: &str, result: &str)` — COMPUTE event
- `log_verified(details: &str, elapsed_ms: u64)` — VERIFIED event
- `log_mismatch(details: &str, elapsed_ms: u64)` — MISMATCH event
- `log_weekend(date: &str, context: &str, elapsed_ms: u64)` — WEEKEND event
- `log_unverifiable(date: &str, context: &str, elapsed_ms: u64)` — UNVERIFIABLE event
- `log_suppressed(date: &str, context: &str, elapsed_ms: u64)` — SUPPRESSED event
- `log_false_match(file_line: &str)` — FALSE_MATCH event
- Respects `BIZDAY_LOG_DIR` env var, defaults to `.claude/logs/`
- Auto-creates directory if missing
- Appends, never overwrites

Create `src/report.rs`:
- Parse `.claude/logs/bizday.log` (or `$BIZDAY_LOG_DIR/bizday.log`)
- Default: one-line summary (coverage, proactive rate, mismatches, FP rate)
- `--trend`: per-session table with cumulative row
- `--mismatches`: list all MISMATCH events with details
- `--unverified`: list all dates that weren't checked
- `--false-matches`: list all FALSE_MATCH events
- `--slow`: events where elapsed_ms > 10
- `--pr-summary`: markdown table for PR descriptions
- `--eval`: checkpoint evaluation at session 10, 50, every 50 after
- `--session <id>`: filter to specific session

Create `tests/log.rs` (8 tests — use tempfile for isolation):
- `compute_event_logged`, `hook_events_logged`, `elapsed_ms_present`
- `session_marker_once`, `new_session_after_id_change`
- `creates_log_directory`, `appends_not_overwrites`, `log_format_parseable`

Create `tests/report.rs` (7 tests):
- `empty_log`, `known_session`, `trend_mode`, `pr_summary_markdown`
- `mismatches_drilldown`, `false_match_rate`, `latency_percentile`

Commit: `"feat: bizday log + report — unified logging and measurement framework"`

### B5: Add build:bizday to package.json

Add to `package.json` scripts:
```json
"build:bizday": "cargo build --release -p bizday"
```

Verify:
```bash
npm run build:bizday
./target/release/bizday 2026-03-11 10
```

Commit: `"feat: add build:bizday npm script"`

### Final verification

```bash
cargo test -p bizday
cargo build --release -p bizday
./target/release/bizday 2026-03-11 10  # → 2026-03-24
./target/release/bizday 2026-03-11 2026-03-24  # → 10
./target/release/bizday 2026-03-07  # → Saturday info
./target/release/bizday verify 2026-03-11 10 2026-03-24  # → OK, exit 0
./target/release/bizday help
```

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches)
- Level 2: Commit WIP, move to next task
- Level 3: Commit, mark blocked
- **Calculations**: NEVER do mental math — use `node -e` or `python3 -c`
  Example: `node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('2026-03-11'), 9), 'yyyy-MM-dd'))"`
