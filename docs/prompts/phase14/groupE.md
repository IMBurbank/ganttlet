---
phase: 14
group: E
stage: 2
agent_count: 1
scope:
  modify:
    - src/components/gantt/DependencyLayer.tsx
    - src/components/gantt/DependencyArrow.tsx
    - src/utils/dependencyUtils.ts
    - src/utils/layoutUtils.ts
    - src/components/gantt/GanttChart.tsx
  read_only: []
depends_on: [A, B, C]
tasks:
  - id: E1
    summary: "Read code"
  - id: E2
    summary: "Fix consistency"
  - id: E3
    summary: "Memoize getDependencyPoints"
  - id: E4
    summary: "Arrow path consistency"
  - id: E5
    summary: "Verify"
---

# Phase 14 Group E — Arrow Render Consistency (R5)

You are implementing Phase 14 Group E for the Ganttlet project.
Read `CLAUDE.md` and `docs/phase14-recommendations.md` (Section R5, and Section 9 Key File Reference) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

**CRITICAL CONTEXT**: This is a Stage 2 agent. Stage 1 has already been merged. Before starting work:
1. Read the recent git log (`git log --oneline -20`) to see what Stage 1 changed
2. Read the CURRENT versions of files you'll modify — they may have changed

## Success Criteria (you're done when ALL of these are true):
1. `DependencyLayer` receives `tasks` and `taskYPositions` as a guaranteed-consistent pair (from the same render/memo cycle)
2. `getDependencyPoints` results are memoized to avoid recalculation when inputs haven't changed
3. Arrow paths are recomputed when and only when task positions or dates change
4. No arrow offset bugs are visible when switching zoom levels or scrolling
5. All existing tests pass (`npm run test`, `npx tsc --noEmit`)
6. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- Arrow/bar mismatch from stale data
- Dependency arrows use different state snapshot than task bars
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool. Dependency arrows connect task bars
visually. If the arrow endpoints don't match the task bar edges, users see broken-looking arrows.

## Your files (ONLY modify these):
- `src/components/gantt/DependencyLayer.tsx` — arrow container
- `src/components/gantt/DependencyArrow.tsx` — individual arrow SVG rendering
- `src/utils/dependencyUtils.ts` — `getDependencyPoints()`, `createBezierPath()`
- `src/utils/layoutUtils.ts` — `buildTaskYPositions()`
- `src/components/gantt/GanttChart.tsx` — main SVG canvas (only if needed for consistency fix)

Do NOT modify `TaskBar.tsx`, `GanttContext.tsx`, `ganttReducer.ts`, `yjsBinding.ts`, or files in `crates/`. Other agents own those files.

## Current Code State (read these before editing)

### GanttChart.tsx (line 84):
```typescript
const taskYPositions = useMemo(() => buildTaskYPositions(visibleTasks), [visibleTasks]);
```
This is already memoized on `visibleTasks`. Good.

### GanttChart.tsx passes to DependencyLayer (lines ~230-241):
```typescript
<DependencyLayer
  tasks={visibleTasks}
  allTasks={allTasks}
  taskYPositions={taskYPositions}
  // ... other props
/>
```
Both `tasks` and `taskYPositions` come from the same render. This looks correct. The issue may be deeper.

### DependencyLayer.tsx:
- Creates `taskMap` from `allTasks` (line 22) — this includes ALL tasks including hidden ones
- Creates `visibleIds` from `tasks` (line 24)
- Iterates `tasks` and renders `DependencyArrow` for each visible dependency
- Each `DependencyArrow` receives `taskYPositions`, `fromTask`, and `toTask`

### DependencyArrow.tsx:
- Calls `getDependencyPoints()` to compute arrow start/end coordinates
- `getDependencyPoints` uses `dateToXCollapsed()` for X coordinates and `taskYPositions` for Y

### dependencyUtils.ts getDependencyPoints:
- Computes X from task dates via `dateToXCollapsed()`
- Computes Y from `taskYPositions.get(taskId)` + `rowHeight/2`
- Returns `{ startX, startY, endX, endY }`

### Potential arrow offset causes:
1. **allTasks vs visibleTasks mismatch**: `taskMap` uses `allTasks` but `taskYPositions` only has entries for `visibleTasks`. If a dependency references a hidden task, `taskYPositions.get()` returns undefined → NaN coordinates
2. **Stale memo**: If `getDependencyPoints` is called with outdated props during a transition
3. **Render order**: DependencyLayer might render before taskYPositions update

