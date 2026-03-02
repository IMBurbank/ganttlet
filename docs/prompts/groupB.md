# Phase 9 Group B — Cascade Bug Fix

You are implementing Phase 9 Group B for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- src/components/table/TaskRow.tsx
- src/components/gantt/TaskBar.tsx
- src/components/gantt/TaskBarPopover.tsx
- src/state/__tests__/ganttReducer.test.ts

## Bug Description

Tasks don't cascade when the duration of their dependencies is increased. Cascade only fires when the start date changes (task move). When the end date changes (via end-date edit or duration change) or when resizing a bar, no `CASCADE_DEPENDENTS` dispatch is made. The Rust cascade engine works fine — the bug is entirely in the TypeScript dispatch call sites.

## Tasks — execute in order:

### B1: Fix TaskRow.tsx — cascade on end-date and duration changes

**End-date branch** (`handleDateUpdate`, the `else` block around lines 77-87):
After the existing dispatches (UPDATE_TASK_FIELD for endDate + duration, ADD_CHANGE_RECORD), add a CASCADE_DEPENDENTS dispatch:
```typescript
const endDelta = daysBetween(oldValue, value);
if (endDelta !== 0) {
  dispatch({ type: 'CASCADE_DEPENDENTS', taskId: task.id, daysDelta: endDelta });
}
```

**Duration handler** (`handleDurationUpdate`, lines 90-102):
Save the old end date before computing the new one, then add CASCADE_DEPENDENTS after existing dispatches:
```typescript
function handleDurationUpdate(value: string) {
  const newDuration = parseInt(value, 10);
  if (isNaN(newDuration) || newDuration < 0) return;
  const oldEndDate = task.endDate;  // save before recomputing
  const oldValue = String(task.duration);
  const newEndDate = addDaysToDate(task.startDate, newDuration);
  dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'duration', value: newDuration });
  dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'endDate', value: newEndDate });
  dispatch({
    type: 'ADD_CHANGE_RECORD',
    taskId: task.id, taskName: task.name, field: 'duration',
    oldValue, newValue: value, user: 'You',
  });
  const endDelta = daysBetween(oldEndDate, newEndDate);
  if (endDelta !== 0) {
    dispatch({ type: 'CASCADE_DEPENDENTS', taskId: task.id, daysDelta: endDelta });
  }
}
```

### B2: Fix TaskBar.tsx — cascade on resize

In the `onMouseUp` handler (lines 101-114), add an `else` branch for resize mode.

1. Add `lastEndDate: string` to the dragRef type (line 46-52):
   ```typescript
   const dragRef = useRef<{
     startX: number;
     origStartDate: string;
     origEndDate: string;
     mode: 'move' | 'resize';
     lastStartDate: string;
     lastEndDate: string;
   } | null>(null);
   ```

2. Initialize `lastEndDate` in `handleMouseDown` (line 63):
   ```typescript
   dragRef.current = { startX: e.clientX, origStartDate: startDate, origEndDate: endDate, mode, lastStartDate: startDate, lastEndDate: endDate };
   ```

3. In `onMouseMove` resize path (around line 97, after the RESIZE_TASK dispatch):
   ```typescript
   dragRef.current.lastEndDate = newEndStr;
   ```

4. In `onMouseUp`, add the resize cascade:
   ```typescript
   if (finalTask.mode === 'move') {
     const delta = daysBetween(finalTask.origStartDate, finalTask.lastStartDate);
     if (delta !== 0) {
       dispatch({ type: 'CASCADE_DEPENDENTS', taskId, daysDelta: delta });
     }
   } else {
     const endDelta = daysBetween(finalTask.origEndDate, finalTask.lastEndDate);
     if (endDelta !== 0) {
       dispatch({ type: 'CASCADE_DEPENDENTS', taskId, daysDelta: endDelta });
     }
   }
   ```

### B3: Fix TaskBarPopover.tsx — cascade on end-date change

In `saveField` (lines 71-80, the `endDate` branch), add CASCADE_DEPENDENTS after the existing dispatches:
```typescript
} else if (field === 'endDate') {
  const newDuration = daysBetween(task!.startDate, value);
  if (newDuration < 0) return;
  dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'endDate', value });
  dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'duration', value: newDuration });
  dispatch({
    type: 'ADD_CHANGE_RECORD',
    taskId, taskName: task!.name, field: 'endDate',
    oldValue, newValue: value, user: 'You',
  });
  const endDelta = daysBetween(oldValue, value);
  if (endDelta !== 0) {
    dispatch({ type: 'CASCADE_DEPENDENTS', taskId, daysDelta: endDelta });
  }
}
```

### B4: Add tests for cascade on duration/end-date changes

In `src/state/__tests__/ganttReducer.test.ts`, add a describe block:

```typescript
describe('CASCADE_DEPENDENTS on end-date/duration changes', () => {
  it('cascades dependents when end date increases (positive delta)', () => {
    const parent = makeTask({ id: 'A', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 });
    const child = makeTask({
      id: 'B', startDate: '2026-03-11', endDate: '2026-03-20', duration: 9,
      dependencies: [{ fromId: 'A', toId: 'B', type: 'finish-to-start' }],
    });
    let state = makeState({ tasks: [parent, child] });

    // Simulate end date change: A's end date moves from Mar 10 to Mar 15 (5 day delta)
    state = ganttReducer(state, { type: 'UPDATE_TASK_FIELD', taskId: 'A', field: 'endDate', value: '2026-03-15' });
    state = ganttReducer(state, { type: 'CASCADE_DEPENDENTS', taskId: 'A', daysDelta: 5 });

    const childTask = state.tasks.find(t => t.id === 'B')!;
    expect(childTask.startDate).toBe('2026-03-16');
    expect(childTask.endDate).toBe('2026-03-25');
  });

  it('cascades dependents when duration decreases (negative delta)', () => {
    const parent = makeTask({ id: 'A', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 });
    const child = makeTask({
      id: 'B', startDate: '2026-03-11', endDate: '2026-03-20', duration: 9,
      dependencies: [{ fromId: 'A', toId: 'B', type: 'finish-to-start' }],
    });
    let state = makeState({ tasks: [parent, child] });

    // Simulate duration decrease: A's end date moves from Mar 10 to Mar 7 (-3 day delta)
    state = ganttReducer(state, { type: 'UPDATE_TASK_FIELD', taskId: 'A', field: 'endDate', value: '2026-03-07' });
    state = ganttReducer(state, { type: 'UPDATE_TASK_FIELD', taskId: 'A', field: 'duration', value: 6 });
    state = ganttReducer(state, { type: 'CASCADE_DEPENDENTS', taskId: 'A', daysDelta: -3 });

    const childTask = state.tasks.find(t => t.id === 'B')!;
    expect(childTask.startDate).toBe('2026-03-08');
    expect(childTask.endDate).toBe('2026-03-17');
  });
});
```

## Verification
After all tasks, run:
```bash
npx tsc --noEmit && npm run test
```
Both must pass. Commit your changes with descriptive messages.
