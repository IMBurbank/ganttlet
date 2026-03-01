# Phase 6 Agent Prompts

Three self-contained prompts for parallel Claude CLI sessions.
Each session runs in its own git worktree and can spawn subagents for subtasks.

## Setup

Claude Code runs in Docker with the project root mounted at `/workspace/`.
Attach three terminals to the running dev container, one per agent group.

```bash
# From the host, open three terminals and attach each to the dev container:
docker compose exec dev bash

# Inside the container, create worktrees from /workspace:

# Terminal 1 — Group A
cd /workspace
git worktree add /workspace/.claude/worktrees/phase6-groupA -b feature/phase6-wasm-scheduler
cd /workspace/.claude/worktrees/phase6-groupA
npm install
claude --dangerously-skip-permissions

# Terminal 2 — Group B
cd /workspace
git worktree add /workspace/.claude/worktrees/phase6-groupB -b feature/phase6-state-sync
cd /workspace/.claude/worktrees/phase6-groupB
npm install
claude --dangerously-skip-permissions

# Terminal 3 — Group C (can start immediately — it polls TASKS.md for A4+B2 completion)
cd /workspace
git worktree add /workspace/.claude/worktrees/phase6-groupC -b feature/phase6-ui-visual
cd /workspace/.claude/worktrees/phase6-groupC
npm install
claude --dangerously-skip-permissions

# Terminal 4 — Group D integration (can start immediately — polls for A4+B6+C9 completion)
cd /workspace
claude --dangerously-skip-permissions
```

### Notes
- All worktrees live under `/workspace/.claude/worktrees/` inside the container
- TASKS.md at `/workspace/TASKS.md` is the shared coordination file — all worktrees can see the main repo's copy
- When marking tasks done, agents should edit `/workspace/TASKS.md` (the main copy, not the worktree copy) so other agents can see updates
- Each worktree has its own `node_modules` — `npm install` is required after creation
- `npm run build:wasm` in Group A's worktree uses the Rust toolchain already in the container

After all three finish, merge branches into main.

---

## Group A Prompt — WASM Scheduler Enhancements

Paste this into Terminal 1:

````
You are the Group A agent for Phase 6 of Ganttlet. You own the Rust WASM scheduler and its TypeScript wrapper. NO OTHER FILES.

## Your files (exclusive ownership — only touch these)
- crates/scheduler/src/cpm.rs
- crates/scheduler/src/types.rs
- crates/scheduler/src/lib.rs
- crates/scheduler/src/cascade.rs (read-only reference)
- crates/scheduler/src/graph.rs (read-only reference)
- crates/scheduler/src/constraints.rs (NEW — you create this)
- crates/scheduler/Cargo.toml (if needed)
- src/utils/schedulerWasm.ts

## DO NOT TOUCH
Any file in src/state/, src/collab/, src/components/, src/types/. Those belong to Groups B and C.

## Tasks (execute sequentially: A1 → A2 → A3 → A4)

### A1: Fix critical path — only connected dependency chains

File: crates/scheduler/src/cpm.rs

**Bug**: `compute_critical_path()` returns ALL zero-float tasks, including standalone tasks with no dependencies. A single task with no predecessors or successors always has zero float and gets marked critical — this is wrong.

**Current code** (lines 206-217):
```rust
let mut critical_ids = Vec::new();
for t in &non_summary {
    let task_es = *es.get(t.id.as_str()).unwrap_or(&0);
    let task_ls = *ls.get(t.id.as_str()).unwrap_or(&0);
    let float = task_ls - task_es;
    if float.abs() < 1 {
        critical_ids.push(t.id.clone());
    }
}
```

**Fix**: After the zero-float check, also require that the task participates in at least one dependency relationship. Use the `in_degree` and `successors` maps already computed above. A task is critical only if `float.abs() < 1 AND (in_degree[id] > 0 || successors[id].len() > 0)`.

**Tests to add**:
- `standalone_task_not_critical`: Single task with no deps → NOT critical (this is a CHANGE from the existing `single_task_is_critical` test — update it)
- `standalone_task_alongside_chain`: A→B chain plus standalone C. A and B are critical, C is NOT.

**Tests to verify still pass**:
- `linear_fs_chain` — all three tasks remain critical
- `non_critical_task_with_float` — C still excluded

Run: `cd crates/scheduler && cargo test`

---

### A2: Add scoped critical path computation

**Files**: crates/scheduler/src/cpm.rs, crates/scheduler/src/types.rs, crates/scheduler/src/lib.rs

**Step 1**: Add `project` field to the Rust Task struct.

In `types.rs`, add to the Task struct:
```rust
pub project: String,
```
This field is `#[serde(rename_all = "camelCase")]` so it maps to `project` in JS (same name).

Update ALL test helper `make_task` functions across all test modules (cpm.rs, cascade.rs, graph.rs) to include `project: String::new()`.

**Step 2**: Add scope enum to `cpm.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CriticalPathScope {
    All,
    Project { name: String },
    Milestone { id: String },
}
```

**Step 3**: Add `compute_critical_path_scoped(tasks, scope)` in `cpm.rs`:
- `All` → call existing `compute_critical_path(tasks)` (with A1 fix applied)
- `Project { name }` → filter tasks to only those where `task.project == name`, then call `compute_critical_path(&filtered)`
- `Milestone { id }` → BFS backward from the milestone task through the dependency graph (follow `dep.fromId` links) to find ALL transitive predecessors. Collect those + the milestone. Run `compute_critical_path(&subset)`.

