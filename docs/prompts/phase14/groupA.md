---
phase: 14
group: A
stage: 1
agent_count: 1
scope:
  modify:
    - src/components/gantt/TaskBar.tsx
    - src/state/GanttContext.tsx
  read_only:
    - src/collab/yjsBinding.ts
depends_on: []
tasks:
  - id: A1
    summary: "Read code"
  - id: A2
    summary: "Split dispatch"
  - id: A3
    summary: "Active drag tracking"
  - id: A4
    summary: "Guard SET_TASKS"
  - id: A5
    summary: "Throttle drag dispatch"
  - id: A6
    summary: "Verify"
---

# Phase 14 Group A — Drag Throttle + SET_TASKS Guard (R1, R3)

You are implementing Phase 14 Group A for the Ganttlet project.
Read `CLAUDE.md` and `docs/phase14-recommendations.md` (Sections R1, R3, and Section 9 Key File Reference) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

## Success Criteria (you're done when ALL of these are true):
1. `TaskBar.tsx` uses `requestAnimationFrame` to throttle MOVE_TASK dispatch during drag (~60fps max)
2. `TaskBar.tsx` only dispatches MOVE_TASK if the computed date actually changed from previous dispatch
3. CRDT broadcasts during drag are throttled to ~100ms intervals (10fps) via `collabDispatch`, with a final authoritative write on mouseup
4. `GanttContext.tsx` exposes both `localDispatch` (React state only) and `collabDispatch` (React + Yjs) via context
5. `GanttContext.tsx` tracks active drag state (`activeDragTaskId`) and exposes it
6. The Yjs observer in `yjsBinding.ts` OR `GanttContext.tsx` preserves the active-drag task's dates during `SET_TASKS` from remote updates (R3)
7. All existing tests pass (`npm run test`, `npx tsc --noEmit`)
8. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- TaskBar still dispatches on every mousemove without throttling
- No RAF-based throttle visible in the drag handler
- `localDispatch` not accessible from TaskBar
- SET_TASKS still overwrites an actively-dragged task's dates
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool where multiple users edit the same
schedule simultaneously over a network (CRDT-based sync via Yjs). The scheduling engine runs as a
Rust→WASM module in each user's browser.

## Your files (ONLY modify these):
- `src/components/gantt/TaskBar.tsx` — drag handlers (mousedown/mousemove/mouseup)
- `src/state/GanttContext.tsx` — dispatch split, active drag tracking, SET_TASKS guard

Do NOT modify `src/state/ganttReducer.ts`, `src/state/actions.ts`, `src/collab/yjsBinding.ts`, or any other files. Other agents own those files.

## Current Code State (read these before editing)

### TaskBar.tsx drag flow (lines 61-125):
- `handleMouseDown` creates closures for `onMouseMove`/`onMouseUp` and adds document listeners
- Every mousemove computes new dates via `xToDateCollapsed` and dispatches `MOVE_TASK`
- Duration is computed from `daysBetween(origStartDate, origEndDate)` and preserved during move
- On mouseup, `CASCADE_DEPENDENTS` is dispatched with `daysBetween(origStartDate, lastStartDate)`
- `dragRef.current` stores: `{ startX, origStartDate, origEndDate, mode, lastStartDate, lastEndDate }`

### GanttContext.tsx (lines 57-96):
- `TASK_MODIFYING_ACTIONS` set (line 58-66) determines what syncs to Yjs
- `collabDispatch` (line 87-96) dispatches to reducer AND calls `applyActionToYjs`
- Only `collabDispatch` is exposed via `GanttDispatchContext` — raw `dispatch` is not exposed
- `useGanttDispatch()` returns `collabDispatch`
- The `pendingFullSyncRef` pattern handles UNDO/REDO/REPARENT full sync

### yjsBinding.ts observer (line 98-109):
- `bindYjsToDispatch` sets up an `observeDeep` observer on the Yjs tasks array
- When remote changes arrive, it reads all tasks from Yjs and dispatches `SET_TASKS`
- The `isLocalUpdate` flag prevents echoing back local changes

## Tasks — execute in order:

### A1: Read and understand the current code

