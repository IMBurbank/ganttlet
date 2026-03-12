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

### Bug 5: Conflict message says one date, recalculate pushes to another

**User-reported:** Constraint violation indicator says "dependency requires no earlier
than 3/26" but clicking to fix pushes the task to 3/27.

This is Bugs 3+4 manifesting together:
- `find_conflicts` (lib.rs:160-162) computes the required date using the EXCLUSIVE FS
  formula → says 3/26
- `compute_earliest_start` (constraints.rs:22-23) resolves it using the INCLUSIVE FS
  formula → pushes to 3/27

The error message and the fix use different formulas. The task overshoots by 1 business
day every time.

**Fix:** Both must call the same `fs_successor_start` helper (see date-conventions.md).

### Bug 6: CPM forward pass uses exclusive convention

**File:** `crates/scheduler/src/cpm.rs:118-123`

```rust
DepType::FS => cur_ef + edge.lag as i64,    // no +1 gap
DepType::FF => cur_ef + edge.lag as i64 - succ_dur,
DepType::SF => cur_es + edge.lag as i64 - succ_dur,
```

With inclusive end, `ef` represents the last occupied unit. FS successor should start at
`cur_ef + 1 + lag`, not `cur_ef + lag`. FF/SF need similar adjustment since `succ_dur`
is used to back up from an inclusive end.

### Bug 7: FNET and MFO constraint derivation off by one

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

### Bug 8: Bar rendering doesn't include end-date column

**Files:** `src/components/gantt/TaskBar.tsx`, `GanttChart.tsx`

Bar width = `dateToX(endDate) - dateToX(startDate)`. With inclusive end dates, the bar
must also include the end date's column: width should be `+ columnWidth`.

### Bug 9: No systematic weekend enforcement

Weekends don't count against duration (already correct — business day counting).
But the system doesn't prevent tasks from having weekend start/end dates.

**Two enforcement modes depending on source:**

**A. UI prevention (Gantt chart + left pane table):**
The UI must make it impossible to set a weekend start or end date. This means:
- **Drag (TaskBar move):** `xToDateCollapsed` and `xToDate` can return weekend dates.
  Must snap to nearest business day during drag, not after.
- **Resize (TaskBar resize):** Same — end date must snap to business day during resize.
- **Inline date edit (TaskRow):** Date input should reject weekends. Either use a date
  picker that disables weekends, or validate on change and revert/snap.
- **Popover edit (TaskBarPopover):** Same as inline edit.
- **ADD_TASK:** `new Date()` on a weekend must snap forward to Monday.

**B. Sheets import → constraint violation warning (NOT silent fix):**
When a task is imported from Google Sheets with a weekend start or end date, do NOT
silently snap the date. Instead, surface it as a constraint violation warning using the
same pattern as existing warnings (SNLT, FNLT, MSO, MFO conflicts):
- Add a new conflict type: `WEEKEND_VIOLATION`
- Message: "Task X starts/ends on a weekend (Sat 2026-03-14)"
- The red conflict indicator appears on the task bar, same as other violations
- User must fix it in the sheet or manually in the UI

This matches the existing constraint violation UX — the system warns, the user decides.

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
6. Add `WEEKEND_VIOLATION` conflict type to `find_conflicts` — detect tasks with
   weekend start or end dates and surface as conflict (same pattern as SNLT/FNLT/MSO/MFO)
7. Fix CPM: `ef = es + duration - 1`, adjust backward pass
8. Update all test data to use inclusive end dates, fix expected values

### Phase 3: TypeScript State + Reducer

**Scope:** `src/state/ganttReducer.ts`, `src/utils/schedulerWasm.ts`

1. Fix ADD_TASK: `end = addBusinessDays(today, duration - 1)`. If today is a weekend,
   snap start forward to Monday before computing end.
2. Fix MOVE_TASK / RESIZE_TASK: inclusive duration recalculation
3. Fix UPDATE_TASK_FIELD: `end = addBusinessDays(newStart, duration - 1)`
4. Fix schedulerWasm cascade result merging: inclusive duration
5. No weekend guard needed here — UI layer prevents weekend dates (Phase 4)

