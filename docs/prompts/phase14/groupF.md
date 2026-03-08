---
phase: 14
group: F
stage: 3
agent_count: 1
scope:
  modify:
    - src/collab/awareness.ts
    - src/types/index.ts
    - src/components/gantt/TaskBar.tsx
    - src/components/gantt/GanttChart.tsx
  read_only: []
depends_on: [A, B, C, D, E]
tasks:
  - id: F1
    summary: "Read post-merge"
  - id: F2
    summary: "Extend awareness"
  - id: F3
    summary: "Extend CollabUser type"
  - id: F4
    summary: "Broadcast drag intent"
  - id: F5
    summary: "Render ghost bars"
  - id: F6
    summary: "Verify"
---

# Phase 14 Group F — Drag Intent via Awareness / Ghost Bar (R6)

You are implementing Phase 14 Group F for the Ganttlet project.
Read `CLAUDE.md` and `docs/phase14-recommendations.md` (Section R6, and Section 9 Key File Reference) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

**CRITICAL CONTEXT**: This is a Stage 3 agent. Stages 1 and 2 have already been merged. Before starting work:
1. Read the recent git log (`git log --oneline -30`) to see what Stages 1+2 changed
2. Read the CURRENT versions of all files you'll modify — they changed significantly
3. TaskBar.tsx now has RAF throttle, localDispatch/collabDispatch split, COMPLETE_DRAG, and active drag tracking
4. awareness.ts currently only tracks viewing state (viewingTaskId, viewingCellColumn)
5. GanttContext.tsx now has drag tracking, dispatch split, and structural sync

## Success Criteria (you're done when ALL of these are true):
1. During drag, the local user broadcasts drag intent via Yjs awareness: `{ dragging: { taskId, currentStartDate, currentEndDate } }`
2. Remote users see a semi-transparent "ghost bar" at the in-progress drag position
3. When the drag completes, the awareness `dragging` field is cleared
4. If a user disconnects mid-drag, Yjs awareness timeout cleans up automatically
5. Ghost bar has reduced opacity (~0.3) and the dragger's presence color
6. All existing tests pass (`npm run test`, `npx tsc --noEmit`)
7. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- No ghost bar visible for remote users during drag
- Ghost bar persists after drag completion
- Awareness state doesn't include drag information
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart where multiple users see each other's presence.
R6 adds drag intent so remote users see where a task is being dragged to in real-time.

## Your files (ONLY modify these):
- `src/collab/awareness.ts` — add drag intent to awareness state
- `src/types/index.ts` — extend CollabUser type with dragging field
- `src/components/gantt/TaskBar.tsx` — broadcast drag intent during drag
- `src/components/gantt/GanttChart.tsx` — render ghost bars for remote drags

Do NOT modify `ganttReducer.ts`, `yjsBinding.ts`, `actions.ts`, `DependencyLayer.tsx`, or files in `crates/`. Other agents have finished their work on those files.

## Current Code State (read these AFTER Stage 2 merge)

### awareness.ts current state shape:
```typescript
awareness.setLocalStateField('user', {
  name: user.name,
  email: user.email,
  color: pickColor(clientId),
  viewingTaskId: null,
  viewingCellColumn: null,
});
```
Need to add `dragging: null | { taskId, currentStartDate, currentEndDate }`.

### TaskBar.tsx after Stage 1+2:
- Has `setActiveDrag()` from Group A (active drag tracking for SET_TASKS guard)
- Uses `localDispatch` for RAF-throttled local renders
- Uses `dispatch` (collabDispatch) for CRDT broadcasts
- Mouseup dispatches `COMPLETE_DRAG`
- `dragRef.current` tracks `{ startX, origStartDate, origEndDate, mode, lastStartDate, lastEndDate }`

### GanttChart.tsx:
- Renders `TaskBar` components for each visible task
- Renders `DependencyLayer` for arrows
- Has `collabUsers` from `useGanttState()` — list of remote users with presence info
- `taskYPositions` maps task IDs to Y pixel positions

### CollabUser type (in types/index.ts):
```typescript
interface CollabUser {
  clientId: number;
  name: string;
  email: string;
  color: string;
  viewingTaskId: string | null;
  viewingCellColumn: string | null;
}
```
Need to extend with `dragging` field.

## Tasks — execute in order:

### F1: Read ALL files after Stage 2 merge

1. `git log --oneline -30` to see what changed
2. Read `src/collab/awareness.ts` (current version)
3. Read `src/components/gantt/TaskBar.tsx` (current version — changed significantly by Groups A+D)
4. Read `src/components/gantt/GanttChart.tsx` (current version)
5. Read `src/types/index.ts` (CollabUser type)

### F2: Extend awareness with drag intent

In `src/collab/awareness.ts`:

1. Add a function to set drag intent:
```typescript
export function setDragIntent(
  awareness: Awareness,
  dragging: { taskId: string; currentStartDate: string; currentEndDate: string } | null
): void {
  const current = awareness.getLocalState();
  if (!current?.user) return;

  awareness.setLocalStateField('user', {
    ...current.user,
    dragging,
  });
}
```

