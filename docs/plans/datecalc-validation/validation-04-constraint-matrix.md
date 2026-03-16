# Validation 04: Constraint Type x Date Position Matrix

**Complexity**: LARGE (~40-50 date computations)

## Prerequisites

Read `CLAUDE.md` first for full project context, especially the Date Conventions section.

## Task Description

Write tests for all 6 constraint types (FNET, FNLT, SNET, SNLT, MFO, MSO) x 3 date
positions (constraint falls on Friday, Monday, mid-week Wednesday). That is 18 test cases
minimum, plus 6 more with FS dependencies + constraints to test interaction. Total: ~24 tests.

## Critical Rule

For ALL date computations, use the shell functions — NEVER do mental math. This is
especially important here because there are ~50 computations. Do NOT take shortcuts
on later tests just because earlier ones are similar.

```bash
# Compute end date from start + duration (inclusive)
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('START'), DURATION-1), 'yyyy-MM-dd'))"

# Compute start from end + duration (inverse)
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('END'), -(DURATION-1)), 'yyyy-MM-dd'))"

# Compute duration (inclusive)
node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('END'), d.parseISO('START')) + 1)"

# Check day of week
node -e "const d=require('date-fns'); console.log(d.format(d.parseISO('DATE'), 'EEEE'))"

# FS successor start
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('PRED_END'), 1 + LAG), 'yyyy-MM-dd'))"
```

## Read First

- `crates/scheduler/src/constraints.rs` — understand `recalculate_earliest`, constraint types
- `crates/scheduler/src/date_utils.rs` — understand `task_end_date`, `task_start_date`

## Reference: Constraint Type Behaviors

From `constraints.rs`:
- **SNET** (Start No Earlier Than): floor on start date. `new_start = max(dep_start, constraint_date)`
- **SNLT** (Start No Later Than): ceiling on start. Flags conflict if `new_start > constraint_date`
- **FNET** (Finish No Earlier Than): floor on end. Pushes start later if `computed_end < constraint_date`
- **FNLT** (Finish No Later Than): ceiling on end. Flags conflict if `computed_end > constraint_date`
- **MSO** (Must Start On): pins start to constraint_date. Conflict if deps push past it
- **MFO** (Must Finish On): pins end to constraint_date. Derives start via `task_start_date`

## Part 1: 18 Constraint x Position Tests

Add a new test module in `crates/scheduler/src/constraints.rs`:
```rust
#[cfg(test)]
mod constraint_matrix_tests { ... }
```

For each constraint type, write 3 tests with constraint dates on:
- **Friday** (e.g., 2026-04-10)
- **Monday** (e.g., 2026-04-13)
- **Wednesday** (e.g., 2026-04-15)

### SNET x 3 positions

For each position:
1. Create a task with start date, duration 5. Compute end date with tool.
2. Set SNET constraint date (Fri/Mon/Wed as specified).
3. Run `recalculate_earliest`. Compute expected new_start and new_end with tools.
4. Assert new_start and new_end.

### SNLT x 3 positions

For each position:
1. Create a task with an FS dependency that pushes start past the SNLT date.
2. Compute dep-driven start with tool.
3. Set SNLT constraint. Verify conflict is detected.
4. Assert new_start equals dep-driven (SNLT doesn't move the task, just flags).

### FNET x 3 positions

For each position:
1. Create a task whose computed end is before the FNET date.
2. Compute original end with tool.
3. Set FNET constraint. Compute expected pushed start using `task_start_date(constraint_date, duration)`.
4. Assert new_start and new_end.

### FNLT x 3 positions

For each position:
1. Create a task with an FS dep that pushes end past the FNLT date.
2. Compute dep-driven end with tool.
3. Set FNLT constraint. Verify conflict is detected.
4. Assert conflict message contains "FNLT".

### MSO x 3 positions

For each position:
1. Create a task with MSO constraint.
2. Run recalculate. Verify start is pinned to constraint date.
3. Compute end with tool.
4. Assert start and end.

### MFO x 3 positions

For each position:
1. Create a task with MFO constraint.
2. Compute derived start using `task_start_date(constraint_date, duration)` with tool.
3. Run recalculate. Verify start matches derived.
4. Compute end with tool.
5. Assert start and end.

## Part 2: 6 Dependency + Constraint Interaction Tests

Add 6 more tests combining FS dependencies with constraints:

1. **FS + SNET (SNET wins)**: Dep pushes to Mon, SNET = Wed. Assert start = Wed.
2. **FS + SNET (Dep wins)**: Dep pushes to Fri, SNET = Mon before. Assert start = Fri.
3. **FS + FNET**: Dep pushes to Mon (5d task, end = Fri). FNET = next Wed. Assert start pushed.
4. **FS + SNLT (conflict)**: Dep pushes past SNLT. Assert conflict detected.
5. **FS + MSO (conflict)**: Dep pushes past MSO date. Assert conflict and pinned start.
6. **FS + MFO (conflict)**: Dep pushes start past MFO-derived start. Assert conflict.

For each test, compute ALL dates (predecessor end, dep-driven start, constraint interaction)
with tools before writing assertions.

## Expected Date Computations

- 18 tests x 2-3 computations = 36-54
- 6 interaction tests x 2-3 computations = 12-18
- Total: ~48-72 date computations

This task is deliberately repetitive. You MUST sustain tool use across all 24 cases.
Do NOT switch to mental math for "obvious" cases.

## Files to Modify

- `crates/scheduler/src/constraints.rs` — add `constraint_matrix_tests` module

## Verification

```bash
cd crates/scheduler && cargo test constraint_matrix -- --nocapture
```

All 24 tests must pass. No existing tests may break.

## Deliverables

1. 24 new test functions in `constraints.rs`
2. All tests passing
3. Commit: `test: add 24 constraint matrix tests with tool-verified dates`
