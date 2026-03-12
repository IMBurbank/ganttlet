# Date Calculation Bug Fixes — Plan (TENTATIVE)

> **Status:** TENTATIVE — under active discussion, not yet finalized.
> **Branch:** `agent/date-calc-fixes`
> **Created:** 2026-03-12
> **Last verified:** 2026-03-12 (deep review against full codebase)

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

**12 callsites** (all must migrate to `taskDuration`):
- `ganttReducer.ts:33` (MOVE_TASK), `:43` (RESIZE_TASK), `:59` (UPDATE_TASK_FIELD),
  `:283` (ADD_TASK), `:546` (COMPLETE_DRAG)
- `schedulerWasm.ts:168` (cascade result)
- `sheetsMapper.ts:20` (taskToRow), `:51` (rowToTask)
- `yjsBinding.ts:175` (RESIZE), `:282` (COMPLETE_DRAG), `:296` (CASCADE_DEPENDENTS)
- `TaskRow.tsx:90` (end date edit), `TaskBar.tsx:131` (resize drag)

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

With inclusive convention, `constraint_date` is the required finish date (last working
day). Backing up by `duration - 1` business days gives the correct start.
Current `- duration` overshoots by one day.
(Verified: dur=5, constraint=Fri 3/6 → `-(5)` gives Fri 2/27 (wrong), `-(4)` gives Mon 3/2 (correct).)

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

### Bug 10: RECALCULATE_EARLIEST reducer doesn't recompute duration

**File:** `src/state/ganttReducer.ts:605`

```typescript
return { ...t, startDate: r.newStart, endDate: r.newEnd };
```

After WASM `recalculate_earliest` sets new start/end dates, the `duration` field is NOT
updated. It retains its old value, which may no longer match the new date range. This
causes stale duration display and divergence between `duration` and date-derived values.

**Fix:** `return { ...t, startDate: r.newStart, endDate: r.newEnd, duration: taskDuration(r.newStart, r.newEnd) }`

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

### Bug 12: TodayLine uses `dateToX` instead of `dateToXCollapsed`

**File:** `src/components/gantt/TodayLine.tsx:3,15`

```typescript
import { dateToX, formatDate } from '../../utils/dateUtils';
const x = dateToX(todayStr, timelineStart, colWidth, zoom);
```

When `collapseWeekends` is enabled, the today line renders at the wrong X position because
it doesn't account for collapsed weekends. Should use `dateToXCollapsed`.

**Fix:** Pass `collapseWeekends` prop and use `dateToXCollapsed`.

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

---

## What's Already Correct

These functions use the inclusive convention and do NOT need changing:

| Function | File | Why correct |
|---|---|---|
| `compute_earliest_start` FS | `constraints.rs:20-24` | `add_biz(pred.end, 1) + lag` — correctly skips past inclusive end |
| `compute_earliest_start` SS | `constraints.rs:25-28` | `add_biz(pred.start, lag)` — SS is start-to-start, no +1 gap needed |
| FF `-(duration - 1)` | `constraints.rs:29-33` | Correctly backs up from inclusive finish to find start |
| SF `-(duration - 1)` | `constraints.rs:34-39` | Same as FF — inclusive back-up |
| `cascade_dependents` SS | `cascade.rs:105-115` | Same-day start correct for SS |
| `cascade_dependents` FF | `cascade.rs:117-127` | Same-end correct for FF |
| `cascade_dependents` SF | `cascade.rs:129-140` | Correct for SF |
| SNET constraint floor | `constraints.rs:55-68` | String comparison on dates, convention-independent |
| SNLT/FNLT conflict detection | `constraints.rs:226-258` | Compares computed dates, works with either convention |
| `next_biz_day_on_or_after` | `date_utils.rs:63-70` | Weekend snapping, convention-independent |
| `add_business_days` | `date_utils.rs:47-59` | Shifts by N biz days, convention-independent |
| CPM (entire module) | `cpm.rs` | Abstract integer model, convention-independent float/critical path |
| `businessDaysBetween` (Date) | `dateUtils.ts:129-137` | Pixel mapping only, exclusive is correct for column counting |

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
3. `ensureBusinessDay(date: Date, direction: 'forward' | 'backward'): Date` — snaps to
   nearest weekday
4. `isWeekendDate(dateStr: string): boolean` — convenience for validation

