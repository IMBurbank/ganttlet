---
phase: 20
group: C
stage: 2
agent_count: 1
scope:
  create:
    - src/collab/observer.ts
    - src/collab/initialization.ts
    - src/collab/__tests__/observer.test.ts
    - src/state/TaskStoreProvider.tsx
    - src/state/UIStoreProvider.tsx
  modify:
    - src/collab/yjsProvider.ts
  read_only:
    - src/store/TaskStore.ts
    - src/store/UIStore.ts
    - src/schema/ydoc.ts
    - src/mutations/index.ts
    - src/utils/schedulerWasm.ts
    - src/utils/summaryUtils.ts
    - docs/plans/frontend-redesign.md
depends_on: [A, B]
tasks:
  - id: C1
    summary: "Read architecture spec (§6 observation handler) and Group A/B outputs"
  - id: C2
    summary: "Create observation handler with origin-aware routing (local/sheets/remote)"
  - id: C3
    summary: "Create Y.Doc initialization module (initializeYDoc, hydrateFromSheets)"
  - id: C4
    summary: "Create TaskStoreProvider (React context, Y.Doc lifecycle, observation wiring)"
  - id: C5
    summary: "Create UIStoreProvider (React context, localStorage persistence for expandedTasks/theme)"
  - id: C6
    summary: "Update yjsProvider.ts for new schema (Y.Map<Y.Map> instead of Y.Array)"
  - id: C7
    summary: "Write observer tests (incremental change detection, origin routing, error resilience)"
---

# Phase 20 Group C — Observation Handler + Providers

You are implementing the bridge between Y.Doc and the React store layer.
Read `docs/plans/frontend-redesign.md` section 6 (Observation Handler) for the spec.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

Groups A and B created the stores and Y.Doc mutations. This group wires them together:
Y.Doc changes → observation handler → TaskStore updates → React re-renders.

## Key Requirements

### Observation Handler (src/collab/observer.ts)

The handler subscribes to `ytasks.observeDeep()` and routes changes by transaction origin:

```typescript
function setupObserver(
  doc: Y.Doc,
  taskStore: TaskStore,
  uiState: { criticalPathScope: CriticalPathScope }
): () => void   // returns cleanup function
```

**Origin-aware routing:**
- `txn.origin === 'local'` → process synchronously (same frame, zero latency)
- `txn.origin === 'sheets'` → process synchronously but skip cold derivations (no cascade)
- No origin (remote Yjs peer) → batch via `requestAnimationFrame`

**Change extraction (use event.target, NOT event.path):**
```typescript
for (const event of events) {
  if (event.target === ytasks) {
    // Root map: task added/deleted. Keys = task IDs.
  } else if (event.target instanceof Y.Map && event.target.parent === ytasks) {
    // Inner Y.Map: field changed. taskId = event.target.get('id')
  }
}
```

**Invariant:** Task deletion is always `ytasks.delete(taskId)`, never inner-map mutation.

**Processing pipeline:**
1. Extract changed/deleted task IDs from events
2. Read ONLY changed tasks from Y.Doc via `yMapToTask()` (O(changed))
3. Merge into current `taskStore.getAllTasks()` state (so summary recalc sees new values)
4. Incremental summary recalc — `recalcAffectedSummaries()` walks UP from changed tasks
5. `taskStore.batchUpdate(changedTasks, deletedIds)`
6. If NOT 'sheets' origin: schedule cold derivations via `requestIdleCallback`
   (fallback `setTimeout(16)` for Safari): `computeCriticalPathScoped`, `detectConflicts`

**Also observe `taskOrder`:**
```typescript
taskOrder.observe(() => taskStore.setTaskOrder(Array.from(taskOrder)));
```

**Error resilience (4 layers):**
- Per-task: try/catch around yMapToTask — skip malformed
- Summary: try/catch — fall back to full recalcSummaryDates
- Cold derive: try/catch — show degraded mode
- Full handler: top-level try/catch — fall back to full Y.Doc re-read

### Y.Doc Initialization (src/collab/initialization.ts)

