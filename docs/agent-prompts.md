# Phase 7 Agent Prompts

Three self-contained prompts for parallel Claude CLI sessions.
Each session runs in its own git worktree and can spawn subagents for subtasks.

## Setup

Claude Code runs in Docker with the project root mounted at `/workspace/`.

### Execution flow

Groups A and C run in parallel in worktrees (no shared files). After both finish,
merge A and C into main, then Group B starts from the merged main (it imports files
that Group A creates). Group D handles the final B merge and cleanup.

```
  A (worktree) ──┐
                  ├── merge A+C to main ── B (worktree from merged main) ── D (merge B, cleanup)
  C (worktree) ──┘
```

### Terminal commands

```bash
# From the host, attach terminals to the running dev container:
docker compose exec dev bash

# ── Stage 1: Run A and C in parallel ──

# Terminal 1 — Group A (starts immediately)
cd /workspace
git worktree add /workspace/.claude/worktrees/phase7-groupA -b feature/phase7-hierarchy-state
cd /workspace/.claude/worktrees/phase7-groupA
npm install
claude --dangerously-skip-permissions

# Terminal 2 — Group C (starts immediately — parallel with A)
cd /workspace
git worktree add /workspace/.claude/worktrees/phase7-groupC -b feature/phase7-wasm-scheduler
cd /workspace/.claude/worktrees/phase7-groupC
npm install
claude --dangerously-skip-permissions

# ── Stage 2: After A and C finish, merge to main ──

# Terminal 3 — Merge A+C, then start Group B
cd /workspace
git merge feature/phase7-hierarchy-state --no-ff -m "Merge feature/phase7-hierarchy-state: hierarchy enforcement, task reparenting, dependency validation"
git merge feature/phase7-wasm-scheduler --no-ff -m "Merge feature/phase7-wasm-scheduler: workstream-scoped critical path, remove All scope"
# Now create B's worktree from the merged main (has A's and C's files)
git worktree add /workspace/.claude/worktrees/phase7-groupB -b feature/phase7-ui-components
cd /workspace/.claude/worktrees/phase7-groupB
npm install
claude --dangerously-skip-permissions

# ── Stage 3: After B finishes, run Group D integration ──

# Terminal 4 — Group D (merge B, final build/test, cleanup)
cd /workspace
claude --dangerously-skip-permissions
```

### Notes
- All worktrees live under `/workspace/.claude/worktrees/` inside the container
- TASKS.md at `/workspace/TASKS.md` is the shared coordination file — all worktrees can see the main repo's copy
- When marking tasks done, agents should edit `/workspace/TASKS.md` (the main copy, not the worktree copy) so other agents can see updates
- Each worktree has its own `node_modules` — `npm install` is required after creation
- `npm run build:wasm` in Group C's worktree uses the Rust toolchain already in the container
- Group B's worktree is created **after** A+C merge to main, so it has all the types, utils, and WASM changes it depends on

---

## Group A Prompt — Hierarchy Enforcement + State Management

Paste this into Terminal 1:

````
You are the Group A agent for Phase 7 of Ganttlet. You own hierarchy utilities, dependency validation, state management, and seed data. NO OTHER FILES.

## Your files (exclusive ownership — only touch these)
- src/utils/hierarchyUtils.ts (NEW — you create this)
- src/utils/dependencyValidation.ts (NEW — you create this)
- src/state/ganttReducer.ts
- src/state/actions.ts
- src/types/index.ts
- src/state/GanttContext.tsx
- src/collab/yjsBinding.ts
- src/data/fakeData.ts
- src/utils/__tests__/hierarchyUtils.test.ts (NEW — you create this)
- src/utils/__tests__/dependencyValidation.test.ts (NEW — you create this)
- src/state/__tests__/ganttReducer.test.ts (extend existing)

## DO NOT TOUCH
Any file in crates/, src/components/, src/App.tsx, src/utils/schedulerWasm.ts. Those belong to Groups B and C.

## Tasks (execute sequentially: A1 → A2 → A3+A4+A5 → A6 → A7 → A8 → A9)

### A1: Create `src/utils/hierarchyUtils.ts`

Pure functions for hierarchy queries. All other hierarchy work depends on this.

```typescript
import type { Task } from '../types';

export type HierarchyRole = 'project' | 'workstream' | 'task';

/**
 * Determine a task's role in the hierarchy.
 * - project: isSummary && no parentId (top-level summary)
 * - workstream: isSummary && parent is a project
 * - task: everything else (leaf tasks, milestones)
 */
export function getHierarchyRole(task: Task, taskMap: Map<string, Task>): HierarchyRole {
  if (task.isSummary && !task.parentId) return 'project';
  if (task.isSummary && task.parentId) {
    const parent = taskMap.get(task.parentId);
    if (parent && parent.isSummary && !parent.parentId) return 'workstream';
  }
  return 'task';
}

/**
 * Walk up the parentId chain to find the project ancestor (top-level summary).
 * Returns null if the task itself is a project or has no project ancestor.
 */
export function findProjectAncestor(task: Task, taskMap: Map<string, Task>): Task | null {
  let current = task.parentId ? taskMap.get(task.parentId) : undefined;
  while (current) {
    if (current.isSummary && !current.parentId) return current;
    current = current.parentId ? taskMap.get(current.parentId) : undefined;
  }
  return null;
}

/**
 * Walk up the parentId chain to find the workstream ancestor.
 * Returns null if not found.
 */
export function findWorkstreamAncestor(task: Task, taskMap: Map<string, Task>): Task | null {
  let current = task.parentId ? taskMap.get(task.parentId) : undefined;
  while (current) {
    if (getHierarchyRole(current, taskMap) === 'workstream') return current;
    current = current.parentId ? taskMap.get(current.parentId) : undefined;
  }
  return null;
}

/**
 * BFS down childIds to collect all descendant IDs.
 */
export function getAllDescendantIds(taskId: string, taskMap: Map<string, Task>): Set<string> {
  const descendants = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    const task = taskMap.get(id);
    if (task) {
      for (const childId of task.childIds) {
        if (!descendants.has(childId)) {
          descendants.add(childId);
          queue.push(childId);
        }
      }
    }
  }
  return descendants;
}

/**
 * Check if taskId is a descendant of ancestorId.
 */
export function isDescendantOf(taskId: string, ancestorId: string, taskMap: Map<string, Task>): boolean {
  return getAllDescendantIds(ancestorId, taskMap).has(taskId);
}

/**
 * Generate a prefixed ID for a new task under the given parent.
 * Pattern: {parentId}-{N+1} where N is the max existing number.
 * Example: parent "pe" with existing "pe-1", "pe-3" → returns "pe-4"
 */
export function generatePrefixedId(parent: Task, existingTasks: Task[]): string {
  const prefix = `${parent.id}-`;
  let maxN = 0;
  for (const t of existingTasks) {
    if (t.id.startsWith(prefix)) {
      const suffix = t.id.slice(prefix.length);
      const n = parseInt(suffix, 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
  }
  return `${prefix}${maxN + 1}`;
}

/**
 * Compute inherited fields based on parent's role.
 * - If parent is project: { project: parent.name, workStream: '', okrs: [...parent.okrs] }
 * - If parent is workstream: { project: parent.project, workStream: parent.name, okrs: [...parent.okrs] }
 * - If no parent: { project: '', workStream: '', okrs: [] }
 */
export function computeInheritedFields(
  parentId: string | null,
  taskMap: Map<string, Task>
): { project: string; workStream: string; okrs: string[] } {
  if (!parentId) return { project: '', workStream: '', okrs: [] };
  const parent = taskMap.get(parentId);
  if (!parent) return { project: '', workStream: '', okrs: [] };

  const role = getHierarchyRole(parent, taskMap);
  if (role === 'project') {
    return { project: parent.name, workStream: '', okrs: [...parent.okrs] };
  }
  if (role === 'workstream') {
    return { project: parent.project, workStream: parent.name, okrs: [...parent.okrs] };
  }
  // Parent is a regular task — inherit its fields
  return { project: parent.project, workStream: parent.workStream, okrs: [...parent.okrs] };
}
```

