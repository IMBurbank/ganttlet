# Date Calculation Bug Fixes — Plan (TENTATIVE)

> **Status:** TENTATIVE — under active discussion, not yet finalized.
> **Branch:** `agent/date-calc-fixes`
> **Created:** 2026-03-12

## Convention (Agreed)

**end_date is INCLUSIVE** — the last working day the task occupies.
**duration** = business days in `[start_date, end_date]`, counting both endpoints.
**No task starts or ends on a weekend.**

Example: Task start 2026-03-11 (Wed), end 2026-03-24 (Tue) → duration = 10.

Formula: `end = addBusinessDays(start, duration - 1)`.
Inverse: `duration = inclusiveBusinessDays(start, end)` (count both endpoints).

---

## Current Bugs

### Bug 1: `workingDaysBetween` uses exclusive end

**Files:** `src/utils/dateUtils.ts:144-155`

Counts `[start, end)` — exclusive of end date. Returns 9 for the example above instead of 10.
Used in: ganttReducer, sheetsMapper, schedulerWasm, TaskBar, TaskRow, TaskBarPopover, yjsBinding.

### Bug 2: End date computed as exclusive everywhere

Every place that derives end from start+duration uses `addBusinessDays(start, duration)`,
which gives the day *after* the last working day. Should be `addBusinessDays(start, duration - 1)`.

**Locations:**
- `src/state/ganttReducer.ts` — ADD_TASK, MOVE_TASK, RESIZE_TASK, UPDATE_TASK_FIELD
- `crates/scheduler/src/constraints.rs:291` — `recalculate_earliest`: `new_end = add_business_days(&new_start, task.duration)`
- `crates/scheduler/src/cpm.rs:80` — CPM forward pass: `ef = es + duration` (integer model)

### Bug 3: `cascade_dependents` FS allows overlap with inclusive end

**File:** `crates/scheduler/src/cascade.rs:92-103`

```rust
// Current (assumes exclusive end):
let raw = add_business_days(&pred_eff_end, dep_link.lag);
let required = next_biz_day_on_or_after(&raw);
```

With inclusive end, pred.end IS the last working day. Successor must start AFTER it.
Should be: `add_business_days(&pred_eff_end, 1 + dep_link.lag)` (or equivalent).

Same issue in SS (line 108), FF (line 120), SF (line 132) — all need +1 adjustment.

### Bug 4: `find_conflicts` FS uses exclusive convention

**File:** `crates/scheduler/src/lib.rs:160-162`

```rust
types::DepType::FS => {
    let raw = add_business_days(&pred.end_date, dep.lag);
    date_utils::next_biz_day_on_or_after(&raw)
}
```

Same problem as cascade — allows successor to start on predecessor's last day.

### Bug 5: CPM forward pass uses exclusive convention

**File:** `crates/scheduler/src/cpm.rs:118-123`

```rust
DepType::FS => cur_ef + edge.lag as i64,    // no +1 gap
DepType::FF => cur_ef + edge.lag as i64 - succ_dur,
DepType::SF => cur_es + edge.lag as i64 - succ_dur,
```

With inclusive end, `ef` represents the last occupied unit. FS successor should start at
`cur_ef + 1 + lag`, not `cur_ef + lag`. FF/SF need similar adjustment since `succ_dur`
is used to back up from an inclusive end.

### Bug 6: FNET and MFO constraint derivation off by one

**File:** `crates/scheduler/src/constraints.rs:238-283`

```rust
// FNET (line 244): derives start from constraint finish date
new_start = add_business_days(constraint_date, -(task.duration));
// Should be: -(task.duration - 1)

// MFO (line 275): same issue
let derived_start = add_business_days(constraint_date, -(task.duration));
// Should be: -(task.duration - 1)
```

With inclusive convention, backing up from an inclusive end by `duration - 1` business
days gives the correct start. Using `duration` overshoots by one day.

### Bug 7: Bar rendering doesn't include end-date column

**Files:** `src/components/gantt/TaskBar.tsx`, `GanttChart.tsx`

Bar width = `dateToX(endDate) - dateToX(startDate)`. With inclusive end dates, the bar
must also include the end date's column: width should be `+ columnWidth`.

### Bug 8: No systematic weekend enforcement

No validation prevents start/end dates from being weekends when:
- User edits dates inline in TaskRow
- Dates imported from Google Sheets
- `xToDate` converts pixel position to date during drag

---

## What's Already Correct

These functions were written for the inclusive convention and do NOT need changing:

| Function | File | Why correct |
|---|---|---|
| `compute_earliest_start` FS | `constraints.rs:20-24` | `add_biz(pred.end, 1) + lag` — correctly skips past inclusive end |
| FF/SF `-(duration - 1)` | `constraints.rs:32, 38` | Correctly backs up from inclusive finish |
| SNET constraint floor | `constraints.rs:55-68` | String comparison on dates, convention-independent |
| SNLT/FNLT conflict detection | `constraints.rs:226-258` | Compares computed dates, works with either convention |
| `next_biz_day_on_or_after` | `date_utils.rs:63-70` | Weekend snapping, convention-independent |

---

## Fix Plan (Phases)

### Phase 1: Convention + Core Utils

