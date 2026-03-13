# Date Calculation Bug Fixes — Plan (TENTATIVE)

> **Status:** TENTATIVE — under active discussion, not yet finalized.
> **Branch:** `agent/date-calc-fixes`
> **Created:** 2026-03-12
> **Last verified:** 2026-03-13 (deep review with 4 parallel subagents + item-by-item verification)

## Convention (Agreed)

**end_date is INCLUSIVE** — the last working day the task occupies.
**duration** = business days in `[start_date, end_date]`, counting both endpoints.
**No task starts or ends on a weekend.**

Example: Task start 2026-03-11 (Wed), end 2026-03-24 (Tue) → duration = 10.
(Verified: `differenceInBusinessDays(3/24, 3/11) + 1 = 9 + 1 = 10`.)

Formula: `end = addBusinessDays(start, duration - 1)`.
Inverse: `duration = taskDuration(start, end)` (count both endpoints).

---

## Current Bugs

### Bug 1: Duration calculation uses exclusive end

**File:** `src/utils/dateUtils.ts:144-155`

`workingDaysBetween(start, end)` counts `[start, end)` — exclusive of end date.
Returns 9 for the example above instead of 10.

**14 callsites** (all must migrate to `taskDuration`):
- `ganttReducer.ts:33` (MOVE_TASK), `:43` (RESIZE_TASK), `:59` (UPDATE_TASK_FIELD),
  `:283` (ADD_TASK), `:546` (COMPLETE_DRAG)
- `schedulerWasm.ts:168` (cascade result)
- `sheetsMapper.ts:20` (taskToRow), `:51` (rowToTask)
- `yjsBinding.ts:175` (RESIZE), `:282` (COMPLETE_DRAG), `:296` (CASCADE_DEPENDENTS)
- `TaskRow.tsx:90` (end date edit), `TaskBarPopover.tsx:87` (end date edit)
- `TaskBar.tsx:131` (resize drag)

**Fix:** Add `taskDuration(start, end)` counting `[start, end]` inclusive. Migrate all
callsites. Delete `workingDaysBetween` when no callers remain.

**Note:** `businessDaysBetween(start: Date, end: Date)` (dateUtils.ts:129) is the same
algorithm but takes Date objects. It is used ONLY for pixel mapping in collapsed-weekend
mode (`dateToXCollapsed`). It stays as-is — pixel mapping doesn't need inclusive counting.
Add a doc comment clarifying this is NOT for duration calculation.

### Bug 2: End date computed as exclusive everywhere

Every place that derives end from start+duration uses `addBusinessDays(start, duration)`,
which gives the day *after* the last working day. Should be `addBusinessDays(start, duration - 1)`.

**Locations:**
- `src/state/ganttReducer.ts` — ADD_TASK (line 273-276, uses raw calendar addDays then
  derives duration), MOVE_TASK, RESIZE_TASK, UPDATE_TASK_FIELD
- `src/components/table/TaskRow.tsx:77` — start date change: `addBusinessDaysToDate(value, task.duration)`
- `src/components/table/TaskRow.tsx:111` — duration change: `addBusinessDaysToDate(task.startDate, newDuration)`
- `src/components/gantt/TaskBarPopover.tsx:73` — start date change: `addBusinessDaysToDate(value, task!.duration)`
- `crates/scheduler/src/constraints.rs:291` — `recalculate_earliest`: `new_end = add_business_days(&new_start, task.duration)`
- `crates/scheduler/src/cpm.rs:80,127` — CPM: `ef = es + duration` (integer model — see Bug 6 analysis)

**Fix:** All locations use `taskEndDate(start, dur)` / `task_end_date(start, dur)` which
encodes the `- 1`.

### Bug 3: `cascade_dependents` FS allows overlap with inclusive end

**File:** `crates/scheduler/src/cascade.rs:92-103`

```rust
// Current (assumes exclusive end):
let raw = add_business_days(&pred_eff_end, dep_link.lag);
let required = next_biz_day_on_or_after(&raw);
```

With inclusive end, pred.end IS the last working day. FS means successor must start AFTER
predecessor finishes, so successor start = pred.end + 1 + lag business days.
Current formula with lag=0 gives `required = pred.end` (same-day start) — allows overlap.

**Fix:** `add_business_days(&pred_eff_end, 1 + dep_link.lag)` (no `next_biz_day_on_or_after`
needed when all dates are guaranteed business days).

**SS, FF, SF are correct as-is for inclusive convention:**
- SS (line 105-115): `add_biz(pred.start, lag)` — start-to-start, same-day OK. Correct.
- FF (line 117-127): `add_biz(pred.end, lag)` — finish-to-finish, same-end OK. Correct.
- SF (line 129-140): `add_biz(pred.start, lag)` — start-to-finish. Correct.

The `next_biz_day_on_or_after` calls in SS/FF/SF become no-ops once all dates are
guaranteed business days (Bug 9 fix). They can be removed for clarity but are not wrong.

### Bug 4: `find_conflicts` FS uses exclusive convention

**File:** `crates/scheduler/src/lib.rs:160-163`

```rust
types::DepType::FS => {
    let raw = add_business_days(&pred.end_date, dep.lag);
    date_utils::next_biz_day_on_or_after(&raw)
}
```

Same as Bug 3 — allows successor to start on predecessor's last day. Must be
`add_business_days(&pred.end_date, 1 + dep.lag)`.

### Bug 5: Conflict message says one date, recalculate pushes to another

**User-reported:** Constraint violation indicator says "dependency requires no earlier
than 3/26" but clicking to fix pushes the task to 3/27.

This is Bugs 3+4 manifesting together:
- `find_conflicts` (lib.rs:160-163) computes the required date using the EXCLUSIVE FS
  formula → says 3/26
- `compute_earliest_start` (constraints.rs:22-23) resolves it using the INCLUSIVE FS
  formula → pushes to 3/27

The error message and the fix use different formulas. The task overshoots by 1 business
day every time.

**Fix:** Both must use `add_business_days(pred.end, 1 + lag)`. Extract as shared
`fs_successor_start` helper (see date-conventions.md).

### Bug 6: CPM uses exclusive integer model

**File:** `crates/scheduler/src/cpm.rs:80,119-122,127`