**Rust (`crates/scheduler/src/date_utils.rs`):**
5. `task_duration(start: &str, end: &str) -> i32` — inclusive business day count
6. `task_end_date(start: &str, duration: i32) -> String` — `add_business_days(start, duration - 1)`
7. `ensure_business_day(date: &str) -> String` — rename of `next_biz_day_on_or_after`
   (keep old name as alias during migration)
8. `prev_business_day(date: &str) -> String` — snap backward to Friday

**Shared Rust helpers for dependency-type earliest start:**
9. `fs_successor_start(pred_end: &str, lag: i32) -> String` — `add_business_days(pred_end, 1 + lag)`
10. `ss_successor_start(pred_start: &str, lag: i32) -> String` — `add_business_days(pred_start, lag)`
11. `ff_successor_start(pred_end: &str, lag: i32, succ_duration: i32) -> String`
12. `sf_successor_start(pred_start: &str, lag: i32, succ_duration: i32) -> String`

13. Add comprehensive tests for all new functions (convention tests from Phase 7d/7e)
14. Add `WEEKEND_VIOLATION` to Rust `ConflictResult` types

### Phase 2: Rust Scheduler Fixes

**Scope:** `crates/scheduler/src/` — cascade.rs, constraints.rs, lib.rs

1. Fix `cascade_dependents` FS (line 92-103): use `fs_successor_start` helper.
   Remove `next_biz_day_on_or_after` wrapper (dates guaranteed to be business days).
   SS/FF/SF cascade: optionally remove `next_biz_day_on_or_after` wrappers for clarity
   (they're no-ops with guaranteed business-day dates), but formulas stay the same.
2. Fix `recalculate_earliest` end computation (line 291): `task_end_date(&new_start, task.duration)`
3. Fix FNET (line 244): `add_business_days(constraint_date, -(task.duration - 1))`
4. Fix MFO (line 275): same — `-(task.duration - 1)`
5. Fix `find_conflicts` FS (line 160-163): use `fs_successor_start` helper
6. Fix `find_conflicts` SS (line 164-167): use `ss_successor_start` helper (functionally
   unchanged, just uses shared helper for consistency)
7. Add FF/SF conflict detection to `find_conflicts` (Bug 11 — currently skipped at line 168)
8. Add `WEEKEND_VIOLATION` conflict type to `find_conflicts` — detect tasks with weekend
   start or end dates
9. Add CPM doc comment explaining the exclusive integer model is intentional (Bug 6)
10. Update all Rust test data to use inclusive end dates, fix expected values

### Phase 3: TypeScript State + Reducer

**Scope:** `src/state/ganttReducer.ts`, `src/utils/schedulerWasm.ts`, `src/utils/summaryUtils.ts`

1. Migrate all `workingDaysBetween` calls to `taskDuration` in:
   - ganttReducer.ts (5 callsites: MOVE_TASK:33, RESIZE_TASK:43, UPDATE_TASK_FIELD:59,
     ADD_TASK:283, COMPLETE_DRAG:546)
   - schedulerWasm.ts:168
2. Fix all end-date derivations to use `taskEndDate`:
   - ADD_TASK: `end = taskEndDate(today, duration)`. If today is a weekend, snap start
     forward to Monday before computing end.
   - UPDATE_TASK_FIELD when start changes and end must follow
3. Fix RECALCULATE_EARLIEST (Bug 10, line 605): recompute duration from new dates
4. Fix recalcSummaryDates (Bug 13): add `task.duration = taskDuration(minStart, maxEnd)`
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
6. Fix TaskRow end-date derivation (Bug 2 locations):
   - Line 77: `taskEndDate(value, task.duration)` instead of `addBusinessDaysToDate(value, task.duration)`
   - Line 111: `taskEndDate(task.startDate, newDuration)` instead of `addBusinessDaysToDate(task.startDate, newDuration)`
7. Fix TodayLine (Bug 12): use `dateToXCollapsed` with collapseWeekends prop
8. Verify collapsed-weekend mode still works with inclusive bar width
9. Migrate remaining `workingDaysBetween` calls in TaskBar.tsx:131 and TaskRow.tsx:90

### Phase 5: Sheets + CRDT Sync (weekend warning)

**Scope:** `src/sheets/sheetsMapper.ts`, `src/collab/yjsBinding.ts`, `src/types/index.ts`

Weekend dates from Sheets are NOT silently fixed. They are surfaced as warnings.

1. Migrate sheetsMapper `workingDaysBetween` → `taskDuration` (lines 20, 51)
2. Migrate yjsBinding `workingDaysBetween` → `taskDuration` (lines 175, 282, 296)
3. Fix end-date derivations in yjsBinding to use `taskEndDate`
4. Add `WEEKEND_VIOLATION` to ConflictResult types (TS side, matching Rust)
5. `find_conflicts` (already updated in Phase 2) detects weekend start/end dates
   and returns `WEEKEND_VIOLATION` conflicts. The existing conflict indicator UI
   (red dashed border + message on click) handles display — no new UI component needed.
6. Sheets import does NOT snap or reject weekend dates. The task is imported as-is,
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

## Risk Notes

- Phase 0 (docs) must land FIRST — implementing agents need the convention visible
- Phase 1 is purely additive (new functions, no breaking changes)
- Phases 2-5 are the breaking changes — all existing test assertions need updating
- Phase 5 (Sheets) is highest risk — convention mismatch could corrupt user data
- `workingDaysBetween` migration has **12 callsites** — must update all atomically
  within each phase
- Cascade preserves `count_biz_days_to(start, end)` date gap, NOT `task.duration` field.
  If duration and date gap are out of sync (stale duration), cascade and recalculate
  will produce different end dates. Bug 10 and Bug 13 fixes address this by ensuring
  duration is always recomputed after date changes.
- CPM stays as standard exclusive integer model — no changes needed, no risk

---

## Affected Files (Exhaustive)

### Must change:
- `src/utils/dateUtils.ts` — add `taskDuration`, `taskEndDate`, `ensureBusinessDay`; deprecate `workingDaysBetween`
- `src/utils/__tests__/dateUtils.test.ts` — convention tests, update all duration assertions
- `src/utils/taskFieldValidation.ts` — add weekend rejection to `validateEndDate`, add `validateStartDate`
- `src/utils/__tests__/taskFieldValidation.test.ts` — weekend validation tests
- `src/state/ganttReducer.ts` — RECALCULATE_EARLIEST (Bug 10), migrate 5 `workingDaysBetween` calls
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
to use:

| Function | Language | Status | Use for |
|---|---|---|---|
| `taskDuration(start, end)` | TS | **NEW** | Duration from dates (inclusive) |
| `task_duration(start, end)` | Rust | **NEW** | Duration from dates (inclusive) |
| `taskEndDate(start, dur)` | TS | **NEW** | End date from start+duration |
| `task_end_date(start, dur)` | Rust | **NEW** | End date from start+duration |
| `ensureBusinessDay(date)` | TS | **NEW** | Snap forward to weekday |
| `ensure_business_day(date)` | Rust | **NEW** (rename of `next_biz_day_on_or_after`) | Snap forward to weekday |
| `prevBusinessDay(date)` | TS | **NEW** | Snap backward to weekday |
| `prev_business_day(date)` | Rust | **NEW** | Snap backward to weekday |
| `fs_successor_start(end, lag)` | Rust | **NEW** | FS dep earliest start |
| `ss_successor_start(start, lag)` | Rust | **NEW** | SS dep earliest start |
| `ff_successor_start(end, lag, dur)` | Rust | **NEW** | FF dep earliest start |
| `sf_successor_start(start, lag, dur)` | Rust | **NEW** | SF dep earliest start |
| `addBusinessDays(date, n)` | TS (date-fns) | **KEEP** | Shift by N biz days (generic) |
| `add_business_days(date, n)` | Rust | **KEEP** | Shift by N biz days (generic) |
| `addBusinessDaysToDate(str, n)` | TS | **KEEP** | String wrapper around addBusinessDays |
| `businessDaysBetween(start, end)` | TS | **KEEP** | Pixel mapping in collapsed-weekend mode ONLY |
| `businessDaysDelta(start, end)` | TS | **KEEP** | Signed shift delta for cascade |
| `daysBetween(start, end)` | TS | **KEEP** | Calendar day difference |
| `workingDaysBetween(start, end)` | TS | **DELETE** | ~~Duration~~ → replaced by `taskDuration` |
| `count_biz_days_to(from, to)` | Rust | **KEEP** | Cascade shift calculation (start-exclusive, end-inclusive) |
| `next_biz_day_on_or_after(date)` | Rust | **DEPRECATE** | → `ensure_business_day()` |