---

### A2: Create `src/utils/dependencyValidation.ts`

Hierarchy-aware dependency validation.

```typescript
import type { Task, Dependency } from '../types';
import { getHierarchyRole, isDescendantOf, getAllDescendantIds } from './hierarchyUtils';

export interface DepValidationError {
  code: string;
  message: string;
}

/**
 * Validate whether adding a dependency from predecessorId to successorId
 * would violate hierarchy rules.
 *
 * Rules:
 * - A project cannot depend on its own descendants
 * - A workstream cannot depend on its own child tasks
 * - A task cannot depend on its own ancestor project/workstream
 *
 * Returns null if valid, { code, message } if invalid.
 */
export function validateDependencyHierarchy(
  tasks: Task[],
  successorId: string,
  predecessorId: string
): DepValidationError | null {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const successor = taskMap.get(successorId);
  const predecessor = taskMap.get(predecessorId);
  if (!successor || !predecessor) return null;

  // Check if predecessor is an ancestor of successor
  if (isDescendantOf(successorId, predecessorId, taskMap)) {
    const predRole = getHierarchyRole(predecessor, taskMap);
    return {
      code: 'ANCESTOR_DEPENDENCY',
      message: `Cannot add dependency: ${predecessor.name} is an ancestor ${predRole} of ${successor.name}`,
    };
  }

  // Check if successor is an ancestor of predecessor
  if (isDescendantOf(predecessorId, successorId, taskMap)) {
    const succRole = getHierarchyRole(successor, taskMap);
    return {
      code: 'DESCENDANT_DEPENDENCY',
      message: `Cannot add dependency: ${successor.name} is an ancestor ${succRole} of ${predecessor.name}`,
    };
  }

  return null;
}

/**
 * Check if moving taskId under newParentId would create conflicts
 * with existing dependencies.
 *
 * A conflict exists if the task (or its descendants) has a dependency
 * on the target parent entity itself (not on sibling tasks under that parent).
 *
 * Returns list of conflicting deps with human-readable reasons.
 */
export function checkMoveConflicts(
  tasks: Task[],
  taskId: string,
  newParentId: string
): { dep: Dependency; reason: string }[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const task = taskMap.get(taskId);
  const newParent = taskMap.get(newParentId);
  if (!task || !newParent) return [];

  const conflicts: { dep: Dependency; reason: string }[] = [];

  // Get the ancestor chain of the new parent (the parent itself + its ancestors)
  const ancestorIds = new Set<string>([newParentId]);
  let current = newParent.parentId ? taskMap.get(newParent.parentId) : undefined;
  while (current) {
    ancestorIds.add(current.id);
    current = current.parentId ? taskMap.get(current.parentId) : undefined;
  }

  // Get all IDs being moved (task + its descendants)
  const movingIds = new Set([taskId, ...getAllDescendantIds(taskId, taskMap)]);

  // Check all deps of moving tasks
  for (const movingId of movingIds) {
    const movingTask = taskMap.get(movingId);
    if (!movingTask) continue;

    for (const dep of movingTask.dependencies) {
      // Conflict if dep references the new parent or its ancestors directly
      if (ancestorIds.has(dep.fromId)) {
        const fromTask = taskMap.get(dep.fromId);
        conflicts.push({
          dep,
          reason: `${movingTask.name} depends on ${fromTask?.name ?? dep.fromId}, which is an ancestor of the target`,
        });
      }
    }
  }

  // Also check if any ancestor deps point TO moving tasks
  for (const ancestorId of ancestorIds) {
    const ancestor = taskMap.get(ancestorId);
    if (!ancestor) continue;
    for (const dep of ancestor.dependencies) {
      if (movingIds.has(dep.fromId)) {
        const fromTask = taskMap.get(dep.fromId);
        conflicts.push({
          dep,
          reason: `${ancestor.name} depends on ${fromTask?.name ?? dep.fromId}, which is being moved`,
        });
      }
    }
  }

  return conflicts;
}
```

---

### A3: Modify `ADD_TASK` in reducer (Issues #1, #2, #3)

File: `src/state/ganttReducer.ts` (the `ADD_TASK` case, currently lines 195-265)

Import at the top:
```typescript
import { computeInheritedFields, generatePrefixedId, getHierarchyRole } from '../utils/hierarchyUtils';
```

Modify the ADD_TASK case. The key changes:
1. Build a taskMap from current tasks
2. If there's a parent, call `computeInheritedFields(parentId, taskMap)` to get `project`, `workStream`, `okrs`
3. If there's a parent that is a project or workstream (isSummary), call `generatePrefixedId(parent, tasks)` instead of `task-${Date.now()}`
4. Set `focusNewTaskId: newId` in the returned state

```typescript
case 'ADD_TASK': {
  const taskMap = new Map(state.tasks.map(t => [t.id, t]));
  const parent = action.parentId ? taskMap.get(action.parentId) : undefined;

  // Generate ID: prefixed if parent is summary, otherwise timestamp
  const newId = parent && parent.isSummary
    ? generatePrefixedId(parent, state.tasks)
    : `task-${Date.now()}`;

  // Inherit fields from parent
  const inherited = computeInheritedFields(action.parentId, taskMap);

  const today = new Date().toISOString().split('T')[0];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 5);
  const endDateStr = endDate.toISOString().split('T')[0];

  const newTask: Task = {
    id: newId,
    name: 'New Task',
    startDate: today,
    endDate: endDateStr,
    duration: 5,
    owner: '',
    workStream: inherited.workStream,
    project: inherited.project,
    functionalArea: '',
    done: false,
    description: '',
    isMilestone: false,
    isSummary: false,
    parentId: action.parentId,
    childIds: [],
    dependencies: [],
    isExpanded: false,
    isHidden: false,
    notes: '',
    okrs: inherited.okrs,
  };

  let tasks = [...state.tasks];

  // If it has a parent, add to parent's childIds
  if (action.parentId) {
    tasks = tasks.map(t =>
      t.id === action.parentId
        ? { ...t, childIds: [...t.childIds, newId] }
        : t
    );
  }

  // Insert after the specified task, or at the end
  if (action.afterTaskId) {
    const idx = tasks.findIndex(t => t.id === action.afterTaskId);
    if (idx !== -1) {
      let insertIdx = idx + 1;
      const afterTask = tasks[idx];
      if (afterTask.isSummary && afterTask.isExpanded) {
        const descendants = new Set<string>();
        const queue = [...afterTask.childIds];
        while (queue.length > 0) {
          const cid = queue.pop()!;
          descendants.add(cid);
          const child = tasks.find(t => t.id === cid);
          if (child) queue.push(...child.childIds);
        }
        while (insertIdx < tasks.length && descendants.has(tasks[insertIdx].id)) {
          insertIdx++;
        }
      }
      tasks.splice(insertIdx, 0, newTask);
    } else {
      tasks.push(newTask);
    }
  } else {
    tasks.push(newTask);
  }

  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks, focusNewTaskId: newId };
}
```

---

### A4: Modify `UPDATE_TASK_FIELD` in reducer

When `field === 'name'` and the task is a project or workstream, cascade field updates to descendants.

Replace the current UPDATE_TASK_FIELD case (lines 45-53) with:

