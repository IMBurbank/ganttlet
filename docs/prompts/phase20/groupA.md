---
phase: 20
group: A
stage: 1
agent_count: 1
scope:
  create:
    - src/store/TaskStore.ts
    - src/store/UIStore.ts
    - src/store/__tests__/TaskStore.test.ts
    - src/store/__tests__/UIStore.test.ts
    - src/hooks/useTask.ts
    - src/hooks/useUIStore.ts
    - src/hooks/useMutate.ts
    - src/hooks/index.ts
  modify:
    - src/types/index.ts   # APPEND ONLY — Group B reads this file in parallel. Add MutateAction at end.
  read_only:
    - src/state/ganttReducer.ts
    - src/state/GanttContext.tsx
    - docs/plans/frontend-redesign.md
depends_on: []
tasks:
  - id: A1
    summary: "Read the architecture spec (docs/plans/frontend-redesign.md §4) and current types"
  - id: A2
    summary: "Create TaskStore class with per-task event emitter and batchUpdate"
  - id: A3
    summary: "Create UIStore class with UIState interface and selector-based hook"
  - id: A4
    summary: "Create useTask, useTaskOrder, useCriticalPath, useConflicts hooks"
  - id: A5
    summary: "Create useUIStore hook with selector pattern"
  - id: A6
    summary: "Create useMutate hook (context-based, routes to Y.Doc mutations)"
  - id: A7
    summary: "Write TaskStore unit tests (batchUpdate, per-task notifications, O(1) verification)"
  - id: A8
    summary: "Write UIStore unit tests (dispatch, selector, state updates)"
---

# Phase 20 Group A — TaskStore + UIStore + Hooks

You are implementing the store layer for Ganttlet's frontend redesign.
Read `docs/plans/frontend-redesign.md` sections 4 (Task Store) and the UIStore subsection
for the complete specification.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

The current architecture uses `useReducer + React Context` in `GanttContext.tsx`, which
causes O(N) re-renders on every state change. This group creates the replacement:
per-task O(1) subscriptions via a custom `TaskStore` class + `useSyncExternalStore`.

## Key Requirements

### TaskStore (src/store/TaskStore.ts)

A class with:
- `private tasks: Map<string, Task>` — in-memory task data
- `private listeners: Map<string, Set<() => void>>` — per-task subscribers
- `private globalListeners: Set<() => void>` — for taskOrder, derived state
- `subscribe(taskId, listener)` → unsubscribe function
- `subscribeGlobal(listener)` → unsubscribe function
- `getTask(taskId)` → `Task | undefined`
- `getAllTasks()` → `Map<string, Task>`
- `getAllTasksArray()` → `Task[]`
- `getTaskOrder()` → `string[]`
- `setTaskOrder(order: string[])` → void
- `batchUpdate(changed: Map<string, Task>, deleted: Set<string>)` → void
  - Updates internal Map
  - Notifies ONLY changed/deleted task listeners (true O(1))
  - Notifies global listeners
- `getCriticalPath()` → `Set<string>`
- `getConflicts()` → `Map<string, string>`
- `setDerived(criticalPath, conflicts)` → void (notifies global listeners)

**Context exports:** Create and export from `TaskStore.ts`:
```typescript
export const TaskStoreContext = React.createContext<TaskStore | null>(null);
```
Group C's `TaskStoreProvider.tsx` imports this context. Same pattern for `UIStoreContext`
in `UIStore.ts`.

### UIStore (src/store/UIStore.ts)

A simpler store for low-frequency UI state. Interface from the spec:

```typescript
interface UIState {
  dataSource: 'sandbox' | 'loading' | 'sheet' | 'empty' | undefined;
  zoomLevel: 'day' | 'week' | 'month';
  colorBy: ColorByField;
  showCriticalPath: boolean;
  criticalPathScope: { type: 'all' } | { type: 'project' | 'workstream'; name: string };
  theme: 'light' | 'dark';
  columns: ColumnConfig[];
  searchQuery: string;
  expandedTasks: Set<string>;
  isLeftPaneCollapsed: boolean;
  showOwnerOnBar: boolean;
  showAreaOnBar: boolean;
  showOkrsOnBar: boolean;
  collapseWeekends: boolean;
  contextMenu: { x: number; y: number; taskId: string } | null;
  dependencyEditor: { taskId: string; highlightFromId?: string } | null;
  reparentPicker: { taskId: string } | null;
  focusNewTaskId: string | null;
  // Conflict resolution
  pendingConflicts: ConflictRecord[] | null;
}
```

Single global subscription (no per-field granularity needed — UI changes infrequent).
`useUIStore<T>(selector: (s: UIState) => T): T` hook via `useSyncExternalStore`.

### Hooks (src/hooks/)

- `useTask(taskId: string): Task | undefined` — per-task O(1) subscription
- `useTaskOrder(): string[]` — global subscription
- `useCriticalPath(): Set<string>` — global subscription
- `useConflicts(): Map<string, string>` — global subscription
- `useUIStore<T>(selector): T` — selector-based UI state
- `useMutate(): (action: MutateAction) => void` — dispatches to Y.Doc mutation functions.
  **Type ownership:** Define `MutateAction` type in `src/types/index.ts` (shared across groups).
  **Context ownership:** Create and export `MutateContext` from `src/hooks/useMutate.ts`:
  ```typescript
  export const MutateContext = React.createContext<((action: MutateAction) => void) | null>(null);
  export function useMutate() {
    const mutate = useContext(MutateContext);
    if (!mutate) throw new Error('useMutate must be used within TaskStoreProvider');
    return mutate;
  }
  ```
  Group C imports `MutateContext` from `../../hooks/useMutate` and provides the real dispatch.
- `index.ts` — barrel exports

### Tests

- TaskStore: verify batchUpdate notifies only changed tasks, verify O(1) behavior
  (subscribe to task A, update task B, verify A's listener NOT called)
- UIStore: verify selector-based subscription, state transitions
- Import Task type from `src/types/index.ts`
- Mock Y.Doc interactions (Group B handles actual Y.Doc code)

## Error Handling

- Agents must NEVER do mental math — use `python3 -c` for arithmetic
- Progress: `TASK_ID | STATUS | ISO_TIMESTAMP | MESSAGE`
- On failure: read `.agent-status.json` and `git log --oneline -10` before retrying

## Verification

After all tasks:
1. `npx tsc --noEmit` — must pass
2. `npx vitest run src/store/ src/hooks/` — all new tests pass
3. Commit with conventional commit message