### Phase 4: Rendering + UI (weekend prevention)

**Scope:** `src/components/gantt/TaskBar.tsx`, `GanttChart.tsx`, `TaskRow.tsx`, `TaskBarPopover.tsx`

The UI must make it **impossible** to set a weekend start or end date. Prevent, don't fix after.

1. Fix bar width: `+ columnWidth` to include end-date column
2. Fix drag move (TaskBar): `xToDate`/`xToDateCollapsed` results must snap to nearest
   business day during the drag — the ghost bar should never sit on a weekend column.
   In non-collapsed mode, snap forward for start, backward for end. In collapsed mode,
   weekends aren't visible so this is automatic.
3. Fix drag resize (TaskBar): end date snaps to previous business day if it would land
   on weekend. Minimum 1-day duration enforced.
4. Fix inline date edit (TaskRow): reject weekend dates on change. If user types a
   Saturday, show validation error / revert to previous value. Don't silently snap.
5. Fix popover date edit (TaskBarPopover): same as inline edit.
6. Verify collapsed-weekend mode still works with inclusive bar width.

### Phase 5: Sheets + CRDT Sync (weekend warning)

**Scope:** `src/sheets/sheetsMapper.ts`, `src/collab/yjsBinding.ts`, `src/types/index.ts`

Weekend dates from Sheets are NOT silently fixed. They are surfaced as warnings.

1. Fix sheetsMapper: inclusive duration on import/export
2. Fix yjsBinding: inclusive duration from Yjs maps
3. Add `WEEKEND_VIOLATION` to ConflictResult types (TS side, matching Rust)
4. `find_conflicts` (already updated in Phase 2) detects weekend start/end dates
   and returns `WEEKEND_VIOLATION` conflicts. The existing conflict indicator UI
   (red dashed border + message on click) handles display — no new UI component needed.
5. Sheets import does NOT snap or reject weekend dates. The task is imported as-is,
   and `detectConflicts()` (called on every render in GanttChart.tsx) shows the warning.
   User fixes it via the UI or in the sheet.

### Phase 6: Cross-cutting Tests

1. Consistency tests: cascade and recalculate produce identical results
2. Roundtrip tests: edit → cascade → recalculate → no drift
3. Weekend enforcement tests:
   - Drag to weekend column → snaps to business day
   - Resize to weekend → snaps to previous business day
   - Inline edit weekend date → rejected
   - Sheets import with weekend date → WEEKEND_VIOLATION conflict shown
   - ADD_TASK on weekend → start snaps to Monday
4. E2E: bar width matches duration, no weekend start/end in UI-created tasks

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

---

## Documentation & Agent Infrastructure Updates

These files guide agent behavior. If they reference old function names, old conventions,
or wrong semantics, agents will reintroduce the bugs we're fixing.

### Must update (actively misleads agents):

**`src/types/index.ts:15`** — Task.duration doc comment
```typescript
// CURRENT (wrong):
/** Number of business days (Mon-Fri) from startDate to endDate, inclusive of start, exclusive of end. Always derived — never edit directly. */
// FIXED:
/** Business days in [startDate, endDate] inclusive of both. Always derived via taskDuration() — never edit directly. */
```

**`crates/scheduler/src/types.rs`** — Task struct
- Add doc comment on `start_date`, `end_date`, `duration` establishing the inclusive
  convention. Currently undocumented.

**`crates/scheduler/CLAUDE.md:6`** — Scheduler constraints
```
// CURRENT:
- All lag values in business days — always use `add_business_days()`
// ADD:
- end_date is INCLUSIVE — the last working day the task occupies
- duration = business days in [start_date, end_date] counting both endpoints
- Derive end from duration: `task_end_date(start, dur)` (NOT `add_business_days(start, dur)`)
- Derive duration from dates: `task_duration(start, end)` (NOT manual counting)
- FS successor start: use `fs_successor_start()` helper (NOT raw `add_business_days`)
```

**`.claude/skills/scheduling-engine/SKILL.md`** — Scheduling engine guide
- Line 26: "Cascade: Propagate date delta to FS successors only" — add note that cascade
  now uses shared `fs_successor_start` helper for all dep types
