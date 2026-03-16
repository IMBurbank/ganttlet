# Validation 06: Historical Bug Regression Tests

**Difficulty:** LARGE (~30-40 date computations)

## Prerequisites

1. Read `CLAUDE.md` first for full project context, especially the Date Conventions section.
2. Read `crates/scheduler/src/date_utils.rs` — understand `task_duration`, `task_end_date`, `fs_successor_start`, `shift_date`, `business_day_delta`, `is_weekend_date`.
3. Read `crates/scheduler/src/cascade.rs` — understand cascade logic and the `cascade_dependents` function signature.
4. Read `docs/plans/datecalc-tool.md` — find the "Historical evidence" section describing the 3 bug commits.

## Critical Rule

**NEVER compute dates mentally.** Use the `taskEndDate` and `taskDuration` shell functions for ALL date computations. These are available in the shell and mirror the Rust/TS functions exactly:

```bash
taskEndDate 2026-03-11 10    # → 2026-03-24 (end date for 10-day task starting Mar 11)
taskDuration 2026-03-11 2026-03-24  # → 10 (inclusive business day count)
```

Every expected value in every test assertion MUST be verified with one of these tool calls before you write it. No exceptions.

## Task

Reconstruct 3 historical bugs and write comprehensive regression tests. Add a new `#[cfg(test)] mod regression_tests` module at the bottom of `crates/scheduler/src/cascade.rs`, after any existing test modules.

### Bug 1: Duration computed in calendar days instead of business days (commit `1880999`)

**Background:** The original implementation computed duration as `end_date - start_date + 1` in calendar days, ignoring weekends. This gave wrong durations for any task spanning a weekend.

**Regression tests (4 tests):**

**1a: Mon-Fri same week (no weekend)**
- Start: 2026-03-09 (Monday), End: 2026-03-13 (Friday)
- Compute `taskDuration 2026-03-09 2026-03-13` — should be 5
- Calendar days would be 5 too (no weekend) — this case is NOT caught by the bug
- Include as a baseline sanity check

**1b: Fri-Tue crosses one weekend**
- Start: 2026-03-06 (Friday), End: 2026-03-10 (Tuesday)
- Compute `taskDuration 2026-03-06 2026-03-10` with tool
- Calendar days: compute with `python3 -c "print((10-6)+1)"` → 5
- Business days: should be 3 (Fri, Mon, Tue)
- Assert business days != calendar days — this is the bug

**1c: Mon-Mon next week**
- Start: 2026-03-09 (Monday), End: 2026-03-16 (Monday)
- Compute `taskDuration 2026-03-09 2026-03-16` with tool
- Calendar days: 8
- Business days: should be 6 (Mon-Fri + Mon)
- Assert the correct business day count

**1d: Two-week span**
- Start: 2026-03-09 (Monday), End: 2026-03-20 (Friday)
- Compute `taskDuration 2026-03-09 2026-03-20` with tool
- Calendar days: 12
- Business days: should be 10
- Assert the correct count

For each test, write assertions that verify:
```rust
assert_eq!(task_duration(start, end), <business_days>);
// Verify this is different from calendar days for weekend-spanning tasks
assert_ne!(<business_days>, <calendar_days>, "Bug regression: calendar != business days");
```

### Bug 2: FS lag treated as calendar days, cascade lands on weekend (commit `8ee19f8`)

**Background:** `fs_successor_start` was using `add_days(pred_end, 1 + lag)` instead of `shift_date(pred_end, 1 + lag)`, which meant lag was added in calendar days and results could land on weekends.

**Regression tests (4 tests):**

**2a: FS lag=0, predecessor ends Friday → successor starts Monday**
- Predecessor ends: 2026-03-06 (Friday)
- Compute `fs_successor_start("2026-03-06", 0)` — use tool to get next biz day after Friday
- Assert result is Monday (not Saturday)
- Assert `!is_weekend_date(&result)`

