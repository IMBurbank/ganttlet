# Validation 05: Audit All Date Assertions

**Complexity**: LARGE (~50+ date verifications)

## Prerequisites

Read `CLAUDE.md` first for full project context, especially the Date Conventions section.

## Task Description

Review every `assert_eq!` containing a date literal or duration value in the scheduler
test files. For EACH assertion, independently compute the expected value using a tool
and mark it as CORRECT or WRONG. Fix any wrong assertions.

## Critical Rule

For ALL date computations, use the shell functions — NEVER do mental math:

```bash
# Compute end date from start + duration (inclusive)
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('START'), DURATION-1), 'yyyy-MM-dd'))"

# Compute duration (inclusive)
node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('END'), d.parseISO('START')) + 1)"

# Compute business_day_delta (exclusive — NOT +1)
node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('TO'), d.parseISO('FROM')))"

# Compute FS successor start
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('PRED_END'), 1 + LAG), 'yyyy-MM-dd'))"

# Compute SS successor start
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('PRED_START'), LAG), 'yyyy-MM-dd'))"

# Compute FF successor start
node -e "const d=require('date-fns'); const rf=d.addBusinessDays(d.parseISO('PRED_END'), LAG); console.log(d.format(d.addBusinessDays(rf, -(SUCC_DUR-1)), 'yyyy-MM-dd'))"

# Compute SF successor start
node -e "const d=require('date-fns'); const rf=d.addBusinessDays(d.parseISO('PRED_START'), LAG); console.log(d.format(d.addBusinessDays(rf, -(SUCC_DUR-1)), 'yyyy-MM-dd'))"

# shift_date(date, n) — n business days forward/backward
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('DATE'), N), 'yyyy-MM-dd'))"

# Check day of week
node -e "const d=require('date-fns'); console.log(d.format(d.parseISO('DATE'), 'EEEE'))"

# task_start_date(end, duration) — inverse of task_end_date
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('END'), -(DURATION-1)), 'yyyy-MM-dd'))"
```

## Files to Audit

### Rust files

1. **`crates/scheduler/src/date_utils.rs`**
   - `convention_tests` module — audit all `assert_eq!` with date strings or durations
   - `tests` module — audit `shift_date`, `business_day_delta`, `day_of_week` assertions
   - `cross_language_tests` module — audit all `task_duration` and `task_end_date` assertions

2. **`crates/scheduler/src/cascade.rs`**
   - All test modules — audit cascade start/end date assertions
   - Pay special attention to `shift_date` calls used to compute expected values in comments

3. **`crates/scheduler/src/constraints.rs`**
   - All test modules — audit `compute_earliest_start` and `recalculate_earliest` assertions

### TypeScript files

4. **`src/utils/__tests__/dateUtils.test.ts`**
   - `taskDuration` tests
   - `taskEndDate` tests
   - `cross-language consistency` section (must match Rust exactly)

5. **`src/state/__tests__/ganttReducer.test.ts`**
   - Any assertions involving date strings or durations

## Audit Procedure

For EACH `assert_eq!` or `expect()` that contains a date string (like `"2026-03-09"`)
or a duration number:

1. Read the function call being tested
2. Identify the inputs
3. Run the corresponding tool computation
4. Compare tool result to assertion expected value
5. Record: `[file:line] function(inputs) = TOOL_RESULT — ASSERTION says EXPECTED — CORRECT/WRONG`

## Output Format

Create a summary in your commit message or as a comment block at the top of the test file:

```
Total assertions verified: N
Correct: N
Wrong: N (list each with file:line and correct value)
```

If any assertion is WRONG, fix it in the source file.

## Expected Computations

Rough counts by file:
- `date_utils.rs` convention_tests: ~15 assertions
- `date_utils.rs` tests: ~10 assertions
- `date_utils.rs` cross_language_tests: ~15 assertions
- `cascade.rs` tests: ~25 assertions
- `constraints.rs` tests: ~20 assertions
- `dateUtils.test.ts`: ~15 assertions
- `ganttReducer.test.ts`: variable

Total: 50+ individual date computations. Every single one MUST use a tool.

## Files to Modify

- Any file with incorrect assertions (likely none, but fix if found)
- No new files — this is a pure audit task

## Verification

```bash
cd crates/scheduler && cargo test
npm run test -- --run src/utils/__tests__/dateUtils.test.ts
npm run test -- --run src/state/__tests__/ganttReducer.test.ts
```

All tests must pass. If you fixed assertions, the previously-incorrect tests now pass
with corrected values.

## Deliverables

1. Audit summary: total assertions checked, correct count, wrong count
2. Any fixes applied
3. Commit: `test: audit all date assertions — N verified, M fixed` (with actual counts)
