# Validation 04: Constraint Type × Date Position Matrix

**Difficulty:** LARGE (~40-50 date computations)

## Prerequisites

1. Read `CLAUDE.md` first for full project context, especially the Date Conventions section.
2. Read `crates/scheduler/src/constraints.rs` — understand all 6 constraint types (FNET, FNLT, SNET, SNLT, MFO, MSO), the `recalculate_earliest` function, and existing test patterns including `make_task` and `make_dep` helpers.
3. Read `crates/scheduler/src/date_utils.rs` — understand `task_end_date`, `task_duration`, `task_start_date`.

## Critical Rule

**NEVER compute dates mentally.** Use the `taskEndDate` and `taskDuration` shell functions for ALL date computations. These are available in the shell and mirror the Rust/TS functions exactly:

```bash
taskEndDate 2026-03-11 10    # → 2026-03-24 (end date for 10-day task starting Mar 11)
taskDuration 2026-03-11 2026-03-24  # → 10 (inclusive business day count)
```

Every expected value in every test assertion MUST be verified with one of these tool calls before you write it. No exceptions — even for test case #18 when you are tired of calling tools. **Sustain tool use across all 24 cases.**

## Task

Write tests for all 6 constraint types × 3 date positions = 18 test cases, plus 6 interaction tests. Total: 24 test cases.

Add a new `#[cfg(test)] mod constraint_matrix_tests` module at the bottom of `crates/scheduler/src/constraints.rs`, after the existing `mod tests` block.

### Part 1: Pure Constraint Tests (18 cases)

For each of the 6 constraint types (FNET, FNLT, SNET, SNLT, MFO, MSO), write 3 tests where the constraint date falls on:
1. **Friday** (e.g., 2026-03-20)
2. **Monday** (e.g., 2026-03-23)
3. **Mid-week Wednesday** (e.g., 2026-03-25)

#### Base task for all tests:
- No dependencies (pure constraint behavior)
- Duration: 5
- Current start: 2026-03-09 (Monday)
- Compute current end: `taskEndDate 2026-03-09 5`
- Today floor: 2026-03-02 (so it does not interfere)

#### For each test case:

1. **Choose constraint date** (Friday/Monday/Wednesday as specified above)
2. **Compute expected results** using tools:
   - For SNET: new_start = max(current_start, constraint_date). Compute new_end = `taskEndDate <new_start> 5`
   - For SNLT: new_start stays dep-driven. If new_start > constraint_date → conflict flag.
   - For FNET: Compute end = `taskEndDate <start> 5`. If end < constraint_date → push start. New start = `task_start_date(constraint_date, 5)`. Use tool to compute.
   - For FNLT: Compute end = `taskEndDate <start> 5`. If end > constraint_date → conflict flag.
   - For MSO: new_start = constraint_date. Compute new_end = `taskEndDate <constraint_date> 5`. If deps push past → conflict.
   - For MFO: Derive start from constraint_date: `task_start_date(constraint_date, 5)`. Compute with tool. If deps push past → conflict.
3. **Write the assertion**

#### Naming convention:
```rust
#[test]
fn snet_friday() { ... }
#[test]
fn snet_monday() { ... }
#[test]
fn snet_wednesday() { ... }
#[test]
fn snlt_friday() { ... }
// ... etc for all 18
```

### Part 2: Constraint + FS Dependency Interaction Tests (6 cases)

For each constraint type, write 1 test that combines it with an FS dependency:

- Predecessor A: start 2026-03-02, duration 5 → compute end with `taskEndDate 2026-03-02 5`
- Successor B: has FS dep on A (lag=0) AND a constraint
- B duration: 5

For each:
1. Compute B's earliest from FS: `fs_successor_start(A.end, 0)` — use tool to compute as next biz day after A.end
2. Apply constraint logic on top of FS-driven start
3. Compute expected final start and end with tools
4. Choose constraint dates that create interesting interactions:
   - SNET: constraint date LATER than FS-driven start (constraint wins)
   - SNLT: constraint date EARLIER than FS-driven start (conflict)
   - FNET: constraint date that pushes end later than FS would
   - FNLT: constraint date that FS-driven end exceeds (conflict)
   - MSO: constraint date EARLIER than FS-driven start (conflict)
   - MFO: constraint date that FS-driven start exceeds (conflict)

#### Naming convention:
```rust
#[test]
fn snet_with_fs_dep() { ... }
#[test]
fn snlt_with_fs_dep() { ... }
// ... etc for all 6
```

### Implementation Notes

- Use the existing `make_task(id, start, end, duration)` and `make_dep(from, to, dep_type, lag)` helpers from the `tests` module.
- Set `constraint_type` and `constraint_date` on the task struct.
- Call `recalculate_earliest(&tasks, None, None, None, "2026-03-02")` and assert on the results.
- For conflict tests, check `result.conflict.is_some()` and that the conflict message contains the constraint type string.

## Expected Date Computations

You must make at least **40** separate `taskEndDate` or `taskDuration` tool calls across all 24 test cases. Each test requires at least 2 computations (start + end or end + roundtrip).

**This task is deliberately repetitive.** The point is to verify that you sustain tool use for EVERY test case — not just the first few. Do not fall back to mental math for "similar" cases.

## Verification

```bash
cd crates/scheduler && cargo test constraint_matrix_tests -- --nocapture
```

All 24 tests must pass.

## Deliverable

- Modified: `crates/scheduler/src/constraints.rs` (new `constraint_matrix_tests` module)
- All tests passing
