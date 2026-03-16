---
phase: 16
group: E
stage: 3
agent_count: 1
scope:
  modify:
    - src/state/ganttReducer.ts
    - src/state/__tests__/ganttReducer.test.ts
    - src/utils/schedulerWasm.ts
    - src/utils/summaryUtils.ts
  read_only:
    - docs/plans/date-calc-fixes.md
    - src/utils/dateUtils.ts
    - src/types/index.ts
depends_on: [B]
tasks:
  - id: E1
    summary: "Read ganttReducer.ts — understand all workingDaysBetween callsites"
  - id: E2
    summary: "Migrate 5 workingDaysBetween calls in ganttReducer to taskDuration"
  - id: E3
    summary: "Fix ADD_TASK: ensureBusinessDay(today), taskEndDate for end"
  - id: E4
    summary: "Fix all end-date derivations in ganttReducer to use taskEndDate"
  - id: E5
    summary: "Fix schedulerWasm.ts:168 — use taskDuration"
  - id: E6
    summary: "Fix recalcSummaryDates (Bug 13): add duration recomputation"
  - id: E7
    summary: "Update ganttReducer.test.ts — fix assertions, add convention tests"
---

# Phase 16 Group E — TypeScript State + Reducer Fixes

You are implementing Phase 16 Group E for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

The TS state layer (ganttReducer, schedulerWasm, summaryUtils) uses `workingDaysBetween`
(exclusive, returns value 1 too low) and raw `addBusinessDays(start, duration)` for end dates
(1 day too far). Group B added `taskDuration`, `taskEndDate`, `ensureBusinessDay`, and
`withDuration`. Now you migrate all callers.

**Critical:** This group ships together with Group D (Rust fixes). Rust formulas now expect
inclusive duration values. You are switching TS from exclusive to inclusive, which makes
Rust correct.

**What changes:**
- `workingDaysBetween(start, end)` → `taskDuration(start, end)` (returns value +1 larger)
- `addBusinessDaysToDate(start, duration)` → `taskEndDate(start, duration)` for end dates
- `ADD_TASK`: snap today to business day, use `taskEndDate` for default end

## Your files (ONLY modify these):
- `src/state/ganttReducer.ts`
- `src/state/__tests__/ganttReducer.test.ts`
- `src/utils/schedulerWasm.ts`
- `src/utils/summaryUtils.ts`

**Read-only:**
- `docs/plans/date-calc-fixes.md` — §Stage 3, §Bug 13, §Bug 14 context
- `src/utils/dateUtils.ts` — new functions from Group B
- `src/types/index.ts` — Task type

## Tasks — execute in order:

### E1: Read and understand

Read `ganttReducer.ts` and identify ALL 5 `workingDaysBetween` callsites:
1. Line 33: `MOVE_TASK` — recomputes duration after moving dates
2. Line 43: `RESIZE_TASK` — recomputes duration after resize
3. Line 59: `UPDATE_TASK_FIELD` — recomputes duration when start/end changes
4. Line 283: `ADD_TASK` — computes initial duration
5. Line 546: `COMPLETE_DRAG` — recomputes duration after drag

Also identify all `addBusinessDaysToDate` calls that derive end dates from duration.

Read `schedulerWasm.ts` line 168 — cascade result duration derivation.
Read `summaryUtils.ts` — `recalcSummaryDates` function.

### E2: Migrate workingDaysBetween calls in ganttReducer

Replace all 5 `workingDaysBetween` calls with `taskDuration`:

```typescript
// Import at top:
import { taskDuration, taskEndDate, ensureBusinessDay, withDuration } from '../utils/dateUtils';

// BEFORE (each callsite):
duration: workingDaysBetween(startDate, endDate)
// AFTER:
duration: taskDuration(startDate, endDate)
```

**Consider using `withDuration`** where a task object with new dates is being constructed:
```typescript
// BEFORE:
{ ...task, startDate: newStart, endDate: newEnd, duration: workingDaysBetween(newStart, newEnd) }
// AFTER:
withDuration({ ...task, startDate: newStart, endDate: newEnd })
```