```rust
// Forward init (line 80): ef = duration (es=0, so ef = es + duration)
// Forward FS (line 119): new_es = cur_ef + lag     // no +1 gap
// Forward FF (line 121): new_es = cur_ef + lag - succ_dur
// Forward SF (line 122): new_es = cur_es + lag - succ_dur
// Forward update (line 127): ef = new_es + succ_dur
```

**Analysis: CPM does NOT need changing.** CPM operates in abstract integer units, never
converts to calendar dates. Float = `ls - es` is convention-independent — verified
arithmetically that exclusive and inclusive models produce identical float and critical
path results for all dependency types.

CPM's `ef = es + duration` is the standard textbook formula. Changing it would add risk
and make the code non-standard with zero functional benefit.

**Fix:** Keep CPM as-is. Add a doc comment:
```rust
// CPM uses the standard exclusive integer model internally (ef = es + duration).
// This is intentional — CPM never converts to calendar dates. Float and critical
// path results are convention-independent. Do NOT change this to match the
// inclusive calendar convention.
```

### Bug 7: FNET, FNLT, and MFO end-date formulas need convention update

**File:** `crates/scheduler/src/constraints.rs:238-283`

Three locations compute `computed_end` using the exclusive formula, and two locations
derive start from a constraint finish date:

```rust
// FNET (line 241): end computation for comparison
let computed_end = add_business_days(&new_start, task.duration);  // → task_end_date
// FNET (line 244): derives start from constraint finish date
new_start = add_business_days(constraint_date, -(task.duration));  // → -(task.duration - 1)

// FNLT (line 251): end computation for comparison — same issue
let computed_end = add_business_days(&new_start, task.duration);  // → task_end_date

// MFO (line 275): derives start from constraint finish date — same as FNET
let derived_start = add_business_days(constraint_date, -(task.duration));  // → -(task.duration - 1)
```

**Note:** All five lines are **correct under the existing exclusive convention** —
verified: `add_biz(3/6, -5)` gives 2/27, then `add_biz(2/27, 5)` gives 3/6 = constraint ✓.
The changes are needed because the inclusive convention uses a different `duration` value
(+1 larger) and different end-date formula (`dur - 1`).

With inclusive convention, `constraint_date` is the required finish date (last working
day). End must be computed via `task_end_date(start, dur)` = `add_biz(start, dur - 1)`.
Backing up from constraint to start uses `-(duration - 1)` instead of `-(duration)`.
(Verified with inclusive dur=5: `-(5)` gives Fri 2/27, end = `add_biz(2/27, 4)` = Thu 3/5 ≠ 3/6.
`-(4)` gives Mon 3/2, end = `add_biz(3/2, 4)` = Fri 3/6 = constraint ✓.)

### Bug 8: Bar rendering doesn't include end-date column

**Files:** `src/components/gantt/GanttChart.tsx:137-139,171-173`

```typescript
const taskWidth = Math.max(endX - x, 0);
```

Bar width = `dateToXCollapsed(endDate) - dateToXCollapsed(startDate)`. With inclusive end
dates, the bar must also include the end date's column: width should be `+ colWidth`.

### Bug 9: No systematic weekend enforcement

Weekends don't count against duration (already correct — business day counting).
But the system doesn't prevent tasks from having weekend start/end dates.

**Two enforcement modes depending on source:**

**A. UI prevention (Gantt chart + left pane table):**
The UI must make it impossible to set a weekend start or end date. This means:
- **Drag (TaskBar move):** `xToDateCollapsed` and `xToDate` can return weekend dates.
  Must snap to nearest business day during drag, not after.
- **Resize (TaskBar resize):** Same — end date must snap to business day during resize.
- **Inline date edit (TaskRow):** Date input should reject weekends. `validateEndDate`
  (`taskFieldValidation.ts:24-28`) only checks ordering — must add weekend check.
  Similarly validate start dates.
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

### ~~Bug 10~~ (Not a bug)

`RECALCULATE_EARLIEST` reducer (ganttReducer.ts:605) doesn't recompute duration — but
this is correct. Rust `recalculate_earliest` always derives `new_end` from
`add_business_days(new_start, task.duration)` (constraints.rs:291), preserving duration.
Start and end always shift together. No constraint independently pins end to a different
value. The TS reducer correctly leaves `duration` unchanged.

### Bug 11: `find_conflicts` skips FF/SF dependency violations entirely

**File:** `crates/scheduler/src/lib.rs:168`

```rust
_ => continue, // FF and SF constrain end, skip for start check
```

No conflict detection for finish-constrained dependency types. If an FF or SF dependency
is violated, no warning is shown to the user. This means:
- An FF dep where successor finishes before predecessor → no conflict reported
- An SF dep where successor finishes before predecessor starts → no conflict reported

**Fix:** Add FF/SF conflict detection. FF checks `task.end_date < required_end`, SF same.

### Bug 12: `dateToX`/`xToDate` naming invites wrong usage

**File:** `src/components/gantt/TodayLine.tsx:3,15` (symptom)
**Root cause:** `src/utils/dateUtils.ts:84-94,157-181` (API design)

TodayLine uses `dateToX` (no collapse awareness) instead of `dateToXCollapsed`. But the
real problem is the naming: `dateToXCollapsed` is the correct default that handles both
modes internally (delegates to `dateToX` when weekends are expanded). Every component
except TodayLine already uses the `Collapsed` variant — the "simple" name is the wrong one.

**Fix:** Rename to make the weekend-aware version the default:

| Current (wrong default) | New (correct default) |
|---|---|
| `dateToX(str, start, w, zoom)` | `dateToXCalendar(str, start, w, zoom)` — internal, includes weekends |
| `xToDate(x, start, w, zoom)` | `xToDateCalendar(x, start, w, zoom)` — internal, includes weekends |
| `dateToXCollapsed(str, start, w, zoom, collapse)` | `dateToX(str, start, w, zoom, collapse)` — the one to use |
| `xToDateCollapsed(x, start, w, zoom, collapse)` | `xToDate(x, start, w, zoom, collapse)` — the one to use |

After rename:
- Every existing `dateToXCollapsed` call becomes `dateToX` (shorter, obviously correct)
- TodayLine calls `dateToX(todayStr, ..., collapseWeekends)` — fixed automatically
- `dateToXCalendar` is private/internal — used only inside `dateToX` as fallback
- No component can accidentally skip weekend handling — the simple name does it right
- `xToDate` always returns a valid date for the current collapse mode — drag handlers
  that need weekend snapping get it from the right function