**2b: FS lag=1, predecessor ends Friday**
- Predecessor ends: 2026-03-06 (Friday)
- Compute successor start with lag=1. Use tool: shift 1+1=2 biz days from Friday
- Assert result is a weekday (should be Tuesday)
- Assert `!is_weekend_date(&result)`

**2c: FS lag=2, predecessor ends Friday**
- Predecessor ends: 2026-03-06 (Friday)
- Compute successor start with lag=2. Use tool: shift 1+2=3 biz days from Friday
- Assert result is Wednesday
- Assert `!is_weekend_date(&result)`

**2d: FS lag=5, predecessor ends Friday**
- Predecessor ends: 2026-03-06 (Friday)
- Compute successor start with lag=5. Use tool: shift 1+5=6 biz days from Friday
- Should land on Monday of the week after next
- Assert `!is_weekend_date(&result)`

For each test, also verify that the buggy formula `add_days(pred_end, 1 + lag)` would have given a different (wrong, possibly weekend) result:
```rust
let buggy_result = add_days(pred_end, 1 + lag);
let correct_result = fs_successor_start(pred_end, lag);
// For lag=0 from Friday: buggy = Saturday, correct = Monday
assert_ne!(buggy_result, correct_result, "Bug regression: calendar vs business day lag");
```

### Bug 3: Cascade over-aggressive due to wrong slack calculation (commit `23ad90b`)

**Background:** Cascade was shifting dependents even when sufficient slack existed between predecessor and successor. The fix implemented slack-aware cascading: if `required_start <= current_start`, no cascade occurs.

**Regression tests (4 tests):**

**3a: Sufficient slack absorbs move — no cascade**
- A: duration 5, starts 2026-03-02 → compute end with `taskEndDate 2026-03-02 5`
- B: FS from A, lag=0, starts 2026-03-16 (Monday) → compute end with tool. Duration 7.
- Compute required B.start: `fs_successor_start(A.end, 0)` with tool
- Verify required_start <= B.current_start (slack absorbs)
- Move A forward by 2 biz. Update A's end. Recompute required_start.
- Assert cascade returns empty results (slack still absorbs)

**3b: Slack partially absorbs — cascade by minimum**
- A: duration 5, starts 2026-03-09 → compute end
- B: FS from A, lag=0, starts 2026-03-16 → compute end. Duration 7.
- Move A forward by 5 biz. Compute new A.end.
- Compute required B.start.
- If required > B.current → cascade by exactly (required - current) biz days
- Compute B's new start and end with tools

**3c: No slack, tight chain — full cascade**
- A: duration 5, starts 2026-03-02 → compute end (should be Friday 2026-03-06)
- B: FS from A, lag=0, starts 2026-03-09 (Monday, tight) → compute end. Duration 5.
- Verify slack = 0 (required start = B.start)
- Move A forward 3 biz. Compute new A.end.
- B must cascade by 3 biz days. Compute B's new dates.

**3d: Backward move does not cascade (asymmetric)**
- A and B set up as in 3c (tight chain)
- Move A backward by 2 biz (delta = -2)
- Assert cascade returns empty (backward moves never cascade)

For each test:
1. Compute ALL dates with tools before writing assertions
2. Use `cascade_dependents(&tasks, moved_id, delta)` and check results
3. Verify `is_weekend_date` on all result dates

### Implementation Notes

- Use inline Task construction (not `make_task` which requires duration=7).
- Import from `crate::date_utils`: `task_duration`, `task_end_date`, `fs_successor_start`, `shift_date`, `add_days`, `is_weekend_date`, `business_day_delta`.
- Import from `crate::types`: `Task`, `Dependency`, `DepType`, `CascadeResult`.
- Use `make_dep` helper or inline `Dependency` construction.

## Expected Date Computations

You must make at least **30** separate `taskEndDate` or `taskDuration` tool calls across the 12 tests. Each test requires 2-4 date computations.

## Verification

```bash
cd crates/scheduler && cargo test regression_tests -- --nocapture
```

All 12 tests must pass.

## Deliverable

- Modified: `crates/scheduler/src/cascade.rs` (new `regression_tests` module)
- All tests passing