```typescript
// Create a Y.Doc and populate from a task array (for sandbox or initial sheet load)
function initializeYDoc(doc: Y.Doc, tasks: Task[]): void

// Hydrate an empty Y.Doc from Sheets data
function hydrateFromSheets(doc: Y.Doc, sheetTasks: Task[]): void
```

Both use `initSchema(doc)` from Group B's schema module, then write all tasks in one transaction.

### TaskStoreProvider (src/state/TaskStoreProvider.tsx)

React context provider that:
1. Creates a TaskStore instance
2. Creates or accepts a Y.Doc instance
3. Calls `setupObserver(doc, taskStore, ...)` on mount
4. Cleans up observer on unmount
5. Provides TaskStore via `TaskStoreContext` (imported from Group A's TaskStore.ts)
6. **Provides MutateContext** (import from `../../hooks/useMutate`) — wires useMutate() to real mutation functions:
   ```typescript
   const mutate = useCallback((action: MutateAction) => {
     const { tasks, taskOrder } = initSchema(doc);
     switch (action.type) {
       case 'MOVE_TASK': return moveTask(doc, action.taskId, action.newStart, action.newEnd);
       case 'ADD_TASK': return addTask(doc, action.task, action.afterTaskId);
       // ... all MutateAction cases
     }
   }, [doc]);
   return (
     <TaskStoreContext.Provider value={taskStore}>
       <MutateContext.Provider value={mutate}>
         {children}
       </MutateContext.Provider>
     </TaskStoreContext.Provider>
   );
   ```
7. **Yjs connection effect** (recreated from GanttContext): if a relay URL is configured,
   connect WebSocket provider to the Y.Doc. On disconnect, clean up. This enables collab.
8. **Sandbox initialization**: if `dataSource === 'sandbox'`, call `initializeYDoc(doc, demoTasks)`
   to populate the Y.Doc with demo data.

### UIStoreProvider (src/state/UIStoreProvider.tsx)

React context provider that:
1. Creates a UIStore instance
2. Initializes from localStorage (expandedTasks, theme)
3. Persists to localStorage on changes
4. Provides UIStore via `UIStoreContext` (imported from Group A's UIStore.ts)
5. **Keyboard shortcuts effect** (recreated from GanttContext):
   - Ctrl/Cmd+Z → Y.UndoManager.undo() (stubbed in Phase 1 — TODO for Phase 4)
   - Ctrl/Cmd+Shift+Z → Y.UndoManager.redo() (stubbed)
   - Ctrl/Cmd+B → toggle left pane
6. **Sandbox beforeunload effect**: if `dataSource === 'sandbox'` and tasks have been
   edited, prevent navigation with `beforeunload` event.

### yjsProvider.ts updates

Update `connectCollab` to work with the new Y.Doc schema:
- `doc.getMap<Y.Map<unknown>>('tasks')` instead of `doc.getArray('tasks')`
- No functional changes to WebSocket/auth logic

### Tests

```typescript
test('observer routes local changes synchronously', () => {
  const doc = new Y.Doc();
  const store = new TaskStore();
  setupObserver(doc, store, { criticalPathScope: { type: 'all' } });

  // Write a task with 'local' origin
  doc.transact(() => { /* add task */ }, 'local');

  // Store should be updated immediately (same tick)
  expect(store.getTask('task-1')).toBeDefined();
});

test('observer batches remote changes via RAF', () => {
  // Write without origin (simulates remote peer)
  doc.transact(() => { /* add task */ });
  // Store NOT updated yet (batched)
  expect(store.getTask('task-1')).toBeUndefined();
  // After RAF fires...
});

test('observer skips cold derivations for sheets origin', () => {
  // Mock requestIdleCallback, verify NOT called for 'sheets' origin
});
```

## Error Handling

- NEVER do mental date math — use shell functions
- Progress: `TASK_ID | STATUS | ISO_TIMESTAMP | MESSAGE`

## Verification

1. `npx tsc --noEmit`
2. `npx vitest run src/collab/ src/state/`
3. Commit with conventional commit message
