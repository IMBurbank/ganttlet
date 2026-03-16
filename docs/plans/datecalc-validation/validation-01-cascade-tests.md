# Validation 01: Cascade Test Cases

**Difficulty:** MEDIUM (~12-16 date computations)

## Prerequisites

1. Read `CLAUDE.md` first for full project context, especially the Date Conventions section.
2. Read `crates/scheduler/src/date_utils.rs` to understand `task_end_date`, `task_duration`, `fs_successor_start`, `ss_successor_start`, `ff_successor_start`, `sf_successor_start`.
3. Read `crates/scheduler/src/cascade.rs` to understand the cascade algorithm, `make_task` helper, and existing test patterns.

## Critical Rule

**NEVER compute dates mentally.** Use the `taskEndDate` and `taskDuration` shell functions for ALL date computations. These are available in the shell and mirror the Rust/TS functions exactly:

```bash
taskEndDate 2026-03-11 10    # → 2026-03-24 (end date for 10-day task starting Mar 11)
taskDuration 2026-03-11 2026-03-24  # → 10 (inclusive business day count)
```

Every expected value in every test assertion MUST be verified with one of these tool calls before you write it. No exceptions — even for "obvious" cases like same-day tasks.

## Task

Write 6 new test cases in `crates/scheduler/src/cascade.rs` within a new `#[cfg(test)] mod validation_cascade_tests` block. Add it after the existing `mod tests` block.

### Test Cases to Implement

**Test 1: FS predecessor ends Friday, lag 0**
- Predecessor A: starts Monday 2026-03-09, duration 5 → compute end date with `taskEndDate 2026-03-09 5`
- Successor B: starts Monday 2026-03-09, duration 7 → compute end date with `taskEndDate 2026-03-09 7`
- FS lag=0: compute B's required start with tool. Verify it lands on Monday (not Saturday/Sunday).
- Set up cascade: A moves +3 biz. Compute B's new start and end dates.

**Test 2: FS with lag 2 crossing a weekend**
- Predecessor A: starts 2026-03-09, duration 5 → compute end (should be Friday)
- Successor B: starts 2026-03-09, duration 5 → compute end
- FS lag=2: compute B's required start. The lag should skip over the weekend.
- Cascade A forward by 2 biz days. Compute all expected dates.

**Test 3: SS predecessor starts Monday, lag 3**
- Predecessor A: starts 2026-03-09 (Monday), duration 7 → compute end
- Successor B: starts 2026-03-02, duration 5 → compute end
- SS lag=3: compute B's required start with `ss_successor_start(pred_start, 3)` logic — use `taskEndDate 2026-03-09 4` (shift 3 from start = start + 3 biz days).
- Cascade A forward by 2 biz. Verify B shifts only if violation occurs.

**Test 4: FF predecessor ends Wednesday, lag 0, successor duration 5**
- Predecessor A: starts 2026-03-09, duration 7 → compute end
- Successor B: starts 2026-03-02, duration 5 → compute end
- FF lag=0: required finish for B = A's end. Required start = `task_start_date(A.end, B.duration)`.
- Compute all expected values with tools. Cascade A forward by 3.

**Test 5: SF predecessor starts Monday, lag 1, successor duration 3**
- Predecessor A: starts 2026-03-09, duration 7 → compute end
- Successor B: starts 2026-03-02, duration 3 → compute end
- SF lag=1: required finish = `shift_date(A.start, 1)`, required start = back up by (dur-1) biz days.
- Compute all with tools. Cascade A forward by 4.

**Test 6: FS chain — 3 tasks linked FS with lag 0**
- Task A: starts 2026-03-02, duration 5 → compute end
- Task B: FS from A, lag 0, duration 5 → compute start (= next biz day after A.end) and end
- Task C: FS from B, lag 0, duration 5 → compute start and end
- Move A forward by 3 biz days. Compute all 6 new dates (A stays, B and C cascade).

### Implementation Notes

- Use the existing `make_task` helper from the `tests` module (it requires duration=7). For tests needing different durations, create inline Task structs following the pattern in `cascade_across_weekend_preserves_duration`.
- Use `make_dep`, `make_dep_with_lag`, `make_sf_dep`, `make_sf_dep_with_lag` from the existing test module where applicable.
- Import needed functions: `use crate::date_utils::{task_duration, task_end_date, fs_successor_start, ss_successor_start, ff_successor_start, sf_successor_start, shift_date, business_day_delta, is_weekend_date};`

## Expected Date Computations

You must make at least **12** separate `taskEndDate` or `taskDuration` tool calls across the 6 tests. Log each computation result before using it in an assertion.

## Verification

After writing the tests, run:
```bash
cd crates/scheduler && cargo test validation_cascade_tests -- --nocapture
```

All 6 tests must pass.

## Deliverable

- Modified file: `crates/scheduler/src/cascade.rs` (new test module added)
- All tests passing
