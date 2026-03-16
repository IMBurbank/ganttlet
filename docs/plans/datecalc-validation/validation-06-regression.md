# Validation 06: Historical Bug Regression Tests

**Complexity**: LARGE (~30-40 date computations)

## Prerequisites

Read `CLAUDE.md` first for full project context, especially the Date Conventions section.

## Task Description

Reconstruct the 3 historical date math bugs documented in the project and write
comprehensive regression tests to prevent recurrence.

**Historical bugs:**
- `1880999`: Duration computed in calendar days instead of business days
- `8ee19f8`: FS lag treated as calendar days; cascade shifts land on weekends
- `23ad90b`: Cascade over-aggressive due to wrong slack calculation

## Critical Rule

For ALL date computations, use the shell functions — NEVER do mental math:

```bash
# Compute inclusive business day duration
node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('END'), d.parseISO('START')) + 1)"

# Compute calendar day count
node -e "const d=require('date-fns'); console.log(d.differenceInCalendarDays(d.parseISO('END'), d.parseISO('START')))"

# Compute end date (inclusive convention)
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('START'), DURATION-1), 'yyyy-MM-dd'))"

# FS successor start
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('PRED_END'), 1 + LAG), 'yyyy-MM-dd'))"

# Check day of week
node -e "const d=require('date-fns'); console.log(d.format(d.parseISO('DATE'), 'EEEE'))"

# Check is weekend
node -e "const d=require('date-fns'); console.log(d.isWeekend(d.parseISO('DATE')))"

# business_day_delta (exclusive count)
node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('TO'), d.parseISO('FROM')))"
```

## Read First

- `crates/scheduler/src/date_utils.rs` — `task_duration`, `task_end_date`, `fs_successor_start`
- `crates/scheduler/src/cascade.rs` — `cascade_dependents` function and existing tests

## Bug 1: Calendar Days vs Business Days (commit 1880999)

**The bug**: Duration was computed using calendar day count instead of business day count.
A task Mon-Fri showed duration 4 (calendar) instead of 5 (business, inclusive).

### Regression tests to write

Add to `crates/scheduler/src/date_utils.rs` in a new module `regression_tests`:

**Test 1a: Mon-Fri (5 business days, not 4 calendar)**
- Start: 2026-04-06 (Mon), End: 2026-04-10 (Fri)
- Compute `taskDuration` with tool — should be 5
- Compute calendar days with tool — should be 4
- Assert `task_duration` returns the business day count (5), NOT calendar (4)

**Test 1b: Fri-Tue (3 business days, crosses weekend)**
- Start: 2026-04-10 (Fri), End: 2026-04-14 (Tue)
- Compute business duration with tool
- Compute calendar days with tool — would be 4
- Assert `task_duration` returns business count

**Test 1c: Mon-Mon next week (6 business days)**
- Start: 2026-04-06 (Mon), End: 2026-04-13 (Mon)
- Compute business duration with tool
- Compute calendar days with tool — would be 7
- Assert `task_duration` returns business count

**Test 1d: 2-week span (10 business days)**
- Start: 2026-04-06 (Mon), End: 2026-04-17 (Fri)
- Compute business duration with tool
- Compute calendar days with tool — would be 11
- Assert `task_duration` returns business count

## Bug 2: FS Lag as Calendar Days / Weekend Landing (commit 8ee19f8)

**The bug**: FS lag was treated as calendar days, causing cascaded tasks to start on
weekends. E.g., predecessor ends Friday, lag 0 → successor starts Saturday (wrong).

### Regression tests to write

Add to `crates/scheduler/src/date_utils.rs` `regression_tests` module:

**Test 2a: FS lag 0, pred ends Friday → successor starts Monday**
- Predecessor end: 2026-04-10 (Fri)
- Compute `fs_successor_start("2026-04-10", 0)` with tool
- Assert result is a weekday (check with tool)
- Assert result is Monday 2026-04-13

**Test 2b: FS lag 1, pred ends Friday → successor starts Tuesday**
- Predecessor end: 2026-04-10 (Fri)
- Compute `fs_successor_start("2026-04-10", 1)` with tool
- Assert result is a weekday
- Assert correct date

**Test 2c: FS lag 2, pred ends Friday → successor starts Wednesday**
- Predecessor end: 2026-04-10 (Fri)
- Compute `fs_successor_start("2026-04-10", 2)` with tool
- Assert result is a weekday
- Assert correct date

**Test 2d: FS lag 5, pred ends Friday → successor starts next Monday week**
- Predecessor end: 2026-04-10 (Fri)
- Compute `fs_successor_start("2026-04-10", 5)` with tool
- Assert result is a weekday
- Assert correct date (should be Monday of the week after, skipping weekend)

For each test, also verify the result is not a weekend:
```rust
assert!(!is_weekend_date(&result), "FS successor landed on weekend: {}", result);
```

## Bug 3: Over-Aggressive Cascade / Wrong Slack (commit 23ad90b)

**The bug**: Cascade shifted tasks even when slack should have absorbed the move.
The slack calculation was wrong, causing unnecessary cascading.

### Regression tests to write

Add to `crates/scheduler/src/cascade.rs` in a new module `regression_tests`:

**Test 3a: Slack absorbs small move (no cascade)**
- A: dur=5, starts Mon 2026-04-06, compute end with tool
- B: FS lag=0 from A, dur=5, starts 2 weeks later (has 5 days slack)
- Move A forward by 3 biz days — within slack
- Compute: `fs_successor_start(A.new_end, 0)` — should be <= B.start
- Assert cascade returns empty (slack absorbed the move)

**Test 3b: Slack partially absorbs move (minimal cascade)**
- A: dur=5, starts Mon 2026-04-06, compute end with tool
- B: FS lag=0 from A, dur=5, starts 1 week later (has 2 days slack)
- Move A forward by 5 biz days — exceeds slack
- Compute: new required start for B, B's shift amount
- Assert B cascades by exactly the overflow amount (not the full move delta)

**Test 3c: Zero slack — full cascade**
- A: dur=5, starts Mon 2026-04-06, compute end with tool
- B: FS lag=0 from A, dur=5, starts tight (next day after A.end)
- Move A forward by 2 biz days
- Compute: B's new start and end dates
- Assert B shifts by exactly 2

**Test 3d: Chain with mixed slack — cascade stops at slack**
- A → B → C. A has no slack to B. B has 5 days slack to C.
- Move A forward 2 biz days.
- Compute: B must cascade (no slack). C should NOT cascade (B's new end + slack still before C.start).
- Assert B cascades, C does not.

For each test, compute ALL expected values (A's new end, required starts, slack amounts,
B's new dates) with tools before writing assertions.

## Expected Date Computations

- Bug 1: 4 tests x 2 computations (business + calendar) = 8
- Bug 2: 4 tests x 2 computations (date + weekday check) = 8
- Bug 3: 4 tests x 4-5 computations (original dates, moved dates, cascade) = 16-20
- Total: ~32-36 date computations

## Files to Modify

- `crates/scheduler/src/date_utils.rs` — add `regression_tests` module (Bug 1 + Bug 2)
- `crates/scheduler/src/cascade.rs` — add `regression_tests` module (Bug 3)

## Verification

```bash
cd crates/scheduler && cargo test regression -- --nocapture
```

All 12 tests must pass. No existing tests may break.

## Deliverables

1. 8 new tests in `date_utils.rs` (Bug 1 + Bug 2 regression)
2. 4 new tests in `cascade.rs` (Bug 3 regression)
3. All tests passing
4. Commit: `test: add 12 historical bug regression tests with tool-verified dates`
