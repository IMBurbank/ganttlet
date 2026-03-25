---
phase: 20
group: B
stage: 1
agent_count: 1
scope:
  create:
    - src/schema/ydoc.ts
    - src/schema/index.ts
    - src/mutations/taskMutations.ts
    - src/mutations/dependencyMutations.ts
    - src/mutations/constraintMutations.ts
    - src/mutations/index.ts
    - src/mutations/__tests__/taskMutations.test.ts
    - src/mutations/__tests__/dependencyMutations.test.ts
    - src/mutations/__tests__/constraintMutations.test.ts
  read_only:
    - src/types/index.ts
    - src/utils/schedulerWasm.ts
    - src/utils/dateUtils.ts
    - src/collab/yjsBinding.ts
    - src/state/ganttReducer.ts
    - docs/plans/frontend-redesign.md
depends_on: []
tasks:
  - id: B1
    summary: "Read the architecture spec (§3 schema, §5 mutations) and current yjsBinding.ts"
  - id: B2
    summary: "Create Y.Doc schema module: initSchema, taskToYMap, yMapToTask, TASK_FIELDS constant"
  - id: B3
    summary: "Create moveTask + resizeTask mutations (compute cascade in WASM, write atomically)"
  - id: B4
    summary: "Create addTask + deleteTask mutations (UUID generation, recursive delete, childIds/deps cleanup)"
  - id: B5
    summary: "Create reparentTask mutation (parentId + old parent childIds + new parent childIds)"
  - id: B6
    summary: "Create updateTaskField mutation (single field update)"
  - id: B7
    summary: "Create setConstraint mutation (constraint type + date + cascade)"
  - id: B8
    summary: "Create dependency mutations (add, update, remove — JSON string ops)"
  - id: B9
    summary: "Write tests for all mutation functions (Y.Doc in, assert Y.Doc state out)"
---

# Phase 20 Group B — Y.Doc Schema + Mutation Functions

You are implementing the Y.Doc schema and mutation API for Ganttlet's frontend redesign.
Read `docs/plans/frontend-redesign.md` sections 3 (Schema), 5 (Mutation API) for the spec.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

Currently, task mutations go: component → React dispatch → reducer → mirror to Yjs.
In the redesign, mutations go: component → Y.Doc transaction directly. The reducer is
eliminated for task data. This group creates the Y.Doc schema and all mutation functions.

## Key Requirements

### Y.Doc Schema (src/schema/ydoc.ts)

```typescript
// Initialize a fresh Y.Doc with the correct structure
function initSchema(doc: Y.Doc): { tasks: Y.Map<Y.Map<unknown>>; taskOrder: Y.Array<string>; meta: Y.Map<unknown> }

// Convert between Task objects and Y.Map entries
function taskToYMap(task: Task): Y.Map<unknown>    // for inserting new tasks
function yMapToTask(ymap: Y.Map<unknown>): Task    // for reading — computes duration, excludes isExpanded/isHidden

// Constants
const TASK_FIELDS: string[]  // the 19 collaborative fields (NOT duration, isExpanded, isHidden)
```

**Schema:**
- `doc.getMap<Y.Map<unknown>>('tasks')` — keyed by task ID (O(1) lookup)
- `doc.getArray<string>('taskOrder')` — display order
- `doc.getMap<unknown>('meta')` — `{ schemaVersion: 1 }`

**yMapToTask must:**
- Compute `duration` from `startDate`/`endDate` via `taskDuration()` from `dateUtils.ts`
- Default `isExpanded: true`, `isHidden: false` (per-user state, not from Y.Doc)
- Parse `childIds`, `dependencies`, `okrs` from JSON strings with try/catch (default to `[]`)

**taskToYMap must:**
- Write all 19 TASK_FIELDS
- NOT write `duration`, `isExpanded`, `isHidden`
- JSON.stringify for `childIds`, `dependencies`, `okrs`

### Mutation Functions

**Pattern: compute first, write atomically.**
```
1. Read current state from Y.Doc (O(1) via Y.Map.get)
2. Compute cascade in WASM if needed (OUTSIDE transaction)
3. If WASM fails → abort, write nothing
4. Write all changes in one doc.transact(() => {}, 'local')
```

The `'local'` origin tag is critical — Y.UndoManager (Phase 4) tracks this origin.

**moveTask(doc, taskId, newStart, newEnd):**
- Read current task → compute daysDelta → call `cascadeDependents` from WASM
- If cascade fails (WASM error), abort — don't write anything
- In one transaction: update task dates + all cascaded task dates
- Also update `taskOrder` Y.Array? No — moves don't change order.

**resizeTask(doc, taskId, newEnd):**
- Similar to moveTask but only endDate changes. Cascade by delta from old end to new end.

**addTask(doc, task, afterTaskId?):**
- Generate ID: `crypto.randomUUID()`
- Create Y.Map via `taskToYMap()`
- In one transaction: `ytasks.set(id, ymap)` + `taskOrder.insert(index, [id])`
- If task has a parent: update parent's childIds JSON (append new ID)

**deleteTask(doc, taskId):**
- BFS collect all descendants via childIds
- In one transaction:
  - Delete all from ytasks
  - Remove all from taskOrder (iterate backwards)
  - Remove from parent's childIds
  - Clean dependency references in ALL remaining tasks

**reparentTask(doc, taskId, newParentId):**
- In one transaction:
  - Update task's parentId
  - Remove from old parent's childIds JSON
  - Add to new parent's childIds JSON
  - Update taskOrder position (move to after new parent's children)
- NO ID changes (stable UUIDs)

**setConstraint(doc, taskId, type, date?):**
- Read task → set constraintType + constraintDate
- Compute cascade via WASM → write all affected tasks
- One transaction

**addDependency / updateDependency / removeDependency:**
- Read `dependencies` JSON from Y.Map → parse → modify → JSON.stringify → write back
- One transaction each

### Tests

Each test: create a Y.Doc → call mutation → assert Y.Doc state.

```typescript
test('moveTask updates dates and cascades dependents', () => {
  const doc = new Y.Doc();
  const { tasks, taskOrder } = initSchema(doc);
  // Seed two tasks with FS dependency
  // Call moveTask(doc, 'task-1', '2026-04-01', '2026-04-05')
  // Assert task-1 dates changed
  // Assert task-2 dates cascaded
});
```

Mock WASM: `vi.mock('../../utils/schedulerWasm', () => ({ cascadeDependents: vi.fn(...) }))`

## Error Handling

- NEVER do mental date math — use `taskEndDate`/`taskDuration` from `dateUtils.ts`
- Progress: `TASK_ID | STATUS | ISO_TIMESTAMP | MESSAGE`
- On failure: read `.agent-status.json` and `git log --oneline -10`

## Verification

1. `npx tsc --noEmit` — must pass
2. `npx vitest run src/schema/ src/mutations/` — all new tests pass
3. Commit with conventional commit message
