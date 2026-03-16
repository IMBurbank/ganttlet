---
phase: 15
group: D
stage: 3
agent_count: 1
scope:
  modify:
    - src/state/ganttReducer.ts
    - src/state/actions.ts
    - src/components/gantt/TaskBar.tsx
    - src/components/gantt/TaskBarPopover.tsx
    - src/components/table/TaskRow.tsx
    - src/components/shared/DependencyEditorModal.tsx
  read_only:
    - src/types/index.ts
    - src/utils/schedulerWasm.ts
depends_on: [A, B, C]
tasks:
  - id: D1
    summary: "Read all files after Stage 2 merge"
  - id: D2
    summary: "Add SET_CONSTRAINT action + reducer handler"
  - id: D3
    summary: "Add constraint dropdown to TaskBarPopover"
  - id: D4
    summary: "Add constraint column to TaskRow"
  - id: D5
    summary: "Add conflict indicator to TaskBar"
  - id: D6
    summary: "Add SF to DependencyEditorModal"
---

# Phase 15 Group D — Constraint UI + Conflict Indicators

You are implementing Phase 15 Group D for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart where multiple users edit the same schedule simultaneously
(CRDT-based sync via Yjs). The scheduling engine runs as Rust→WASM in each user's browser.

## Prerequisites

Groups A, B, and C (Stages 1-2) have already been merged. The following are now available:
- Rust: 8 constraint types, SF dep type, detect_conflicts WASM export
- TypeScript: `DependencyType` includes 'SF', `Task.constraintType` has all 8 types
- WASM bridge: `detectConflicts()` wrapper in schedulerWasm.ts
- Sheets: constraintType and constraintDate columns synced

## Your files (ONLY modify these):
- `src/state/ganttReducer.ts` — reducer with task state management
- `src/state/actions.ts` — action type definitions
- `src/components/gantt/TaskBar.tsx` — Gantt bar rendering
- `src/components/gantt/TaskBarPopover.tsx` — task detail popover
- `src/components/table/TaskRow.tsx` — table row for task list
- `src/components/shared/DependencyEditorModal.tsx` — dependency add/edit modal

Read-only (understand but do NOT modify):
- `src/types/index.ts` — type definitions (modified by Group C)
- `src/utils/schedulerWasm.ts` — WASM bridge (modified by Group C)

## Success Criteria (you're done when ALL of these are true):
1. SET_CONSTRAINT action exists in actions.ts
2. SET_CONSTRAINT handler in reducer sets constraintType + constraintDate on task
3. ASAP constraint clears constraintDate
4. TaskBarPopover shows constraint type dropdown (8 options) + date picker
5. ASAP/ALAP hide the date picker in popover
6. TaskRow shows constraintType column (inline editable dropdown)
7. TaskBar shows red conflict indicator for tasks with conflicts
8. Conflict tooltip shows reason
9. DependencyEditorModal includes SF in type dropdown
10. `npx tsc --noEmit` passes
11. `npm run test` passes
12. All changes committed with descriptive messages

## Tasks — execute in order:

### D1: Read and understand the current code

1. Read `src/state/actions.ts` — understand the GanttAction union, how actions are defined
2. Read `src/state/ganttReducer.ts` — understand reducer structure, UNDOABLE_ACTIONS, TASK_MODIFYING_ACTIONS
3. Read `src/components/gantt/TaskBarPopover.tsx` — understand popover layout, how fields are edited
4. Read `src/components/table/TaskRow.tsx` — understand column rendering, inline edit pattern
5. Read `src/components/gantt/TaskBar.tsx` — understand bar rendering, how visual indicators work
6. Read `src/components/shared/DependencyEditorModal.tsx` — understand dep type dropdown, DEP_TYPE_LABELS
7. Read `src/types/index.ts` — verify Group C's type changes are merged
8. Read `src/utils/schedulerWasm.ts` — verify detectConflicts wrapper exists

### D2: Add SET_CONSTRAINT action to actions.ts and reducer

In `src/state/actions.ts`:
1. Add SET_CONSTRAINT to the GanttAction union:
```typescript
| { type: 'SET_CONSTRAINT'; taskId: string; constraintType: Task['constraintType']; constraintDate?: string }
```

In `src/state/ganttReducer.ts`:
1. Add SET_CONSTRAINT handler:
```typescript
case 'SET_CONSTRAINT': {
  const tasks = state.tasks.map(t =>
    t.id === action.taskId
      ? {
          ...t,
          constraintType: action.constraintType,
          constraintDate: action.constraintType === 'ASAP' || action.constraintType === 'ALAP'
            ? undefined
            : action.constraintDate,
        }
      : t
  );
  // Trigger recalculation after constraint change
  return { ...state, tasks };
}
```