### Bug 13: `recalcSummaryDates` doesn't recompute summary duration

**File:** `src/utils/summaryUtils.ts:28-31`

```typescript
task.startDate = minStart;
task.endDate = maxEnd;
task.done = allDone;
```

Sets min start and max end from children but never updates `duration`. Summary tasks
retain stale duration values after children move.

**Fix:** `task.duration = taskDuration(minStart, maxEnd)` after setting dates.

### Bug 14: Yjs binding `UPDATE_TASK_FIELD` doesn't recompute duration

**File:** `src/collab/yjsBinding.ts:185-198`

```typescript
case 'UPDATE_TASK_FIELD': {
  // ...
  ymap.set(action.field, action.value);  // ← Writes field, no duration recompute!
}
```

When a user edits start or end date via `TaskRow` inline edit, the component dispatches
`UPDATE_TASK_FIELD`. The reducer correctly recomputes duration (ganttReducer.ts:59), but
the Yjs binding writes only the single field to the Yjs map — it never updates `duration`.

**Path to bug:**
1. User A edits endDate in TaskRow → dispatches `UPDATE_TASK_FIELD(endDate)`
2. Reducer updates duration locally ✓
3. yjsBinding writes `ymap.set('endDate', newValue)` — duration NOT written to Yjs
4. Remote User B receives the Yjs update → `SET_TASKS` fires with stale duration from Yjs
5. User B sees wrong duration until next full sync

**Fix:** In yjsBinding `UPDATE_TASK_FIELD`, when field is `startDate` or `endDate`,
also write the recomputed duration to the Yjs map:
```typescript
if (action.field === 'startDate' || action.field === 'endDate') {
  const start = (action.field === 'startDate' ? action.value : ymap.get('startDate')) as string;
  const end = (action.field === 'endDate' ? action.value : ymap.get('endDate')) as string;
  ymap.set('duration', taskDuration(start, end));
}
```

### Bug 15: No validation at WASM boundary

**Files:** `src/utils/schedulerWasm.ts:24-43`, `crates/scheduler/src/lib.rs`

Dates cross from TypeScript to Rust as raw strings with no validation. If a bug upstream
(reducer, Yjs, Sheets import) produces an invalid date, weekend date, or end < start,
Rust code receives it silently and may compute wrong results.

Similarly, WASM results flow back to TS without validation — invalid dates from Rust
are accepted blindly.

**Fix:** Add debug-mode invariant assertions at the WASM boundary (see Architectural
Prevention § Debug Invariant Assertions).

---

## What's Already Correct

These functions use the inclusive convention and do NOT need changing:

| Function | File | Why correct |
|---|---|---|
| `compute_earliest_start` FS | `constraints.rs:20-24` | `add_biz(pred.end, 1) + lag` — correctly skips past inclusive end |
| `compute_earliest_start` SS | `constraints.rs:25-28` | `add_biz(pred.start, lag)` — SS is start-to-start, no +1 gap needed |
| FF `-(duration - 1)` | `constraints.rs:29-33` | Correct for inclusive convention* |
| SF `-(duration - 1)` | `constraints.rs:34-39` | Same as FF* |
| `cascade_dependents` SS | `cascade.rs:105-115` | Same-day start correct for SS |
| `cascade_dependents` FF | `cascade.rs:117-127` | Same-end correct for FF |
| `cascade_dependents` SF | `cascade.rs:129-140` | Correct for SF |
| SNET constraint floor | `constraints.rs:55-68` | String comparison on start date, convention-independent |
| SNLT conflict detection | `constraints.rs:226-237` | Compares start date only, convention-independent |
| `next_biz_day_on_or_after` | `date_utils.rs:63-70` | Weekend snapping, convention-independent |
| `add_business_days` | `date_utils.rs:47-59` | Shifts by N biz days, convention-independent |
| CPM (entire module) | `cpm.rs` | Abstract integer model, convention-independent float/critical path |
| `businessDaysBetween` (Date) | `dateUtils.ts:129-137` | Pixel mapping only, exclusive is correct for column counting |

**\*FF/SF `-(duration - 1)` note:** These formulas are correct for the **target inclusive
convention** — no code change needed. However, they are currently **wrong under the existing
exclusive convention** (`addBiz(finish, -(dur-1))` gives a start 1 biz day too late because
exclusive `duration` is 1 less than inclusive). They will automatically become correct when
`task.duration` switches to inclusive counting in Phase 3. During implementation, if an agent
sees FF/SF tests failing before Phase 3 lands, this is expected — the formulas are correct
for the target state, not the intermediate state.

---

## Fix Plan (Phases)

### Phase 0: Documentation Foundation (FIRST — before any code changes)

**Scope:** CLAUDE.md files, skills, agent prompts

Why first: implementing agents must know the convention BEFORE touching code. Without
this, Phase 1-5 agents will read `src/types/index.ts:15` ("exclusive of end") and
encode the wrong convention.

1. Add `## Date Conventions (Non-Negotiable)` section to root `CLAUDE.md` (see Phase 7b content)
2. Update `src/types/index.ts:15` — change duration doc comment to inclusive
3. Add convention doc comments to `crates/scheduler/src/types.rs` Task struct
4. Update `crates/scheduler/CLAUDE.md` — add end_date convention rules
5. Update `src/CLAUDE.md` — add convention exception for `taskDuration`/`taskEndDate`
6. Update `.claude/skills/scheduling-engine/SKILL.md` — add convention notes
7. Update `.claude/agents/rust-scheduler.md` — add new helper function names

These are pure documentation changes — no functional code changes, no test updates.
Commit separately so the convention is visible in git history before the fix lands.

### Phase 1: Convention-Encoding Functions

**Scope:** `src/utils/dateUtils.ts`, `crates/scheduler/src/date_utils.rs`

Add new functions that encode the inclusive convention. No callers are changed yet —
these are purely additive.

**TypeScript (`src/utils/dateUtils.ts`):**
1. `taskDuration(start: string, end: string): number` — counts `[start, end]` inclusive
2. `taskEndDate(start: string, duration: number): string` — `addBusinessDays(start, duration - 1)`
3. `ensureBusinessDay(date: Date): Date` — snaps forward to next Monday if weekend,
   no-op if already a weekday
4. `prevBusinessDay(date: Date): Date` — snaps backward to previous Friday if weekend,
   no-op if already a weekday
