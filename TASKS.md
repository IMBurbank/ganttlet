# Task Queue

Claimable tasks for multi-agent development.
**Convention**: write your agent/branch name next to `[x]` when you claim a task.

---

## Rust-WASM Scheduling Engine (DONE)
Replaced the JS CPM utils with a Rust module compiled to WebAssembly.

- [x] Scaffold Rust crate (`crates/scheduler/`) with `wasm-bindgen` + `wasm-pack`
- [x] Define shared types (`Task`, `Dependency`, `CascadeResult`) in Rust
- [x] Implement CPM: topological sort, forward pass (ES/EF), backward pass (LS/LF), zero-float detection
- [x] Implement cycle detection (`would_create_cycle`) via BFS reachability
- [x] Implement cascade dependents (`cascade_dependents`) with date arithmetic
- [x] Expose all functions via `#[wasm_bindgen]`
- [x] Wire WASM module into React app via `schedulerWasm.ts` wrapper
- [x] Delete old JS implementations (`criticalPathUtils.ts`, functions from `dependencyUtils.ts`)

## Phase 6: Gantt Chart UX Improvements (DONE)
Scoped critical path, undo/redo, cascade highlights, weekend collapse, drag constraints, slack indicators, collab sync fix, column close buttons, dependency modal fix.
Three parallel groups: WASM scheduler enhancements, state management + collab sync, UI + visual feedback.

---

## Phase 7: Hierarchy Enforcement, Task Movement & UX Improvements
Hierarchy enforcement, task reparenting, and UX polish across three parallel agent groups.
See `CLAUDE.md` for interface contracts and file ownership.

### Group A: Hierarchy Enforcement + State Management
**Files**: `src/utils/hierarchyUtils.ts` (new), `src/utils/dependencyValidation.ts` (new), `src/state/ganttReducer.ts`, `src/state/actions.ts`, `src/types/index.ts`, `src/state/GanttContext.tsx`, `src/collab/yjsBinding.ts`, `src/data/fakeData.ts`, `src/utils/__tests__/hierarchyUtils.test.ts` (new), `src/utils/__tests__/dependencyValidation.test.ts` (new), `src/state/__tests__/ganttReducer.test.ts`
**Branch**: `feature/phase7-hierarchy-state`

- [x] **A1**: Create `src/utils/hierarchyUtils.ts`
  - Pure functions for hierarchy queries: `getHierarchyRole`, `findProjectAncestor`, `findWorkstreamAncestor`, `getAllDescendantIds`, `isDescendantOf`, `generatePrefixedId`, `computeInheritedFields`
  - `getHierarchyRole(task, taskMap)` — project if `isSummary && !parentId`, workstream if `isSummary && parent is project`, else task
  - `generatePrefixedId(parent, tasks)` — find max N in `{parentId}-N` pattern, return `{parentId}-{N+1}`
  - `computeInheritedFields(parentId, taskMap)` — inherit `project`, `workStream`, `okrs` from parent based on role

- [x] **A2**: Create `src/utils/dependencyValidation.ts`
  - `validateDependencyHierarchy(tasks, successorId, predecessorId)` — projects can't depend on own descendants, workstreams can't depend on own children, tasks can't depend on ancestor project/workstream
  - `checkMoveConflicts(tasks, taskId, newParentId)` — check if task has deps on the target project/workstream entity itself (deps on sibling tasks are fine)

