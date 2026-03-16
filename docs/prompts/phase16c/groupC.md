---
phase: 16c
group: C
stage: 2
agent_count: 1
scope:
  modify:
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/constraints.rs
    - crates/scheduler/src/lib.rs
    - crates/scheduler/src/graph.rs
  read_only:
    - crates/scheduler/src/date_utils.rs
    - crates/scheduler/src/cpm.rs
    - docs/tasks/phase16c.yaml
depends_on: [A]  # C modifies same Rust files as A; no dependency on B (TypeScript-only)
tasks:
  - id: C1
    summary: "Add debug_assert to cascade.rs make_task and fix weekend dates"
  - id: C2
    summary: "Add debug_assert to constraints.rs make_task and fix mismatches"
  - id: C3
    summary: "Fix weekend dates in lib.rs and graph.rs test helpers"
---

# Phase 16c Group C — Test Data Cleanup

You are implementing Phase 16c Group C for the Ganttlet project.
Read `CLAUDE.md` for full project context.
Read `crates/scheduler/CLAUDE.md` for scheduler-specific rules.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

Phase 16 code review found that test helpers (`make_task`) across the Rust scheduler
accept weekend dates and inconsistent duration/date combos without complaint. This
allowed bugs to hide — e.g., an ALAP test used `2026-03-22` (Sunday) as an end date
and passed because the test only asserted on `new_start`. Adding `debug_assert` to
test helpers catches these at test time.

**Critical rule**: NEVER do date arithmetic in your head. Use `taskEndDate`/`taskDuration` shell functions
(or `bizday` CLI) for EVERY date computation — day-of-week checks, `task_end_date` derivations,
`business_day_delta` counts, everything.

## Your files (ONLY modify these):

**Modify:**
- `crates/scheduler/src/cascade.rs` — fix test data, add debug_assert to make_task
- `crates/scheduler/src/constraints.rs` — fix test data, add debug_assert to make_task
- `crates/scheduler/src/lib.rs` — add debug_assert to make_task
- `crates/scheduler/src/graph.rs` — fix test data, add debug_assert to make_task

**Read-only:**
- `crates/scheduler/src/date_utils.rs` — `task_duration`, `task_end_date`, `is_weekend_date`
- `crates/scheduler/src/cpm.rs` — EXEMPT from changes (uses exclusive integer model)
- `docs/tasks/phase16c.yaml` — full task details

## Tasks — execute in order:

### C1: Add debug_assert to cascade.rs make_task and fix weekend dates

Read `crates/scheduler/src/cascade.rs` test module in full.

**Step 1: Add asserts to `make_task`**

The cascade.rs `make_task(id, start, end)` hardcodes `duration: 7`. Add:

```rust
fn make_task(id: &str, start: &str, end: &str) -> Task {
    debug_assert!(!is_weekend_date(start), "make_task start is weekend: {start}");
    debug_assert!(!is_weekend_date(end), "make_task end is weekend: {end}");
    debug_assert!(task_duration(start, end) == 7, "make_task dates inconsistent with duration=7: {start} to {end}");
    Task { ... }
}
```

You will need to add `use crate::date_utils::{is_weekend_date, task_duration};` to the
test module imports.

**Step 2: Run `cargo test` — it will fail on weekend dates**

The debug_asserts will fire for every test using weekend dates. Fix them one by one.

**Weekend dates to fix (~18 occurrences across 5 distinct dates):**

Before fixing ANY date, verify the day-of-week using `bizday`:
```bash
bizday 2026-03-01
# Shows day-of-week and nearest business day
```

| Current date | Day | Replacement | Day | Notes |
|---|---|---|---|---|
| 2026-03-01 | Sun | 2026-03-02 | Mon | 12 callsites as start date |
| 2026-03-07 | Sat | 2026-03-06 | Fri | 1 callsite as end date |
| 2026-03-15 | Sun | 2026-03-13 | Fri | 2 callsites as end date |
| 2026-03-21 | Sat | 2026-03-23 | Mon | 2 callsites as start date (ensureBusinessDay snaps forward) |
| 2026-03-28 | Sat | 2026-03-27 | Fri | 1 callsite as end date |

**CRITICAL**: After changing a start date, you MUST recompute the corresponding end date
using `task_end_date(new_start, 7)` — the make_task helper hardcodes `duration=7`.
Example:
```bash
taskEndDate 2026-03-02 7
# Returns 2026-03-10 (inclusive convention)
```

**Step 3: Recompute ALL downstream assertions**

After changing dates, every `assert_eq!` on output dates must be recomputed. Use `taskEndDate`/`taskDuration`
shell functions for each one. Do NOT guess — compute.

