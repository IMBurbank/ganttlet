# Validation 02: Debug Duration Discrepancy

**Complexity**: MEDIUM (~10-12 date computations)

## Prerequisites

Read `CLAUDE.md` first for full project context, especially the Date Conventions section.

## Task Description

A user reports that a task from 2026-04-06 to 2026-04-24 shows duration 15
in the UI but they expected 14. Investigate whether 15 is correct.

## Critical Rule

For ALL date computations, use the shell functions — NEVER do mental math:

```bash
# Compute inclusive duration
node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('END'), d.parseISO('START')) + 1)"

# Compute end date from start + duration
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('START'), DURATION-1), 'yyyy-MM-dd'))"

# Check day of week (0=Sun, 6=Sat)
node -e "const d=require('date-fns'); console.log(d.getDay(d.parseISO('DATE')))"

# List all business days in a range
node -e "const d=require('date-fns'); let c=d.parseISO('START'); const e=d.parseISO('END'); while(c<=e){if(d.getDay(c)!==0&&d.getDay(c)!==6)console.log(d.format(c,'yyyy-MM-dd EEE'));c=d.addDays(c,1)}"
```

## Investigation Steps

### Step 1: Compute the actual duration

Run `taskDuration('2026-04-06', '2026-04-24')` using the tool. Record the result.

### Step 2: Enumerate business days

List all business days from 2026-04-06 to 2026-04-24 using the tool. Count them.
Explain WHY the result is what it is (identify weekends in the range).

### Step 3: Write a definitive test

Add a test in `crates/scheduler/src/date_utils.rs` in the `convention_tests` module:

```rust
#[test]
fn duration_april_6_to_24() {
    // 2026-04-06 (Mon) to 2026-04-24 (Fri)
    // Weekends: Apr 11-12, Apr 18-19
    // Business days: [computed count from Step 1]
    assert_eq!(task_duration("2026-04-06", "2026-04-24"), COMPUTED_VALUE);
}
```

The expected value MUST come from a tool computation, not from your reasoning.

### Step 4: Write 3 more edge-case tests

Each requires computing duration with the tool first:

**Test A: Same start and end date**
- Pick 2026-04-06 (Monday)
- Compute `taskDuration('2026-04-06', '2026-04-06')` with tool
- Write assertion

**Test B: Cross-month boundary**
- Start: 2026-04-27 (Mon), End: 2026-05-08 (Fri)
- Compute `taskDuration('2026-04-27', '2026-05-08')` with tool
- Write assertion

**Test C: Task spanning 3 weekends**
- Start: 2026-04-06 (Mon), End: 2026-04-30 (Thu... verify day of week with tool!)
- Compute duration with tool
- Write assertion

## Expected Date Computations

- Step 1: 1 computation
- Step 2: 1 enumeration (counts as 1)
- Step 3: 1 computation for the test
- Step 4: 3 tests x 2-3 computations each (duration + day-of-week checks) = 6-9
- Total: ~10-12 computations

## Files to Modify

- `crates/scheduler/src/date_utils.rs` — add tests to `convention_tests` module

## Verification

```bash
cd crates/scheduler && cargo test convention_tests -- --nocapture
```

All tests must pass. No existing tests may break.

## Deliverables

1. Investigation report: is 15 correct? Explain why.
2. 4 new test functions in `date_utils.rs`
3. All tests passing
4. Commit: `test: add duration edge-case tests with tool-verified values`