**Scope:** `src/utils/dateUtils.ts`, `crates/scheduler/src/date_utils.rs`, type definitions

1. Document convention in `src/types/index.ts` and `crates/scheduler/src/types.rs`
2. Fix `workingDaysBetween` → count `[start, end]` inclusive (change `<` to `<=`)
3. Add `endDateFromDuration(start, dur)` = `addBusinessDays(start, dur - 1)` helper (TS)
4. Add `end_from_duration(start, dur)` = `add_business_days(start, dur - 1)` helper (Rust)
5. Add `snapToBusinessDay(date, direction)` for weekend enforcement (TS + Rust)
6. Update dateUtils tests

### Phase 2: Rust Scheduler

**Scope:** `crates/scheduler/src/` — cascade.rs, constraints.rs, cpm.rs, lib.rs

1. Fix `cascade_dependents` FS/SS/FF/SF: adjust for inclusive pred.end
2. Fix `recalculate_earliest`: `new_end = add_business_days(start, duration - 1)`
3. Fix FNET: `-(duration - 1)`
4. Fix MFO: `-(duration - 1)`
5. Fix `find_conflicts` FS/SS: match cascade fix
6. Fix CPM: `ef = es + duration - 1`, adjust backward pass
7. Update all test data to use inclusive end dates, fix expected values

### Phase 3: TypeScript State + Reducer

**Scope:** `src/state/ganttReducer.ts`, `src/utils/schedulerWasm.ts`

1. Fix ADD_TASK: `end = addBusinessDays(today, duration - 1)`
2. Fix MOVE_TASK / RESIZE_TASK: inclusive duration recalculation
3. Fix UPDATE_TASK_FIELD: `end = addBusinessDays(newStart, duration - 1)`
4. Fix schedulerWasm cascade result merging: inclusive duration
5. Weekend guard on all date mutations

### Phase 4: Rendering + UI

**Scope:** `src/components/gantt/TaskBar.tsx`, `GanttChart.tsx`, `TaskRow.tsx`, `TaskBarPopover.tsx`

1. Fix bar width: `+ columnWidth` to include end-date column
2. Fix drag: snap to business days
3. Fix resize: snap end to business day
4. Fix inline date editing: validate no weekends
5. Verify collapsed-weekend mode still works

### Phase 5: Sheets + CRDT Sync

**Scope:** `src/sheets/sheetsMapper.ts`, `src/collab/yjsBinding.ts`

1. Fix sheetsMapper: inclusive duration on import/export
2. Fix yjsBinding: inclusive duration from Yjs maps
3. Weekend validation on Sheets import

### Phase 6: Cross-cutting Tests

1. Consistency tests: cascade and recalculate produce identical results
2. Roundtrip tests: edit → cascade → recalculate → no drift
3. Weekend boundary tests
4. E2E: bar width matches duration, no weekend start/end

---

## Risk Notes

- Phase 1+2 are tightly coupled — Rust convention change must match TS convention change
- Phase 5 (Sheets) is highest risk — convention mismatch could corrupt user data
- CPM integer model change (Phase 2) affects critical path + float calculations
- All existing test assertions will need updating — most encode the old exclusive convention
- `workingDaysBetween` change affects 7+ callsites — must update all atomically

---

## Affected Files (Exhaustive)

### Must change:
- `src/utils/dateUtils.ts` — workingDaysBetween, add helpers
- `src/utils/__tests__/dateUtils.test.ts` — update all duration assertions
- `src/state/ganttReducer.ts` — ADD_TASK, MOVE_TASK, RESIZE_TASK, UPDATE_TASK_FIELD
- `src/state/__tests__/ganttReducer.test.ts`
- `src/utils/schedulerWasm.ts` — cascade result duration
- `src/sheets/sheetsMapper.ts` — rowsToTasks, taskToRow duration
- `src/sheets/__tests__/sheetsMapper.test.ts`
- `src/collab/yjsBinding.ts` — yMapToTask duration
- `src/components/gantt/TaskBar.tsx` — bar width, drag handlers
- `src/components/gantt/GanttChart.tsx` — bar width
- `src/components/table/TaskRow.tsx` — inline edit handlers
- `src/components/gantt/TaskBarPopover.tsx` — quick edit
- `src/types/index.ts` — document convention
- `crates/scheduler/src/types.rs` — document convention
- `crates/scheduler/src/date_utils.rs` — add helpers
- `crates/scheduler/src/cascade.rs` — FS/SS/FF/SF adjustment
- `crates/scheduler/src/constraints.rs` — recalculate_earliest end, FNET, MFO
- `crates/scheduler/src/cpm.rs` — EF formula, backward pass
- `crates/scheduler/src/lib.rs` — find_conflicts FS/SS

### May need change (verify):
- `src/utils/dependencyUtils.ts` — arrow endpoint pixel calc
- `src/components/gantt/DependencyLayer.tsx` — arrow rendering
- `src/components/gantt/SlackIndicator.tsx` — slack bar width
- `src/components/gantt/SummaryBar.tsx` — summary bar width
- `src/components/gantt/MilestoneMarker.tsx` — milestone position
- `src/data/fakeData.ts` — seed data end dates
- `e2e/*.spec.ts` — E2E assertions