1. Read `src/components/gantt/TaskBar.tsx` (full file)
2. Read `src/state/GanttContext.tsx` (full file)
3. Read `src/collab/yjsBinding.ts` (focus on `bindYjsToDispatch` observer, lines 98-109)
4. Understand the current flow: `TaskBar` calls `dispatch` (which is `collabDispatch`) → both reducer and Yjs update

### A2: Split dispatch into localDispatch + collabDispatch

In `GanttContext.tsx`:

1. Create a new context for local-only dispatch:
```typescript
const LocalDispatchContext = createContext<Dispatch<GanttAction>>(() => {});
```

2. Create `localDispatch` that calls only the React reducer (no Yjs):
```typescript
const localDispatch = useCallback<Dispatch<GanttAction>>((action: GanttAction) => {
  dispatch(action);
}, []);
```

3. Expose both via providers:
```tsx
<LocalDispatchContext.Provider value={localDispatch}>
  <GanttDispatchContext.Provider value={collabDispatch}>
    ...
  </GanttDispatchContext.Provider>
</LocalDispatchContext.Provider>
```

4. Add a `useLocalDispatch` hook:
```typescript
export function useLocalDispatch() {
  return useContext(LocalDispatchContext);
}
```

5. Commit: `"feat: split dispatch into localDispatch + collabDispatch (R1)"`

### A3: Add active drag tracking

In `GanttContext.tsx`:

1. Add a ref and setter for active drag state:
```typescript
const activeDragRef = useRef<{ taskId: string; startDate: string; endDate: string } | null>(null);
```

2. Create a context and hook to expose the setter:
```typescript
const SetActiveDragContext = createContext<(drag: { taskId: string; startDate: string; endDate: string } | null) => void>(() => {});

export function useSetActiveDrag() {
  return useContext(SetActiveDragContext);
}
```

3. Create a getter function accessible from the Yjs observer scope (closure or ref):
```typescript
const getActiveDrag = useCallback(() => activeDragRef.current, []);
```

4. Commit: `"feat: add active drag tracking to GanttContext (R3)"`

### A4: Guard SET_TASKS during active drag

In `GanttContext.tsx`, modify the approach. Since the Yjs observer dispatches `SET_TASKS` via the raw `dispatch`, we need to intercept it. Option: wrap the dispatch passed to `bindYjsToDispatch`:

1. Create a guarded dispatch for the Yjs observer that preserves active drag state:
```typescript
const guardedDispatch = useCallback<Dispatch<GanttAction>>((action: GanttAction) => {
  if (action.type === 'SET_TASKS' && activeDragRef.current) {
    const drag = activeDragRef.current;
    const tasks = action.tasks.map(t =>
      t.id === drag.taskId
        ? { ...t, startDate: drag.startDate, endDate: drag.endDate }
        : t
    );
    dispatch({ type: 'SET_TASKS', tasks });
  } else {
    dispatch(action);
  }
}, []);
```

2. Pass `guardedDispatch` to `bindYjsToDispatch` instead of raw `dispatch`:
```typescript
cleanup = bindYjsToDispatch(doc, guardedDispatch);
```

3. Write a test or verify manually that dragging doesn't snap back on remote updates.

4. Commit: `"feat: guard SET_TASKS during active drag to prevent snap-back (R3)"`

### A5: Throttle drag dispatch in TaskBar

In `TaskBar.tsx`:

1. Import `useLocalDispatch` from GanttContext
2. Import `useSetActiveDrag` from GanttContext
3. Get both dispatchers:
```typescript
const dispatch = useGanttDispatch();     // collabDispatch (React + Yjs)
const localDispatch = useLocalDispatch(); // React only
const setActiveDrag = useSetActiveDrag();
```

