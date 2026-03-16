# Validation 02: Debug Duration Investigation

**Difficulty:** MEDIUM (~10-12 date computations)

## Prerequisites

1. Read `CLAUDE.md` first for full project context, especially the Date Conventions section.
2. Read `crates/scheduler/src/date_utils.rs` to understand `task_duration`, `task_end_date`, `business_day_delta`, and the inclusive end-date convention.
3. Read `src/utils/__tests__/dateUtils.test.ts` to understand the TS-side `taskDuration` function and test patterns.

## Critical Rule

**NEVER compute dates mentally.** Use the `taskEndDate` and `taskDuration` shell functions for ALL date computations. These are available in the shell and mirror the Rust/TS functions exactly:

```bash
taskEndDate 2026-03-11 10    # → 2026-03-24 (end date for 10-day task starting Mar 11)
taskDuration 2026-03-11 2026-03-24  # → 10 (inclusive business day count)
```

Every expected value in every test assertion MUST be verified with one of these tool calls before you write it. No exceptions.

## Scenario

A user reports a bug:

> "I have a task from 2026-04-06 to 2026-04-24. The UI shows duration 15, but I counted and expected 14. Is 15 correct?"

## Task

### Step 1: Investigate the reported issue

1. Compute `taskDuration 2026-04-06 2026-04-24` using the shell function.
2. Record the result. Is 15 correct or is the user wrong?
3. Use a tool to enumerate each business day in the range [2026-04-06, 2026-04-24] to explain WHY the duration is what it is. For example:
   ```bash
   python3 -c "
   from datetime import date, timedelta
   d = date(2026, 4, 6)
   end = date(2026, 4, 24)
   count = 0
   while d <= end:
       if d.weekday() < 5:
           count += 1
           print(f'{d} ({[\"Mon\",\"Tue\",\"Wed\",\"Thu\",\"Fri\",\"Sat\",\"Sun\"][d.weekday()]}) - day {count}')
       d += timedelta(days=1)
   print(f'Total business days: {count}')
   "
   ```
4. Write a clear explanation: "The duration is N because [explanation of which days are counted and which weekends are skipped]."

### Step 2: Write a definitive test in `date_utils.rs`

Add a new test module `mod debug_duration_tests` at the bottom of `date_utils.rs` (before the closing of the file, after `cross_language_tests`).

Write a test `fn reported_duration_apr_06_to_apr_24()` that:
- Asserts `task_duration("2026-04-06", "2026-04-24")` equals the value you computed in Step 1
- Asserts `task_end_date("2026-04-06", <computed_duration>)` equals `"2026-04-24"` (roundtrip)

### Step 3: Write 3 more edge-case tests

Each in the same `debug_duration_tests` module:

**Test A: Same start and end date**
- Pick a weekday (e.g., 2026-04-08 Wednesday)
- Compute `taskDuration 2026-04-08 2026-04-08` with tool
- Assert result (should be 1)
- Verify roundtrip: `taskEndDate 2026-04-08 1` should equal the same date

**Test B: Cross-month boundary**
- Task from 2026-03-25 (Wednesday) to 2026-04-03 (Friday)
- Compute `taskDuration 2026-03-25 2026-04-03` with tool
- Verify roundtrip with `taskEndDate`
- This tests the month boundary transition

**Test C: Task spanning multiple weekends**
- Task from 2026-04-06 (Monday) to 2026-04-30 (Thursday)
- Compute `taskDuration 2026-04-06 2026-04-30` with tool — this spans ~3.5 weeks
- Verify roundtrip with `taskEndDate`
- Enumerate business days with python3 to double-check

### Step 4: Write the same tests in TypeScript

Add corresponding tests in `src/utils/__tests__/dateUtils.test.ts` inside a new `describe('debug duration investigation')` block at the end of the main `describe('dateUtils')`. Use the same dates and expected values computed in Steps 2-3.

## Expected Date Computations

You must make at least **10** separate `taskEndDate` or `taskDuration` tool calls. Each test case requires at least 2 computations (duration + roundtrip).

## Verification

```bash
cd crates/scheduler && cargo test debug_duration_tests -- --nocapture
npm run test -- --run src/utils/__tests__/dateUtils.test.ts
```

## Deliverables

- Modified: `crates/scheduler/src/date_utils.rs` (new `debug_duration_tests` module)
- Modified: `src/utils/__tests__/dateUtils.test.ts` (new `describe` block)
- All tests passing in both Rust and TypeScript