5. `isWeekendDate(dateStr: string): boolean` — convenience for validation

**Rust (`crates/scheduler/src/date_utils.rs`):**
6. `task_duration(start: &str, end: &str) -> i32` — inclusive business day count
7. `task_end_date(start: &str, duration: i32) -> String` — `add_business_days(start, duration - 1)`
8. `ensure_business_day(date: &str) -> String` — rename of `next_biz_day_on_or_after`
   (keep old name as alias during migration)
9. `prev_business_day(date: &str) -> String` — snap backward to Friday

**Shared Rust helpers for dependency-type earliest start:**
10. `fs_successor_start(pred_end: &str, lag: i32) -> String` — `add_business_days(pred_end, 1 + lag)`
11. `ss_successor_start(pred_start: &str, lag: i32) -> String` — `add_business_days(pred_start, lag)`
12. `ff_successor_start(pred_end: &str, lag: i32, succ_duration: i32) -> String`
13. `sf_successor_start(pred_start: &str, lag: i32, succ_duration: i32) -> String`

14. Add comprehensive tests for all new functions (convention tests from Phase 7d/7e)
15. Add `WEEKEND_VIOLATION` to Rust `ConflictResult` types

### Phase 2: Rust Scheduler Fixes

**Scope:** `crates/scheduler/src/` — cascade.rs, constraints.rs, lib.rs