- [x] **A3**: Modify `ADD_TASK` in reducer (Issues #1, #2, #3)
  - Call `computeInheritedFields(parentId, taskMap)` for `project`, `workStream`, `okrs`
  - Call `generatePrefixedId(parent, tasks)` for workstream-prefixed ID
  - Set `focusNewTaskId: newId` in returned state (Issue #5 signal)

- [x] **A4**: Modify `UPDATE_TASK_FIELD` in reducer
  - When `field === 'name'` and task is a project or workstream, cascade field updates to descendants
  - Project rename → update `project` field on all descendants
  - Workstream rename → update `workStream` field on all descendants

- [x] **A5**: Add hierarchy validation to `ADD_DEPENDENCY`
  - Call `validateDependencyHierarchy()` before adding; if invalid, return state unchanged

- [x] **A6**: Add `REPARENT_TASK` reducer case (Issue #4)
  - Validate: not reparenting to self or own descendant
  - Call `checkMoveConflicts()` — reject if conflicts exist
  - Update `parentId`, `childIds`, inherited fields, reposition in array, update dependency references if `newId` provided
  - Call `recalcSummaryDates`

- [x] **A7**: Add new actions and state fields
  - `src/state/actions.ts`: Add `REPARENT_TASK`, `SET_REPARENT_PICKER`, `TOGGLE_LEFT_PANE`, `CLEAR_FOCUS_NEW_TASK`
  - `src/types/index.ts`: Add `focusNewTaskId`, `isLeftPaneCollapsed`, `reparentPicker` to GanttState; update `CriticalPathScope` to remove `all`, add `workstream`
  - `src/state/GanttContext.tsx`: Add initial values, `Ctrl+B` shortcut for `TOGGLE_LEFT_PANE`, change default `criticalPathScope`
  - `src/collab/yjsBinding.ts`: Handle `REPARENT_TASK` via full sync

- [x] **A8**: Fix seed data in `src/data/fakeData.ts`
  - Fix inconsistent `project` fields — all tasks should have `project: 'Q2 Product Launch'`
  - Workstreams: set `project` to parent project's name, keep `workStream` as own name
  - Leaf tasks: set `project` to `'Q2 Product Launch'`, `workStream` to parent workstream's name

- [x] **A9**: Tests
  - `src/utils/__tests__/hierarchyUtils.test.ts` (new): hierarchy role classification, prefixed ID generation, inherited fields
  - `src/utils/__tests__/dependencyValidation.test.ts` (new): hierarchy violation rejection, cross-project deps allowed, move conflict detection
  - `src/state/__tests__/ganttReducer.test.ts` (extend): ADD_TASK inheritance, UPDATE_TASK_FIELD cascade, ADD_DEPENDENCY rejection, REPARENT_TASK

**Execution**: A1 → A2 → A3+A4+A5 → A6 → A7 → A8 → A9

---

### Group B: UI Components
**Files**: `src/App.tsx`, `src/components/gantt/TaskBar.tsx`, `src/components/gantt/TaskBarPopover.tsx` (new), `src/components/table/TaskRow.tsx`, `src/components/table/InlineEdit.tsx`, `src/components/table/TaskTable.tsx`, `src/components/shared/DependencyEditorModal.tsx`, `src/components/shared/ReparentPickerModal.tsx` (new), `src/components/layout/Toolbar.tsx`
**Branch**: `feature/phase7-ui-components`
**Depends on**: A7 (types + actions), A1 (hierarchy utils), A2 (dep validation)

- [ ] **B1**: Focus on new task (Issue #5)
  - `InlineEdit.tsx`: Add `autoEdit?: boolean` prop — when true, enter edit mode automatically
  - `TaskRow.tsx`: Add `autoFocusName?: boolean` prop, pass to name cell's `InlineEdit`; `scrollIntoView` when true
  - `TaskTable.tsx`: Read `focusNewTaskId` from state, pass `autoFocusName` to `TaskRow`, dispatch `CLEAR_FOCUS_NEW_TASK` after one animation frame

- [ ] **B2**: Edit from task bars (Issue #6)
  - `TaskBarPopover.tsx` (new): Portal-based popover with editable fields (name, start/end date, duration, owner)
  - `TaskBar.tsx`: Add `onDoubleClick` handler to open popover at click position

- [ ] **B3**: Collapse/expand left pane (Issue #7)
  - `App.tsx`: Read `isLeftPaneCollapsed`, set left pane to `w-0 overflow-hidden` when collapsed; add divider button with chevron; `transition-all duration-200`

- [ ] **B4**: Reparent picker modal (Issue #4 UI)
  - `ReparentPickerModal.tsx` (new): List workstream/project targets, exclude current parent and descendants, show `checkMoveConflicts()` warnings, dispatch `REPARENT_TASK`
  - `App.tsx`: Add "Move to workstream..." context menu item for non-summary tasks, render `ReparentPickerModal` when `state.reparentPicker` is set

- [ ] **B5**: Dependency modal hierarchy filtering
  - `DependencyEditorModal.tsx`: Add `validateDependencyHierarchy` check to `availablePredecessors` filter and `getValidPredecessorsForRow`

- [ ] **B6**: Read-only inherited fields in table
  - `TaskRow.tsx`: Import `getHierarchyRole`; for `workStream` and `project` cells, render as read-only text if the field is inherited

- [ ] **B7**: Critical path scope UI (Issue #10 — UI part)
  - `Toolbar.tsx`: Remove "All" button from scope dropdown; add "Workstreams" section; dispatch `SET_CRITICAL_PATH_SCOPE` with `{ type: 'workstream', name }` for workstream selections

**Execution**: B1+B2+B3 → B4+B5+B6 → B7

---

### Group C: WASM Critical Path Rework
**Files**: `crates/scheduler/src/cpm.rs`, `crates/scheduler/src/types.rs`, `crates/scheduler/src/lib.rs`, `src/utils/schedulerWasm.ts`
**Branch**: `feature/phase7-wasm-scheduler`

- [ ] **C1**: Add `work_stream` field to Rust Task
  - `crates/scheduler/src/types.rs`: Add `#[serde(default)] pub work_stream: String`

- [ ] **C2**: Update `CriticalPathScope` enum
  - `crates/scheduler/src/cpm.rs`: Remove `All` variant, add `Workstream { name: String }`
  - Update `compute_critical_path_scoped`: `Workstream` filters by `t.work_stream == name`

- [ ] **C3**: Update WASM TypeScript wrapper
  - `src/utils/schedulerWasm.ts`: Add `workStream` to task-to-WASM mapping; remove local `CriticalPathScope` type duplicate; update `computeCriticalPathScoped` for new scope variants

- [ ] **C4**: Rust tests
  - Add tests for workstream-scoped critical path
  - Verify `All` removal doesn't break callers

**Execution**: C1 → C2 → C3 → C4

---

### Cross-Group Dependencies
- Groups A and C run in parallel (no shared files)
- Group B depends on A7 (types, actions, state fields), A1 (hierarchy utils), A2 (dep validation)
- B7 depends on C2+C3 (new CriticalPathScope type with workstream variant)
- **Run Groups A and C in parallel. Start Group B after A7 completes.**

---

### Integration Verification (after merge)
1. `npm run build` succeeds
2. `npm run test` — all tests pass
3. `cargo test` — Rust tests pass
4. Manual smoke test:
   - Add task under workstream → inherits project/workStream/okrs, gets prefixed ID
   - Add Task from toolbar → scrolls into view, name field focused for editing
   - Rename a project → all descendants' `project` field updates
   - Double-click task bar → popover appears, edit name/dates/owner
   - Ctrl+B → left pane collapses; Ctrl+B again → restores with same columns
   - Right-click task → "Move to workstream..." → picker shows valid targets
   - Move task to different workstream → ID changes, all dependency links update
   - Try to add dep from task to its own project → blocked
   - Try to move task into workstream where it depends on that workstream → warning
   - Critical path scope dropdown → shows Projects and Workstreams sections, no "All"
   - Select workstream scope → only that workstream's critical chain highlighted

---

## Resource Assignment & Leveling
Basic resource tracking and overallocation detection.

- [ ] Define resource data model (id, name, capacity, calendar)
- [ ] Add resource assignment UI (task → resource mapping)
- [ ] Implement overallocation detection (flag tasks exceeding capacity)
- [ ] Implement basic resource leveling (delay tasks to resolve conflicts)

## Baseline Tracking
Save and compare schedule snapshots.

- [ ] Define baseline data model (snapshot of dates per task)
- [ ] Add "Save Baseline" action (store current dates)
- [ ] Render baseline bars on Gantt chart (ghost bars behind actuals)
- [ ] Add variance columns (planned vs. actual start/finish delta)

## Export
Generate shareable outputs from the Gantt chart.

- [ ] Export to PDF (print-friendly layout with headers/legend)
- [ ] Export to PNG (rasterize SVG at chosen resolution)
- [ ] Export to CSV (flat table of task data)
