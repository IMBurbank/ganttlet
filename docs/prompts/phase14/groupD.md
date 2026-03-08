---
phase: 14
group: D
stage: 2
agent_count: 1
scope:
  modify:
    - src/state/actions.ts
    - src/state/ganttReducer.ts
    - src/collab/yjsBinding.ts
    - src/state/GanttContext.tsx
    - src/components/gantt/TaskBar.tsx
  read_only: []
depends_on: [A, B, C]
tasks:
  - id: D1
    summary: "Read post-merge"
  - id: D2
    summary: "COMPLETE_DRAG action"
  - id: D3
    summary: "COMPLETE_DRAG handler"
  - id: D4
    summary: "RESIZE_TASK Yjs fix + COMPLETE_DRAG Yjs"
  - id: D5
    summary: "TaskBar mouseup"
  - id: D6
    summary: "TASK_MODIFYING_ACTIONS"
  - id: D7
    summary: "Dependency Yjs ops"
  - id: D8
    summary: "useEffect add/delete sync"
  - id: D9
    summary: "Verify"
---

# Phase 14 Group D — Atomic COMPLETE_DRAG + Structural CRDT Sync (R4, R10)

You are implementing Phase 14 Group D for the Ganttlet project.
Read `CLAUDE.md` and `docs/phase14-recommendations.md` (Sections R4, R10, and Section 9 Key File Reference) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

**CRITICAL CONTEXT**: This is a Stage 2 agent. Stage 1 has already been merged. Before starting work:
1. Read the recent git log (`git log --oneline -20`) to see what Stage 1 changed
2. Read `.agent-status.json` (or `claude-progress.txt`) if it exists
3. Read the CURRENT versions of all files you'll modify — they may have changed in Stage 1

## Success Criteria (you're done when ALL of these are true):
1. A `COMPLETE_DRAG` action type exists in `actions.ts` with payload: `{ taskId, origStartDate, origEndDate, finalStartDate, finalEndDate, mode: 'move' | 'resize' }`
2. `ganttReducer.ts` has a `COMPLETE_DRAG` handler that atomically sets final dates + computes cascade + recalcs summaries
3. `COMPLETE_DRAG` is in `UNDOABLE_ACTIONS` (replacing per-pixel MOVE_TASK undo entries)
4. `COMPLETE_DRAG` is in `TASK_MODIFYING_ACTIONS` set in `GanttContext.tsx`
5. `TaskBar.tsx` mouseup dispatches `COMPLETE_DRAG` instead of separate `CASCADE_DEPENDENTS`
6. `yjsBinding.ts` has a `COMPLETE_DRAG` case that updates all affected tasks in a single `doc.transact()`
7. `ADD_DEPENDENCY`, `UPDATE_DEPENDENCY`, `REMOVE_DEPENDENCY` are in `TASK_MODIFYING_ACTIONS` and have targeted Yjs mutations in `applyActionToYjs`
8. `ADD_TASK` and `DELETE_TASK` sync to Yjs via a `useEffect` diff in `GanttContext.tsx`
9. All existing tests pass (`npm run test`, `npx tsc --noEmit`)
10. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- Drag still dispatches separate MOVE_TASK + CASCADE_DEPENDENTS on mouseup
- Dependency operations don't sync via Yjs
- ADD_TASK/DELETE_TASK don't sync via Yjs
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool where multiple users edit the same
schedule simultaneously via Yjs CRDTs.

## Your files (ONLY modify these):
- `src/state/actions.ts` — add COMPLETE_DRAG action type
- `src/state/ganttReducer.ts` — add COMPLETE_DRAG handler
- `src/collab/yjsBinding.ts` — add COMPLETE_DRAG, ADD_DEPENDENCY, UPDATE_DEPENDENCY, REMOVE_DEPENDENCY Yjs cases
- `src/state/GanttContext.tsx` — add to TASK_MODIFYING_ACTIONS, add useEffect diff for add/delete task sync
- `src/components/gantt/TaskBar.tsx` — change mouseup to dispatch COMPLETE_DRAG