## Tasks — execute in order:

### E1: Read and understand the current code

1. Read `src/components/gantt/GanttChart.tsx` (focus on taskYPositions computation and DependencyLayer props)
2. Read `src/components/gantt/DependencyLayer.tsx` (full file)
3. Read `src/components/gantt/DependencyArrow.tsx` (full file)
4. Read `src/utils/dependencyUtils.ts` (getDependencyPoints, createBezierPath)
5. Read `src/utils/layoutUtils.ts` (buildTaskYPositions)

### E2: Fix consistency between taskYPositions and dependency data

The key issue: `DependencyLayer` uses `allTasks` for lookup but `taskYPositions` only contains visible tasks. If a dependency's from-task is hidden, the arrow gets undefined Y coordinates.

1. Add a guard in `DependencyLayer` or `DependencyArrow` to skip arrows where either task is missing from `taskYPositions`:

In `DependencyLayer.tsx`, strengthen the visibility check:
```typescript
for (const task of tasks) {
  for (const dep of task.dependencies) {
    const fromTask = taskMap.get(dep.fromId);
    if (!fromTask) continue;
    // Both tasks must have Y positions (visible)
    if (!taskYPositions.has(dep.fromId) || !taskYPositions.has(task.id)) continue;
    // ... render arrow ...
  }
}
```

2. Commit: `"fix: skip dependency arrows when either task is not in taskYPositions (R5)"`

### E3: Memoize getDependencyPoints

In `DependencyArrow.tsx`, memoize the dependency points calculation:

```typescript
const points = useMemo(
  () => getDependencyPoints(dep, fromTask, toTask, taskYPositions, timelineStart, colWidth, zoom, rowHeight, collapseWeekends),
  [dep, fromTask.startDate, fromTask.endDate, toTask.startDate, toTask.endDate,
   taskYPositions.get(fromTask.id), taskYPositions.get(toTask.id),
   timelineStart, colWidth, zoom, rowHeight, collapseWeekends]
);
```

Or if `DependencyArrow` is not already wrapped in `React.memo`, wrap it:
```typescript
export default React.memo(function DependencyArrow(...) { ... });
```

The key insight: arrow paths should only recompute when the tasks' dates or Y-positions change, not on every parent re-render.

Commit: `"perf: memoize arrow point calculation in DependencyArrow (R5)"`

### E4: Ensure arrow path consistency

Review `getDependencyPoints` in `dependencyUtils.ts`. Check:
1. Does it correctly handle the case where `taskYPositions` returns `undefined`?
2. Does it use the same `dateToXCollapsed` parameters as `TaskBar.tsx`?
3. Are the arrow endpoint offsets (STUB = 12px) correctly applied?

If any of these are issues, fix them. Otherwise, add guard clauses for undefined positions.

Commit: `"fix: guard against undefined taskYPositions in getDependencyPoints (R5)"`

### E5: Verify and finalize

1. Run `npx tsc --noEmit` — fix any type errors
2. Run `npm run test` — fix any test failures (especially `dependencyUtils.test.ts`)
3. Verify no files outside your scope were modified: `git diff --name-only`
4. Update `claude-progress.txt` with final status
5. Commit any remaining fixes

## Progress Tracking

After completing each major task, append a status line to `claude-progress.txt`:
```
# STATUS values: DONE, IN_PROGRESS, BLOCKED, SKIPPED
# Format: TASK_ID | STATUS | ISO_TIMESTAMP | MESSAGE
E1 | DONE | 2026-03-06T10:23Z | Read all rendering files, identified visibility guard gap
E2 | DONE | 2026-03-06T10:45Z | Fixed taskYPositions consistency check
```
On restart, read `claude-progress.txt` and `git log --oneline -10` first. Skip completed tasks.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.
- Emergency: `git add -A && git commit -m "emergency: groupE saving work"`.
- **Calculations**: NEVER do mental math or date arithmetic. Use `node -e "const {differenceInCalendarDays,addDays}=require('date-fns'); ..."` or `date -d '2026-03-06 + 17 days' +%Y-%m-%d` or `python3 -c "print(...)"`. Prefer `date-fns` directly (`differenceInCalendarDays`, `addDays`, `addBusinessDays`) over project wrappers when writing new code.