- Add to Known Gotchas:
  - end_date is inclusive — `task_end_date()` and `task_duration()` encode this
  - Never use raw `add_business_days(start, duration)` to derive end dates
  - Never write FS/SS/FF/SF earliest-start logic inline — use the shared helpers
- Add to Lessons Learned:
  - Off-by-one root cause: three functions computed FS earliest start with different
    formulas (cascade used exclusive, constraints used inclusive, find_conflicts used
    exclusive). Unified into shared `fs_successor_start` helper.

**`.claude/agents/rust-scheduler.md`** — Rust scheduler subagent prompt
- Line 24: `date_utils.rs` description lists `add_business_days()`, `is_weekend()`,
  `parse_date()`/`format_date()` — add `task_duration()`, `task_end_date()`,
  `ensure_business_day()`, `fs_successor_start()`/etc.
- Line 35: MFO description says "derives start from constraint_date - duration" — fix to
  "derives start from constraint_date via `task_end_date` inverse"
- Line 41: "All lag values are in business days — always use `add_business_days()`" — add
  "For end-date derivation use `task_end_date()`, not raw `add_business_days()`"
- Add to Critical rules:
  - end_date is inclusive. Duration convention encoded in `task_duration()`/`task_end_date()`.
  - FS/SS/FF/SF successor start must use shared helpers, never raw arithmetic.

**`CLAUDE.md:43-44`** — Root project instructions
```
// CURRENT:
- **In code**: prefer `date-fns` directly ... project helpers in `src/utils/dateUtils.ts`
  and `crates/scheduler/src/date_utils.rs` exist but are thin wrappers; use the standard
  library when writing new code to minimize bug surface
// FIXED — add exception for convention-encoding functions:
- **In code**: prefer `date-fns` directly for generic date operations. EXCEPTION: always
  use `taskDuration()`/`taskEndDate()` for duration and end-date derivation — these encode
  the inclusive convention and must not be replaced with raw `addBusinessDays` arithmetic.
```

**`docs/unplanned-issues.md:29`** — Duration mode toggle feature
```
// CURRENT:
Currently `duration` is always derived via `workingDaysBetween()` (business days, Mon-Fri)
// FIXED:
Currently `duration` is always derived via `taskDuration()` (business days, Mon-Fri, inclusive of start and end)
```

### Should update (stale references, low risk but confusing):

**`.claude/skills/google-sheets-sync/SKILL.md:33`** — Column layout table
- Column 4 (`duration`): add note that duration is inclusive business day count
- No function name references to update (doesn't mention `workingDaysBetween`)

**`.claude/skills/e2e-testing/SKILL.md:47`** — Lessons learned
- Line 47: "Date-dependent tests can flake near midnight or weekend boundaries" — still
  valid, no change needed
- Consider adding: "Tasks must never have start or end dates on weekends. E2E tests
  should verify this invariant."

**`.claude/agents/codebase-explorer.md`** — No date-specific content. OK as-is.

**`.claude/agents/verify-and-diagnose.md`** — No date-specific content. OK as-is.

**`docs/completed-phases.md:182`** — Historical reference
- Line 182: "Made `duration` always derived from `daysBetween(startDate, endDate)`"
- This is historical record, but it's wrong (was actually `workingDaysBetween` at that
  point, not `daysBetween`). Add a note: "Note: duration derivation updated in Phase 16
  to use `taskDuration()` with inclusive [start, end] semantics."

### No change needed:

- `.claude/agents/plan-reviewer.md` — no date content
- `.claude/skills/cloud-deployment/SKILL.md` — no date content
- `.claude/skills/rust-wasm/SKILL.md` — no date content
- `.claude/skills/shell-scripting/SKILL.md` — no date content
- `.claude/skills/multi-agent-orchestration/SKILL.md` — no date content
- `.claude/skills/issue-workflow/SKILL.md` — no date content
- `.claude/worktrees/CLAUDE.md` — no date content
- `src/CLAUDE.md` — says "prefer date-fns directly", no function names to update
- Phase prompt files — excluded per user instruction