```typescript
case 'UPDATE_TASK_FIELD': {
  const taskMap = new Map(state.tasks.map(t => [t.id, t]));
  const targetTask = taskMap.get(action.taskId);

  let tasks = state.tasks.map(t =>
    t.id === action.taskId
      ? { ...t, [action.field]: action.value }
      : t
  );

  // If renaming a project or workstream, cascade to descendants
  if (action.field === 'name' && targetTask && typeof action.value === 'string') {
    const role = getHierarchyRole(targetTask, taskMap);

    if (role === 'project') {
      // Update own project field + all descendants' project field
      const descendantIds = getAllDescendantIds(action.taskId, taskMap);
      tasks = tasks.map(t => {
        if (t.id === action.taskId) return { ...t, project: action.value as string };
        if (descendantIds.has(t.id)) return { ...t, project: action.value as string };
        return t;
      });
    } else if (role === 'workstream') {
      // Update own workStream field + all child tasks' workStream field
      const descendantIds = getAllDescendantIds(action.taskId, taskMap);
      tasks = tasks.map(t => {
        if (t.id === action.taskId) return { ...t, workStream: action.value as string };
        if (descendantIds.has(t.id)) return { ...t, workStream: action.value as string };
        return t;
      });
    }
  }

  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks };
}
```

Add the import for `getAllDescendantIds` (should already be imported from A3).

---

### A5: Add hierarchy validation to `ADD_DEPENDENCY`

Import at the top (add to existing import):
```typescript
import { validateDependencyHierarchy } from '../utils/dependencyValidation';
```

Replace the ADD_DEPENDENCY case (lines 149-157):

```typescript
case 'ADD_DEPENDENCY': {
  // Validate hierarchy rules
  const hierarchyError = validateDependencyHierarchy(
    state.tasks,
    action.taskId,
    action.dependency.fromId
  );
  if (hierarchyError) return state; // Silently reject — UI filters invalid options

  let tasks = state.tasks.map(t =>
    t.id === action.taskId
      ? { ...t, dependencies: [...t.dependencies, action.dependency] }
      : t
  );
  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks };
}
```

---

### A6: Add `REPARENT_TASK` reducer case

Add this case to the `ganttReducerInner` switch, before the `default` case. Also add `'REPARENT_TASK'` to the `UNDOABLE_ACTIONS` set at the top.

```typescript
case 'REPARENT_TASK': {
  const taskMap = new Map(state.tasks.map(t => [t.id, t]));
  const task = taskMap.get(action.taskId);
  if (!task) return state;

  // Can't reparent to self
  if (action.newParentId === action.taskId) return state;

  // Can't reparent to own descendant
  if (action.newParentId && isDescendantOf(action.newParentId, action.taskId, taskMap)) {
    return state;
  }

  // Check for dependency conflicts
  if (action.newParentId) {
    const conflicts = checkMoveConflicts(state.tasks, action.taskId, action.newParentId);
    if (conflicts.length > 0) return state;
  }

  let tasks = [...state.tasks];

  // 1. Remove from old parent's childIds
  if (task.parentId) {
    tasks = tasks.map(t =>
      t.id === task.parentId
        ? { ...t, childIds: t.childIds.filter(cid => cid !== action.taskId) }
        : t
    );
  }

  // 2. Determine new ID
  const newId = action.newId || action.taskId;
  const oldId = action.taskId;

  // 3. Compute inherited fields from new parent
  const updatedTaskMap = new Map(tasks.map(t => [t.id, t]));
  const inherited = computeInheritedFields(action.newParentId, updatedTaskMap);

  // 4. Update the task itself
  tasks = tasks.map(t => {
    if (t.id === oldId) {
      return {
        ...t,
        id: newId,
        parentId: action.newParentId,
        project: inherited.project,
        workStream: inherited.workStream,
      };
    }
    return t;
  });

  // 5. Add to new parent's childIds
  if (action.newParentId) {
    tasks = tasks.map(t =>
      t.id === action.newParentId
        ? { ...t, childIds: [...t.childIds, newId] }
        : t
    );
  }

  // 6. If ID changed, update all references
  if (newId !== oldId) {
    tasks = tasks.map(t => {
      let updated = t;

      // Update parentId references
      if (t.parentId === oldId) {
        updated = { ...updated, parentId: newId };
      }

      // Update childIds references
      if (t.childIds.includes(oldId)) {
        updated = { ...updated, childIds: updated.childIds.map(cid => cid === oldId ? newId : cid) };
      }

      // Update dependency references (fromId and toId)
      const newDeps = t.dependencies.map(d => ({
        ...d,
        fromId: d.fromId === oldId ? newId : d.fromId,
        toId: d.toId === oldId ? newId : d.toId,
      }));
      if (JSON.stringify(newDeps) !== JSON.stringify(t.dependencies)) {
        updated = { ...updated, dependencies: newDeps };
      }

      return updated;
    });
  }

  // 7. Also update descendants' inherited fields
  const descendantIds = getAllDescendantIds(newId, new Map(tasks.map(t => [t.id, t])));
  if (descendantIds.size > 0) {
    tasks = tasks.map(t => {
      if (descendantIds.has(t.id)) {
        return { ...t, project: inherited.project, workStream: inherited.workStream || t.workStream };
      }
      return t;
    });
  }

  // 8. Reposition task in array after new parent
  if (action.newParentId) {
    const taskToMove = tasks.find(t => t.id === newId);
    if (taskToMove) {
      tasks = tasks.filter(t => t.id !== newId);
      const parentIdx = tasks.findIndex(t => t.id === action.newParentId);
      if (parentIdx !== -1) {
        // Insert after parent's last descendant
        let insertIdx = parentIdx + 1;
        const parentTask = tasks[parentIdx];
        const parentDescendants = getAllDescendantIds(parentTask.id, new Map(tasks.map(t => [t.id, t])));
        while (insertIdx < tasks.length && parentDescendants.has(tasks[insertIdx].id)) {
          insertIdx++;
        }
        tasks.splice(insertIdx, 0, taskToMove);
      } else {
        tasks.push(taskToMove);
      }
    }
  }

  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks, reparentPicker: null };
}
```

Import at the top:
```typescript
import { isDescendantOf, getAllDescendantIds, computeInheritedFields, generatePrefixedId, getHierarchyRole } from '../utils/hierarchyUtils';
import { checkMoveConflicts } from '../utils/dependencyValidation';
```

---

### A7: Add new actions and state fields

**File: `src/state/actions.ts`**

Add to the GanttAction union (before the closing semicolon):
```typescript
| { type: 'REPARENT_TASK'; taskId: string; newParentId: string | null; newId?: string }
| { type: 'SET_REPARENT_PICKER'; picker: { taskId: string } | null }
| { type: 'TOGGLE_LEFT_PANE' }
| { type: 'CLEAR_FOCUS_NEW_TASK' }
```

**File: `src/types/index.ts`**

Update `CriticalPathScope` — remove `all`, add `workstream`:
```typescript
export type CriticalPathScope =
  | { type: 'project'; name: string }
  | { type: 'workstream'; name: string }
  | { type: 'milestone'; id: string };
```

Add to `GanttState` (after `collapseWeekends`):
```typescript
focusNewTaskId: string | null;
isLeftPaneCollapsed: boolean;
reparentPicker: { taskId: string } | null;
```

**File: `src/state/GanttContext.tsx`**

Add to `initialState`:
```typescript
focusNewTaskId: null,
isLeftPaneCollapsed: false,
reparentPicker: null,
```

Change the criticalPathScope default:
```typescript
criticalPathScope: { type: 'project', name: '' } as CriticalPathScope,
```

Add Ctrl+B keyboard shortcut. In the existing keyboard shortcuts `useEffect`, add:
```typescript
if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
  e.preventDefault();
  collabDispatch({ type: 'TOGGLE_LEFT_PANE' });
}
```

**File: `src/state/ganttReducer.ts`**

Add reducer cases for the new actions:
```typescript
case 'SET_REPARENT_PICKER':
  return { ...state, reparentPicker: action.picker };

case 'TOGGLE_LEFT_PANE':
  return { ...state, isLeftPaneCollapsed: !state.isLeftPaneCollapsed };

case 'CLEAR_FOCUS_NEW_TASK':
  return { ...state, focusNewTaskId: null };
```

