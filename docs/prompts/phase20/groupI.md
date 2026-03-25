---
phase: 20
group: I
stage: 6
agent_count: 1
scope:
  modify:
    - src/state/TaskStoreProvider.tsx
    - src/state/UIStoreProvider.tsx
    - src/hooks/useMutate.ts
    - package.json
  create:
    - src/components/shared/DataSafeErrorBoundary.tsx
    - src/collab/__tests__/undoManager.test.ts
  read_only:
    - src/store/TaskStore.ts
    - src/schema/ydoc.ts
    - src/mutations/index.ts
    - docs/plans/frontend-redesign.md
depends_on: [A, B, C, D, E, F, G, H]
tasks:
  - id: I1
    summary: "Read architecture spec §8 (Undo/Error/Crash) and current undo implementation"
  - id: I2
    summary: "Add y-indexeddb dependency and wire into TaskStoreProvider"
  - id: I3
    summary: "Create Y.UndoManager: scoped to 'local' origin, captureTimeout 500ms"
  - id: I4
    summary: "Wire Ctrl+Z/Ctrl+Shift+Z in UIStoreProvider to Y.UndoManager (replace stubs)"
  - id: I5
    summary: "Clear Y.UndoManager on sandbox→sheet promotion (undoManager.clear())"
  - id: I6
    summary: "Create DataSafeErrorBoundary component (keeps provider mounted)"
  - id: I7
    summary: "Add error boundaries in App.tsx: outer + per-panel (table, chart)"
  - id: I8
    summary: "Add pre-write validation in SheetsAdapter: orphaned deps/childIds/parentId"
  - id: I9
    summary: "Write undo tests: per-client scope, cascade undo, sandbox clear"
---

# Phase 20 Group I — Undo + Error Recovery + Crash Safety

You are implementing Y.UndoManager, IndexedDB persistence, and error boundaries.
Read `docs/plans/frontend-redesign.md` section 8 (Undo / Error Recovery / Crash Safety).

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

Current undo is global (undoes ALL users' changes). Y.UndoManager provides per-client
scoped undo. y-indexeddb persists Y.Doc to IndexedDB for crash recovery. Error boundaries
prevent rendering errors from crashing the entire app.

## Key Requirements

### Y.UndoManager

```typescript
const undoManager = new Y.UndoManager(doc.getMap('tasks'), {
  trackedOrigins: new Set(['local']),  // only undo YOUR changes
  captureTimeout: 500,                 // group rapid edits into one step
});
```

Wire into TaskStoreProvider lifecycle:
- Create on mount (after Y.Doc init)
- Expose via context or ref
- Clear on sandbox→sheet promotion (`undoManager.clear()`)
- Destroy on unmount

Wire keyboard shortcuts in UIStoreProvider:
- Ctrl/Cmd+Z → `undoManager.undo()`
- Ctrl/Cmd+Shift+Z → `undoManager.redo()`
- Listen for `stack-item-added`/`stack-item-popped` → update UndoRedoButtons enabled state

### y-indexeddb

```bash
npm install y-indexeddb
```

In TaskStoreProvider, after Y.Doc creation:
```typescript
import { IndexeddbPersistence } from 'y-indexeddb';
const persistence = new IndexeddbPersistence(`ganttlet-${roomId}`, doc);
persistence.on('synced', () => { /* loaded from IndexedDB */ });
```

On load: IndexedDB restores Y.Doc → SheetsAdapter reconciles with Sheet.

### DataSafeErrorBoundary

Error boundary that keeps the sync provider mounted:
```typescript
<TaskStoreProvider>
  <UIStoreProvider>
    <DataSafeErrorBoundary fallback={...}>
      <Layout />  {/* inner boundaries per panel */}
    </DataSafeErrorBoundary>
  </UIStoreProvider>
</TaskStoreProvider>
```

Inner boundaries on table panel and chart panel independently. Failed panel shows
retry button. Other panels continue working. Sync continues regardless.

### Pre-write Validation

In SheetsAdapter, before writing to Sheets:
- Check orphaned `dependencies` (fromId references deleted task)
- Check orphaned `parentId` / `childIds`
- Check invalid dates (end < start, non-milestone)
- Log warnings but do NOT block write (blocking risks data loss)

## Verification

1. `npx tsc --noEmit`
2. `npx vitest run` — undo tests pass
3. `npx playwright test e2e/gantt.spec.ts -g "undo|redo"` — undo/redo E2E tests pass
4. Manual: Ctrl+Z undoes last edit, Ctrl+Shift+Z redoes
5. Commit with conventional commit message
