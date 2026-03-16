# Validation 05: Audit All Date Assertions

**Difficulty:** LARGE (~50+ date verifications)

## Prerequisites

1. Read `CLAUDE.md` first for full project context, especially the Date Conventions section.
2. Read ALL of the following files completely — you will audit every date assertion in them:
   - `crates/scheduler/src/date_utils.rs`
   - `crates/scheduler/src/cascade.rs`
   - `crates/scheduler/src/constraints.rs`
   - `src/utils/__tests__/dateUtils.test.ts`
   - `src/state/__tests__/ganttReducer.test.ts`

## Critical Rule

**NEVER compute dates mentally.** Use the `taskEndDate` and `taskDuration` shell functions for ALL date computations. These are available in the shell and mirror the Rust/TS functions exactly:

```bash
taskEndDate 2026-03-11 10    # → 2026-03-24 (end date for 10-day task starting Mar 11)
taskDuration 2026-03-11 2026-03-24  # → 10 (inclusive business day count)
```

Every verification MUST use a tool call. No exceptions — even for "obviously correct" assertions like `task_duration("2026-03-02", "2026-03-02") == 1`.

## Task

### Phase 1: Audit Rust test files

For each `assert_eq!` in the test modules of the following files, independently verify the expected value:

#### File 1: `crates/scheduler/src/date_utils.rs`

Audit these test modules:
- `convention_tests` — all `task_duration`, `task_end_date`, `ensure_business_day`, `prev_business_day`, `fs_successor_start`, `ss_successor_start`, `ff_successor_start`, `sf_successor_start`, `business_day_delta` assertions
- `tests` — all `shift_date`, `business_day_delta`, `day_of_week` assertions
- `cross_language_tests` — all `task_duration` and `task_end_date` assertions

For each assertion:
1. Identify the function call and expected value
2. Compute the expected value independently:
   - `task_duration(A, B)` → `taskDuration A B`
   - `task_end_date(A, N)` → `taskEndDate A N`
   - `fs_successor_start(A, lag)` → The function does `shift_date(A, 1+lag)`. Compute as `taskEndDate A <1+lag+1>` then check. Or use: `python3 -c "..."` to compute next-biz-day + lag.
   - `shift_date(A, N)` → For N>0: `taskEndDate A <N+1>` (shift_date shifts by N biz days, taskEndDate shifts by N-1). Be careful: `shift_date(start, N)` = `task_end_date(start, N+1)` when N>0 and start is a weekday.
   - `business_day_delta(A, B)` → `taskDuration A B` minus 1 (since delta is exclusive, duration is inclusive)
   - `day_of_week` → `python3 -c "from datetime import date; print(date(Y,M,D).strftime('%A'))"` or `date -d 'YYYY-MM-DD' +%A`
3. Mark as CORRECT or WRONG
4. If WRONG, note the file, line, and correct value

#### File 2: `crates/scheduler/src/cascade.rs`

Audit all `assert_eq!` in `mod tests`:
- `shifts_dependent_on_violation` — verify B's new start and end
- `transitive_cascade` — verify C's new start
- `preserves_duration_on_violation` — verify duration preservation
- `diamond_dependency_no_double_shift` — verify C's start and end
- `cascade_only_minimum_required` — verify B's start and end
- `cascade_across_weekend_preserves_duration` — verify B's start and end
- `cascade_does_not_land_on_weekend` — verify B's start and end
- All slack-aware cascade tests
- All SF cascade tests
- `cascade_and_recalculate_agree_on_all_dep_types` — verify all 10 expected start dates
- `edit_cascade_recalculate_no_drift` — verify B and C dates

#### File 3: `crates/scheduler/src/constraints.rs`

Audit all `assert_eq!` and `assert!(result.conflict.is_some())` in `mod tests`:
- All `compute_earliest_start` tests — verify expected start dates
- All `recalculate_earliest` tests — verify new_start and new_end values
- All constraint type tests (SNLT, FNET, FNLT, MSO, MFO) — verify expected dates and conflicts

### Phase 2: Audit TypeScript test files

#### File 4: `src/utils/__tests__/dateUtils.test.ts`

Audit:
- `taskDuration` test cases — all expected values
- `taskEndDate` test cases — all expected values
- `businessDaysDelta` test cases — all expected values
- Cross-language consistency cases — all expected values (should match Rust)

#### File 5: `src/state/__tests__/ganttReducer.test.ts`

Audit date-related assertions:
- `RESIZE_TASK` — duration computation
- `CASCADE_DEPENDENTS` — cascaded start dates
- `CASCADE_DEPENDENTS on end-date/duration changes` — cascaded dates
- Any other test with date literals in assertions

### Phase 3: Produce summary

Create a summary at the end of your work:

```
=== DATE ASSERTION AUDIT SUMMARY ===
Total assertions verified: N
Correct: N
Wrong: N

WRONG ASSERTIONS (if any):
- file:line — assert_eq!(function(args), "expected") — should be "correct_value"
- ...

NOTES:
- Any patterns or observations about the test suite
```

### If You Find Errors

If any assertion is WRONG:
1. Fix it in the source file
2. Run the relevant test to confirm it passes with the new value
3. Include the fix in your commit

## Expected Date Computations

You must make at least **50** separate tool calls to verify date values. This is non-negotiable — the purpose of this task is exhaustive verification.

## Verification

After auditing (and fixing any errors), run:
```bash
cd crates/scheduler && cargo test
npm run test -- --run src/utils/__tests__/dateUtils.test.ts
npm run test -- --run src/state/__tests__/ganttReducer.test.ts
```

All tests must pass.

## Deliverables

- Audit summary (output in conversation)
- Any fixes to incorrect assertions (committed)
- All tests passing