2. Add SET_CONSTRAINT to `TASK_MODIFYING_ACTIONS` (so it syncs via CRDT)
3. Add SET_CONSTRAINT to `UNDOABLE_ACTIONS` (so it supports undo)
4. After setting the constraint, the reducer should trigger a recalculation of dates
   (check how CASCADE_DEPENDENTS or RECALCULATE_EARLIEST is triggered — the pattern may be
   to dispatch a follow-up action or to call recalculate inline)

Add test: dispatch SET_CONSTRAINT → task.constraintType and task.constraintDate updated.

Commit: `"feat: add SET_CONSTRAINT action and reducer handler"`

### D3: Add constraint selector dropdown to TaskBarPopover.tsx

In `src/components/gantt/TaskBarPopover.tsx`:

1. Add a constraint type dropdown with all 8 options:
```typescript
const CONSTRAINT_LABELS: Record<string, string> = {
  ASAP: 'As Soon As Possible',
  SNET: 'Start No Earlier Than',
  ALAP: 'As Late As Possible',
  SNLT: 'Start No Later Than',
  FNET: 'Finish No Earlier Than',
  FNLT: 'Finish No Later Than',
  MSO: 'Must Start On',
  MFO: 'Must Finish On',
};
```

2. Add a date picker that appears for date-bearing constraints (SNET, SNLT, FNET, FNLT, MSO, MFO)
3. Hide the date picker for ASAP and ALAP (they don't use dates)
4. On change, dispatch SET_CONSTRAINT with the selected type and date
5. Show current constraint type and date if set

Follow the existing popover styling and layout patterns.

Commit: `"feat: add constraint selector dropdown to TaskBarPopover"`

### D4: Add constraintType column to TaskRow.tsx

In `src/components/table/TaskRow.tsx`:

1. Check how columns are configured — look for a column config array or pattern
2. Add a constraintType column that displays the current constraint type
3. Make it inline editable via a dropdown (same 8 options as the popover)
4. On change, dispatch SET_CONSTRAINT

Follow the existing inline edit pattern used by other columns.

Commit: `"feat: add constraintType column to task table"`

### D5: Add conflict indicator to TaskBar.tsx

In `src/components/gantt/TaskBar.tsx`:

1. Import `detectConflicts` from schedulerWasm (or get conflicts from state if available)
2. For tasks with conflicts, add a red visual indicator:
   - Red outline/border on the Gantt bar
   - Use a CSS class like `conflict` or inline style
3. Add a tooltip showing the conflict reason (from ConflictResult.message)
4. The indicator should clear when the conflict is resolved

Implementation considerations:
- Conflicts should be computed at a higher level (not per-TaskBar render) to avoid N WASM calls
- Look for an existing pattern where data is computed in GanttChart or context and passed as props
- If no such pattern exists, compute conflicts once in the parent and pass them down

Commit: `"feat: add red conflict indicator to TaskBar for negative float"`

### D6: Add SF to DependencyEditorModal.tsx

In `src/components/shared/DependencyEditorModal.tsx`:

1. Add SF to `DEP_TYPE_LABELS`:
```typescript
const DEP_TYPE_LABELS: Record<DependencyType, string> = {
  FS: 'Finish to Start',
  FF: 'Finish to Finish',
  SS: 'Start to Start',
  SF: 'Start to Finish',
};
```

2. Verify the dropdown renders all 4 options
3. Verify creating an SF dependency works end-to-end (dispatches correctly)

Commit: `"feat: add SF to dependency editor dropdown"`

## Progress Tracking

After completing each major task (D1-D6), update `.agent-status.json` in the worktree root:

```json
{
  "group": "D",
  "phase": 15,
  "tasks": {
    "D1": { "status": "done" },
    "D2": { "status": "in_progress" }
  },
  "last_updated": "2026-03-08T10:30:00Z"
}
```

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, update .agent-status.json with "status": "blocked", skip dependent tasks.
- Emergency: `git add -A && git commit -m "emergency: groupD saving work"`.
- **Calculations**: NEVER do mental math or date arithmetic. Use `taskEndDate`/`taskDuration` shell functions for dates, `python3 -c` for arithmetic.

## Design Notes

### Conflict Computation Strategy
Don't call `detectConflicts()` inside each TaskBar render — that would be O(N) WASM calls.
Instead, compute conflicts once at the GanttChart level:
1. After any state change that could affect conflicts (SET_CONSTRAINT, CASCADE_DEPENDENTS, MOVE_TASK, RECALCULATE_EARLIEST)
2. Store results in state or a memo
3. Pass conflict info to TaskBar as a prop

Look at how `criticalPath` data flows from computation to rendering for a pattern to follow.

### Constraint Recalculation
When SET_CONSTRAINT is dispatched, the schedule may need recalculation:
- Setting SNET/FNET may push dates forward
- Setting MSO/MFO pins dates
- Check if the reducer already calls recalculate after task field changes
- The existing RECALCULATE_EARLIEST action may be the right follow-up

### ASAP/ALAP Date Handling
- ASAP: no constraint date needed (it's the default behavior)
- ALAP: no constraint date needed (determined by CPM backward pass)
- Both should clear any existing constraintDate when selected
