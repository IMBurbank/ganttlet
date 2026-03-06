# Phase 14 Group B — Duration Derivation + Semantics + Sheets (R2, R7, R9)

You are implementing Phase 14 Group B for the Ganttlet project.
Read `CLAUDE.md` and `docs/phase14-recommendations.md` (Sections R2, R7, R9, and Section 9 Key File Reference) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

## Success Criteria (you're done when ALL of these are true):
1. `duration` on Task type is documented as "calendar days, always derived from daysBetween(startDate, endDate)"
2. `RESIZE_TASK` action makes `newDuration` optional in its payload — duration is computed in the reducer from dates (other files still send it; the reducer ignores it)
3. `ganttReducer.ts` recomputes duration from dates after MOVE_TASK, RESIZE_TASK, and any action that changes dates
4. `sheetsMapper.ts:taskToRow` computes duration from dates using `daysBetween(startDate, endDate)` instead of reading `task.duration`
5. `sheetsMapper.ts:rowToTask` computes duration from dates instead of parsing column 4 (column 4 still exists for readability but is not used as input)
6. `dateUtils.ts` has a clear comment documenting that `daysBetween` returns calendar days
7. All existing tests pass (`npm run test`, `npx tsc --noEmit`)
8. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- `task.duration` is still synced as an independent field that can diverge from dates
- `RESIZE_TASK` action still has `newDuration` as required in its payload type (it should be optional)
- Sheets mapper reads duration from the sheet row as a data input
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool where multiple users edit the same
schedule simultaneously over a network (CRDT-based sync via Yjs). The scheduling engine runs as a
Rust→WASM module in each user's browser.

## Your files (ONLY modify these):
- `src/state/ganttReducer.ts` — recompute duration from dates
- `src/state/actions.ts` — make `newDuration` optional on RESIZE_TASK payload (do NOT remove it — other files still send it)
- `src/types/index.ts` — add documentation comment to `duration` field
- `src/utils/dateUtils.ts` — add documentation comment to `daysBetween`
- `src/sheets/sheetsMapper.ts` — compute duration on write, ignore on read

Do NOT modify `src/components/gantt/TaskBar.tsx`, `src/state/GanttContext.tsx`, `src/collab/yjsBinding.ts`, or any files in `crates/`. Other agents own those files.

## Current Code State (read these before editing)

### actions.ts RESIZE_TASK (line 5):
```typescript
| { type: 'RESIZE_TASK'; taskId: string; newEndDate: string; newDuration: number }
```
Make `newDuration` optional (`newDuration?: number`). Other files (TaskBar.tsx, tests) still pass it — the reducer will just ignore it and compute from dates instead.

### ganttReducer.ts RESIZE_TASK (lines 39-47):
```typescript
case 'RESIZE_TASK': {
  let tasks = state.tasks.map(t =>
    t.id === action.taskId
      ? { ...t, endDate: action.newEndDate, duration: action.newDuration }
      : t
  );
  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks };
}
```
Sets `duration: action.newDuration` — should compute from dates instead.

### ganttReducer.ts MOVE_TASK (lines 29-37):
Does NOT update duration at all. Since the move preserves the start-end span, duration is implicitly preserved. But it should be recomputed to ensure consistency.

### sheetsMapper.ts taskToRow (line 19):
```typescript
String(task.duration),
```
Writes the stored duration. Should compute from dates.

### sheetsMapper.ts rowToTask (line 46):
```typescript
duration: parseInt(get(4)) || 0,
```
Reads duration from sheet. Should compute from dates.

### types/index.ts Task.duration (line 15):
```typescript
duration: number;
```
No documentation. Should clarify this is calendar days, derived from dates.

### TaskBar.tsx (line 96-98) — READ ONLY, DO NOT MODIFY:
```typescript
const newDuration = daysBetween(dragRef.current.origStartDate, newEndStr);
if (newDuration < 1) return;
dispatch({ type: 'RESIZE_TASK', taskId, newEndDate: newEndStr, newDuration });
```
This is the call site for RESIZE_TASK. When you remove `newDuration` from the action type, TaskBar.tsx will have a type error. **You must NOT fix TaskBar.tsx** — Group A owns that file. Instead:
- Make `newDuration` optional in the action type temporarily: `newDuration?: number`
- OR add a note in claude-progress.txt that TaskBar.tsx needs updating after merge

**RECOMMENDED APPROACH**: Make `newDuration` optional in actions.ts so both old and new call sites compile. The reducer ignores it and computes from dates anyway. This avoids cross-group conflicts.