Do NOT modify files in `crates/`, `src/sheets/`, or rendering components like `DependencyLayer.tsx`. Other agents own those files.

## Current Code State (read ALL of these before editing — Stage 1 may have changed them)

### Key things Stage 1 (Groups A, B, C) changed:
- **Group A** modified `TaskBar.tsx` (RAF throttle, localDispatch/collabDispatch split) and `GanttContext.tsx` (dispatch split, active drag tracking, SET_TASKS guard)
- **Group B** modified `ganttReducer.ts` (duration computed from dates), `actions.ts` (RESIZE_TASK newDuration optional), `sheetsMapper.ts`
- **Group C** modified `cascade.rs` (adjacency list) and `schedulerWasm.ts` (instrumentation)

### Actions to read AFTER Stage 1 merge:
1. `src/state/actions.ts` — check RESIZE_TASK payload (Group B made newDuration optional)
2. `src/state/ganttReducer.ts` — check MOVE_TASK/RESIZE_TASK/CASCADE_DEPENDENTS handlers (Group B changed them)
3. `src/state/GanttContext.tsx` — check dispatch split and TASK_MODIFYING_ACTIONS (Group A changed this)
4. `src/components/gantt/TaskBar.tsx` — check new drag handlers (Group A changed this)
5. `src/collab/yjsBinding.ts` — unchanged by Stage 1

### yjsBinding.ts applyActionToYjs (lines 144-283):
Handles: MOVE_TASK, RESIZE_TASK, UPDATE_TASK_FIELD, TOGGLE_EXPAND, HIDE_TASK, SHOW_ALL_TASKS, CASCADE_DEPENDENTS, SET_TASKS, REPARENT_TASK (no-op)
MISSING: COMPLETE_DRAG, ADD_DEPENDENCY, UPDATE_DEPENDENCY, REMOVE_DEPENDENCY, ADD_TASK, DELETE_TASK

### GanttContext.tsx TASK_MODIFYING_ACTIONS (lines 58-66):
```typescript
const TASK_MODIFYING_ACTIONS = new Set([
  'MOVE_TASK', 'RESIZE_TASK', 'UPDATE_TASK_FIELD', 'TOGGLE_EXPAND',
  'HIDE_TASK', 'SHOW_ALL_TASKS', 'CASCADE_DEPENDENTS',
]);
```
MISSING: COMPLETE_DRAG, ADD_DEPENDENCY, UPDATE_DEPENDENCY, REMOVE_DEPENDENCY

### ganttReducer.ts key patterns:
- `cascadeDependents` imported from `schedulerWasm` (WASM call)
- CASCADE_DEPENDENTS handler (lines 155-173): tracks pre/post dates, computes shifts
- ADD_TASK (lines 256-336): generates ID, inserts task, updates parent childIds
- DELETE_TASK (lines 338-358): cascades delete to descendants, cleans up childIds and deps

## Tasks — execute in order:

### D1: Read ALL files after Stage 1 merge

1. `git log --oneline -20` to see what changed
2. Read `src/state/actions.ts` (current version)
3. Read `src/state/ganttReducer.ts` (current version)
4. Read `src/state/GanttContext.tsx` (current version — Group A changed this significantly)
5. Read `src/components/gantt/TaskBar.tsx` (current version — Group A changed drag handlers)
6. Read `src/collab/yjsBinding.ts` (current version)
7. Commit nothing — this is reconnaissance.

### D2: Add COMPLETE_DRAG action type

In `src/state/actions.ts`, add:
```typescript
| { type: 'COMPLETE_DRAG'; taskId: string; origStartDate: string; origEndDate: string; finalStartDate: string; finalEndDate: string; mode: 'move' | 'resize' }
```

Commit: `"feat: add COMPLETE_DRAG action type (R4)"`

### D3: Add COMPLETE_DRAG handler to reducer

In `src/state/ganttReducer.ts`:

1. Add `COMPLETE_DRAG` to `UNDOABLE_ACTIONS` and **remove `MOVE_TASK`** from it:
```typescript
const UNDOABLE_ACTIONS = new Set([
  'RESIZE_TASK', 'CASCADE_DEPENDENTS',
  'ADD_DEPENDENCY', 'UPDATE_DEPENDENCY', 'REMOVE_DEPENDENCY',
  'ADD_TASK', 'DELETE_TASK', 'REPARENT_TASK',
  'RECALCULATE_EARLIEST', 'COMPLETE_DRAG',
]);
```

**WHY remove MOVE_TASK:** Group A's throttled drag dispatches `MOVE_TASK` via `localDispatch` at ~60fps for local rendering. Each dispatch pushes to the undo stack. With `COMPLETE_DRAG` now as the authoritative undo entry for the entire drag, keeping `MOVE_TASK` undoable would pollute the stack with ~60 entries per drag. Removing it means only `COMPLETE_DRAG` creates a single clean undo entry.

2. Add the handler (use `daysBetween` import — should already exist from Group B's work):
```typescript
case 'COMPLETE_DRAG': {
  // 1. Apply final position
  let tasks = state.tasks.map(t => {
    if (t.id !== action.taskId) return t;
    const duration = daysBetween(action.finalStartDate, action.finalEndDate);
    return { ...t, startDate: action.finalStartDate, endDate: action.finalEndDate, duration };
  });

  // 2. Cascade dependents from original position
  if (action.mode === 'move') {
    const delta = daysBetween(action.origStartDate, action.finalStartDate);
    if (delta !== 0) {
      const preCascadeDates = new Map(tasks.map(t => [t.id, { start: t.startDate, end: t.endDate }]));
      tasks = cascadeDependents(tasks, action.taskId, delta);
      const changedIds: string[] = [];
      const shifts: CascadeShift[] = [];
      for (const t of tasks) {
        const pre = preCascadeDates.get(t.id);
        if (pre && (t.startDate !== pre.start || t.endDate !== pre.end)) {
          changedIds.push(t.id);
          shifts.push({ taskId: t.id, fromStartDate: pre.start, fromEndDate: pre.end });
        }
      }
      tasks = recalcSummaryDates(tasks);
      if (changedIds.length > 0) {
        return { ...state, tasks, lastCascadeIds: changedIds, cascadeShifts: shifts };
      }
    }
  } else {
    // Resize: cascade from end date change
    const endDelta = daysBetween(action.origEndDate, action.finalEndDate);
    if (endDelta !== 0) {
      const preCascadeDates = new Map(tasks.map(t => [t.id, { start: t.startDate, end: t.endDate }]));
      tasks = cascadeDependents(tasks, action.taskId, endDelta);
      const changedIds: string[] = [];
      const shifts: CascadeShift[] = [];
      for (const t of tasks) {
        const pre = preCascadeDates.get(t.id);
        if (pre && (t.startDate !== pre.start || t.endDate !== pre.end)) {
          changedIds.push(t.id);
          shifts.push({ taskId: t.id, fromStartDate: pre.start, fromEndDate: pre.end });
        }
      }
      tasks = recalcSummaryDates(tasks);
      if (changedIds.length > 0) {
        return { ...state, tasks, lastCascadeIds: changedIds, cascadeShifts: shifts };
      }
    }
  }

  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks };
}
```

Commit: `"feat: COMPLETE_DRAG reducer handler — atomic position + cascade (R4)"`

### D4: Fix RESIZE_TASK Yjs case + Add COMPLETE_DRAG to Yjs binding

In `src/collab/yjsBinding.ts`:

**First**, fix the existing `RESIZE_TASK` case. Group B made `newDuration` optional — the Yjs binding currently does `ymap.set('duration', action.newDuration)` which would write `undefined` if the field is missing. Change it to compute duration from dates:
```typescript
case 'RESIZE_TASK': {
  // ...existing code...
  ymap.set('endDate', action.newEndDate);
  // Compute duration from dates (newDuration is now optional)
  const duration = daysBetween(ymap.get('startDate') as string, action.newEndDate);
  ymap.set('duration', duration);
  // ...
}
```
Import `daysBetween` from `../utils/dateUtils` if not already imported.

**Then**, add a case for `COMPLETE_DRAG` in `applyActionToYjs`:

```typescript
case 'COMPLETE_DRAG': {
  isLocalUpdate = true;
  try {
    // Read current tasks to compute cascade
    const currentTasks = readTasksFromYjs(doc);
    const updatedTasks = cascadeDependents(
      currentTasks.map(t =>
        t.id === action.taskId
          ? { ...t, startDate: action.finalStartDate, endDate: action.finalEndDate }
          : t
      ),
      action.taskId,
      action.mode === 'move'
        ? daysBetween(action.origStartDate, action.finalStartDate)
        : daysBetween(action.origEndDate, action.finalEndDate)
    );

    doc.transact(() => {
      // Update moved task
      const movedIdx = findTaskIndex(yarray, action.taskId);
      if (movedIdx !== -1) {
        const ymap = yarray.get(movedIdx) as Y.Map<unknown>;
        ymap.set('startDate', action.finalStartDate);
        ymap.set('endDate', action.finalEndDate);
      }

      // Update cascaded tasks
      for (const task of updatedTasks) {
        const orig = currentTasks.find(t => t.id === task.id);
        if (orig && task.id !== action.taskId && (orig.startDate !== task.startDate || orig.endDate !== task.endDate)) {
          const idx = findTaskIndex(yarray, task.id);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('startDate', task.startDate);
            ymap.set('endDate', task.endDate);
          }
        }
      }
    });
  } finally {
    isLocalUpdate = false;
  }
  break;
}
```

You'll need to import `daysBetween` from `../utils/dateUtils`.

Commit: `"feat: COMPLETE_DRAG Yjs binding — single atomic transaction (R4)"`

### D5: Update TaskBar mouseup to use COMPLETE_DRAG

In `src/components/gantt/TaskBar.tsx`, modify the mouseup handler. After Stage 1 merge, Group A's RAF-throttled drag is in place. Find the `onMouseUp` function and change it to dispatch `COMPLETE_DRAG` instead of separate `CASCADE_DEPENDENTS`:

```typescript
function onMouseUp() {
  if (rafId) cancelAnimationFrame(rafId);
  if (dragRef.current) {
    const finalTask = dragRef.current;
    dragRef.current = null;
    setActiveDrag(null);

    // Dispatch atomic COMPLETE_DRAG (replaces MOVE_TASK + CASCADE_DEPENDENTS)
    dispatch({
      type: 'COMPLETE_DRAG',
      taskId,
      origStartDate: finalTask.origStartDate,
      origEndDate: finalTask.origEndDate,
      finalStartDate: finalTask.lastStartDate,
      finalEndDate: finalTask.lastEndDate,
      mode: finalTask.mode,
    });
  }
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}
```

Remove the separate `CASCADE_DEPENDENTS` dispatch entirely.

Commit: `"feat: TaskBar mouseup dispatches COMPLETE_DRAG instead of CASCADE_DEPENDENTS (R4)"`

### D6: Add COMPLETE_DRAG to TASK_MODIFYING_ACTIONS

In `src/state/GanttContext.tsx`, add `COMPLETE_DRAG` to the set:
```typescript
const TASK_MODIFYING_ACTIONS = new Set([
  'MOVE_TASK', 'RESIZE_TASK', 'UPDATE_TASK_FIELD', 'TOGGLE_EXPAND',
  'HIDE_TASK', 'SHOW_ALL_TASKS', 'CASCADE_DEPENDENTS', 'COMPLETE_DRAG',
  'ADD_DEPENDENCY', 'UPDATE_DEPENDENCY', 'REMOVE_DEPENDENCY',
]);
```

Also, export a `useAwareness` hook so that Group F (Stage 3) can access the awareness instance from `TaskBar.tsx`:
```typescript
export function useAwareness() {
  return useContext(AwarenessContext);
}
```
`AwarenessContext` already exists as a module-private context in GanttContext.tsx — just export the hook, not the context itself.

Commit: `"feat: add COMPLETE_DRAG and dependency ops to TASK_MODIFYING_ACTIONS, export useAwareness (R4, R10)"`

### D7: Add dependency operations to Yjs (R10)

In `src/collab/yjsBinding.ts`, add cases for dependency ops:

```typescript
case 'ADD_DEPENDENCY': {
  isLocalUpdate = true;
  try {
    doc.transact(() => {
      const idx = findTaskIndex(yarray, action.taskId);
      if (idx !== -1) {
        const ymap = yarray.get(idx) as Y.Map<unknown>;
        const depsRaw = ymap.get('dependencies') as string;
        let deps: any[] = [];
        try { deps = JSON.parse(depsRaw || '[]'); } catch {}
        deps.push(action.dependency);
        ymap.set('dependencies', JSON.stringify(deps));
      }
    });
  } finally {
    isLocalUpdate = false;
  }
  break;
}

case 'UPDATE_DEPENDENCY': {
  isLocalUpdate = true;
  try {
    doc.transact(() => {
      const idx = findTaskIndex(yarray, action.taskId);
      if (idx !== -1) {
        const ymap = yarray.get(idx) as Y.Map<unknown>;
        const depsRaw = ymap.get('dependencies') as string;
        let deps: any[] = [];
        try { deps = JSON.parse(depsRaw || '[]'); } catch {}
        deps = deps.map((d: any) =>
          d.fromId === action.fromId
            ? { ...d, type: action.newType, lag: action.newLag }
            : d
        );
        ymap.set('dependencies', JSON.stringify(deps));
      }
    });
  } finally {
    isLocalUpdate = false;
  }
  break;
}

case 'REMOVE_DEPENDENCY': {
  isLocalUpdate = true;
  try {
    doc.transact(() => {
      const idx = findTaskIndex(yarray, action.taskId);
      if (idx !== -1) {
        const ymap = yarray.get(idx) as Y.Map<unknown>;
        const depsRaw = ymap.get('dependencies') as string;
        let deps: any[] = [];
        try { deps = JSON.parse(depsRaw || '[]'); } catch {}
        deps = deps.filter((d: any) => d.fromId !== action.fromId);
        ymap.set('dependencies', JSON.stringify(deps));
      }
    });
  } finally {
    isLocalUpdate = false;
  }
  break;
}
```

Commit: `"feat: sync dependency add/update/remove to Yjs (R10)"`

### D8: Add useEffect diff for ADD_TASK/DELETE_TASK sync (R10)

In `src/state/GanttContext.tsx`, add a `useEffect` that diffs `state.tasks` to detect adds/deletes and syncs to Yjs:

```typescript
// Track previous tasks for add/delete detection
const prevTasksRef = useRef<Task[]>(state.tasks);

useEffect(() => {
  const doc = yjsDocRef.current;
  if (!doc) return;

  const prevTasks = prevTasksRef.current;
  const currentTasks = state.tasks;
  prevTasksRef.current = currentTasks;

  const prevIds = new Set(prevTasks.map(t => t.id));
  const currentIds = new Set(currentTasks.map(t => t.id));

  const addedTasks = currentTasks.filter(t => !prevIds.has(t.id));
  const deletedIds = [...prevIds].filter(id => !currentIds.has(id));

  if (addedTasks.length === 0 && deletedIds.length === 0) return;

  // Don't sync if this was triggered by a remote SET_TASKS
  // (the isLocalUpdate flag in yjsBinding prevents echo, but we need our own guard here)
  // Check: if the change came from SET_TASKS dispatched by the Yjs observer, skip
  // We can detect this by checking if the Yjs array already has these tasks

  const yarray = doc.getArray<Y.Map<unknown>>('tasks');

  isLocalUpdate = true; // Need to export or restructure — see note below
  try {
    doc.transact(() => {
      // Handle additions
      for (const task of addedTasks) {
        // Check if Yjs already has this task (from remote)
        if (findTaskIndex(yarray, task.id) === -1) {
          yarray.push([taskToYMap(task)]);
        }

        // Update parent's childIds in Yjs if task has a parent
        if (task.parentId) {
          const parentIdx = findTaskIndex(yarray, task.parentId);
          if (parentIdx !== -1) {
            const parentYmap = yarray.get(parentIdx) as Y.Map<unknown>;
            const childIdsRaw = parentYmap.get('childIds') as string;
            let childIds: string[] = [];
            try { childIds = JSON.parse(childIdsRaw || '[]'); } catch {}
            if (!childIds.includes(task.id)) {
              childIds.push(task.id);
              parentYmap.set('childIds', JSON.stringify(childIds));
            }
          }
        }
      }

      // Handle deletions
      for (const id of deletedIds) {
        const idx = findTaskIndex(yarray, id);
        if (idx !== -1) {
          yarray.delete(idx, 1);
        }
      }

      // Update childIds for parents of deleted tasks
      for (const id of deletedIds) {
        const deletedTask = prevTasks.find(t => t.id === id);
        if (deletedTask?.parentId) {
          const parentIdx = findTaskIndex(yarray, deletedTask.parentId);
          if (parentIdx !== -1) {
            const parentYmap = yarray.get(parentIdx) as Y.Map<unknown>;
            const childIdsRaw = parentYmap.get('childIds') as string;
            let childIds: string[] = [];
            try { childIds = JSON.parse(childIdsRaw || '[]'); } catch {}
            childIds = childIds.filter(cid => cid !== id);
            parentYmap.set('childIds', JSON.stringify(childIds));
          }
        }
      }
    });
  } finally {
    isLocalUpdate = false;
  }
}, [state.tasks]);
```

**IMPORTANT NOTE on `isLocalUpdate`:** This is currently a module-level `let` in `yjsBinding.ts`. You have two options:
1. Export a setter function from `yjsBinding.ts`: `export function setLocalUpdate(val: boolean) { isLocalUpdate = val; }`
2. Move the add/delete Yjs logic into a new exported function in `yjsBinding.ts` that the useEffect calls

Option 2 is cleaner. Add a function to `yjsBinding.ts`:
```typescript
export function syncTaskAdditionsAndDeletions(
  doc: Y.Doc,
  addedTasks: Task[],
  deletedIds: string[],
  prevTasks: Task[]
): void {
  // ... the doc.transact logic from above ...
}
```

Then the useEffect in GanttContext calls it.

Commit: `"feat: sync task add/delete to Yjs via useEffect diff (R10)"`

### D9: Verify and finalize

1. Run `npx tsc --noEmit` — fix any type errors
2. Run `npm run test` — fix any test failures
3. Verify no files outside your scope were modified: `git diff --name-only`
4. Test flow mentally: drag → RAF throttle → COMPLETE_DRAG on mouseup → single Yjs transaction
5. Update `.agent-status.json` with final status
6. Commit any remaining fixes

## Progress Tracking

After completing each major task (D1, D2, etc.), update `.agent-status.json` in the worktree root:

```json
{
  "group": "D",
  "phase": 14,
  "tasks": {
    "D1": { "status": "done", "tests_passing": 3, "tests_failing": 0 },
    "D2": { "status": "in_progress" }
  },
  "last_updated": "2026-03-06T10:30:00Z"
}
```

On restart, read `.agent-status.json` (fall back to `claude-progress.txt`) and `git log --oneline -10` first. Skip completed tasks.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, update .agent-status.json with "status": "blocked", skip dependent tasks.
- Emergency: `git add -A && git commit -m "emergency: groupD saving work"`.
- **Calculations**: NEVER do mental math or date arithmetic. Use `node -e "const {differenceInCalendarDays,addDays}=require('date-fns'); ..."` or `date -d '2026-03-06 + 17 days' +%Y-%m-%d` or `python3 -c "print(...)"`. Prefer `date-fns` directly (`differenceInCalendarDays`, `addDays`, `addBusinessDays`) over project wrappers when writing new code.
