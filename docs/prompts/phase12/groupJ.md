# Phase 12 Group J — Cascade UX + Recalculate UI

You are implementing Phase 12 Group J for the Ganttlet project.
Read CLAUDE.md and docs/TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool where multiple users edit the same
schedule simultaneously over a network (CRDT-based sync). The scheduling engine runs as a
Rust→WASM module in each user's browser.

**This is Stage 2 of a scheduling engine overhaul.** Stage 1 (Rust engine) has already been
merged. The WASM module now has these new behaviors you need to integrate:
- `cascade_dependents()` is now **asymmetric**: forward moves (positive delta) cascade as before,
  backward moves (negative delta) return empty results (no dependents shift)
- A new `recalculate_earliest()` WASM function exists that snaps tasks to their earliest possible
  dates, respecting dependencies, SNET constraints, and a today-date floor
- Tasks now have optional `constraintType` and `constraintDate` fields

Your job is to wire these engine changes into the React frontend. You have FULL ownership of
all frontend files listed below — no other agent is working on frontend code concurrently.

## Your files (you may modify these):
- `src/state/ganttReducer.ts`
- `src/utils/schedulerWasm.ts`
- `src/types/index.ts`
- `src/components/gantt/TaskBar.tsx`
- `src/components/gantt/CascadeHighlight.tsx`
- `src/components/shared/ContextMenu.tsx`
- `src/components/layout/Toolbar.tsx`

## Current state of the frontend

Read the files listed above. Key things to know:

**schedulerWasm.ts**: Wraps WASM calls. Has `cascadeDependents()`, `cascadeDependentsWithIds()`,
`computeCriticalPath()`, `computeCriticalPathScoped()`, `computeEarliestStart()`. The
`mapTasksToWasm()` helper maps TypeScript Task objects to the WASM format. You'll need to update
this mapper to include the new `constraintType` and `constraintDate` fields, and add a new
`recalculateEarliest()` wrapper.

**ganttReducer.ts**: Contains the `CASCADE_DEPENDENTS` action case and other task-mutation logic.
Uses undo/redo stacks. The cascade currently applies the WASM results unconditionally.

**types/index.ts**: Defines `Task`, `CriticalPathScope`, `GanttState`, etc. `CriticalPathScope`
still has a `milestone` variant — leave it for now (Group K will remove it in Stage 3).

**CascadeHighlight.tsx**: Renders a highlight/shading animation on tasks that just cascaded.
Currently tied to `lastCascadeIds` in state.

## Tasks — execute in order:

### J1: Update cascade behavior in reducer

The WASM `cascade_dependents()` now returns an empty array for backward moves (negative delta).
The frontend needs to handle this:

1. In `ganttReducer.ts`, find the `CASCADE_DEPENDENTS` action case
2. The WASM call `cascadeDependentsWithIds()` will now return `{ tasks: [...], changedIds: [] }`
   for backward moves — the tasks array has no changes, changedIds is empty
3. When changedIds is empty (backward move), the reducer should still update the moved task's
   own dates (which the user dragged) but NOT cascade to dependents
4. Set `lastCascadeIds` only when changedIds is non-empty (forward cascade)
5. Update `CascadeHighlight` to only show the animation when `lastCascadeIds` is non-empty

### J2: Add recalculate action to reducer + WASM wrapper

1. In `schedulerWasm.ts`, update `mapTasksToWasm()` to include the new fields:
   ```typescript
   constraintType: t.constraintType ?? null,
   constraintDate: t.constraintDate ?? null,
   ```

2. In `schedulerWasm.ts`, add a new wrapper function:
   ```typescript
   interface RecalcResult {
     id: string;
     newStart: string;
     newEnd: string;
   }

   export function recalculateEarliest(
     tasks: Task[],
     scopeProject?: string,
     scopeWorkstream?: string,
     scopeTaskId?: string,
   ): RecalcResult[] {
     if (!wasmModule) throw new Error('WASM scheduler not initialized');
     const wasmTasks = mapTasksToWasm(tasks);
     const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
     return wasmModule.recalculate_earliest(
       wasmTasks,
       scopeProject ?? null,
       scopeWorkstream ?? null,
       scopeTaskId ?? null,
       today,
     );
   }
   ```

3. In `types/index.ts`, add the constraint fields to the `Task` interface:
   ```typescript
   constraintType?: 'ASAP' | 'SNET';
   constraintDate?: string;
   ```

4. In `ganttReducer.ts`, add a new action case `RECALCULATE_EARLIEST`:
   - Accepts a scope: `{ taskId?: string; workstream?: string; project?: string }`
   - Calls `recalculateEarliest()` from schedulerWasm
   - Applies the returned date changes to matching tasks
   - Triggers summary date recalculation (same as after CASCADE_DEPENDENTS)
   - Pushes current tasks to the undo stack before applying changes
   - Sets `lastCascadeIds` to the list of changed task IDs (for highlighting)

### J3: Add recalculate to context menu

In `ContextMenu.tsx` (or wherever the right-click context menu is implemented):

1. When right-clicking a regular task: add "Recalculate to earliest" option
   - Dispatches `RECALCULATE_EARLIEST` with `{ taskId: task.id }`
2. When right-clicking a workstream summary row: add "Recalculate workstream" option
   - Dispatches `RECALCULATE_EARLIEST` with `{ workstream: task.workStream }`
3. When right-clicking a project summary row: add "Recalculate project" option
   - Dispatches `RECALCULATE_EARLIEST` with `{ project: task.project }`

### J4: Add recalculate button to toolbar

In `Toolbar.tsx`:

1. Add a "Recalculate All" button near the existing toolbar controls
2. On click: dispatch `RECALCULATE_EARLIEST` with empty scope (recalculates everything)
3. Style consistently with existing toolbar buttons

### J5: Extend cascade highlight duration

In `CascadeHighlight.tsx` (or wherever the highlight timing is managed):

1. Change the highlight duration from ~2 seconds to 10 seconds
2. Clear the highlight early if the user makes another edit (the reducer sets new `lastCascadeIds`)
3. Ensure recalculate also triggers the highlight on affected tasks (it sets `lastCascadeIds` in J2)

### J6: Commit and verify
- `npx tsc --noEmit` — compiles
- `npm run test` — all unit tests pass
- `npm run format:check && npm run lint` — clean
- Commit with message: "feat: asymmetric cascade UX, recalculate-to-earliest UI, 10s cascade highlight"
