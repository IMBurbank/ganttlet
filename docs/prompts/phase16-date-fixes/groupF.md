---
phase: 16
group: F
stage: 4
agent_count: 1
scope:
  modify:
    - src/components/gantt/TaskBar.tsx
    - src/components/gantt/GanttChart.tsx
    - src/components/gantt/TodayLine.tsx
    - src/components/table/TaskRow.tsx
    - src/components/gantt/TaskBarPopover.tsx
    - src/utils/dateUtils.ts
    - src/utils/dependencyUtils.ts
    - src/utils/taskFieldValidation.ts
    - src/utils/__tests__/taskFieldValidation.test.ts
    - src/utils/__tests__/dateUtils.test.ts
  read_only:
    - docs/plans/date-calc-fixes.md
    - src/types/index.ts
    - src/state/ganttReducer.ts
depends_on: [B, E]
tasks:
  - id: F1
    summary: "Read GanttChart.tsx, TaskBar.tsx — understand bar width and dateToX"
  - id: F2
    summary: "Fix bar width: taskEndX - taskX + colWidth"
  - id: F3
    summary: "Fix drag move: snap to business day during drag"
  - id: F4
    summary: "Fix drag resize: end snaps to prev business day, min 1-day"
  - id: F5
    summary: "Fix taskFieldValidation: weekend rejection + validateStartDate"
  - id: F6
    summary: "Fix end-date derivation: TaskRow + TaskBarPopover → taskEndDate"
  - id: F7
    summary: "Migrate workingDaysBetween: TaskBar, TaskRow, TaskBarPopover → taskDuration"
  - id: F8
    summary: "Rename dateToXCollapsed→dateToX, old→Calendar variants (Bug 12)"
  - id: F9
    summary: "Verify collapsed-weekend mode still works"
  - id: F10
    summary: "Write taskFieldValidation tests"
---

# Phase 16 Group F — Rendering + UI Weekend Prevention

You are implementing Phase 16 Group F for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

The UI layer needs three categories of fixes:
1. **Bar width** — inclusive end means bars need `+ colWidth` to include the end column
2. **Weekend prevention** — drag and edit must prevent weekend start/end dates
3. **Function renaming** — `dateToXCollapsed` → `dateToX` (the correct default)

**Key convention:**
- End date is inclusive (last working day)
- Bar width = end column position - start column position + one column width
- No task can start or end on a weekend

## Your files (ONLY modify these):

**Modify:**
- `src/components/gantt/TaskBar.tsx` — drag handlers, bar rendering
- `src/components/gantt/GanttChart.tsx` — bar width computation
- `src/components/gantt/TodayLine.tsx` — today line position
- `src/components/table/TaskRow.tsx` — inline date editing, end-date derivation
- `src/components/gantt/TaskBarPopover.tsx` — popover date editing
- `src/utils/dateUtils.ts` — rename dateToX functions
- `src/utils/dependencyUtils.ts` — rename dateToXCollapsed→dateToX (4 callsites)
- `src/utils/taskFieldValidation.ts` — add weekend validation
- `src/utils/__tests__/taskFieldValidation.test.ts` — validation tests
- `src/utils/__tests__/dateUtils.test.ts` — rename dateToXCollapsed→dateToX in tests

**Read-only:**
- `docs/plans/date-calc-fixes.md` — §Stage 4, §Bug 8, §Bug 9, §Bug 12
- `src/types/index.ts` — Task type
- `src/state/ganttReducer.ts` — understand what actions are dispatched

## Tasks — execute in order:

### F1: Read and understand

Read these files, focusing on:
1. `GanttChart.tsx` — lines 139, 173: bar width computation. How `dateToX`/`dateToXCollapsed` is used.
2. `TaskBar.tsx` — drag handlers (onMouseDown, onMouseMove), how start/end dates are computed during drag. Line 131: `workingDaysBetween` during resize.
3. `TodayLine.tsx` — line 3 and 15: uses `dateToX` (wrong — should use collapsed variant)
4. `TaskRow.tsx` — lines 77, 90, 111: end-date derivation and `workingDaysBetween`
5. `TaskBarPopover.tsx` — lines 73, 87: end-date derivation and `workingDaysBetween`
6. `taskFieldValidation.ts` — `validateEndDate` function (lines 24-28)
7. `dateUtils.ts` — `dateToX`, `xToDate`, `dateToXCollapsed`, `xToDateCollapsed`

### F2: Fix bar width (Bug 8)

In `GanttChart.tsx`, find bar width computation (around lines 139, 173). Currently:
```typescript
const width = taskEndX - taskX;  // excludes end column
```

Fix to include the end-date column:
```typescript
const width = taskEndX - taskX + colWidth;  // includes end column (inclusive)
```

Where `colWidth` is the column width at current zoom level. Find how column width is
accessed in the component (likely via props or computed value).

Commit: `"fix: bar width includes end-date column (inclusive convention)"`

### F3: Fix drag move — snap to business day

In `TaskBar.tsx`, the drag move handler computes new start/end dates from mouse position
using `xToDate`/`xToDateCollapsed`. These can return weekend dates in non-collapsed mode.

After computing the new date from mouse position, snap it:
```typescript
import { ensureBusinessDay } from '../../utils/dateUtils';

// After computing newStartDate from xToDate:
const snappedStart = format(ensureBusinessDay(parseISO(newStartDate)), 'yyyy-MM-dd');
```

This ensures the ghost bar never sits on a weekend column. In collapsed-weekend mode,
weekends aren't visible so this is a no-op.

Commit: `"fix: drag move snaps to business day — prevents weekend placement"`

### F4: Fix drag resize — end snaps to prev business day

In `TaskBar.tsx`, the resize handler computes new end date from mouse position. The end
date should snap **backward** (to Friday) if it lands on a weekend:

```typescript
import { prevBusinessDay } from '../../utils/dateUtils';

// After computing newEndDate from xToDate:
const snappedEnd = format(prevBusinessDay(parseISO(newEndDate)), 'yyyy-MM-dd');

// Enforce minimum 1-day duration:
if (snappedEnd < task.startDate) {
  snappedEnd = task.startDate;  // minimum: same-day task (duration 1)
}
```

Commit: `"fix: drag resize snaps end to prev business day, min 1-day duration"`

### F5: Fix taskFieldValidation — weekend rejection

In `taskFieldValidation.ts`:

1. Update `validateEndDate` to reject weekends:
```typescript
export function validateEndDate(value: string, startDate: string): string | null {
  if (isWeekendDate(value)) return 'End date cannot be a weekend';
  if (value < startDate) return 'End date must be on or after start date';
  return null;
}
```

2. Add `validateStartDate`:
```typescript
export function validateStartDate(value: string, endDate: string): string | null {
  if (isWeekendDate(value)) return 'Start date cannot be a weekend';
  if (value > endDate) return 'Start date must be on or before end date';
  return null;
}
```

Import `isWeekendDate` from `dateUtils`.

Commit: `"feat: add weekend rejection to date validation"`

### F6: Fix end-date derivation in TaskRow + TaskBarPopover

**TaskRow.tsx line 77** — when start date changes, end is derived:
```typescript
// BEFORE:
addBusinessDaysToDate(value, task.duration)
// AFTER:
taskEndDate(value, task.duration)
```

**TaskRow.tsx line 111** — when duration changes, end is derived:
```typescript
// BEFORE:
addBusinessDaysToDate(task.startDate, newDuration)
// AFTER:
taskEndDate(task.startDate, newDuration)
```

**TaskBarPopover.tsx line 73** — same pattern:
```typescript
// BEFORE:
addBusinessDaysToDate(value, task!.duration)
// AFTER:
taskEndDate(value, task!.duration)
```

Import `taskEndDate` from `dateUtils`.

Commit: `"fix: end-date derivation in TaskRow + TaskBarPopover → taskEndDate"`

### F7: Migrate workingDaysBetween

Three remaining `workingDaysBetween` callsites in UI components:

**TaskBar.tsx line 131** — resize drag:
```typescript
// BEFORE:
workingDaysBetween(task.startDate, newEndDate)
// AFTER:
taskDuration(task.startDate, newEndDate)
```

**TaskRow.tsx line 90** — end date edit:
```typescript
// BEFORE:
workingDaysBetween(task.startDate, value)
// AFTER:
taskDuration(task.startDate, value)
```

**TaskBarPopover.tsx line 87** — end date edit:
```typescript
// BEFORE:
workingDaysBetween(task!.startDate, value)
// AFTER:
taskDuration(task!.startDate, value)
```

Import `taskDuration` from `dateUtils`.

Commit: `"fix: migrate UI workingDaysBetween → taskDuration (3 callsites)"`

### F8: Rename dateToX functions (Bug 12)

In `dateUtils.ts`, rename:
- `dateToX` → `dateToXCalendar` (internal, includes weekends)
- `xToDate` → `xToDateCalendar` (internal, includes weekends)
- `dateToXCollapsed` → `dateToX` (the correct default — handles both modes)
- `xToDateCollapsed` → `xToDate` (the correct default)

Then update ALL callsites across the codebase:
- Every `dateToXCollapsed(` → `dateToX(` (23+ callsites in GanttChart, TaskBar, etc.)
- Every `xToDateCollapsed(` → `xToDate(`
- `TodayLine.tsx` currently uses old `dateToX` → now calls new `dateToX` which is weekend-aware
- The old `dateToX` (now `dateToXCalendar`) should only be called from within the new `dateToX`

**Files with callsites (~42 references total):**
- `GanttChart.tsx` — 10 `dateToXCollapsed`
- `TaskBar.tsx` — 7 `dateToXCollapsed` + 4 `xToDateCollapsed`
- `dependencyUtils.ts` — 5 `dateToXCollapsed` (1 import + 4 calls)
- `dateUtils.test.ts` — 10 `dateToXCollapsed` + 7 `xToDateCollapsed` + 1 `dateToX` + 1 `xToDate`
- `TodayLine.tsx` — 1 `dateToX` (old, becomes the correct name automatically)
- `dateUtils.ts` — 1 definition of each (rename these first)

**Strategy:** Do the rename in `dateUtils.ts` first, then use grep to find and fix all imports
and callsites across all files above. The compiler (`tsc`) will catch any you miss.

Commit: `"refactor: rename dateToXCollapsed→dateToX — weekend-aware is default (Bug 12)"`

### F9: Verify collapsed-weekend mode

After all changes, mentally trace through the collapsed-weekend rendering path:
1. `dateToX` (new name) with `collapseWeekends=true` — does it still compute correct X positions?
2. Bar width `taskEndX - taskX + colWidth` — is colWidth correct in collapsed mode?
3. Drag handlers using new `xToDate` — do they return correct dates in collapsed mode?

If anything looks wrong, fix it. If you can't verify without running the app, note it
in your commit message and `.agent-status.json`.

Commit: (only if fixes needed) `"fix: collapsed-weekend mode adjustments"`

### F10: Write taskFieldValidation tests

In `taskFieldValidation.test.ts`:

1. `validateEndDate`:
   - Weekend date → error message
   - End before start → error message
   - Valid end date → null
   - Same day as start → null (valid 1-day task)

2. `validateStartDate`:
   - Weekend date → error message
   - Start after end → error message
   - Valid start date → null

Commit: `"test: weekend validation tests for taskFieldValidation"`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupF saving work"`.
- **Calculations**: NEVER do mental math.