**Step 4**: Add WASM export in `lib.rs`:
```rust
#[wasm_bindgen]
pub fn compute_critical_path_scoped(tasks_js: JsValue, scope_js: JsValue) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
    let scope: cpm::CriticalPathScope = serde_wasm_bindgen::from_value(scope_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize scope: {}", e)))?;
    let critical_ids = cpm::compute_critical_path_scoped(&tasks, &scope);
    serde_wasm_bindgen::to_value(&critical_ids)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}
```

**Tests**:
- `scoped_all_same_as_default`: `compute_critical_path_scoped(tasks, All)` == `compute_critical_path(tasks)`
- `scoped_project_filters`: Two projects "Alpha" and "Beta" with independent chains. Scoping to "Alpha" only returns Alpha's chain.
- `scoped_milestone_traces_predecessors`: A→B→C→Milestone. Scoping to Milestone returns A,B,C,Milestone critical chain.

Run: `cd crates/scheduler && cargo test`

---

### A3: Add `compute_earliest_start` to Rust crate

**File**: crates/scheduler/src/constraints.rs (NEW FILE)

Create a new module. Add `pub mod constraints;` to `lib.rs`.

```rust
use crate::types::{DepType, Task};

/// Compute the earliest possible start date for a task given its dependencies.
/// Returns None if the task has no dependencies (unconstrained).
pub fn compute_earliest_start(tasks: &[Task], task_id: &str) -> Option<String> {
    // find the task
    // iterate its dependencies
    // for each dep, find the predecessor task and compute earliest start:
    //   FS: predecessor.end_date + lag + 1 day  (FS means finish-to-start: start after predecessor finishes)
    //   SS: predecessor.start_date + lag
    //   FF: predecessor.end_date + lag - task.duration + 1 day
    // return the maximum (latest) of all computed dates, or None if no deps
}
```

Reuse the `add_days` and `parse_date` helpers from `cascade.rs` — either extract them to a shared `date_utils.rs` module, or duplicate the simple ones. Prefer extracting to avoid duplication.

**WASM export** in `lib.rs`:
```rust
#[wasm_bindgen]
pub fn compute_earliest_start(tasks_js: JsValue, task_id: &str) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
    let result = constraints::compute_earliest_start(&tasks, task_id);
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}
```

**Tests** (in constraints.rs):
- `no_deps_returns_none`: task with no dependencies → None
- `single_fs_dep`: A(start 03-01, end 03-10) → B(FS, lag 0). Earliest start for B = 03-11 (end + 1 day)
- `fs_dep_with_lag`: A(end 03-10) → B(FS, lag 2). Earliest = 03-13
- `multiple_deps_latest_wins`: A(end 03-10) and C(end 03-15) both FS to B. Earliest = 03-16
- `ss_dep`: A(start 03-01) → B(SS, lag 3). Earliest = 03-04

Run: `cd crates/scheduler && cargo test`

---

### A4: Expose all new functions in TypeScript wrapper

**File**: src/utils/schedulerWasm.ts

Add three new exports that Group B and C will consume (they depend on these signatures exactly):

```typescript
import type { Task } from '../types';

// Existing CriticalPathScope will be defined in types/index.ts by Group B.
// For now, define it locally or import from types:
export type CriticalPathScope =
  | { type: 'all' }
  | { type: 'project'; name: string }
  | { type: 'milestone'; id: string };

export function computeCriticalPathScoped(tasks: Task[], scope: CriticalPathScope): Set<string> {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  const wasmTasks = mapTasksToWasm(tasks); // extract the existing mapping to a helper
  const result: string[] = wasmModule.compute_critical_path_scoped(wasmTasks, scope);
  return new Set(result);
}

export function computeEarliestStart(tasks: Task[], taskId: string): string | null {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  const wasmTasks = mapTasksToWasm(tasks);
  return wasmModule.compute_earliest_start(wasmTasks, taskId) ?? null;
}

export function cascadeDependentsWithIds(
  tasks: Task[],
  movedTaskId: string,
  daysDelta: number,
): { tasks: Task[]; changedIds: string[] } {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  const wasmTasks = mapTasksToWasm(tasks);
  const results: CascadeResult[] = wasmModule.cascade_dependents(wasmTasks, movedTaskId, daysDelta);
  const changedIds = results.map(r => r.id);
  const changedMap = new Map(results.map(r => [r.id, r]));
  const updatedTasks = tasks.map(t => {
    const changed = changedMap.get(t.id);
    return changed ? { ...t, startDate: changed.startDate, endDate: changed.endDate } : t;
  });
  return { tasks: updatedTasks, changedIds };
}
```

**Also**:
1. Extract the repeated task-mapping code into a `mapTasksToWasm(tasks)` helper.
2. Add `project: t.project` to the WASM task mapping object.
3. Update the existing `computeCriticalPath` to call `computeCriticalPathScoped(tasks, { type: 'all' })` for backward compatibility.

**Verify**:
```bash
cd crates/scheduler && cargo test
npm run build:wasm
npm run test
```

## When done
1. Mark tasks A1-A4 as `[x]` in TASKS.md
2. Commit with message: "feat: scoped critical path, earliest start, cascade IDs in WASM scheduler"
3. Run `npm run build` to verify full build passes
````

---

## Group B Prompt — State Management, Undo/Redo, Collab Sync

Paste this into Terminal 2:

````
You are the Group B agent for Phase 6 of Ganttlet. You own the state management, action types, and collab sync layer. NO OTHER FILES.

## Your files (exclusive ownership — only touch these)
- src/types/index.ts
- src/state/actions.ts
- src/state/ganttReducer.ts
- src/state/GanttContext.tsx
- src/collab/yjsBinding.ts