**File: `src/collab/yjsBinding.ts`**

Add `REPARENT_TASK` to the switch in `applyActionToYjs`. Use full sync (same pattern as SET_TASKS):
```typescript
case 'REPARENT_TASK': {
  // Reparent replaces multiple tasks — do a full sync
  // The actual state change is in the reducer; here we just mark for full sync
  // This is handled by the pendingFullSyncRef pattern in GanttContext
  break;
}
```

In `GanttContext.tsx`, add `REPARENT_TASK` to the pendingFullSync check alongside UNDO/REDO:
```typescript
if (action.type === 'UNDO' || action.type === 'REDO' || action.type === 'REPARENT_TASK') {
  pendingFullSyncRef.current = true;
}
```

Also add `'REPARENT_TASK'` and `'UPDATE_TASK_FIELD'` to the TASK_MODIFYING_ACTIONS set if not already there (UPDATE_TASK_FIELD should already be there).

**Verify**: `npx tsc --noEmit` passes. Mark A7 as done in TASKS.md.

---

### A8: Fix seed data in `src/data/fakeData.ts`

The seed data has inconsistent `project` fields. Fix all tasks:

- `root`: `project: 'Q2 Product Launch'` (already correct)
- `pe`: change `project` from `'API Overhaul'` to `'Q2 Product Launch'`
- `ux`: change `project` from `'Design System'` to `'Q2 Product Launch'`
- `gtm`: change `project` from `'Marketing Push'` to `'Q2 Product Launch'`
- All `pe-*` tasks: change `project` from `'API Overhaul'` to `'Q2 Product Launch'`
- All `ux-*` tasks: change `project` from `'Design System'` to `'Q2 Product Launch'`
- All `gtm-*` tasks: change `project` from `'Marketing Push'` to `'Q2 Product Launch'`
- `ms-api`: change `project` from `'API Overhaul'` to `'Q2 Product Launch'`
- `ms-ux`: change `project` from `'Design System'` to `'Q2 Product Launch'`
- `ms-gtm`: change `project` from `'Marketing Push'` to `'Q2 Product Launch'`
- `ms-launch`: already correct

The `workStream` fields should match the parent workstream's name:
- `pe` children: `workStream: 'Platform Engineering'` (already correct)
- `ux` children: `workStream: 'User Experience'` (already correct)
- `gtm` children: `workStream: 'Go-to-Market'` (already correct)

---

### A9: Tests

**File: `src/utils/__tests__/hierarchyUtils.test.ts`** (NEW)

Test:
- `getHierarchyRole`: correctly classifies project (isSummary, no parent), workstream (isSummary, parent is project), and task
- `generatePrefixedId`: returns `pe-10` when `pe-9` exists, handles gaps (pe-1, pe-5 → pe-6)
- `computeInheritedFields`: project parent → inherits project name, workstream parent → inherits project + workStream names
- `findProjectAncestor` / `findWorkstreamAncestor`: correct traversal
- `getAllDescendantIds` / `isDescendantOf`: correct BFS

**File: `src/utils/__tests__/dependencyValidation.test.ts`** (NEW)

Test:
- `validateDependencyHierarchy`: rejects project depending on own descendant, rejects task depending on own ancestor, allows cross-project deps, allows cross-workstream deps
- `checkMoveConflicts`: detects conflict when task depends on target parent, no conflict when task depends on sibling under target

**File: `src/state/__tests__/ganttReducer.test.ts`** (extend existing)

Add tests for:
- `ADD_TASK` under a workstream parent: inherits `project`, `workStream`, `okrs`, gets prefixed ID, sets `focusNewTaskId`
- `UPDATE_TASK_FIELD` renaming a project: cascades `project` field to all descendants
- `UPDATE_TASK_FIELD` renaming a workstream: cascades `workStream` field to descendants
- `ADD_DEPENDENCY` with hierarchy violation: returns state unchanged
- `REPARENT_TASK`: updates `parentId`, `childIds`, inherited fields; with `newId` updates dependency references

Update the `makeState` helper to include the new fields:
```typescript
focusNewTaskId: null,
isLeftPaneCollapsed: false,
reparentPicker: null,
```

Update the `criticalPathScope` default in makeState to match the new type (no 'all'):
```typescript
criticalPathScope: { type: 'project', name: '' },
```

---

## Verification

```bash
npm run test
npx tsc --noEmit
```

## When done
1. Mark tasks A1-A9 as `[x]` in `/workspace/TASKS.md`
2. Commit with message: "feat: hierarchy enforcement, task reparenting, dependency validation, seed data fix"
3. Run `npm run build` to verify full build passes
````

---

## Group B Prompt — UI Components

Paste this into Terminal 3. This worktree was created **after** merging Groups A and C to main, so all dependency files already exist.

````
You are the Group B agent for Phase 7 of Ganttlet. You own ALL UI components. NO OTHER FILES.

## Prerequisites — already met

Your worktree was created from main after Groups A and C merged. You already have:
- `src/utils/hierarchyUtils.ts` and `src/utils/dependencyValidation.ts` (Group A)
- Updated `src/types/index.ts`, `src/state/actions.ts`, `src/state/GanttContext.tsx` (Group A)
- Updated `src/utils/schedulerWasm.ts` and WASM module (Group C)

You can start working immediately.

## Your files (exclusive ownership — only touch these)
- src/App.tsx
- src/components/gantt/TaskBar.tsx
- src/components/gantt/TaskBarPopover.tsx (NEW — you create this)
- src/components/table/TaskRow.tsx
- src/components/table/InlineEdit.tsx
- src/components/table/TaskTable.tsx
- src/components/shared/DependencyEditorModal.tsx
- src/components/shared/ReparentPickerModal.tsx (NEW — you create this)
- src/components/layout/Toolbar.tsx

## DO NOT TOUCH
Any file in crates/, src/state/, src/collab/, src/types/, src/utils/, src/data/. Those belong to Groups A and C.

## Read-only dependencies (you import from these but don't modify them)
- src/types/index.ts — GanttState now has: `focusNewTaskId`, `isLeftPaneCollapsed`, `reparentPicker`; `CriticalPathScope` now has `workstream` variant instead of `all`
- src/state/actions.ts — New actions: `REPARENT_TASK`, `SET_REPARENT_PICKER`, `TOGGLE_LEFT_PANE`, `CLEAR_FOCUS_NEW_TASK`
- src/state/GanttContext.tsx — `useGanttState()` and `useGanttDispatch()` hooks
- src/utils/hierarchyUtils.ts — `getHierarchyRole`, `generatePrefixedId`, `computeInheritedFields`, etc.
- src/utils/dependencyValidation.ts — `validateDependencyHierarchy`, `checkMoveConflicts`

## Tasks (execute: B1+B2+B3 → B4+B5+B6 → B7)

You can use subagents for parallel tasks within a stage.

### B1: Focus on new task (Issue #5)

**File: `src/components/table/InlineEdit.tsx`**

Add an `autoEdit?: boolean` prop. When `autoEdit` becomes true, enter edit mode automatically.

```typescript
interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  type?: 'text' | 'date' | 'number';
  displayValue?: string;
  min?: number;
  max?: number;
  autoEdit?: boolean;
}

export default function InlineEdit({ value, onSave, type = 'text', displayValue, min, max, autoEdit }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-enter edit mode when autoEdit becomes true
  useEffect(() => {
    if (autoEdit && !editing) {
      setEditValue(value);
      setEditing(true);
    }
  }, [autoEdit]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // ... rest unchanged
}
```

**File: `src/components/table/TaskRow.tsx`**

Add `autoFocusName?: boolean` prop. Pass it to the name cell's InlineEdit as `autoEdit`. Add a ref and `useEffect` to scroll into view when `autoFocusName` is true.

