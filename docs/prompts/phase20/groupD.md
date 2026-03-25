---
phase: 20
group: D
stage: 3
agent_count: 1
scope:
  modify:
    - src/App.tsx
    - src/components/gantt/GanttChart.tsx
    - src/components/gantt/TaskBar.tsx
    - src/components/gantt/TaskBarPopover.tsx
    - src/components/gantt/TimelineHeader.tsx
    - src/components/gantt/GridLines.tsx
    - src/components/table/TaskTable.tsx
    - src/components/table/TaskRow.tsx
    - src/components/table/ColumnHeader.tsx
    - src/components/table/PredecessorsCell.tsx
    - src/components/layout/Header.tsx
    - src/components/layout/Toolbar.tsx
    - src/components/shared/DependencyEditorModal.tsx
    - src/components/shared/ReparentPickerModal.tsx
    - src/components/shared/UndoRedoButtons.tsx
  read_only:
    - src/store/TaskStore.ts
    - src/store/UIStore.ts
    - src/hooks/index.ts
    - src/mutations/index.ts
    - docs/plans/frontend-redesign.md
depends_on: [A, B, C]
tasks:
  - id: D1
    summary: "Read Group A/B/C outputs — understand new hooks and mutation API"
  - id: D2
    summary: "Migrate GanttChart.tsx — useTask hooks for visible tasks, useUIStore for zoom/colorBy"
  - id: D3
    summary: "Migrate TaskBar.tsx — useTask(id) for task data, useMutate() for drag commit"
  - id: D4
    summary: "Migrate TaskBarPopover.tsx — useMutate() for field edits, touched-field tracking"
  - id: D5
    summary: "Migrate TaskTable + TaskRow — useTask(id), useUIStore for columns/search"
  - id: D6
    summary: "Migrate Header + Toolbar — useUIStore, useMutate for undo/redo/add task"
  - id: D7
    summary: "Migrate DependencyEditorModal + ReparentPickerModal — mutation API"
  - id: D8
    summary: "Migrate App.tsx — replace GanttProvider with TaskStoreProvider + UIStoreProvider"
  - id: D9
    summary: "Migrate remaining: ColumnHeader, PredecessorsCell, GridLines, TimelineHeader, UndoRedoButtons"
---

# Phase 20 Group D — Gantt + Table + Layout Component Migration

You are migrating the core Gantt chart, table, and layout components from the old
`useGanttState`/`useGanttDispatch` pattern to the new store hooks + mutation API.

Read `docs/plans/frontend-redesign.md` for the architecture spec.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

Groups A-C created: TaskStore, UIStore, hooks (useTask, useUIStore, useMutate), mutation
functions, and the observation handler. This group rewires 15 core components to use them.

## Migration Pattern

For each component, replace:
```typescript
// OLD
const state = useGanttState();
const dispatch = useGanttDispatch();
const task = state.tasks.find(t => t.id === taskId);
dispatch({ type: 'MOVE_TASK', taskId, newStartDate, newEndDate });

// NEW
const task = useTask(taskId);
const ui = useUIStore(s => s.zoomLevel);
const mutate = useMutate();
mutate({ type: 'MOVE_TASK', taskId, newStart, newEnd });
```

### Key migration rules:

1. **Task data** → `useTask(id)` (per-task O(1) subscription)
2. **Task list/order** → `useTaskOrder()` + `useTask(id)` per item
3. **UI state** (zoom, theme, columns, panels) → `useUIStore(selector)`
4. **Task mutations** (move, resize, add, delete) → `useMutate()`
5. **UI mutations** (toggle panel, set zoom) → `useUIStore` dispatch
6. **Critical path / conflicts** → `useCriticalPath()`, `useConflicts()`

### TaskBarPopover: touched-field tracking

The popover needs special handling per the architecture spec (§6 Edit Guards):
```typescript
const [touched, setTouched] = useState<Set<string>>(new Set());
const effectiveName = touched.has('name') ? localName : task.name;
// Only write touched fields on save
```

### TaskBar: drag stays as-is structurally

The drag mechanics (CSS transform on mouseup, RAF throttle) don't change in this phase.
The drag commit changes from `dispatch({ type: 'COMPLETE_DRAG', ... })` to
`mutate({ type: 'MOVE_TASK', ... })`. The CSS transform optimization is Phase 3.

### App.tsx: provider swap

Replace:
```tsx
<GanttProvider>
  <AppContent />
</GanttProvider>
```

With:
```tsx
<UIStoreProvider>
  <TaskStoreProvider>
    <AppContent />
  </TaskStoreProvider>
</UIStoreProvider>
```

## DO NOT MODIFY

- Group E handles: WelcomeGate, onboarding components, shared modals, GanttContext deletion
- Do NOT delete GanttContext.tsx — Group E handles the final cleanup
- Do NOT modify onboarding components — Group E handles those
- Do NOT modify the onboarding routing inside App.tsx (the WelcomeGate/AppContent branch) — only swap the provider wrapper

## Verification

1. `npx tsc --noEmit`
2. **Zero stale imports in YOUR files:**
   ```bash
   grep -rn "useGanttState\|useGanttDispatch\|GanttContext\|ganttReducer" src/components/gantt/ src/components/table/ src/components/layout/ src/components/shared/DependencyEditorModal.tsx src/components/shared/ReparentPickerModal.tsx src/components/shared/UndoRedoButtons.tsx src/App.tsx --include="*.tsx" --include="*.ts"
   ```
   Must return ZERO results. If any remain, you missed a migration.
3. `npx vitest run` — existing component tests should pass
4. `npx playwright test e2e/gantt.spec.ts e2e/tooltip.spec.ts` — Gantt E2E tests pass
4. Commit with conventional commit message