## DO NOT TOUCH
Any file in crates/, src/utils/schedulerWasm.ts, src/components/. Those belong to Groups A and C.

## Read-only dependencies (you import from these but don't modify them)
- src/utils/schedulerWasm.ts — provides `cascadeDependents`, `cascadeDependentsWithIds` (Group A adds this)

## Tasks (execute: B1 → B2 → B3 → B4 → B5+B6 in parallel)

### B1: Fix CASCADE_DEPENDENTS collab sync (bug fix)

**File**: src/collab/yjsBinding.ts

**Bug**: `CASCADE_DEPENDENTS` is in `TASK_MODIFYING_ACTIONS` (GanttContext.tsx:56) so `collabDispatch` calls `applyActionToYjs()` for it. But `applyActionToYjs()` has no `case 'CASCADE_DEPENDENTS'` in its switch — it falls through to `default: break;` at line 240. Cascaded date changes NEVER reach other users.

**Fix**: Add a case to the switch in `applyActionToYjs()` (after the `SHOW_ALL_TASKS` case, before `SET_TASKS`):

```typescript
case 'CASCADE_DEPENDENTS': {
  isLocalUpdate = true;
  try {
    doc.transact(() => {
      const currentTasks = readTasksFromYjs(doc);
      // Import cascadeDependents from schedulerWasm
      const { cascadeDependents } = await import('../utils/schedulerWasm');
      // Actually this needs to be sync — cascadeDependents IS sync (no await needed)
      const updated = cascadeDependents(currentTasks, action.taskId, action.daysDelta);
      for (const task of updated) {
        const idx = findTaskIndex(yarray, task.id);
        if (idx !== -1) {
          const orig = currentTasks.find(t => t.id === task.id);
          if (orig && (orig.startDate !== task.startDate || orig.endDate !== task.endDate)) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('startDate', task.startDate);
            ymap.set('endDate', task.endDate);
          }
        }
      }
    });
  } finally {
    isLocalUpdate = false;
  }
  break;
}
```

Note: `cascadeDependents` is a synchronous function. Add the import at the top of the file:
```typescript
import { cascadeDependents } from '../utils/schedulerWasm';
```

**Verify**: `npm run test` passes, TypeScript compiles.

---

### B2: Add new state fields and action types

This is the critical dependency for Group C. Complete it ASAP and mark `[x]` in TASKS.md.

**File**: src/types/index.ts

Add the `CriticalPathScope` type before `GanttState`:
```typescript
export type CriticalPathScope =
  | { type: 'all' }
  | { type: 'project'; name: string }
  | { type: 'milestone'; id: string };
```

Add to `GanttState` interface (after `isCollabConnected`):
```typescript
undoStack: Task[][];
redoStack: Task[][];
lastCascadeIds: string[];
criticalPathScope: CriticalPathScope;
collapseWeekends: boolean;
```

**File**: src/state/actions.ts

Add to the `GanttAction` union (before the closing semicolon):
```typescript
| { type: 'UNDO' }
| { type: 'REDO' }
| { type: 'SET_LAST_CASCADE_IDS'; taskIds: string[] }
| { type: 'SET_CRITICAL_PATH_SCOPE'; scope: CriticalPathScope }
| { type: 'TOGGLE_COLLAPSE_WEEKENDS' }
```

Add the import for `CriticalPathScope`:
```typescript
import type { ColorByField, ZoomLevel, ColumnConfig, CollabUser, Dependency, DependencyType, Task, CriticalPathScope } from '../types';
```

**File**: src/state/GanttContext.tsx

Add to `initialState` (after `isCollabConnected: false`):
```typescript
undoStack: [],
redoStack: [],
lastCascadeIds: [],
criticalPathScope: { type: 'all' } as CriticalPathScope,
collapseWeekends: true,
```

Import `CriticalPathScope`:
```typescript
import type { GanttState, CriticalPathScope } from '../types';
```

**Verify**: `npx tsc --noEmit` passes. Mark B2 as done in TASKS.md.

---

### B3: Implement undo/redo in reducer

**File**: src/state/ganttReducer.ts

**Step 1**: Define which actions are undoable:
```typescript
const UNDOABLE_ACTIONS = new Set([
  'MOVE_TASK', 'RESIZE_TASK', 'CASCADE_DEPENDENTS',
  'ADD_DEPENDENCY', 'UPDATE_DEPENDENCY', 'REMOVE_DEPENDENCY',
  'ADD_TASK', 'DELETE_TASK',
]);
```

**Step 2**: Wrap the reducer to snapshot before undoable actions. Replace the top of `ganttReducer`:

```typescript
export function ganttReducer(state: GanttState, action: GanttAction): GanttState {
  // Snapshot before undoable actions
  let stateForReducer = state;
  if (UNDOABLE_ACTIONS.has(action.type)) {
    const undoStack = [...state.undoStack, state.tasks].slice(-50); // max 50
    stateForReducer = { ...state, undoStack, redoStack: [] };
  }

  return ganttReducerInner(stateForReducer, action);
}

function ganttReducerInner(state: GanttState, action: GanttAction): GanttState {
  switch (action.type) {
    // ... all existing cases ...
```

**Step 3**: Add UNDO and REDO cases inside `ganttReducerInner`:
```typescript
case 'UNDO': {
  if (state.undoStack.length === 0) return state;
  const prev = state.undoStack[state.undoStack.length - 1];
  return {
    ...state,
    tasks: prev,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, state.tasks],
    lastCascadeIds: [],
  };
}

case 'REDO': {
  if (state.redoStack.length === 0) return state;
  const next = state.redoStack[state.redoStack.length - 1];
  return {
    ...state,
    tasks: next,
    redoStack: state.redoStack.slice(0, -1),
    undoStack: [...state.undoStack, state.tasks],
    lastCascadeIds: [],
  };
}
```

