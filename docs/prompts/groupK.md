# Phase 12 Group K — Critical Path UI + Float Visualization

You are implementing Phase 12 Group K for the Ganttlet project.
Read CLAUDE.md and docs/TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool where multiple users edit the same
schedule simultaneously over a network (CRDT-based sync). The scheduling engine runs as a
Rust→WASM module in each user's browser.

**This is Stage 3 of a scheduling engine overhaul.** Stages 1 and 2 have already been merged.
The WASM module and frontend now have:
- `compute_critical_path_scoped()` returns critical task IDs AND critical edges (from_id, to_id)
- `cascade_dependents()` is asymmetric: forward moves cascade, backward moves return empty results
- `recalculateEarliest()` exists in schedulerWasm.ts and is wired into the reducer
- `computeEarliestStart()` computes a single task's earliest start given dependencies
- `CascadeHighlight` shows a 10-second animation on affected tasks
- Tasks have optional `constraintType` and `constraintDate` fields
- `lastCascadeIds` in state tracks which tasks just moved
- `CriticalPathScope` still has a `milestone` variant — you will remove it

Your job is to complete the critical path visualization and add float/slack indicators to the
frontend. You have FULL ownership of all frontend files listed below — no other agent is working
on frontend code concurrently.

## Your files (you may modify these):
- `src/components/gantt/GanttChart.tsx`
- `src/components/gantt/DependencyLayer.tsx`
- `src/components/gantt/SlackIndicator.tsx`
- `src/components/gantt/MilestoneMarker.tsx`
- `src/components/layout/Toolbar.tsx`
- `src/state/ganttReducer.ts`
- `src/utils/schedulerWasm.ts`
- `src/types/index.ts`

## Current state of the frontend

Read the files listed above. Key things to know:

**schedulerWasm.ts**: Has `computeCriticalPathScoped()` which currently returns `Set<string>` of
task IDs. After Stage 1, the WASM function also returns critical edges, but the TypeScript wrapper
doesn't expose them yet. You need to update this wrapper.

**DependencyLayer.tsx**: Renders dependency arrows between tasks. Already accepts `criticalPathIds`
prop and uses it to determine if an arrow is critical (both ends on critical path). After your
changes, it should use the actual critical edges from the WASM result instead.

**SlackIndicator.tsx**: A component that renders a dashed ghost bar showing the slack window
between a task's earliest possible start and its current start. It exists but is NOT currently
used anywhere. You need to wire it into the GanttChart after backward moves.

**Toolbar.tsx**: Has a critical path toggle and scope dropdown. The scope dropdown still includes
a "Milestone" option — you will remove it.

**types/index.ts**: Defines `CriticalPathScope` with `project`, `workstream`, and `milestone`
variants. You will remove the `milestone` variant.

## Tasks — execute in order:

### K1: Update critical path rendering

1. In `schedulerWasm.ts`, update `computeCriticalPathScoped()` to return both task IDs and edges:
   ```typescript
   interface CriticalPathResult {
     taskIds: Set<string>;
     edges: Array<{ fromId: string; toId: string }>;
   }

   export function computeCriticalPathScoped(
     tasks: Task[],
     scope: CriticalPathScope,
   ): CriticalPathResult {
     // ... call WASM, which now returns { taskIds: string[], edges: [string, string][] }
     // Map the result into the interface above
   }
   ```
2. Update `GanttChart.tsx` to pass critical edges to `DependencyLayer`
3. Update `DependencyLayer.tsx` to accept a `criticalEdges` prop and use it to determine
   which arrows to highlight as critical (red, thicker) instead of inferring from both-ends logic
4. Ensure the full chain from first task to last task is visually connected with red arrows

### K2: Remove milestone from critical path scope

1. In `types/index.ts`, remove the `milestone` variant from `CriticalPathScope`:
   ```typescript
   export type CriticalPathScope =
     | { type: 'project'; name: string }
     | { type: 'workstream'; name: string };
   ```
2. In `Toolbar.tsx`, remove the "Milestone" option from the scope dropdown
3. In `ganttReducer.ts`, update `SET_CRITICAL_PATH_SCOPE` if it references milestone
4. Fix any TypeScript errors from removing the variant

### K3: Implement float/slack visualization

After a backward move, dependents don't cascade. Instead, slack appears between where a dependent
could start (earliest) and where it currently sits. Show this visually:

1. In `GanttChart.tsx`, after a backward move is detected (check state for backward-move indicator
   or empty `lastCascadeIds` after a task drag), compute the slack window for each dependent:
   - Call `computeEarliestStart(tasks, taskId)` for each dependent of the moved task
   - If earliest start < current start, that task has slack
2. Pass slack data to `SlackIndicator` and render it on the affected task bars
3. `SlackIndicator` already renders a dashed ghost bar — just wire it in with the right coordinates
4. Slack indicators should appear after backward moves and clear on the next edit
5. Use the `computeEarliestStart()` WASM call (already in schedulerWasm.ts) to determine each
   task's slack window size

### K4: Ensure critical path highlights full chain

1. Verify `TaskBar` renders a red/highlighted style for all critical tasks (not just some)
2. Verify `DependencyLayer` renders red arrows for all critical edges using the new edges prop
3. Test with multi-level hierarchies — critical path should flow through leaf tasks only,
   not summary rows
4. If `MilestoneMarker.tsx` has any critical path rendering that depends on the removed milestone
   scope, update or remove it

### K5: Commit and verify
- `npx tsc --noEmit` — compiles
- `npm run test` — all unit tests pass
- `npm run format:check && npm run lint` — clean
- Commit with message: "feat: critical path edge highlighting, float/slack visualization, remove milestone scope"