```typescript
interface TaskRowProps {
  task: Task;
  columns: ColumnConfig[];
  colorBy: ColorByField;
  taskMap: Map<string, Task>;
  viewer: ViewerInfo | null;
  autoFocusName?: boolean;
}

export default function TaskRow({ task, columns, colorBy, taskMap, viewer, autoFocusName }: TaskRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Scroll into view when auto-focusing
  useEffect(() => {
    if (autoFocusName && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [autoFocusName]);

  // In renderCell, for the 'name' case, pass autoEdit to InlineEdit:
  // case 'name':
  //   ...
  //   <InlineEdit
  //     value={task.name}
  //     onSave={v => handleFieldUpdate('name', v)}
  //     autoEdit={autoFocusName}
  //   />

  // Add ref={rowRef} to the root div
  return (
    <div
      ref={rowRef}
      className={...}
      ...
    >
```

**File: `src/components/table/TaskTable.tsx`**

Read `focusNewTaskId` from `useGanttState()`. Pass `autoFocusName={task.id === focusNewTaskId}` to each TaskRow. Add a `useEffect` to dispatch `CLEAR_FOCUS_NEW_TASK` after one animation frame.

```typescript
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';

export default function TaskTable({ tasks, columns, colorBy, taskMap, users, collabUsers, isCollabConnected }: TaskTableProps) {
  const { focusNewTaskId } = useGanttState();
  const dispatch = useGanttDispatch();

  // Clear focus signal after one frame
  useEffect(() => {
    if (focusNewTaskId) {
      requestAnimationFrame(() => {
        dispatch({ type: 'CLEAR_FOCUS_NEW_TASK' });
      });
    }
  }, [focusNewTaskId, dispatch]);

  // In the map, pass autoFocusName:
  // <TaskRow
  //   ...
  //   autoFocusName={task.id === focusNewTaskId}
  // />
}
```

---

### B2: Edit from task bars (Issue #6)

**File: `src/components/gantt/TaskBarPopover.tsx`** (NEW)

Create a portal-based popover for editing task fields. Follow the pattern from `DependencyEditorModal.tsx`.

```typescript
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import { addDaysToDate, daysBetween } from '../../utils/dateUtils';

interface TaskBarPopoverProps {
  taskId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export default function TaskBarPopover({ taskId, position, onClose }: TaskBarPopoverProps) {
  const state = useGanttState();
  const dispatch = useGanttDispatch();
  const task = state.tasks.find(t => t.id === taskId);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid immediate close from the double-click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  if (!task) return null;

  function handleFieldUpdate(field: string, value: string | number) {
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field, value });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId, taskName: task!.name, field,
      oldValue: String((task as any)[field] ?? ''),
      newValue: String(value), user: 'You',
    });
  }

  function handleStartDateChange(value: string) {
    const oldStart = task!.startDate;
    const newEndDate = addDaysToDate(value, task!.duration);
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'startDate', value });
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'endDate', value: newEndDate });
    const delta = daysBetween(oldStart, value);
    if (delta !== 0) {
      dispatch({ type: 'CASCADE_DEPENDENTS', taskId, daysDelta: delta });
    }
  }

  function handleEndDateChange(value: string) {
    const newDuration = daysBetween(task!.startDate, value);
    if (newDuration < 0) return;
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'endDate', value });
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'duration', value: newDuration });
  }

  // Position the popover, clamping to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x, window.innerWidth - 320),
    top: Math.min(position.y + 10, window.innerHeight - 300),
    zIndex: 50,
  };

  const popover = (
    <div ref={popoverRef} style={style} className="bg-surface-raised border border-border-default rounded-lg shadow-xl p-3 w-[300px] fade-in">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-muted font-mono">{task.id}</span>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-lg leading-none cursor-pointer">&times;</button>
      </div>

      <div className="space-y-2">
        {/* Name */}
        <div>
          <label className="text-[10px] text-text-muted uppercase">Name</label>
          <input
            type="text"
            defaultValue={task.name}
            onBlur={e => { if (e.target.value !== task.name) handleFieldUpdate('name', e.target.value); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            autoFocus
            className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Dates row */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-muted uppercase">Start</label>
            <input
              type="date"
              defaultValue={task.startDate}
              onBlur={e => { if (e.target.value !== task.startDate) handleStartDateChange(e.target.value); }}
              className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-text-muted uppercase">End</label>
            <input
              type="date"
              defaultValue={task.endDate}
              onBlur={e => { if (e.target.value !== task.endDate) handleEndDateChange(e.target.value); }}
              className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Duration + Owner row */}
        <div className="flex gap-2">
          <div className="w-20">
            <label className="text-[10px] text-text-muted uppercase">Duration</label>
            <input
              type="number"
              defaultValue={task.duration}
              min={1}
              onBlur={e => {
                const d = parseInt(e.target.value, 10);
                if (!isNaN(d) && d > 0 && d !== task.duration) {
                  const newEnd = addDaysToDate(task.startDate, d);
                  dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'duration', value: d });
                  dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'endDate', value: newEnd });
                }
              }}
              className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-text-muted uppercase">Owner</label>
            <input
              type="text"
              defaultValue={task.owner}
              onBlur={e => { if (e.target.value !== task.owner) handleFieldUpdate('owner', e.target.value); }}
              className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}
```

**File: `src/components/gantt/TaskBar.tsx`**

Add state for the popover and a double-click handler. Import `TaskBarPopover`.

Add state:
```typescript
const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
```

Add double-click handler on the main bar rects (the two `<rect>` elements with `onMouseDown`):
```typescript
onDoubleClick={(e) => {
  e.stopPropagation();
  setPopoverPos({ x: e.clientX, y: e.clientY });
}}
```

Render the popover conditionally at the bottom of the `<g>` element (inside the Tooltip), using a foreignObject or rendering it outside SVG. Since popover is a portal, render it outside the SVG return:

```typescript
return (
  <>
    <Tooltip content={tooltipContent} delay={300} svg>
      <g ...>
        {/* existing SVG content */}
      </g>
    </Tooltip>
    {popoverPos && (
      <TaskBarPopover
        taskId={taskId}
        position={popoverPos}
        onClose={() => setPopoverPos(null)}
      />
    )}
  </>
);
```

Note: The `<>` fragment may need to be used since SVG elements can't contain React portals directly. The TaskBarPopover uses `createPortal` to render to `document.body`, so it works fine.

---

### B3: Collapse/expand left pane (Issue #7)

**File: `src/App.tsx`**

Read `isLeftPaneCollapsed` from state. When collapsed, hide the left pane. Add a divider button.

```typescript
const { isLeftPaneCollapsed } = useGanttState(); // add to existing destructuring or call

// Replace the left panel div:
{/* Task Table - left panel */}
<div
  ref={tableScrollRef}
  className={`shrink-0 border-r border-border-default overflow-y-auto overflow-x-hidden transition-all duration-200 ${
    isLeftPaneCollapsed ? 'w-0 overflow-hidden' : ''
  }`}
  onScroll={handleTableScroll}
>
  <TaskTable ... />
</div>

{/* Collapse/expand divider */}
<button
  onClick={() => dispatch({ type: 'TOGGLE_LEFT_PANE' })}
  className="shrink-0 w-5 flex items-center justify-center bg-surface-raised/50 border-r border-border-subtle hover:bg-surface-overlay transition-colors cursor-pointer group"
  title={isLeftPaneCollapsed ? 'Expand table (Ctrl+B)' : 'Collapse table (Ctrl+B)'}
>
  <svg
    width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
    className={`text-text-muted group-hover:text-text-primary transition-transform ${isLeftPaneCollapsed ? 'rotate-0' : 'rotate-180'}`}
  >
    <path d="M7 1 L2 5 L7 9 Z" />
  </svg>
</button>
```

Import `useGanttState` if not already imported (it should be).

---

### B4: Reparent picker modal (Issue #4 UI)

**File: `src/components/shared/ReparentPickerModal.tsx`** (NEW)