**Verify**: `npm run test` passes.

---

### B4: Update CASCADE_DEPENDENTS to track changed IDs + add new reducer cases

**File**: src/state/ganttReducer.ts

**Step 1**: Update the CASCADE_DEPENDENTS case. Import `cascadeDependentsWithIds` from schedulerWasm (Group A adds this — if it doesn't exist yet, keep using `cascadeDependents` and add a TODO comment; we'll update when A4 is done).

For now, since `cascadeDependentsWithIds` may not exist yet, implement it inline:
```typescript
case 'CASCADE_DEPENDENTS': {
  const result = cascadeDependents(state.tasks, action.taskId, action.daysDelta);
  // Track which task IDs changed
  const changedIds = result
    .filter((t, i) => t.startDate !== state.tasks[i]?.startDate || t.endDate !== state.tasks[i]?.endDate)
    .map(t => t.id);
  let tasks = recalcSummaryDates(result);
  return { ...state, tasks, lastCascadeIds: changedIds };
}
```

Actually, a simpler approach: compare before/after to find changed IDs:
```typescript
case 'CASCADE_DEPENDENTS': {
  let tasks = cascadeDependents(state.tasks, action.taskId, action.daysDelta);
  // Find IDs of tasks whose dates changed
  const changedIds: string[] = [];
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].startDate !== state.tasks[i]?.startDate || tasks[i].endDate !== state.tasks[i]?.endDate) {
      changedIds.push(tasks[i].id);
    }
  }
  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks, lastCascadeIds: changedIds };
}
```

**Step 2**: Add remaining new cases:
```typescript
case 'SET_LAST_CASCADE_IDS':
  return { ...state, lastCascadeIds: action.taskIds };

case 'SET_CRITICAL_PATH_SCOPE':
  return { ...state, criticalPathScope: action.scope };

case 'TOGGLE_COLLAPSE_WEEKENDS':
  return { ...state, collapseWeekends: !state.collapseWeekends };
```

**Verify**: `npm run test` passes.

---

### B5: Wire up keyboard shortcuts for undo/redo

**File**: src/state/GanttContext.tsx

Add a `useEffect` inside `GanttProvider` (after the collab effect):

```typescript
// Keyboard shortcuts for undo/redo
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        collabDispatch({ type: 'REDO' });
      } else {
        collabDispatch({ type: 'UNDO' });
      }
    }
  }
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [collabDispatch]);
```

Also add UNDO and REDO to `TASK_MODIFYING_ACTIONS` so they sync to Yjs:
```typescript
const TASK_MODIFYING_ACTIONS = new Set([
  'MOVE_TASK', 'RESIZE_TASK', 'UPDATE_TASK_FIELD', 'TOGGLE_EXPAND',
  'HIDE_TASK', 'SHOW_ALL_TASKS', 'CASCADE_DEPENDENTS',
  'UNDO', 'REDO',
]);
```

---

### B6: Sync UNDO/REDO to collab

**File**: src/collab/yjsBinding.ts

UNDO/REDO replace the entire task array, so they need a full sync rather than incremental updates. Add cases:

```typescript
case 'UNDO':
case 'REDO': {
  // These replace the entire task array — handled via full sync.
  // The collabDispatch wrapper in GanttContext already calls applyActionToYjs.
  // We need to do a full replacement, but we don't have the resulting tasks here.
  // Instead, we'll handle this differently...
  break;
}
```

**Better approach**: In GanttContext.tsx, use a ref to detect when UNDO/REDO was dispatched, then do a full sync in a useEffect:

```typescript
// In GanttProvider:
const pendingFullSyncRef = useRef(false);

// Modify collabDispatch:
const collabDispatch = useCallback<Dispatch<GanttAction>>((action: GanttAction) => {
  dispatch(action);

  if (action.type === 'UNDO' || action.type === 'REDO') {
    pendingFullSyncRef.current = true;
  } else if (yjsDocRef.current && TASK_MODIFYING_ACTIONS.has(action.type)) {
    applyActionToYjs(yjsDocRef.current, action);
  }
}, []);

// Add effect to sync after undo/redo:
useEffect(() => {
  if (pendingFullSyncRef.current && yjsDocRef.current) {
    applyTasksToYjs(yjsDocRef.current, state.tasks);
    pendingFullSyncRef.current = false;
  }
}, [state.tasks]);
```

Remove UNDO/REDO from `TASK_MODIFYING_ACTIONS` since we handle them specially. Keep the set as before.

**Verify**: `npm run test` passes. Open two browser tabs with `?room=test`. Move a task, Ctrl+Z — both tabs should revert.

## When done
1. Mark tasks B1-B6 as `[x]` in TASKS.md
2. Commit with message: "feat: undo/redo, cascade sync fix, scoped critical path state"
3. Run `npm run build` to verify full build passes
````

---

## Group C Prompt — UI, Visual Feedback, Timeline

Paste this into Terminal 3. The agent will poll TASKS.md until its dependencies (A4, B2) are done, then start work automatically.

````
You are the Group C agent for Phase 6 of Ganttlet. You own ALL UI components and the dateUtils module. NO OTHER FILES.

## BEFORE YOU START — Wait for dependencies

You depend on Group A (task A4) and Group B (task B2) completing first. Their work provides the WASM functions and state fields you import.

**Poll `/workspace/TASKS.md` every 30 seconds** until BOTH of these lines show `[x]`:
- `[x] **A4**:` (Group A exposed WASM functions in TypeScript wrapper)
- `[x] **B2**:` (Group B added new state fields and action types)