### dateUtils.ts daysBetween (line ~20):
Returns `differenceInCalendarDays` — calendar days, not business days. No documentation comment.

## Tasks — execute in order:

### B1: Read and understand the current code

1. Read `src/state/actions.ts`
2. Read `src/state/ganttReducer.ts` (focus on MOVE_TASK, RESIZE_TASK, ADD_TASK, CASCADE_DEPENDENTS)
3. Read `src/sheets/sheetsMapper.ts`
4. Read `src/types/index.ts` (Task interface)
5. Read `src/utils/dateUtils.ts` (daysBetween function)

### B2: Document duration semantics (R7)

1. In `src/types/index.ts`, add a comment to the `duration` field:
```typescript
/** Calendar days between startDate and endDate (inclusive). Always derived — never edit directly. */
duration: number;
```

2. In `src/utils/dateUtils.ts`, add a comment to `daysBetween`:
```typescript
/**
 * Returns the number of calendar days between two date strings.
 * This is the canonical duration calculation used everywhere.
 * For business-day display, use businessDaysBetween() separately.
 */
```

3. Commit: `"docs: document duration as calendar days, always derived from dates (R7)"`

### B3: Remove newDuration from RESIZE_TASK payload (R2)

1. In `src/state/actions.ts`, make `newDuration` optional:
```typescript
| { type: 'RESIZE_TASK'; taskId: string; newEndDate: string; newDuration?: number }
```
(Optional, not removed — avoids breaking TaskBar.tsx which Group A owns)

2. Commit: `"refactor: make RESIZE_TASK newDuration optional — reducer computes from dates (R2)"`

### B4: Compute duration from dates in the reducer (R2)

1. Add `daysBetween` import to `ganttReducer.ts`:
```typescript
import { daysBetween } from '../utils/dateUtils';
```

2. Modify `RESIZE_TASK` handler to compute duration:
```typescript
case 'RESIZE_TASK': {
  let tasks = state.tasks.map(t => {
    if (t.id !== action.taskId) return t;
    const duration = daysBetween(t.startDate, action.newEndDate);
    return { ...t, endDate: action.newEndDate, duration };
  });
  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks };
}
```

3. Modify `MOVE_TASK` handler to recompute duration (for consistency):
```typescript
case 'MOVE_TASK': {
  let tasks = state.tasks.map(t => {
    if (t.id !== action.taskId) return t;
    const duration = daysBetween(action.newStartDate, action.newEndDate);
    return { ...t, startDate: action.newStartDate, endDate: action.newEndDate, duration };
  });
  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks };
}
```

4. Verify `ADD_TASK` (line 256-336) already sets duration to 5 and computes endDate as today+5. This is OK — duration matches the date span. But you can make it explicit by computing `duration: daysBetween(today, endDateStr)`.

5. Commit: `"feat: compute duration from dates in reducer — never trust action payload (R2)"`

### B5: Sheets mapper — compute on write, ignore on read (R9)

1. In `src/sheets/sheetsMapper.ts`, add `daysBetween` import:
```typescript
import { daysBetween } from '../utils/dateUtils';
```

2. Modify `taskToRow` to compute duration:
```typescript
// Duration column: computed from dates, not stored field (R9)
String(daysBetween(task.startDate, task.endDate)),
```

3. Modify `rowToTask` to compute duration from dates:
```typescript
// Duration: computed from dates, ignoring sheet column 4 (R9 — sheet column is for human readability only)
duration: (() => {
  const s = get(2); // startDate
  const e = get(3); // endDate
  if (s && e) return daysBetween(s, e);
  return parseInt(get(4)) || 0; // Fallback for legacy data without dates
})(),
```

4. Add comments explaining the convention in both functions.

5. Commit: `"feat: Sheets duration column is computed-on-write, ignored-on-read (R9)"`

### B6: Verify and finalize

1. Run `npx tsc --noEmit` — fix any type errors
2. Run `npm run test` — fix any test failures
3. Verify no files outside your scope were modified: `git diff --name-only`
4. If there are test files under `src/` that test duration behavior, update them to match the new semantics
5. Update `claude-progress.txt` with final status
6. Commit any remaining fixes

## Progress Tracking

After completing each major task (B1, B2, etc.), append a status line to `claude-progress.txt`:
```
B1: DONE — read and understood duration handling across codebase
B2: DONE — documented duration semantics
```
On restart, read `claude-progress.txt` FIRST.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.
- Emergency: `git add -A && git commit -m "emergency: groupB saving work"`.