```typescript
import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import { getHierarchyRole, getAllDescendantIds, generatePrefixedId } from '../../utils/hierarchyUtils';
import { checkMoveConflicts } from '../../utils/dependencyValidation';

export default function ReparentPickerModal() {
  const state = useGanttState();
  const dispatch = useGanttDispatch();
  const picker = state.reparentPicker;

  const close = useCallback(() => {
    dispatch({ type: 'SET_REPARENT_PICKER', picker: null });
  }, [dispatch]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  if (!picker) return null;

  const taskMap = new Map(state.tasks.map(t => [t.id, t]));
  const task = taskMap.get(picker.taskId);
  if (!task) return null;

  const descendantIds = getAllDescendantIds(picker.taskId, taskMap);

  // Valid targets: summary tasks (projects/workstreams), excluding self, descendants, and current parent
  const targets = state.tasks.filter(t => {
    if (!t.isSummary) return false;
    if (t.id === picker.taskId) return false;
    if (t.id === task.parentId) return false;
    if (descendantIds.has(t.id)) return false;
    return true;
  });

  function handleSelect(targetId: string) {
    const target = taskMap.get(targetId);
    if (!target) return;

    const conflicts = checkMoveConflicts(state.tasks, picker!.taskId, targetId);
    if (conflicts.length > 0) {
      // For now, show alert — could be enhanced to inline warning
      alert(`Cannot move: ${conflicts.map(c => c.reason).join('; ')}`);
      return;
    }

    const newId = generatePrefixedId(target, state.tasks);
    dispatch({
      type: 'REPARENT_TASK',
      taskId: picker!.taskId,
      newParentId: targetId,
      newId,
    });
  }

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--raw-backdrop)' }} onClick={close} />
      <div className="relative bg-surface-raised border border-border-default rounded-lg shadow-xl w-[400px] max-h-[60vh] flex flex-col fade-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h2 className="text-sm font-semibold text-text-primary">
            Move "{task.name}" to...
          </h2>
          <button onClick={close} className="text-text-secondary hover:text-text-primary transition-colors text-lg leading-none cursor-pointer">&times;</button>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex-1">
          {targets.length === 0 ? (
            <p className="text-text-muted text-sm">No valid targets available.</p>
          ) : (
            <div className="space-y-1">
              {targets.map(target => {
                const role = getHierarchyRole(target, taskMap);
                const conflicts = checkMoveConflicts(state.tasks, picker!.taskId, target.id);
                return (
                  <button
                    key={target.id}
                    onClick={() => handleSelect(target.id)}
                    disabled={conflicts.length > 0}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      conflicts.length > 0
                        ? 'text-text-muted cursor-not-allowed opacity-50'
                        : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-text-muted bg-surface-sunken px-1.5 py-0.5 rounded">{role}</span>
                      <span>{target.name}</span>
                      <span className="text-text-muted text-xs font-mono">({target.id})</span>
                    </div>
                    {conflicts.length > 0 && (
                      <div className="text-xs text-red-400 mt-1">{conflicts[0].reason}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
```

**File: `src/App.tsx`**

Add "Move to workstream..." to the context menu for non-summary, non-milestone tasks. Also render the `ReparentPickerModal`.

In `contextMenuItems`, add after the existing non-summary items:
```typescript
// For non-summary tasks, add reparent option
...(task.isSummary ? [] : [
  {
    label: 'Move to workstream...',
    onClick: () => dispatch({ type: 'SET_REPARENT_PICKER', picker: { taskId: task.id } }),
  },
]),
```

At the bottom of the JSX, after the DependencyEditorModal:
```typescript
import ReparentPickerModal from './components/shared/ReparentPickerModal';
// ...
{state.reparentPicker && <ReparentPickerModal />}
```

---

### B5: Dependency modal hierarchy filtering

**File: `src/components/shared/DependencyEditorModal.tsx`**

Import `validateDependencyHierarchy`:
```typescript
import { validateDependencyHierarchy } from '../../utils/dependencyValidation';
```

Update `availablePredecessors` filter (around line 38-41) to also check hierarchy:
```typescript
const availablePredecessors = nonSummaryTasks.filter(t => {
  if (task.dependencies.some(d => d.fromId === t.id)) return false;
  if (wouldCreateCycle(state.tasks, task.id, t.id)) return false;
  if (validateDependencyHierarchy(state.tasks, task.id, t.id)) return false;
  return true;
});
```

Update `getValidPredecessorsForRow` (around line 125-132) similarly:
```typescript
function getValidPredecessorsForRow(currentFromId: string) {
  return nonSummaryTasks.filter(t => {
    if (t.id === currentFromId) return true;
    if (task!.dependencies.some(d => d.fromId === t.id)) return false;
    if (wouldCreateCycle(state.tasks, task!.id, t.id)) return false;
    if (validateDependencyHierarchy(state.tasks, task!.id, t.id)) return false;
    return true;
  });
}
```

---

### B6: Read-only inherited fields in table

**File: `src/components/table/TaskRow.tsx`**

Import `getHierarchyRole`:
```typescript
import { getHierarchyRole } from '../../utils/hierarchyUtils';
```

In `renderCell`, for the `workStream` and `project` cases, check if the field is inherited (i.e., the task is not a project/workstream itself). If so, render as read-only text.

Replace the `workStream` case:
```typescript
case 'workStream': {
  const role = getHierarchyRole(task, taskMap);
  // workStream is editable only on workstreams themselves (it's their name)
  // For tasks under a workstream, it's inherited and read-only
  if (role === 'task') {
    return <span className="text-text-secondary text-xs">{task.workStream}</span>;
  }
  return (
    <InlineEdit
      value={task.workStream}
      onSave={v => handleFieldUpdate('workStream', v)}
    />
  );
}
```

Replace the `project` case:
```typescript
case 'project': {
  const role = getHierarchyRole(task, taskMap);
  // project is editable only on projects themselves (it's their name)
  // For workstreams and tasks, it's inherited and read-only
  if (role !== 'project') {
    return <span className="text-text-secondary text-xs">{task.project}</span>;
  }
  return (
    <InlineEdit
      value={task.project}
      onSave={v => handleFieldUpdate('project', v)}
    />
  );
}
```

---

### B7: Critical path scope UI (Issue #10 — UI part)

**File: `src/components/layout/Toolbar.tsx`**

Remove the "All" button from the scope dropdown. Derive project names from summary tasks with no parent. Add a "Workstreams" section.

Replace the `projectNames` memo:
```typescript
const projectNames = useMemo(
  () => state.tasks.filter(t => t.isSummary && !t.parentId).map(t => t.name).filter(Boolean),
  [state.tasks]
);
const workstreamNames = useMemo(
  () => state.tasks.filter(t => t.isSummary && t.parentId !== null).map(t => t.name).filter(Boolean),
  [state.tasks]
);
```

Update the `scopeLabel` function (remove the `all` case):
```typescript
function scopeLabel(scope: CriticalPathScope): string {
  if (scope.type === 'project') return scope.name || 'Select scope';
  if (scope.type === 'workstream') return scope.name;
  return milestoneTasks.find(t => t.id === scope.id)?.name ?? scope.id;
}
```