Use this procedure:
1. Read `/workspace/TASKS.md` and check if both A4 and B2 are marked `[x]`
2. If NOT both done, say "Waiting for A4 and B2... (check N)" then sleep 30 seconds and check again
3. If BOTH done, say "Dependencies met — starting Group C work" and proceed to the tasks below

Do NOT start modifying any files until both dependencies are confirmed done. You may use the waiting time to read and familiarize yourself with the files you'll be editing.

## Your files (exclusive ownership — only touch these)
- src/components/gantt/TaskBar.tsx
- src/components/gantt/GanttChart.tsx
- src/components/gantt/DependencyLayer.tsx
- src/components/gantt/TimelineHeader.tsx
- src/components/gantt/GridLines.tsx
- src/components/gantt/CascadeHighlight.tsx (NEW — you create this)
- src/components/gantt/SlackIndicator.tsx (NEW — you create this)
- src/components/table/ColumnHeader.tsx
- src/components/shared/DependencyEditorModal.tsx
- src/components/shared/UndoRedoButtons.tsx (NEW — you create this)
- src/components/layout/Toolbar.tsx
- src/utils/dateUtils.ts

## DO NOT TOUCH
Any file in crates/, src/state/, src/collab/, src/types/. Those belong to Groups A and B.

## Read-only dependencies (you import from these but don't modify them)
- src/types/index.ts — GanttState now has: undoStack, redoStack, lastCascadeIds, criticalPathScope, collapseWeekends, CriticalPathScope type
- src/state/actions.ts — New actions: UNDO, REDO, SET_LAST_CASCADE_IDS, SET_CRITICAL_PATH_SCOPE, TOGGLE_COLLAPSE_WEEKENDS
- src/state/GanttContext.tsx — useGanttState() and useGanttDispatch() hooks
- src/utils/schedulerWasm.ts — New functions: computeCriticalPathScoped(tasks, scope), computeEarliestStart(tasks, taskId), cascadeDependentsWithIds(tasks, id, delta)

## Tasks (execute: C1+C2 → C3 → C4+C5+C6 → C7+C8+C9)

You can use subagents for parallel tasks within a stage (e.g. C1 and C2 simultaneously).

### C1: Fix dependency modal click-outside (quick bug fix)

**File**: src/components/shared/DependencyEditorModal.tsx

**Bug**: The outer container div (line 136-137) has `onClick={(e) => { if (e.target === e.currentTarget) close(); }}`. But the backdrop div (line 140) is a child `<div className="absolute inset-0" .../>` that covers the entire area. When user clicks the backdrop, `e.target` is the backdrop div, NOT the outer container, so `e.target === e.currentTarget` is always false for backdrop clicks.

**Fix**: Add `onClick={close}` directly to the backdrop div at line 140:
```typescript
<div className="absolute inset-0" style={{ backgroundColor: 'var(--raw-backdrop)' }} onClick={close} />
```

That's it. One line change.

---

### C2: Add column close buttons

**File**: src/components/table/ColumnHeader.tsx

Current code is minimal (25 lines). Enhance it:

```typescript
import React from 'react';
import type { ColumnConfig } from '../../types';
import { useGanttDispatch } from '../../state/GanttContext';

interface ColumnHeaderProps {
  columns: ColumnConfig[];
}

export default function ColumnHeader({ columns }: ColumnHeaderProps) {
  const dispatch = useGanttDispatch();
  const visibleColumns = columns.filter(c => c.visible);

  return (
    <div className="flex items-center h-[50px] bg-surface-raised border-b border-border-default text-xs font-semibold text-text-secondary uppercase tracking-wider select-none">
      {visibleColumns.map(col => (
        <div
          key={col.key}
          className="px-2 truncate shrink-0 flex items-center justify-between group"
          style={{ width: col.width }}
        >
          <span>{col.label}</span>
          {col.key !== 'name' && (
            <button
              onClick={() => dispatch({ type: 'TOGGLE_COLUMN', columnKey: col.key })}
              className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary ml-1 transition-opacity cursor-pointer"
              title={`Hide ${col.label}`}
            >
              &times;
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

### C3: Collapse weekends in day view

**File**: src/utils/dateUtils.ts

Add weekend-aware functions:

```typescript
import { isWeekend as isWeekendFn } from 'date-fns';