But only if it fits the code pattern naturally. Don't force it if the code constructs fields
individually.

Commit: `"fix: migrate ganttReducer workingDaysBetween → taskDuration (5 callsites)"`

### E3: Fix ADD_TASK

The `ADD_TASK` action (around line 273-283) currently creates a task with:
- Start date: `new Date()` (can be a weekend!)
- End date: derived via calendar day offset (can also be a weekend)
- Duration: `workingDaysBetween(start, end)` (exclusive, wrong)

Fix to:
```typescript
case 'ADD_TASK': {
  const today = new Date();
  const startDate = format(ensureBusinessDay(today), 'yyyy-MM-dd');
  const duration = 5;  // default duration
  const endDate = taskEndDate(startDate, duration);
  // ... rest of task construction with startDate, endDate, duration
}
```

This ensures:
- Start is always a business day (weekends snap to Monday)
- End is derived from `taskEndDate` (always correct)
- Duration is explicit (not derived from potentially wrong dates)

Commit: `"fix: ADD_TASK — snap to business day, use taskEndDate (Bug 9)"`

### E4: Fix end-date derivations in ganttReducer

Find all places where end date is derived from start + duration using raw `addBusinessDaysToDate`
or `addBusinessDays` and replace with `taskEndDate`:

```typescript
// BEFORE:
endDate: addBusinessDaysToDate(startDate, duration)
// or:
endDate: format(addBusinessDays(parseISO(startDate), duration), 'yyyy-MM-dd')

// AFTER:
endDate: taskEndDate(startDate, duration)
```

This applies to cases like UPDATE_TASK_FIELD when start changes and end must follow.
Check each action type for end-date derivation patterns.

Commit: `"fix: ganttReducer end-date derivations — use taskEndDate"`

### E5: Fix schedulerWasm cascade result

In `schedulerWasm.ts`, line 168 — cascade result processing computes duration from
the cascade's returned start/end dates:

```typescript
// BEFORE:
duration: workingDaysBetween(result.start_date, result.end_date)
// AFTER:
duration: taskDuration(result.start_date, result.end_date)
```

Import `taskDuration` from `dateUtils`.

Commit: `"fix: schedulerWasm cascade result — use taskDuration"`

### E6: Fix recalcSummaryDates (Bug 13)

In `summaryUtils.ts`, the `recalcSummaryDates` function sets `startDate` and `endDate` from
children's min/max but never updates `duration`:

```typescript
// BEFORE:
task.startDate = minStart;
task.endDate = maxEnd;
task.done = allDone;

// AFTER:
task.startDate = minStart;
task.endDate = maxEnd;
task.duration = taskDuration(minStart, maxEnd);
task.done = allDone;
```

Import `taskDuration` from `dateUtils`.

Commit: `"fix: recalcSummaryDates — recompute summary duration (Bug 13)"`

### E7: Update ganttReducer.test.ts

Update all test assertions to use inclusive duration values:

1. All duration assertions increase by 1 (since inclusive counts both endpoints)
2. Add new test cases:
   - `ADD_TASK` on a Saturday → start is Monday
   - `ADD_TASK` on a Sunday → start is Monday
   - `ADD_TASK` on a weekday → start is that day
   - `MOVE_TASK` preserves duration correctly
   - `RESIZE_TASK` computes inclusive duration
   - `UPDATE_TASK_FIELD` recomputes inclusive duration
   - Summary duration recomputed after children move

**IMPORTANT:** Use `taskDuration`/`taskEndDate` shell functions to calculate ALL expected duration values. NEVER compute by hand.

Example verification:
```bash
taskDuration 2026-03-02 2026-03-06
# Should output 5 (Mon-Fri inclusive)
```

Commit: `"test: update ganttReducer tests for inclusive convention"`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupE saving work"`.
- **Calculations**: NEVER do mental math. Use `taskEndDate`/`taskDuration` shell functions for ALL date arithmetic.