**Step 4: Duration consistency for FF/SF tests**

`cascade_dependents()` reads `dependent.duration` for FF and SF dep types (passed to
`ff_successor_start` and `sf_successor_start`). For tests that override `t.duration`,
verify the override is consistent with `task_duration(start, end)`. For tests using the
default `duration=7`, verify `task_duration(new_start, new_end) == 7` after fixing
weekend dates.

**Step 5: Run `cargo test` — all 121 tests must pass**

Commit: `"fix: add debug_assert to cascade.rs make_task, fix ~18 weekend dates"`

### C2: Add debug_assert to constraints.rs make_task and fix mismatches

Read `crates/scheduler/src/constraints.rs` test module in full.

**Step 1: Add asserts to both `make_task` and `make_task_with_project`**

constraints.rs `make_task(id, start, end, duration)` takes an explicit duration parameter.
Add:

```rust
fn make_task(id: &str, start: &str, end: &str, duration: i32) -> Task {
    debug_assert!(!is_weekend_date(start), "make_task start is weekend: {start}");
    debug_assert!(!is_weekend_date(end), "make_task end is weekend: {end}");
    debug_assert!(task_duration(start, end) == duration, "make_task duration mismatch: task_duration({start}, {end}) = {} != {duration}", task_duration(start, end));
    Task { ... }
}
```

Add the same asserts to `make_task_with_project`.

**Step 2: Run `cargo test` — it will fail on mismatches**

There are ~33 duration/date mismatches (all from `make_task`; `make_task_with_project`
has 0 mismatches — its `duration=5` with Mon-Fri windows is correct). Most use
`duration=10` with date windows containing weekends (actual business days ~7-8).

**For each failing test:**
1. Verify the start and end dates are weekdays using `bizday <date>`
2. Compute `task_duration(start, end)` using `taskDuration <start> <end>`
3. Fix EITHER the duration OR the dates to make them consistent
4. Prefer fixing the duration to match the dates (less cascading impact on test assertions)
5. If fixing dates, recompute ALL assertions that depend on those dates

**Important**: constraints.rs production code reads `task.duration` in 7 places (computing
`new_end = task_end_date(&new_start, task.duration)`). Duration mismatches here are
NOT inert — they affect test correctness.

**CPM exception**: Do NOT modify `crates/scheduler/src/cpm.rs`. CPM uses an exclusive
integer model, its milestone with `duration=0` is intentional, and CPM production code
ignores `start_date`/`end_date` entirely.

**Step 3: Run `cargo test` — all must pass**

Commit: `"fix: add debug_assert to constraints.rs make_task, fix ~33 duration mismatches"`

### C3: Fix weekend dates in lib.rs and graph.rs test helpers

**lib.rs:**

Read `crates/scheduler/src/lib.rs` test module. The `make_task(id, start, end)` helper
hardcodes `duration=7`. lib.rs currently has NO weekend dates — all test dates are
weekdays. Add `debug_assert` for weekends as a guardrail:

```rust
fn make_task(id: &str, start: &str, end: &str) -> Task {
    debug_assert!(!is_weekend_date(start), "make_task start is weekend: {start}");
    debug_assert!(!is_weekend_date(end), "make_task end is weekend: {end}");
    Task { ... }
}
```

**graph.rs:**

Read `crates/scheduler/src/graph.rs` test module. The `make_task(id)` helper takes
only an id — all dates are hardcoded in the body:
- `start_date: "2026-03-01"` — this is **Sunday**, must change to `"2026-03-02"` (Monday)
- `end_date: "2026-03-10"` — this is Tuesday, OK

Add `debug_assert` and fix the start date:

```rust
fn make_task(id: &str) -> Task {
    let start = "2026-03-02";
    let end = "2026-03-10";
    debug_assert!(!is_weekend_date(start), "make_task start is weekend: {start}");
    debug_assert!(!is_weekend_date(end), "make_task end is weekend: {end}");
    Task {
        start_date: start.to_string(),
        end_date: end.to_string(),
        ...
    }
}
```

Run `cargo test` — all tests must pass. graph.rs tests only check cycle detection
(reachability), so changing the start date from Sunday to Monday should not affect
any assertions.

Commit: `"fix: add debug_assert to lib.rs and graph.rs make_task, fix graph.rs weekend start"`

### Final verification

```bash
cd crates/scheduler && cargo test 2>&1 | tail -5
```

All 121+ tests must pass.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupC saving work"`.
- **Calculations**: NEVER do mental math — use `taskEndDate`/`taskDuration` shell functions for dates, `python3 -c` for arithmetic.
