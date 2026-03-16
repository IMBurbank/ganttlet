# Validation 01: Cascade Dependency Tests

**Complexity**: MEDIUM (~12-16 date computations)

## Prerequisites

Read `CLAUDE.md` first for full project context, especially the Date Conventions section.

## Task Description

Write 6 new test cases for cascade logic in `crates/scheduler/src/cascade.rs`.
Add them in a new `#[cfg(test)] mod cascade_validation_tests` block at the bottom of the file.

## Critical Rule

For ALL date computations, use the shell functions — NEVER do mental math:

```bash
# Compute end date from start + duration
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('START'), DURATION-1), 'yyyy-MM-dd'))"

# Compute duration from start to end (inclusive)
node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('END'), d.parseISO('START')) + 1)"

# Compute FS successor start (pred_end, lag)
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('PRED_END'), 1 + LAG), 'yyyy-MM-dd'))"

# Compute SS successor start (pred_start, lag)
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('PRED_START'), LAG), 'yyyy-MM-dd'))"

# Compute FF successor start (pred_end, lag, succ_dur)
# Step 1: required_finish = addBusinessDays(pred_end, lag)
# Step 2: start = addBusinessDays(required_finish, -(succ_dur - 1))
node -e "const d=require('date-fns'); const rf=d.addBusinessDays(d.parseISO('PRED_END'), LAG); console.log(d.format(d.addBusinessDays(rf, -(SUCC_DUR-1)), 'yyyy-MM-dd'))"

# Compute SF successor start (pred_start, lag, succ_dur)
node -e "const d=require('date-fns'); const rf=d.addBusinessDays(d.parseISO('PRED_START'), LAG); console.log(d.format(d.addBusinessDays(rf, -(SUCC_DUR-1)), 'yyyy-MM-dd'))"
```

## Test Cases to Write

### Test 1: FS dependency, predecessor ends Friday, lag 0

- Predecessor A: starts 2026-04-06 (Mon), duration 5 — compute end date with tool
- Successor B: starts some earlier date, duration 7, FS lag=0 from A
- Compute: `fs_successor_start(A.end, 0)` — successor must start next Monday
- Compute B's new end date after cascade
- Assert both start and end dates

### Test 2: FS dependency with lag 2 crossing a weekend

- Predecessor A: starts 2026-04-13 (Mon), duration 5 — compute end date with tool
- Successor B: FS lag=2 from A, duration 5
- Compute: `fs_successor_start(A.end, 2)` — lag crosses weekend
- Compute B's new end date
- Assert dates

### Test 3: SS dependency, predecessor starts Monday, lag 3

- Predecessor A: starts 2026-04-20 (Mon), duration 7
- Successor B: SS lag=3, duration 5
- Compute: `ss_successor_start(A.start, 3)` — should be Thursday
- Compute B's end date
- Assert dates

### Test 4: FF dependency, predecessor ends Wednesday, lag 0, successor duration 5

- Predecessor A: starts 2026-04-06 (Mon), duration 3 — compute end date (should be Wed)
- Successor B: FF lag=0, duration 5
- Compute: `ff_successor_start(A.end, 0, 5)` — B must finish same day as A
- Assert B's start date

### Test 5: SF dependency, predecessor starts Monday, lag 1, successor duration 3

- Predecessor A: starts 2026-04-27 (Mon), duration 5
- Successor B: SF lag=1, duration 3
- Compute: `sf_successor_start(A.start, 1, 3)` — required finish, then derive start
- Assert B's start date

### Test 6: FS chain — 3 tasks linked FS with lag 0, first starts Monday

- Task A: starts 2026-05-04 (Mon), duration 5 — compute end
- Task B: FS lag=0 from A, duration 3 — compute start and end
- Task C: FS lag=0 from B, duration 4 — compute start and end
- Move A forward by 2 business days, run cascade
- Compute ALL new start/end dates for B and C
- Assert all dates

## Expected Date Computations

Each test requires 2-3 date computations = 12-18 total. Every single one must use a tool call.

## Files to Modify

- `crates/scheduler/src/cascade.rs` — add new test module

## Verification

```bash
cd crates/scheduler && cargo test cascade_validation -- --nocapture
```

All 6 tests must pass. No existing tests may break.

## Deliverables

1. 6 new test functions in `cascade.rs`
2. All tests passing
3. Commit: `test: add 6 cascade validation tests with tool-verified dates`