In the scope dropdown JSX, remove the "All" button and add workstreams:
```typescript
{showCpScopeMenu && state.showCriticalPath && (
  <div className="absolute top-full left-0 mt-1 bg-surface-overlay border border-border-default rounded-lg shadow-xl p-1 z-40 min-w-[160px] fade-in">
    {projectNames.length > 0 && (
      <>
        <div className="text-text-muted text-[10px] uppercase px-2 pt-1">Projects</div>
        {projectNames.map(name => (
          <button
            key={name}
            onClick={() => { dispatch({ type: 'SET_CRITICAL_PATH_SCOPE', scope: { type: 'project', name } }); setShowCpScopeMenu(false); }}
            className={`block w-full text-left px-2 py-1 rounded text-xs transition-colors ${
              state.criticalPathScope.type === 'project' && state.criticalPathScope.name === name
                ? 'bg-red-600/20 text-red-400' : 'text-text-secondary hover:bg-surface-sunken'
            }`}
          >
            {name}
          </button>
        ))}
      </>
    )}
    {workstreamNames.length > 0 && (
      <>
        <div className="text-text-muted text-[10px] uppercase px-2 pt-1">Workstreams</div>
        {workstreamNames.map(name => (
          <button
            key={name}
            onClick={() => { dispatch({ type: 'SET_CRITICAL_PATH_SCOPE', scope: { type: 'workstream', name } }); setShowCpScopeMenu(false); }}
            className={`block w-full text-left px-2 py-1 rounded text-xs transition-colors ${
              state.criticalPathScope.type === 'workstream' && (state.criticalPathScope as any).name === name
                ? 'bg-red-600/20 text-red-400' : 'text-text-secondary hover:bg-surface-sunken'
            }`}
          >
            {name}
          </button>
        ))}
      </>
    )}
    {milestoneTasks.length > 0 && (
      <>
        <div className="text-text-muted text-[10px] uppercase px-2 pt-1">Milestones</div>
        {milestoneTasks.map(ms => (
          <button
            key={ms.id}
            onClick={() => { dispatch({ type: 'SET_CRITICAL_PATH_SCOPE', scope: { type: 'milestone', id: ms.id } }); setShowCpScopeMenu(false); }}
            className={`block w-full text-left px-2 py-1 rounded text-xs transition-colors ${
              state.criticalPathScope.type === 'milestone' && state.criticalPathScope.id === ms.id
                ? 'bg-red-600/20 text-red-400' : 'text-text-secondary hover:bg-surface-sunken'
            }`}
          >
            {ms.name}
          </button>
        ))}
      </>
    )}
  </div>
)}
```

---

## Verification

```bash
npx tsc --noEmit
npm run test
```

Manual checks:
- Add Task from toolbar → scrolls into view, name field focused for editing
- Double-click task bar → popover appears, edit name/dates/owner
- Ctrl+B → left pane collapses; Ctrl+B again → restores with same columns
- Right-click task → "Move to workstream..." → picker shows valid targets
- Dep modal excludes hierarchy-invalid predecessors
- workStream/project columns are read-only for child tasks
- Critical path scope dropdown shows Projects and Workstreams sections, no "All"

## When done
1. Mark tasks B1-B7 as `[x]` in `/workspace/TASKS.md`
2. Commit with message: "feat: task bar popover, focus new task, pane collapse, reparent picker, hierarchy UI"
3. Run `npm run build` to verify full build passes
````

---

## Group C Prompt — WASM Critical Path Rework

Paste this into Terminal 2:

````
You are the Group C agent for Phase 7 of Ganttlet. You own the Rust WASM scheduler and its TypeScript wrapper. NO OTHER FILES.

## Your files (exclusive ownership — only touch these)
- crates/scheduler/src/cpm.rs
- crates/scheduler/src/types.rs
- crates/scheduler/src/lib.rs
- src/utils/schedulerWasm.ts

## DO NOT TOUCH
Any file in src/state/, src/collab/, src/components/, src/types/, src/data/. Those belong to Groups A and B.

## Tasks (execute sequentially: C1 → C2 → C3 → C4)

### C1: Add `work_stream` field to Rust Task

**File: `crates/scheduler/src/types.rs`**

Add a `work_stream` field to the Task struct:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub start_date: String,
    pub end_date: String,
    pub duration: i32,
    pub is_milestone: bool,
    pub is_summary: bool,
    pub dependencies: Vec<Dependency>,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub work_stream: String,
}
```

Update ALL test helper `make_task` functions across all test modules (cpm.rs, cascade.rs, graph.rs, constraints.rs) to include `work_stream: String::new()`.

Run: `cd crates/scheduler && cargo test`

---

### C2: Update `CriticalPathScope` enum

**File: `crates/scheduler/src/cpm.rs`**

Remove the `All` variant from `CriticalPathScope` and add `Workstream`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CriticalPathScope {
    Project { name: String },
    Workstream { name: String },
    Milestone { id: String },
}
```

Update `compute_critical_path_scoped` to handle the new variant:

```rust
pub fn compute_critical_path_scoped(tasks: &[Task], scope: &CriticalPathScope) -> Vec<String> {
    match scope {
        CriticalPathScope::Project { name } => {
            let filtered: Vec<Task> = tasks
                .iter()
                .filter(|t| t.project == *name)
                .cloned()
                .collect();
            compute_critical_path(&filtered)
        }
        CriticalPathScope::Workstream { name } => {
            let filtered: Vec<Task> = tasks
                .iter()
                .filter(|t| t.work_stream == *name)
                .cloned()
                .collect();
            compute_critical_path(&filtered)
        }
        CriticalPathScope::Milestone { id } => {
            // BFS backward from milestone — existing logic, unchanged
            let task_map: HashMap<&str, &Task> =
                tasks.iter().map(|t| (t.id.as_str(), t)).collect();
            let mut subset_ids: HashSet<String> = HashSet::new();
            let mut queue: VecDeque<String> = VecDeque::new();

            if task_map.contains_key(id.as_str()) {
                queue.push_back(id.clone());
                subset_ids.insert(id.clone());
            }

            while let Some(current) = queue.pop_front() {
                if let Some(task) = task_map.get(current.as_str()) {
                    for dep in &task.dependencies {
                        if !subset_ids.contains(&dep.from_id) {
                            subset_ids.insert(dep.from_id.clone());
                            queue.push_back(dep.from_id.clone());
                        }
                    }
                }
            }

            let subset: Vec<Task> = tasks
                .iter()
                .filter(|t| subset_ids.contains(&t.id))
                .cloned()
                .collect();
            compute_critical_path(&subset)
        }
    }
}
```

Update the existing `make_task` and `make_project_task` helpers in the test module:
```rust
fn make_task(id: &str, start: &str, end: &str, duration: i32) -> Task {
    Task {
        id: id.to_string(),
        start_date: start.to_string(),
        end_date: end.to_string(),
        duration,
        is_milestone: false,
        is_summary: false,
        dependencies: vec![],
        project: String::new(),
        work_stream: String::new(),
    }
}
```

Update `make_project_task`:
```rust
fn make_project_task(id: &str, start: &str, end: &str, duration: i32, project: &str) -> Task {
    Task {
        project: project.to_string(),
        ..make_task(id, start, end, duration)
    }
}
```

Update `scoped_all_same_as_default` test — since `All` no longer exists, change it to test project scope matching all tasks:
```rust
#[test]
fn scoped_project_matches_all_when_same_project() {
    let mut b = make_project_task("b", "2026-03-10", "2026-03-19", 9, "Alpha");
    b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
    let tasks = vec![make_project_task("a", "2026-03-01", "2026-03-10", 9, "Alpha"), b];

    let scoped = compute_critical_path_scoped(&tasks, &CriticalPathScope::Project { name: "Alpha".to_string() });
    let default_result = compute_critical_path(&tasks);
    assert_eq!(default_result, scoped);
}
```

Run: `cd crates/scheduler && cargo test`

---

### C3: Update WASM TypeScript wrapper

**File: `src/utils/schedulerWasm.ts`**

1. Add `workStream` to the task-to-WASM mapping in `mapTasksToWasm`:
```typescript
function mapTasksToWasm(tasks: Task[]) {
  return tasks.map(t => ({
    id: t.id,
    startDate: t.startDate,
    endDate: t.endDate,
    duration: t.duration,
    isMilestone: t.isMilestone,
    isSummary: t.isSummary,
    project: t.project,
    workStream: t.workStream,
    dependencies: t.dependencies.map(d => ({
      fromId: d.fromId,
      toId: d.toId,
      type: d.type,
      lag: d.lag,
    })),
  }));
}
```