/** Count business days (Mon-Fri) between two dates. */
export function businessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    if (!isWeekendFn(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/** dateToX that skips weekends when collapseWeekends is true and zoom is 'day'. */
export function dateToXCollapsed(
  dateStr: string, timelineStart: Date, colWidth: number,
  zoom: ZoomLevel, collapseWeekends: boolean
): number {
  if (!collapseWeekends || zoom !== 'day') return dateToX(dateStr, timelineStart, colWidth, zoom);
  const date = parseISO(dateStr);
  return businessDaysBetween(timelineStart, date) * colWidth;
}

/** Inverse: x to date, skipping weekends. */
export function xToDateCollapsed(
  x: number, timelineStart: Date, colWidth: number,
  zoom: ZoomLevel, collapseWeekends: boolean
): Date {
  if (!collapseWeekends || zoom !== 'day') return xToDate(x, timelineStart, colWidth, zoom);
  const bizDays = Math.round(x / colWidth);
  let count = 0;
  const current = new Date(timelineStart);
  while (count < bizDays) {
    current.setDate(current.getDate() + 1);
    if (!isWeekendFn(current)) count++;
  }
  return current;
}

/** Get timeline days, optionally filtering out weekends. */
export function getTimelineDaysFiltered(start: Date, end: Date, collapseWeekends: boolean): Date[] {
  const all = eachDayOfInterval({ start, end });
  return collapseWeekends ? all.filter(d => !isWeekendFn(d)) : all;
}
```

**File**: src/components/gantt/TimelineHeader.tsx

Read `collapseWeekends` from state. In the `zoom === 'day'` branch, use `getTimelineDaysFiltered` instead of `getTimelineDays`:

```typescript
import { useGanttState } from '../../state/GanttContext';
// ...
const { collapseWeekends } = useGanttState();
// In the day zoom block:
const days = collapseWeekends
  ? getTimelineDaysFiltered(timelineStart, timelineEnd, true)
  : getTimelineDays(timelineStart, timelineEnd);
```

Import `getTimelineDaysFiltered` from dateUtils.

**File**: src/components/gantt/GridLines.tsx

Same pattern — read `collapseWeekends` from state, use filtered days. When weekends are collapsed, there are no weekend columns to shade.

**File**: src/components/gantt/GanttChart.tsx

Read `collapseWeekends` from state. Use `dateToXCollapsed` instead of `dateToX` for task positioning. Pass `collapseWeekends` to child components that need it. Update `totalDays` calculation to use filtered days when weekends collapsed.

**File**: src/components/gantt/TaskBar.tsx

Add `collapseWeekends` prop (default false). Use `dateToXCollapsed`/`xToDateCollapsed` in the drag handler instead of `dateToX`/`xToDate`.

---

### C4: Critical path scope UI in Toolbar

**File**: src/components/layout/Toolbar.tsx

Replace the single Critical Path toggle button with a split button group:
1. Toggle on/off (dispatches `TOGGLE_CRITICAL_PATH`)
2. When on, show a dropdown to select scope:
   - "All" (default)
   - List of unique project names from `state.tasks.map(t => t.project).filter(Boolean)`
   - List of milestone tasks from `state.tasks.filter(t => t.isMilestone)`
3. Dispatch `SET_CRITICAL_PATH_SCOPE` when scope changes.

Read `criticalPathScope` from state to highlight current selection.

Import `CriticalPathScope` from types.

---

### C5: Pass scoped critical path to GanttChart

**File**: src/components/gantt/GanttChart.tsx

Change from:
```typescript
const criticalPathIds = useMemo(
  () => showCriticalPath ? computeCriticalPath(allTasks) : new Set<string>(),
  [allTasks, showCriticalPath]
);
```

To:
```typescript
import { computeCriticalPathScoped } from '../../utils/schedulerWasm';
// ...
const { showCriticalPath, criticalPathScope, collapseWeekends } = useGanttState();
const criticalPathIds = useMemo(
  () => showCriticalPath ? computeCriticalPathScoped(allTasks, criticalPathScope) : new Set<string>(),
  [allTasks, showCriticalPath, criticalPathScope]
);
```

Remove the old `computeCriticalPath` import if no longer needed.

---

### C6: Enforce drag constraints in TaskBar

**File**: src/components/gantt/TaskBar.tsx

Add `earliestStart?: string` prop to `TaskBarProps`.

In `onMouseMove` for move mode, after computing `newStartStr`, clamp it:
```typescript
if (dragRef.current.mode === 'move') {
  let newStart = xToDateCollapsed(
    dateToXCollapsed(dragRef.current.origStartDate, timelineStart, colWidth, zoom, collapseWeekends) + dx,
    timelineStart, colWidth, zoom, collapseWeekends
  );
  let newStartStr = formatDate(newStart);

  // Clamp to earliest start constraint
  if (earliestStart && newStartStr < earliestStart) {
    newStartStr = earliestStart;
    newStart = parseISO(earliestStart);
  }

  const duration = daysBetween(dragRef.current.origStartDate, dragRef.current.origEndDate);
  const newEnd = new Date(newStart);
  newEnd.setDate(newEnd.getDate() + duration);
  const newEndStr = formatDate(newEnd);

  dragRef.current.lastStartDate = newStartStr;
  dispatch({ type: 'MOVE_TASK', taskId, newStartDate: newStartStr, newEndDate: newEndStr });
}
```

Import `parseISO` from date-fns.

**In GanttChart.tsx**: compute earliestStart for each task and pass it down:
```typescript
import { computeEarliestStart } from '../../utils/schedulerWasm';
// Inside the task rendering loop:
const earliest = computeEarliestStart(allTasks, task.id);
// Pass to TaskBar:
earliestStart={earliest ?? undefined}
```

---

### C7: Slack indicator + cascade highlights

**File**: src/components/gantt/SlackIndicator.tsx (NEW)

Renders a dashed rect between the earliest possible start and actual start of a task, showing available slack:

```typescript
import React from 'react';

interface SlackIndicatorProps {
  earliestX: number;
  actualX: number;
  y: number;
  height: number;
}

export default function SlackIndicator({ earliestX, actualX, y, height }: SlackIndicatorProps) {
  if (actualX <= earliestX) return null; // No slack
  return (
    <rect
      x={earliestX}
      y={y + 4}
      width={actualX - earliestX}
      height={height - 8}
      rx={3}
      fill="none"
      stroke="var(--raw-text-muted)"
      strokeWidth={1}
      strokeDasharray="4 2"
      opacity={0.4}
      style={{ pointerEvents: 'none' }}
    />
  );
}
```

**File**: src/components/gantt/CascadeHighlight.tsx (NEW)

Amber flash overlay on tasks that just moved due to cascade:

```typescript
import React, { useEffect, useState } from 'react';

interface CascadeHighlightProps {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function CascadeHighlight({ x, y, width, height }: CascadeHighlightProps) {
  const [opacity, setOpacity] = useState(0.5);

  useEffect(() => {
    const timer = setTimeout(() => setOpacity(0), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (opacity === 0) return null;

  return (
    <rect
      x={x - 2}
      y={y + 2}
      width={width + 4}
      height={height - 4}
      rx={5}
      fill="#f59e0b"
      opacity={opacity}
      style={{ pointerEvents: 'none', transition: 'opacity 0.5s ease-out' }}
    />
  );
}
```

**File**: src/components/gantt/GanttChart.tsx

Add slack and cascade rendering:

```typescript
import { computeEarliestStart } from '../../utils/schedulerWasm';
import SlackIndicator from './SlackIndicator';
import CascadeHighlight from './CascadeHighlight';

// Inside GanttChart:
const { lastCascadeIds } = useGanttState();
const dispatch = useGanttDispatch();

// Auto-clear cascade IDs after 2 seconds
useEffect(() => {
  if (lastCascadeIds.length > 0) {
    const timer = setTimeout(() => {
      dispatch({ type: 'SET_LAST_CASCADE_IDS', taskIds: [] });
    }, 2000);
    return () => clearTimeout(timer);
  }
}, [lastCascadeIds, dispatch]);

// In the SVG, BEFORE TaskBars, render slack indicators and cascade highlights:
{visibleTasks.map(task => {
  if (task.isSummary || task.isMilestone) return null;
  const yPos = taskYPositions.get(task.id);
  if (yPos === undefined) return null;

  const earliest = computeEarliestStart(allTasks, task.id);
  const taskX = dateToXCollapsed(task.startDate, timelineStart, colWidth, zoom, collapseWeekends);
  const taskEndX = dateToXCollapsed(task.endDate, timelineStart, colWidth, zoom, collapseWeekends);
  const taskWidth = Math.max(taskEndX - taskX, 0);

  return (
    <React.Fragment key={`indicators-${task.id}`}>
      {earliest && (
        <SlackIndicator
          earliestX={dateToXCollapsed(earliest, timelineStart, colWidth, zoom, collapseWeekends)}
          actualX={taskX}
          y={yPos}
          height={ROW_HEIGHT}
        />
      )}
      {lastCascadeIds.includes(task.id) && (
        <CascadeHighlight
          x={taskX}
          y={yPos}
          width={taskWidth}
          height={ROW_HEIGHT}
        />
      )}
    </React.Fragment>
  );
})}
```

---

### C8: Undo/Redo toolbar buttons

**File**: src/components/shared/UndoRedoButtons.tsx (NEW)

```typescript
import React from 'react';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';

export default function UndoRedoButtons() {
  const { undoStack, redoStack } = useGanttState();
  const dispatch = useGanttDispatch();

  return (
    <>
      <button
        onClick={() => dispatch({ type: 'UNDO' })}
        disabled={undoStack.length === 0}
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors disabled:text-text-muted disabled:cursor-not-allowed cursor-pointer"
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        onClick={() => dispatch({ type: 'REDO' })}
        disabled={redoStack.length === 0}
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors disabled:text-text-muted disabled:cursor-not-allowed cursor-pointer"
        title="Redo (Ctrl+Shift+Z)"
      >
        Redo
      </button>
    </>
  );
}
```

**File**: src/components/layout/Toolbar.tsx

Import and render after the Add Task button:
```typescript
import UndoRedoButtons from '../shared/UndoRedoButtons';
// In the JSX, after the Add Task button:
<UndoRedoButtons />
```

---

### C9: Weekend toggle in Toolbar

**File**: src/components/layout/Toolbar.tsx

Add a toggle button near the zoom controls. After the zoom button group:

```typescript
{/* Collapse weekends */}
{state.zoomLevel === 'day' && (
  <button
    onClick={() => dispatch({ type: 'TOGGLE_COLLAPSE_WEEKENDS' })}
    className={`px-2 py-0.5 rounded transition-colors ${
      state.collapseWeekends
        ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
        : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay'
    }`}
  >
    Hide Weekends
  </button>
)}
```

Only show this button when zoom is 'day' since weekends aren't relevant in week/month view.

---

## Verification

After all tasks are done:
```bash
npx tsc --noEmit
npm run test
npm run build
```

## When done
1. Mark tasks C1-C9 as `[x]` in TASKS.md
2. Commit with message: "feat: UX improvements — modal fix, column close, weekends, undo UI, slack/cascade visuals, drag constraints, scoped critical path UI"
3. Run `npm run build` to verify full build passes
````

---

## Group D Prompt — Integration, Merge, Build, Test, Cleanup

Paste this into Terminal 4. The agent will poll TASKS.md until all three groups finish, then handle everything.

````
You are the Group D integration agent for Phase 6 of Ganttlet. Your job is to wait for Groups A, B, and C to finish, then merge their branches, fix any issues, verify the build, and clean up.

You work in the MAIN repo at `/workspace` (not a worktree).

## STEP 1 — Wait for all groups to finish

Poll `/workspace/TASKS.md` every 30 seconds until ALL THREE of these final tasks are marked `[x]`:
- `[x] **A4**:` (Group A's last task — WASM TypeScript wrapper)
- `[x] **B6**:` (Group B's last task — collab sync for undo/redo)
- `[x] **C9**:` (Group C's last task — weekend toggle in Toolbar)

Procedure:
1. Read `/workspace/TASKS.md` and check if all three are `[x]`
2. If NOT all done, say "Waiting for groups to finish... (check N) — A4:[x/pending] B6:[x/pending] C9:[x/pending]" then sleep 30 seconds and check again
3. Once all three are done, say "All groups finished — starting integration" and proceed

While waiting, you may read files to familiarize yourself with the codebase. Do NOT modify any files until all three groups are confirmed done.

## STEP 2 — Verify branches have committed changes

Before merging, confirm each branch has clean committed state:

```bash
cd /workspace

# Check Group A branch
git log main..feature/phase6-wasm-scheduler --oneline
git -C .claude/worktrees/phase6-groupA status

# Check Group B branch
git log main..feature/phase6-state-sync --oneline
git -C .claude/worktrees/phase6-groupB status

# Check Group C branch
git log main..feature/phase6-ui-visual --oneline
git -C .claude/worktrees/phase6-groupC status
```

If any branch has uncommitted changes, warn the user and wait. Do NOT proceed with uncommitted work.

If a branch has NO commits beyond main, that group may not have finished properly — warn the user.

## STEP 3 — Merge branches into main

Merge in dependency order (A and B first since C depends on both):

```bash
cd /workspace
git checkout main

# Merge Group A (WASM scheduler — no dependencies)
git merge feature/phase6-wasm-scheduler --no-ff -m "Merge feature/phase6-wasm-scheduler: scoped critical path, earliest start, cascade IDs"

# Merge Group B (state/sync — no dependencies on A)
git merge feature/phase6-state-sync --no-ff -m "Merge feature/phase6-state-sync: undo/redo, cascade sync fix, new state fields"

# Merge Group C (UI — depends on A and B, but no file overlap)
git merge feature/phase6-ui-visual --no-ff -m "Merge feature/phase6-ui-visual: UX improvements, visual feedback, weekend collapse"
```

### Handling merge conflicts

Conflicts should be rare since file ownership is zero-overlap. But if they occur:

1. The most likely conflicts are in import statements or re-exports
2. Read both sides of the conflict carefully
3. Resolve by keeping BOTH sides' changes (they should be additive)
4. After resolving, stage and commit the merge

If a conflict is complex or ambiguous, describe it to the user before resolving.

## STEP 4 — Build and test

Run the full verification suite:

```bash
cd /workspace

# Rust tests
cd crates/scheduler && cargo test && cd /workspace

# Build WASM
npm run build:wasm

# TypeScript type check
npx tsc --noEmit

# Unit tests
npm run test

# Full production build
npm run build
```

If any step fails, diagnose and fix the issue. Common post-merge problems:

- **TypeScript errors**: Usually missing imports or type mismatches at the boundaries between groups. Fix the imports.
- **Rust test failures**: Likely the `project` field wasn't added to all test helpers. Add `project: String::new()` to any `make_task` helper that's missing it.
- **WASM build failure**: Check that `lib.rs` exports are correct and `Cargo.toml` hasn't been corrupted.
- **Runtime import errors**: Check that `schedulerWasm.ts` exports match what components import.
- **Reducer exhaustiveness**: If TypeScript complains about unhandled action types in the switch, add the missing cases.

After fixing any issues, commit the fixes:
```bash
git add -A
git commit -m "fix: resolve post-merge integration issues"
```

## STEP 5 — Integration smoke check

Read through the key integration points and verify they're wired correctly:

1. **WASM → TypeScript**: `src/utils/schedulerWasm.ts` exports `computeCriticalPathScoped`, `computeEarliestStart`, `cascadeDependentsWithIds`
2. **State → UI**: `src/types/index.ts` has `undoStack`, `redoStack`, `lastCascadeIds`, `criticalPathScope`, `collapseWeekends` in GanttState
3. **Actions → Reducer**: All new actions (UNDO, REDO, SET_LAST_CASCADE_IDS, SET_CRITICAL_PATH_SCOPE, TOGGLE_COLLAPSE_WEEKENDS) have cases in the reducer
4. **Reducer → Context**: `initialState` in GanttContext.tsx has defaults for all new fields
5. **Collab sync**: `CASCADE_DEPENDENTS` has a case in `applyActionToYjs()` switch (not falling through to default)
6. **GanttChart → WASM**: `computeCriticalPathScoped` is called instead of `computeCriticalPath`
7. **TaskBar → constraints**: `earliestStart` prop is passed from GanttChart and used in drag handler
8. **Weekend collapse**: `dateToXCollapsed` used in GanttChart, TaskBar, TimelineHeader, GridLines

If any wiring is missing, fix it and commit.

## STEP 6 — Clean up

```bash
cd /workspace

# Remove worktrees
git worktree remove /workspace/.claude/worktrees/phase6-groupA 2>/dev/null || true
git worktree remove /workspace/.claude/worktrees/phase6-groupB 2>/dev/null || true
git worktree remove /workspace/.claude/worktrees/phase6-groupC 2>/dev/null || true

# Delete feature branches (they're merged)
git branch -d feature/phase6-wasm-scheduler
git branch -d feature/phase6-state-sync
git branch -d feature/phase6-ui-visual

# Prune worktree metadata
git worktree prune
```

## STEP 7 — Final report

After everything is done, provide a summary:
- Which branches merged cleanly vs. needed conflict resolution
- Whether the build passed on first try or needed fixes (and what was fixed)
- Test results (how many passed/failed)
- Any remaining issues or TODOs
- Confirm that `main` is in a clean, buildable, deployable state

## Important rules
- Do NOT force-push or rewrite history on main
- Do NOT delete branches until they are confirmed merged
- If anything looks seriously wrong (e.g. a group deleted files it shouldn't have, or major test failures), stop and alert the user rather than trying to fix everything silently
- Commit fixes with clear messages explaining what was wrong and how it was fixed
````