4. Modify `handleMouseDown` to use RAF throttle + CRDT broadcast throttle:
```typescript
const handleMouseDown = useCallback((e: React.MouseEvent, mode: 'move' | 'resize') => {
  e.preventDefault();
  e.stopPropagation();
  dragRef.current = { startX: e.clientX, origStartDate: startDate, origEndDate: endDate, mode, lastStartDate: startDate, lastEndDate: endDate };

  setActiveDrag({ taskId, startDate, endDate });

  let rafId: number | null = null;
  let lastBroadcast = 0;
  let pendingAction: GanttAction | null = null;

  function onMouseMove(ev: MouseEvent) {
    if (!dragRef.current) return;
    const dx = ev.clientX - dragRef.current.startX;

    if (dragRef.current.mode === 'move') {
      // ... same date computation as current code ...
      // IMPORTANT: update BOTH lastStartDate AND lastEndDate in dragRef
      dragRef.current.lastStartDate = newStartStr;
      dragRef.current.lastEndDate = newEndStr;

      const action = { type: 'MOVE_TASK' as const, taskId, newStartDate: newStartStr, newEndDate: newEndStr };
      pendingAction = action;

      // Update drag tracking
      setActiveDrag({ taskId, startDate: newStartStr, endDate: newEndStr });

      // Throttle local render via RAF
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (pendingAction) localDispatch(pendingAction);
        });
      }

      // Throttle CRDT broadcast to ~10fps
      const now = performance.now();
      if (now - lastBroadcast > 100) {
        lastBroadcast = now;
        dispatch(action);
      }
    } else {
      // ... same resize logic, using localDispatch for RAF and dispatch for CRDT ...
    }
  }

  function onMouseUp() {
    if (rafId) cancelAnimationFrame(rafId);
    if (dragRef.current) {
      const finalTask = dragRef.current;
      dragRef.current = null;
      setActiveDrag(null);

      // Final authoritative CRDT write
      if (pendingAction) {
        dispatch(pendingAction);
      }

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
    }
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}, [dispatch, localDispatch, setActiveDrag, taskId, startDate, endDate, timelineStart, colWidth, zoom, minWidth, collapseWeekends, earliestStart]);
```

**IMPORTANT:** Preserve the existing date computation logic exactly (lines 71-86 for move, 91-99 for resize). Only change the dispatch pattern, not the date math.

**CRITICAL BUG FIX:** The current code (line 88) only updates `dragRef.current.lastStartDate` during move but NOT `lastEndDate`. You MUST update BOTH:
```typescript
dragRef.current.lastStartDate = newStartStr;
dragRef.current.lastEndDate = newEndStr;  // <-- this is missing in the current code!
```
Group D (Stage 2) reads `finalTask.lastEndDate` in the COMPLETE_DRAG payload. If you don't update it during move, it will be stale (the original end date) and the drag result will be wrong.

**UNDO STACK NOTE:** `localDispatch` dispatches `MOVE_TASK` which is in `UNDOABLE_ACTIONS`, so each RAF tick pushes an undo entry (~60/sec). This is acceptable in Stage 1 — Group D (Stage 2) will fix this by removing `MOVE_TASK` from `UNDOABLE_ACTIONS` once `COMPLETE_DRAG` is the authoritative undo entry.

5. Commit: `"feat: throttle drag dispatch via RAF + 100ms CRDT broadcast (R1)"`

### A6: Verify and finalize

1. Run `npx tsc --noEmit` — fix any type errors
2. Run `npm run test` — fix any test failures
3. Verify no files outside your scope were modified: `git diff --name-only`
4. Update `.agent-status.json` with final status
5. Commit any remaining fixes

## Progress Tracking

After completing each major task (A1, A2, etc.), update `.agent-status.json` in the worktree root:

```json
{
  "group": "A",
  "phase": 14,
  "tasks": {
    "A1": { "status": "done", "tests_passing": 3, "tests_failing": 0 },
    "A2": { "status": "in_progress" }
  },
  "last_updated": "2026-03-06T10:30:00Z"
}
```

On restart, read `.agent-status.json` (fall back to `claude-progress.txt`) and `git log --oneline -10` first. Skip completed tasks.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK (not "stop all work").
- Level 3 (blocked): Commit, update .agent-status.json with "status": "blocked", skip dependent tasks.
- Emergency: If running out of context, `git add -A && git commit -m "emergency: groupA saving work"`.
- **Calculations**: NEVER do mental math or date arithmetic. Use `node -e "const {differenceInCalendarDays,addDays}=require('date-fns'); ..."` or `date -d '2026-03-06 + 17 days' +%Y-%m-%d` or `python3 -c "print(...)"`. Prefer `date-fns` directly (`differenceInCalendarDays`, `addDays`, `addBusinessDays`) over project wrappers when writing new code.