2. Remove the local `CriticalPathScope` type definition (lines 14-17). Import it from `../types` instead:
```typescript
import type { Task, CriticalPathScope } from '../types';
```

Note: This depends on Group A having updated the `CriticalPathScope` type in `src/types/index.ts` (task A7). If A7 isn't done yet, keep the local type temporarily and add a TODO comment.

3. Update `computeCriticalPath` — since `All` no longer exists, use a project scope or just call the underlying WASM `compute_critical_path` directly:
```typescript
export function computeCriticalPath(tasks: Task[]): Set<string> {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  const wasmTasks = mapTasksToWasm(tasks);
  const result: string[] = wasmModule.compute_critical_path(wasmTasks);
  return new Set(result);
}
```

**Verify**:
```bash
cd crates/scheduler && cargo test
npm run build:wasm
npx tsc --noEmit
npm run test
```

---

### C4: Rust tests

Add tests for workstream-scoped critical path.

**File: `crates/scheduler/src/cpm.rs`** (in the `mod tests` block)

```rust
fn make_workstream_task(id: &str, start: &str, end: &str, duration: i32, project: &str, ws: &str) -> Task {
    Task {
        project: project.to_string(),
        work_stream: ws.to_string(),
        ..make_task(id, start, end, duration)
    }
}

#[test]
fn scoped_workstream_filters() {
    // Engineering chain: e1 -> e2
    let mut e2 = make_workstream_task("e2", "2026-03-11", "2026-03-20", 10, "Alpha", "Engineering");
    e2.dependencies = vec![make_dep("e1", "e2", DepType::FS, 0)];

    // Design chain: d1 -> d2
    let mut d2 = make_workstream_task("d2", "2026-03-11", "2026-03-20", 10, "Alpha", "Design");
    d2.dependencies = vec![make_dep("d1", "d2", DepType::FS, 0)];

    let tasks = vec![
        make_workstream_task("e1", "2026-03-01", "2026-03-10", 10, "Alpha", "Engineering"),
        e2,
        make_workstream_task("d1", "2026-03-01", "2026-03-10", 10, "Alpha", "Design"),
        d2,
    ];

    let eng_critical = compute_critical_path_scoped(
        &tasks,
        &CriticalPathScope::Workstream { name: "Engineering".to_string() },
    );
    assert!(eng_critical.contains(&"e1".to_string()));
    assert!(eng_critical.contains(&"e2".to_string()));
    assert!(!eng_critical.contains(&"d1".to_string()));
    assert!(!eng_critical.contains(&"d2".to_string()));
}

#[test]
fn workstream_scope_empty_returns_empty() {
    let tasks = vec![make_workstream_task("a", "2026-03-01", "2026-03-10", 10, "Alpha", "Engineering")];
    let result = compute_critical_path_scoped(
        &tasks,
        &CriticalPathScope::Workstream { name: "NonExistent".to_string() },
    );
    assert!(result.is_empty());
}
```

Run: `cd crates/scheduler && cargo test`

---

## Verification

```bash
cd crates/scheduler && cargo test
npm run build:wasm
npx tsc --noEmit
npm run test
```

## When done
1. Mark tasks C1-C4 as `[x]` in `/workspace/TASKS.md`
2. Commit with message: "feat: workstream-scoped critical path, remove All scope variant"
3. Run `npm run build` to verify full build passes
````

---

## Group D Prompt — Integration, Merge, Build, Test, Cleanup

Paste this into Terminal 4 after Group B finishes. Groups A and C are already merged to main.

````
You are the Group D integration agent for Phase 7 of Ganttlet. Groups A and C are already merged to main. Your job is to merge Group B's branch, fix any issues, verify the build, and clean up.

You work in the MAIN repo at `/workspace` (not a worktree).

## STEP 1 — Wait for Group B to finish

Poll `/workspace/TASKS.md` every 30 seconds until Group B's last task is marked `[x]`:
- `[x] **B7**:` (Group B's last task — critical path scope UI)

Procedure:
1. Read `/workspace/TASKS.md` and check if B7 is `[x]`
2. If NOT done, say "Waiting for Group B to finish... (check N)" then sleep 30 seconds and check again
3. Once done, say "Group B finished — starting integration" and proceed

While waiting, you may read files to familiarize yourself with the codebase. Do NOT modify any files until B7 is confirmed done.

## STEP 2 — Verify Group B branch has committed changes

```bash
cd /workspace

# Check Group B branch
git log main..feature/phase7-ui-components --oneline
git -C .claude/worktrees/phase7-groupB status
```

If the branch has uncommitted changes, warn the user and wait. Do NOT proceed with uncommitted work.

If the branch has NO commits beyond main, Group B may not have finished properly — warn the user.

## STEP 3 — Merge Group B into main

Groups A and C are already merged. Only B remains:

```bash
cd /workspace
git checkout main
git merge feature/phase7-ui-components --no-ff -m "Merge feature/phase7-ui-components: task bar popover, focus new task, pane collapse, reparent picker"
```

### Handling merge conflicts

Conflicts should be very rare since B was branched from the merged A+C main and has zero file overlap. But if they occur:

1. Read both sides of the conflict carefully
2. Resolve by keeping BOTH sides' changes (they should be additive)
3. After resolving, stage and commit the merge

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
- **CriticalPathScope mismatch**: Group A removes `all` from the type but Group B's Toolbar still references it — update Toolbar to not use `all`.
- **Rust test failures**: The `work_stream` field wasn't added to all test helpers. Add `work_stream: String::new()`.
- **WASM build failure**: Check that `lib.rs` exports are correct.
- **Import path errors**: `schedulerWasm.ts` may import `CriticalPathScope` from `../types` (Group C) but Group A may have changed the type — verify they match.
- **Reducer exhaustiveness**: If TypeScript complains about unhandled action types in the switch, add the missing cases.

After fixing any issues, commit the fixes:
```bash
git add -A
git commit -m "fix: resolve post-merge integration issues"
```

## STEP 5 — Integration smoke check

Read through the key integration points and verify they're wired correctly:

1. **Hierarchy utils → Reducer**: `ganttReducer.ts` imports from `hierarchyUtils.ts` and `dependencyValidation.ts`
2. **State → UI**: `src/types/index.ts` has `focusNewTaskId`, `isLeftPaneCollapsed`, `reparentPicker` in GanttState
3. **Actions → Reducer**: All new actions (REPARENT_TASK, SET_REPARENT_PICKER, TOGGLE_LEFT_PANE, CLEAR_FOCUS_NEW_TASK) have cases in the reducer
4. **CriticalPathScope**: Type in `types/index.ts` matches what WASM returns (no `all`, has `workstream`)
5. **Collab sync**: `REPARENT_TASK` triggers full sync via `pendingFullSyncRef` pattern
6. **Seed data**: `fakeData.ts` has consistent `project: 'Q2 Product Launch'` for all tasks
7. **WASM mapping**: `schedulerWasm.ts` includes `workStream` in `mapTasksToWasm`
8. **Task bar popover**: `TaskBar.tsx` imports `TaskBarPopover` and handles double-click
9. **Reparent picker**: `App.tsx` renders `ReparentPickerModal` when `state.reparentPicker` is set
10. **Pane collapse**: `App.tsx` reads `isLeftPaneCollapsed` and applies `w-0 overflow-hidden`

If any wiring is missing, fix it and commit.

## STEP 6 — Clean up

```bash
cd /workspace

# Remove worktrees
git worktree remove /workspace/.claude/worktrees/phase7-groupA 2>/dev/null || true
git worktree remove /workspace/.claude/worktrees/phase7-groupB 2>/dev/null || true
git worktree remove /workspace/.claude/worktrees/phase7-groupC 2>/dev/null || true

# Delete feature branches (they're merged)
git branch -d feature/phase7-hierarchy-state
git branch -d feature/phase7-ui-components
git branch -d feature/phase7-wasm-scheduler

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