1. Fix `cascade_dependents` FS (line 92-103): use `fs_successor_start` helper.
   Remove `next_biz_day_on_or_after` wrapper (dates guaranteed to be business days).
   SS/FF/SF cascade: optionally remove `next_biz_day_on_or_after` wrappers for clarity
   (they're no-ops with guaranteed business-day dates), but formulas stay the same.
2. Fix `recalculate_earliest` end computation (line 291): `task_end_date(&new_start, task.duration)`
3. Fix FNET computed_end (line 241): `task_end_date(&new_start, task.duration)`
4. Fix FNET start derivation (line 244): `add_business_days(constraint_date, -(task.duration - 1))`
5. Fix FNLT computed_end (line 251): `task_end_date(&new_start, task.duration)`
6. Fix MFO (line 275): same as FNET — `-(task.duration - 1)`
7. Fix `find_conflicts` FS (line 160-163): use `fs_successor_start` helper
8. Fix `find_conflicts` SS (line 164-167): use `ss_successor_start` helper (functionally
   unchanged, just uses shared helper for consistency)
9. Add FF/SF conflict detection to `find_conflicts` (Bug 11 — currently skipped at line 168)
10. Add `WEEKEND_VIOLATION` conflict type to `find_conflicts` — detect tasks with weekend
    start or end dates
11. Add CPM doc comment explaining the exclusive integer model is intentional (Bug 6)
12. Update all Rust test data to use inclusive end dates, fix expected values

> **⚠ Phase 2+3 ordering dependency:** Rust formulas in Phase 2 depend on `task.duration`
> values sent from TypeScript. After Phase 2, formulas like `task_end_date(start, dur)` use
> `add_biz(start, dur - 1)` which is correct only with **inclusive** duration values. Phase 3
> is where TS switches from exclusive to inclusive (`workingDaysBetween` → `taskDuration`).
> If Phase 2 lands without Phase 3, Rust receives old exclusive durations and computes wrong
> end dates (off by 1). **Phases 2 and 3 must ship in the same PR.** Rust unit tests can be
> updated independently (they use hardcoded test data), but runtime correctness requires both.

### Phase 3: TypeScript State + Reducer

**Scope:** `src/state/ganttReducer.ts`, `src/utils/schedulerWasm.ts`, `src/utils/summaryUtils.ts`

1. Migrate all `workingDaysBetween` calls to `taskDuration` in:
   - ganttReducer.ts (5 callsites: MOVE_TASK:33, RESIZE_TASK:43, UPDATE_TASK_FIELD:59,
     ADD_TASK:283, COMPLETE_DRAG:546)
   - schedulerWasm.ts:168
2. Fix all end-date derivations to use `taskEndDate`:
   - ADD_TASK (line 273-283): Currently uses `today + 5 calendar days` (can produce
     weekend dates) then derives duration. Fix: `start = ensureBusinessDay(today)`,
     use default duration (e.g., 5), `end = taskEndDate(start, 5)`,
     `duration = 5`. No more raw calendar offset.
   - UPDATE_TASK_FIELD when start changes and end must follow
3. Fix recalcSummaryDates (Bug 13): add `task.duration = taskDuration(minStart, maxEnd)`
5. Fix schedulerWasm cascade result merging: use `taskDuration` for duration

### Phase 4: Rendering + UI (weekend prevention + bar width)

**Scope:** `src/components/gantt/TaskBar.tsx`, `GanttChart.tsx`, `TodayLine.tsx`,
`TaskRow.tsx`, `TaskBarPopover.tsx`, `taskFieldValidation.ts`

The UI must make it **impossible** to set a weekend start or end date. Prevent, don't fix after.

1. Fix bar width (Bug 8): `taskEndX - taskX + colWidth` to include end-date column.
   Apply in GanttChart.tsx (lines 139, 173) and anywhere bar width is computed.
2. Fix drag move (TaskBar): `xToDate`/`xToDateCollapsed` results must snap to nearest
   business day during the drag — the ghost bar should never sit on a weekend column.
   In non-collapsed mode, snap forward for start, backward for end. In collapsed mode,
   weekends aren't visible so this is automatic.
3. Fix drag resize (TaskBar): end date snaps to previous business day if it would land
   on weekend. Minimum 1-day duration enforced.
4. Fix inline date edit (TaskRow):
   - `validateEndDate` (`taskFieldValidation.ts:24-28`): add weekend rejection
   - Add `validateStartDate` with weekend rejection
   - Reject weekend dates on change — show validation error, don't silently snap
5. Fix popover date edit (TaskBarPopover): same validation
6. Fix end-date derivation (Bug 2 locations):
   - TaskRow.tsx:77: `taskEndDate(value, task.duration)` instead of `addBusinessDaysToDate(value, task.duration)`
   - TaskRow.tsx:111: `taskEndDate(task.startDate, newDuration)` instead of `addBusinessDaysToDate(task.startDate, newDuration)`
   - TaskBarPopover.tsx:73: `taskEndDate(value, task!.duration)` instead of `addBusinessDaysToDate(value, task!.duration)`
7. Rename `dateToXCollapsed` → `dateToX`, `xToDateCollapsed` → `xToDate` (Bug 12).
   Rename old `dateToX` → `dateToXCalendar`, `xToDate` → `xToDateCalendar` (internal).
   All 23+ callsites in GanttChart, TaskBar, dependencyUtils get shorter names.
   TodayLine now calls `dateToX(todayStr, ..., collapseWeekends)` — fixed automatically.
8. Verify collapsed-weekend mode still works with inclusive bar width
9. Migrate remaining `workingDaysBetween` calls in TaskBar.tsx:131, TaskRow.tsx:90,
   and TaskBarPopover.tsx:87

### Phase 5: Sheets + CRDT Sync (weekend warning + Yjs fix)

**Scope:** `src/sheets/sheetsMapper.ts`, `src/collab/yjsBinding.ts`, `src/types/index.ts`

Weekend dates from Sheets are NOT silently fixed. They are surfaced as warnings.

1. Migrate sheetsMapper `workingDaysBetween` → `taskDuration` (lines 20, 51)
2. Migrate yjsBinding `workingDaysBetween` → `taskDuration` (lines 175, 282, 296)
3. Fix end-date derivations in yjsBinding to use `taskEndDate`
4. Fix yjsBinding `UPDATE_TASK_FIELD` (Bug 14): when field is `startDate` or `endDate`,
   also write recomputed duration to Yjs map so remote collaborators see correct duration
5. Add `WEEKEND_VIOLATION` to ConflictResult types (TS side, matching Rust)
6. `find_conflicts` (already updated in Phase 2) detects weekend start/end dates
   and returns `WEEKEND_VIOLATION` conflicts. The existing conflict indicator UI
   (red dashed border + message on click) handles display — no new UI component needed.
7. Sheets import does NOT snap or reject weekend dates. The task is imported as-is,
   and `detectConflicts()` (called on every render in GanttChart.tsx) shows the warning.
   User fixes it via the UI or in the sheet.

### Phase 6: Cross-cutting Tests + Cleanup

1. **Consistency tests:** cascade and recalculate produce identical start dates for all
   dep types (FS/SS/FF/SF) with lag 0, 1, 2
2. **Roundtrip tests:** edit → cascade → recalculate → no drift
3. **find_conflicts/recalculate agreement:** for every dep type, `find_conflicts` reports
   a violation if and only if `recalculate_earliest` would move the task
4. **Weekend enforcement tests:**
   - Drag to weekend column → snaps to business day
   - Resize to weekend → snaps to previous business day
   - Inline edit weekend date → rejected with validation error
   - Sheets import with weekend date → WEEKEND_VIOLATION conflict shown
   - ADD_TASK on weekend → start snaps to Monday
5. **E2E:** bar width matches duration, no weekend start/end in UI-created tasks
6. **Cleanup:** Delete `workingDaysBetween` (all callers migrated). Remove
   `next_biz_day_on_or_after` if fully replaced by `ensure_business_day`.

### Phase 7: Remaining Documentation & Agent Guard Rails

This phase covers documentation updates not done in Phase 0. It is **mandatory, not optional**.

**7a. Update remaining docs** (see inventory below).
Every item in the "Must update" list is a deliverable, not a suggestion.

**7b. Add automated enforcement to pre-commit hook:**

Extend `scripts/pre-commit-hook.sh` to catch common regressions:

```bash
# Banned patterns: deprecated function names
if git diff --cached --name-only | grep -qE '\.(ts|tsx|rs)$'; then
  if git diff --cached -U0 | grep -E '^\+' | grep -qE 'workingDaysBetween'; then
    echo "ERROR: workingDaysBetween is deprecated. Use taskDuration() instead."
    exit 1
  fi
fi
```

Keep it lightweight — only check added lines (`^\+`), only in staged TS/Rust files.
False positive rate should be near zero since `workingDaysBetween` is deleted.

**7c. Convention tests (already added in Phase 1):**

The convention tests from Phase 1 serve as executable documentation — an agent reading
the test file sees the convention immediately. See Phase 1 items 13 for details.

---

## Architectural Prevention (Structural Bug Prevention)

Beyond fixing individual bugs, these changes make entire categories of bugs structurally
impossible. Prioritized by impact-to-effort ratio.

### A1. Centralize duration recomputation (Phase 3 — implement with reducer fixes)

**Problem:** Duration is recomputed inline at 14+ callsites, each calling
`workingDaysBetween(start, end)` independently. If any callsite forgets to recompute,
duration silently goes stale (Bugs 13 and 14 are instances of this).

**Fix:** Create a `withDuration(task)` helper that always recomputes duration from dates:

```typescript
// src/utils/dateUtils.ts
export function withDuration<T extends { startDate: string; endDate: string }>(
  task: T
): T & { duration: number } {
  return { ...task, duration: taskDuration(task.startDate, task.endDate) };
}
```

Use everywhere a task's dates change: reducer actions, Yjs binding, cascade results,
summary recalc. This makes it impossible to update dates without updating duration —
the helper enforces the invariant at the call site.

Note: `RECALCULATE_EARLIEST` is an exception — Rust preserves duration internally
(constraints.rs:291), so the reducer correctly leaves `duration` unchanged. But
everywhere else (cascade results, summary recalc, Yjs binding), `withDuration` should
be used.

Not a type-system guarantee (TS can't enforce "you must call this"), but eliminates
the manual `duration: taskDuration(...)` line that's easy to forget.

### A2. Debug invariant assertions at WASM boundary (Phase 6 — implement with tests)

**Problem:** Invalid dates cross the WASM boundary silently (Bug 15). A bug in the
reducer or Yjs binding can produce end < start, weekend dates, or stale durations, and
Rust code silently computes wrong results.

**Fix:** Add `assertTaskInvariants(task)` that runs in development mode only:

```typescript
// src/utils/schedulerWasm.ts — called before sending tasks to WASM
function assertTaskInvariants(task: Task): void {
  if (process.env.NODE_ENV === 'production') return;
  if (task.isSummary || task.isMilestone) return;

  const computed = taskDuration(task.startDate, task.endDate);
  console.assert(computed === task.duration,
    `Task ${task.id}: duration ${task.duration} != computed ${computed}`);
  console.assert(task.startDate <= task.endDate,
    `Task ${task.id}: start ${task.startDate} > end ${task.endDate}`);
  console.assert(!isWeekendDate(task.startDate),
    `Task ${task.id}: starts on weekend ${task.startDate}`);
  console.assert(!isWeekendDate(task.endDate),
    `Task ${task.id}: ends on weekend ${task.endDate}`);
}
```

Tree-shaken in production. Catches bugs during development immediately instead of
letting them propagate silently through the WASM boundary.

### A3. Cross-language consistency tests (Phase 6 — implement with tests)

**Problem:** TypeScript and Rust implement date arithmetic independently. If a fix is
made in one language but not the other, they silently diverge. There are currently
zero tests that verify TS and Rust agree.

**Fix:** Add a Vitest test that calls WASM functions and compares results to TS:

```typescript
describe('cross-language consistency', () => {
  const cases = [
    { start: '2026-03-02', dur: 5 },  // Mon, full week
    { start: '2026-03-06', dur: 1 },  // Fri, single day
    { start: '2026-03-06', dur: 3 },  // Fri, crosses weekend
  ];

  for (const { start, dur } of cases) {
    it(`task_end_date agrees for ${start}, dur=${dur}`, () => {
      const tsEnd = taskEndDate(start, dur);
      const rustEnd = wasmModule.task_end_date(start, dur);
      expect(tsEnd).toBe(rustEnd);
    });

    it(`task_duration agrees for ${start} → end`, () => {
      const end = taskEndDate(start, dur);
      const tsDur = taskDuration(start, end);
      const rustDur = wasmModule.task_duration(start, end);
      expect(tsDur).toBe(rustDur);
    });
  }
});
```

These tests break immediately if the languages diverge, catching the exact class of
bug that caused the original FS formula disagreement.

### A4. Cascade/recalculate agreement test (Phase 6 — implement with tests)

**Problem:** Cascade and recalculate are independent implementations of "where should
this task start?" For the same input, they must agree — but they diverged for FS
(Bugs 3-5). No test catches this.

**Fix:** Add a Rust test that runs both and asserts agreement:

```rust
#[test]
fn cascade_and_recalculate_agree_on_all_dep_types() {
    for dep_type in [FS, SS, FF, SF] {
        for lag in [0, 1, 2] {
            let tasks = make_two_task_chain(dep_type, lag);
            // Move pred forward 3 business days
            let cascade_result = cascade_dependents(&tasks, "pred", 3);
            let recalc_result = recalculate_earliest(&updated_tasks, ...);
            assert_eq!(cascade_result[0].start_date, recalc_result[0].new_start,
                "Mismatch for {:?} lag={}", dep_type, lag);
        }
    }
}
```

This is the most impactful structural test — it directly prevents the class of bug
that caused the user-visible symptom (Bug 5).

### A5. find_conflicts/recalculate agreement test (Phase 6)

**Problem:** `find_conflicts` reports a violation that `recalculate_earliest` resolves
with a different formula, causing the error message to show the wrong date (Bug 5).

**Fix:** Add a test that verifies: for any task that `find_conflicts` reports as
violating, `recalculate_earliest` moves it to exactly the date reported in the conflict.

```rust
#[test]
fn conflict_date_matches_recalculate_resolution() {
    for dep_type in [FS, SS, FF, SF] {
        let tasks = make_violating_chain(dep_type);
        let conflicts = find_conflicts(&tasks);
        let recalc = recalculate_earliest(&tasks, ...);
        for conflict in &conflicts {
            let resolved = recalc.iter().find(|r| r.id == conflict.task_id).unwrap();
            assert_eq!(conflict.constraint_date, resolved.new_start,
                "Conflict says {} but recalculate moves to {}", ...);
        }
    }
}
```

### Not recommended now (high effort, lower ROI):

**Branded types** (`InclusiveDate & { __brand }`) — Appealing in theory, but would
require touching every function signature in both languages. The convention-encoding
functions (`taskDuration`, `taskEndDate`, shared helpers) achieve the same goal with
less churn: if you always use the right function, you always get the right result. The
risk is "forgetting to call the function," which the pre-commit hook and debug
assertions catch. Branded types could be a future improvement once the core fixes land.

**Shared WASM date library** (single implementation for both languages) — Would
eliminate the cross-language divergence risk entirely, but adds WASM call overhead for
every date operation in TS (currently microsecond-level JS). The cross-language
consistency tests (A3) catch divergence at test time with zero runtime cost. Better
trade-off for now.

---

## Risk Notes

- Phase 0 (docs) must land FIRST — implementing agents need the convention visible
- Phase 1 is purely additive (new functions, no breaking changes)
- **Phases 2+3 must ship together** — Rust formulas (Phase 2) expect inclusive duration
  values from TS (Phase 3). Shipping Phase 2 alone produces off-by-one end dates.
- Phases 2-5 are the breaking changes — all existing test assertions need updating
- Phase 5 (Sheets) is highest risk — convention mismatch could corrupt user data
- `workingDaysBetween` migration has **14 callsites** — must update all atomically
  within each phase
- Cascade preserves `business_day_delta(start, end)` date gap, NOT `task.duration` field.
  If duration and date gap are out of sync (stale duration), cascade and recalculate
  will produce different end dates. Bug 13 and Bug 14 fixes address this by ensuring
  duration is always recomputed after date changes.
- CPM stays as standard exclusive integer model — no changes needed, no risk
- Yjs binding `UPDATE_TASK_FIELD` (Bug 14) is a live collaboration bug — remote users
  see stale duration when dates are edited via table cells

---

## Affected Files (Exhaustive)

### Must change:
- `src/utils/dateUtils.ts` — add `taskDuration`, `taskEndDate`, `ensureBusinessDay`; deprecate `workingDaysBetween`
- `src/utils/__tests__/dateUtils.test.ts` — convention tests, update all duration assertions
- `src/utils/taskFieldValidation.ts` — add weekend rejection to `validateEndDate`, add `validateStartDate`
- `src/utils/__tests__/taskFieldValidation.test.ts` — weekend validation tests
- `src/state/ganttReducer.ts` — migrate 5 `workingDaysBetween` calls
- `src/state/__tests__/ganttReducer.test.ts`
- `src/utils/schedulerWasm.ts` — migrate `workingDaysBetween`, fix end-date derivation
- `src/utils/summaryUtils.ts` — recompute summary duration (Bug 13)
- `src/sheets/sheetsMapper.ts` — migrate 2 `workingDaysBetween` calls
- `src/sheets/__tests__/sheetsMapper.test.ts`
- `src/collab/yjsBinding.ts` — migrate 3 `workingDaysBetween` calls
- `src/components/gantt/TaskBar.tsx` — bar width, drag handlers, weekend snap, migrate `workingDaysBetween`
- `src/components/gantt/GanttChart.tsx` — bar width `+ colWidth`
- `src/components/gantt/TodayLine.tsx` — use `dateToXCollapsed` (Bug 12)
- `src/components/table/TaskRow.tsx` — end-date derivation (Bug 2), migrate `workingDaysBetween`, weekend validation
- `src/components/gantt/TaskBarPopover.tsx` — weekend validation
- `src/types/index.ts` — document inclusive convention, add `WEEKEND_VIOLATION` type
- `crates/scheduler/src/types.rs` — document inclusive convention, add WEEKEND_VIOLATION
- `crates/scheduler/src/date_utils.rs` — add convention-encoding functions and dep-type helpers
- `crates/scheduler/src/cascade.rs` — FS formula fix (SS/FF/SF: remove `next_biz_on_or_after` wrappers only)
- `crates/scheduler/src/constraints.rs` — recalculate_earliest end (line 291), FNET, MFO
- `crates/scheduler/src/cpm.rs` — add doc comment (NO formula changes)
- `crates/scheduler/src/lib.rs` — find_conflicts FS fix, add FF/SF detection, add WEEKEND_VIOLATION

### May need change (verify during implementation):
- `src/utils/dependencyUtils.ts` — arrow endpoint pixel calc (may need `+ colWidth` for inclusive end)
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

### Must update — Phase 0 (before any code changes):

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

**`crates/scheduler/CLAUDE.md`** — Scheduler constraints
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

**`src/CLAUDE.md`** — Frontend constraints
```
// CURRENT:
- Prefer `date-fns` directly over project wrappers for new code
// FIXED:
- Prefer `date-fns` directly over project wrappers for generic date operations.
  EXCEPTION: always use `taskDuration()`/`taskEndDate()` for duration and end-date
  derivation — these encode the inclusive convention.
```

**`.claude/skills/scheduling-engine/SKILL.md`** — Scheduling engine guide
- Add to Known Gotchas:
  - end_date is inclusive — `task_end_date()` and `task_duration()` encode this
  - Never use raw `add_business_days(start, duration)` to derive end dates
  - Never write FS/SS/FF/SF earliest-start logic inline — use the shared helpers
- Add to Lessons Learned:
  - Off-by-one root cause: three functions computed FS earliest start with different
    formulas (cascade used exclusive, constraints used inclusive, find_conflicts used
    exclusive). Unified into shared `fs_successor_start` helper.

**`.claude/agents/rust-scheduler.md`** — Rust scheduler subagent prompt
- Add `task_duration()`, `task_end_date()`, `ensure_business_day()`,
  `fs_successor_start()`/etc. to module map
- Fix MFO description: "derives start from constraint_date via `task_end_date` inverse"
- Add critical rule: end_date is inclusive, use convention functions

### Must update — Phase 7 (after code changes):

**`docs/unplanned-issues.md:29`** — Duration mode toggle feature
```
// CURRENT:
Currently `duration` is always derived via `workingDaysBetween()` (business days, Mon-Fri)
// FIXED:
Currently `duration` is always derived via `taskDuration()` (business days, Mon-Fri, inclusive of start and end)
```

**Add `## Date Conventions (Non-Negotiable)` section to root `CLAUDE.md`:**

```markdown
## Date Conventions (Non-Negotiable)
- **end_date is INCLUSIVE** — the last working day the task occupies.
- **duration** = business days in [startDate, endDate] counting both endpoints.
- **No task starts or ends on a weekend** — UI prevents it; Sheets violations are
  surfaced via WEEKEND_VIOLATION conflict indicator.
- **Always use convention-encoding functions:**
  - Duration from dates: `taskDuration(start, end)` / `task_duration(start, end)`
  - End from start+duration: `taskEndDate(start, dur)` / `task_end_date(start, dur)`
  - FS/SS/FF/SF successor start: `fs_successor_start()` etc. (Rust shared helpers)
- **Never derive end dates with raw `addBusinessDays(start, duration)`** — this gives
  an exclusive end, off by one day. Use `taskEndDate()` which handles the `-1`.
- **Never write dep-type earliest-start arithmetic inline** — use the shared helpers
  in `crates/scheduler/src/date_utils.rs`. Three functions diverged once; don't repeat it.
- **CPM uses standard exclusive integer model internally** — this is intentional and
  convention-independent. Do NOT change CPM to use inclusive model.
```

### Should update (stale references, low risk but confusing):

**`.claude/skills/google-sheets-sync/SKILL.md:33`** — Column layout table
- Column 4 (`duration`): add note that duration is inclusive business day count

**`.claude/skills/e2e-testing/SKILL.md:47`** — Lessons learned
- Add: "Tasks must never have start or end dates on weekends. E2E tests should verify this invariant."

**`docs/completed-phases.md:182`** — Historical reference
- Add note: "Note: duration derivation updated in Phase 16 to use `taskDuration()` with
  inclusive [start, end] semantics."

### No change needed:

- `.claude/agents/plan-reviewer.md` — no date content
- `.claude/agents/codebase-explorer.md` — no date content
- `.claude/agents/verify-and-diagnose.md` — no date content
- `.claude/skills/cloud-deployment/SKILL.md` — no date content
- `.claude/skills/rust-wasm/SKILL.md` — no date content
- `.claude/skills/shell-scripting/SKILL.md` — no date content
- `.claude/skills/multi-agent-orchestration/SKILL.md` — no date content
- `.claude/skills/issue-workflow/SKILL.md` — no date content
- `.claude/worktrees/CLAUDE.md` — no date content
- Phase prompt files — excluded per user instruction

---

## Glossary: Function Name Mapping

For agents grepping the codebase — every function related to date calculation and which
to use. **Design principles for these names:**

1. **One word for "Mon–Fri"**: Always "business day" (TS) / `business_day` (Rust). Never "working", "biz", or "weekday".
2. **Cross-language parity**: TS camelCase ↔ Rust snake_case of the SAME name (e.g., `taskDuration` ↔ `task_duration`).
3. **Purpose in the name**: Convention-encoding functions start with `task` (scheduling domain). Generic primitives use verb phrases (`add`, `ensure`, `prev`).
4. **Grep-friendly**: An agent grepping "duration" finds `taskDuration`/`task_duration`. Grepping "end date" finds `taskEndDate`/`task_end_date`. Grepping "successor" finds all four `_successor_start` helpers.
5. **Internal vs public**: Functions marked `@internal` are implementation details — agents should not call them directly.

### Convention-encoding functions (the ONLY place the inclusive convention lives)

| Function | Language | Status | Purpose | Returns |
|---|---|---|---|---|
| `taskDuration(start, end)` | TS | **NEW** | Duration from dates | Business days in [start, end] inclusive. Same-day = 1. |
| `task_duration(start, end)` | Rust | **NEW** | Duration from dates | Business days in [start, end] inclusive. Same-day = 1. |
| `taskEndDate(start, dur)` | TS | **NEW** | End date from start+duration | `addBusinessDays(start, dur - 1)`. Duration=1 → returns start. |
| `task_end_date(start, dur)` | Rust | **NEW** | End date from start+duration | `add_business_days(start, dur - 1)`. Duration=1 → returns start. |

### Dependency earliest-start helpers (Rust only — TS calls through WASM)

| Function | Language | Status | Purpose |
|---|---|---|---|
| `fs_successor_start(pred_end, lag)` | Rust | **NEW** | FS: next biz day after pred's last day, plus lag |
| `ss_successor_start(pred_start, lag)` | Rust | **NEW** | SS: pred's start + lag biz days |
| `ff_successor_start(pred_end, lag, succ_dur)` | Rust | **NEW** | FF: derive start from pred's end + lag - succ_dur + 1 |
| `sf_successor_start(pred_start, lag, succ_dur)` | Rust | **NEW** | SF: derive start from pred's start + lag - succ_dur + 1 |

### Weekend snap functions

| Function | Language | Status | Purpose |
|---|---|---|---|
| `ensureBusinessDay(date)` | TS | **NEW** | Snap forward: if weekend → next Monday. Weekday → no-op. |
| `ensure_business_day(date)` | Rust | **NEW** (rename of `next_biz_day_on_or_after`) | Same as TS. |
| `prevBusinessDay(date)` | TS | **NEW** | Snap backward: if weekend → prev Friday. Weekday → no-op. |
| `prev_business_day(date)` | Rust | **NEW** | Same as TS. |

> **Why not a single `toBusinessDay(date, direction)` function?** Because agents grep for
> a specific direction. `ensureBusinessDay` is unambiguously "forward" (the common case);
> `prevBusinessDay` is unambiguously "backward." A direction parameter requires reading
> the callsite to know which way it snaps.

### Generic primitives (convention-independent — safe to use anywhere)

| Function | Language | Status | Purpose |
|---|---|---|---|
| `addBusinessDays(date, n)` | TS (date-fns) | **KEEP** | Shift a Date by N business days. External library. |
| `add_business_days(date, n)` | Rust | **KEEP** | Shift a date string by N business days. |
| `addBusinessDaysToDate(str, n)` | TS | **KEEP** | String wrapper: parse → addBusinessDays → format. |
| `businessDaysDelta(start, end)` | TS | **KEEP** | Signed business day difference. For drag shift amounts. |
| `business_day_delta(from, to)` | Rust | **RENAME** | `count_biz_days_to` → `business_day_delta`. Matches TS name. |
| `daysBetween(start, end)` | TS | **KEEP** | Signed calendar day difference. |

### Pixel mapping (rendering — not scheduling)

| Function | Language | Status | Purpose |
|---|---|---|---|
| `dateToX(date, start, colW, zoom)` | TS | **RENAME** | `dateToXCollapsed` → `dateToX`. Weekend-aware (default). |
| `xToDate(x, start, colW, zoom)` | TS | **RENAME** | `xToDateCollapsed` → `xToDate`. Weekend-aware (default). |
| `dateToXCalendar(date, start, colW, zoom)` | TS | **RENAME** | Old `dateToX` → `dateToXCalendar`. Includes weekends. Internal. |
| `xToDateCalendar(x, start, colW, zoom)` | TS | **RENAME** | Old `xToDate` → `xToDateCalendar`. Includes weekends. Internal. |
| `businessDaysBetween(start, end)` | TS | **INTERNALIZE** | Remove `export`. Used only inside `dateToX`. `@internal`. |

> **Why internalize `businessDaysBetween`?** It counts business days with `[start, end)`
> exclusive boundaries — identical result to `taskDuration` but for a different set of days.
> If exported, an agent grepping "business days between" could use it instead of `taskDuration`
> and get wrong results. Making it non-exported eliminates the confusion vector.

### Deprecated / deleted

| Function | Language | Action | Reason |
|---|---|---|---|
| `workingDaysBetween(start, end)` | TS | **DELETE** | Replaced by `taskDuration`. Wrong name ("working"), wrong semantics (exclusive). |
| `next_biz_day_on_or_after(date)` | Rust | **DELETE** | Replaced by `ensure_business_day`. Wrong abbreviation ("biz"). |
| `count_biz_days_to(from, to)` | Rust | **DELETE** | Replaced by `business_day_delta`. Wrong abbreviation, unclear name. |

### Agent search scenarios

| Agent needs to... | Greps for | Finds | Must NOT accidentally use |
|---|---|---|---|
| Compute task duration | "duration", "taskDuration" | `taskDuration` / `task_duration` | `businessDaysBetween` (internalized, invisible) |
| Compute task end date | "end date", "taskEndDate" | `taskEndDate` / `task_end_date` | `addBusinessDaysToDate` (generic, off-by-one without `-1`) |
| Shift a date by N days | "addBusinessDays", "add_business_days" | `addBusinessDays` / `add_business_days` | Nothing — these are correct primitives |
| Compute drag delta | "delta", "businessDaysDelta" | `businessDaysDelta` / `business_day_delta` | `daysBetween` (calendar, not business) |
| Snap to weekday | "ensure", "businessDay" | `ensureBusinessDay` / `ensure_business_day` | Nothing — clear purpose |
| FS earliest start | "successor", "fs_successor" | `fs_successor_start` | Raw `add_business_days(end, 1)` (misses lag handling) |
| Convert date to pixel | "dateToX" | `dateToX` (weekend-aware) | `dateToXCalendar` (only for expanded-weekend views) |