2. Update `getCollabUsers` to include `dragging`:
```typescript
users.push({
  clientId,
  name: state.user.name ?? 'Anonymous',
  email: state.user.email ?? '',
  color: state.user.color ?? pickColor(clientId),
  viewingTaskId: state.user.viewingTaskId ?? null,
  viewingCellColumn: state.user.viewingCellColumn ?? null,
  dragging: state.user.dragging ?? null,
});
```

3. Update `setLocalAwareness` to include `dragging: null` in initial state.

Commit: `"feat: add drag intent to Yjs awareness protocol (R6)"`

### F3: Extend CollabUser type

In `src/types/index.ts`, add `dragging` to CollabUser:
```typescript
interface CollabUser {
  clientId: number;
  name: string;
  email: string;
  color: string;
  viewingTaskId: string | null;
  viewingCellColumn: string | null;
  dragging: { taskId: string; currentStartDate: string; currentEndDate: string } | null;
}
```

Commit: `"feat: extend CollabUser type with drag intent (R6)"`

### F4: Broadcast drag intent from TaskBar

In `src/components/gantt/TaskBar.tsx`:

1. Import `setDragIntent` from `../../collab/awareness` and get the awareness instance via the `useAwareness` hook (exported from GanttContext by Group D in Stage 2):
```typescript
import { setDragIntent } from '../../collab/awareness';
import { useAwareness } from '../../state/GanttContext';

const awareness = useAwareness();
```

2. In the `onMouseMove` handler (inside RAF or alongside CRDT broadcast), broadcast drag intent:
```typescript
// Broadcast drag position to remote users via awareness (not document state)
if (awareness) {
  setDragIntent(awareness, {
    taskId,
    currentStartDate: newStartStr,
    currentEndDate: newEndStr,
  });
}
```

3. In `onMouseUp`, clear drag intent:
```typescript
if (awareness) {
  setDragIntent(awareness, null);
}
```

4. The drag intent broadcast should happen at the same ~100ms throttle as the CRDT broadcast, not on every mousemove. Piggyback on the existing throttle logic.

Commit: `"feat: broadcast drag intent via awareness during drag (R6)"`

### F5: Render ghost bars for remote drags

In `src/components/gantt/GanttChart.tsx`:

1. From `collabUsers` (already in state), find users who are dragging:
```typescript
const remoteDrags = collabUsers.filter(u => u.dragging !== null);
```

2. For each remote drag, render a ghost bar SVG element:
```typescript
{remoteDrags.map(user => {
  const drag = user.dragging!;
  const yPos = taskYPositions.get(drag.taskId);
  if (yPos === undefined) return null;

  const ghostX = dateToXCollapsed(drag.currentStartDate, timelineStart, colWidth, zoom, collapseWeekends);
  const ghostWidth = dateToXCollapsed(drag.currentEndDate, timelineStart, colWidth, zoom, collapseWeekends) - ghostX;
  const barHeight = 28;
  const barY = yPos + (rowHeight - barHeight) / 2;

  return (
    <g key={`ghost-${user.clientId}-${drag.taskId}`} style={{ pointerEvents: 'none' }}>
      <rect
        x={ghostX}
        y={barY}
        width={Math.max(ghostWidth, 4)}
        height={barHeight}
        rx={4}
        fill={user.color}
        opacity={0.3}
        strokeDasharray="4 2"
        stroke={user.color}
        strokeWidth={1}
      />
      {/* Dragger name label */}
      <text
        x={ghostX + 4}
        y={barY - 4}
        fontSize={9}
        fill={user.color}
        fontWeight={600}
      >
        {user.name}
      </text>
    </g>
  );
})}
```

3. Place these ghost bar elements BEFORE the real TaskBar elements in the SVG render order (so they appear behind the actual bars).

4. Import `dateToXCollapsed` and `getColumnWidth` if not already imported.

Commit: `"feat: render ghost bars for remote drag intent (R6)"`

### F6: Verify and finalize

1. Run `npx tsc --noEmit` — fix any type errors
2. Run `npm run test` — fix any test failures
3. Verify no files outside your scope were modified: `git diff --name-only`
4. Update `.agent-status.json` with final status
5. Commit any remaining fixes

## Progress Tracking

After completing each major task (F1, F2, etc.), update `.agent-status.json` in the worktree root:

```json
{
  "group": "F",
  "phase": 14,
  "tasks": {
    "F1": { "status": "done", "tests_passing": 3, "tests_failing": 0 },
    "F2": { "status": "in_progress" }
  },
  "last_updated": "2026-03-06T10:30:00Z"
}
```

On restart, read `.agent-status.json` (fall back to `claude-progress.txt`) and `git log --oneline -10` first. Skip completed tasks.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, update .agent-status.json with "status": "blocked", skip dependent tasks.
- Emergency: `git add -A && git commit -m "emergency: groupF saving work"`.
- **Calculations**: NEVER do mental math or date arithmetic. Use `node -e "const {differenceInCalendarDays,addDays}=require('date-fns'); ..."` or `date -d '2026-03-06 + 17 days' +%Y-%m-%d` or `python3 -c "print(...)"`. Prefer `date-fns` directly (`differenceInCalendarDays`, `addDays`, `addBusinessDays`) over project wrappers when writing new code.
