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

## Phase 6: Gantt Chart UX Improvements
Bug fixes, visual feedback, and new features across three parallel agent groups.
See `CLAUDE.md` for interface contracts and file ownership.

### Group A: WASM Scheduler Enhancements
**Files**: `crates/scheduler/src/*`, `src/utils/schedulerWasm.ts`
**Branch**: `feature/phase6-wasm-scheduler`

- [x] **A1**: Fix critical path — only connected chains
  - File: `crates/scheduler/src/cpm.rs`
  - Bug: all zero-float tasks returned including standalone (no deps). Fix: task is critical only if zero float AND `(in_degree > 0 || out_degree > 0)` — participates in at least one dependency
  - Tests: standalone task excluded, chain still detected

- [x] **A2**: Add scoped critical path computation
  - File: `crates/scheduler/src/cpm.rs`, `types.rs`, `lib.rs`
  - Add `compute_critical_path_scoped(tasks, scope)` with scope variants: All, Project(name), Milestone(id)
  - Project scope: filter tasks to matching project, run CPM on subset
  - Milestone scope: BFS backward from milestone through deps to find transitive predecessors, run CPM on subset + milestone
  - Add `project: String` field to Rust Task struct
  - Tests: all scope = existing + A1 fix, project scope filters, milestone scope traces predecessors

- [x] **A3**: Add `compute_earliest_start` to Rust crate
  - File: `crates/scheduler/src/constraints.rs` (new)
  - `compute_earliest_start(tasks, task_id) -> Option<String>`: for each dep on task, compute earliest possible start date by type (FS/SS/FF with lag), return the latest
  - Tests: no deps → None, single FS → end+1, FS+lag → end+lag+1, multiple deps → latest wins, SS dep → start

- [x] **A4**: Expose all new functions in TypeScript wrapper
  - File: `src/utils/schedulerWasm.ts`
  - Add `computeEarliestStart`, `cascadeDependentsWithIds`, `computeCriticalPathScoped`
  - Update existing `computeCriticalPath` to call scoped variant with `{ type: 'all' }`
  - Update WASM task mapping to include `project` field
  - Verify: `cargo test` passes, `npm run test` passes

**Execution**: A1 → A2 → A3 → A4 (sequential)

---

### Group B: State Management, Undo/Redo, Collab Sync Fix
**Files**: `src/state/actions.ts`, `src/state/ganttReducer.ts`, `src/state/GanttContext.tsx`, `src/collab/yjsBinding.ts`, `src/types/index.ts`
**Branch**: `feature/phase6-state-sync`

- [ ] **B1**: Fix CASCADE_DEPENDENTS collab sync (bug fix — do first)
  - File: `src/collab/yjsBinding.ts`
  - Bug: `CASCADE_DEPENDENTS` in `TASK_MODIFYING_ACTIONS` but no case in `applyActionToYjs()` switch — falls through to `default: break;`
  - Fix: add case that reads tasks from Yjs, calls `cascadeDependents`, writes changed dates back in a transaction
  - Import `cascadeDependents` from `schedulerWasm`

- [ ] **B2**: Add new state fields and action types
  - File: `src/types/index.ts` — add `undoStack`, `redoStack`, `lastCascadeIds`, `criticalPathScope`, `collapseWeekends` to GanttState; add `CriticalPathScope` type
  - File: `src/state/actions.ts` — add UNDO, REDO, SET_LAST_CASCADE_IDS, SET_CRITICAL_PATH_SCOPE, TOGGLE_COLLAPSE_WEEKENDS
  - File: `src/state/GanttContext.tsx` — add defaults to initialState (`undoStack: []`, `redoStack: []`, `lastCascadeIds: []`, `criticalPathScope: { type: 'all' }`, `collapseWeekends: true`)

- [ ] **B3**: Implement undo/redo in reducer
  - File: `src/state/ganttReducer.ts`
  - Define UNDOABLE_ACTIONS: MOVE_TASK, RESIZE_TASK, CASCADE_DEPENDENTS, ADD/UPDATE/REMOVE_DEPENDENCY, ADD_TASK, DELETE_TASK
  - Before undoable action: push `state.tasks` snapshot to undoStack (max 50), clear redoStack
  - UNDO: pop undoStack → tasks, push current tasks → redoStack
  - REDO: pop redoStack → tasks, push current tasks → undoStack

- [ ] **B4**: Update CASCADE_DEPENDENTS to track changed IDs
  - File: `src/state/ganttReducer.ts`
  - Modify CASCADE_DEPENDENTS case to use `cascadeDependentsWithIds` and store `changedIds` in `lastCascadeIds`
  - Add SET_LAST_CASCADE_IDS, SET_CRITICAL_PATH_SCOPE, TOGGLE_COLLAPSE_WEEKENDS cases

- [ ] **B5**: Wire up keyboard shortcuts for undo/redo
  - File: `src/state/GanttContext.tsx`
  - Add `useEffect` for Ctrl+Z (undo) and Ctrl+Shift+Z (redo)

- [ ] **B6**: Sync UNDO/REDO to collab
  - File: `src/state/GanttContext.tsx` + `src/collab/yjsBinding.ts`
  - Use `pendingFullSyncRef` flag: when UNDO/REDO dispatched, set flag. `useEffect` watching `state.tasks` calls `applyTasksToYjs(doc, state.tasks)` when flag set, clears it

**Execution**: B1 → B2 → B3 → B4 → B5+B6 (B5 and B6 in parallel)

---

### Group C: UI, Visual Feedback, Timeline Improvements
**Files**: `src/components/gantt/*`, `src/components/table/ColumnHeader.tsx`, `src/components/shared/*`, `src/components/layout/Toolbar.tsx`, `src/utils/dateUtils.ts`
**Branch**: `feature/phase6-ui-visual`
**Depends on**: A4 (WASM functions), B2 (new state fields)

- [x] **C1**: Fix dependency modal click-outside
  - File: `src/components/shared/DependencyEditorModal.tsx`
  - Bug: backdrop div at line 140 intercepts clicks, so `e.target === e.currentTarget` on outer container is always false
  - Fix: add `onClick={close}` directly to the backdrop div

- [x] **C2**: Add column close buttons
  - File: `src/components/table/ColumnHeader.tsx`
  - Add X button to each column header (except "name"), hover-visible, dispatches TOGGLE_COLUMN
  - Needs `useGanttDispatch` hook

- [x] **C3**: Collapse weekends in day view
  - File: `src/utils/dateUtils.ts` — add `businessDaysBetween`, `dateToXCollapsed`, `xToDateCollapsed`, `getTimelineDaysFiltered`
  - File: `src/components/gantt/TimelineHeader.tsx` — use filtered days when weekends collapsed
  - File: `src/components/gantt/GridLines.tsx` — same: filter out weekend days
  - File: `src/components/gantt/GanttChart.tsx` — read `collapseWeekends` from state, pass to children, use collapsed positioning
  - File: `src/components/gantt/TaskBar.tsx` — accept `collapseWeekends` prop, use collapsed positioning in drag

- [x] **C4**: Critical path scope UI in Toolbar
  - File: `src/components/layout/Toolbar.tsx`
  - Replace single "Critical Path" toggle with split button: toggle on/off + scope dropdown (All / project names / milestones)
  - Dispatch SET_CRITICAL_PATH_SCOPE on scope change

- [x] **C5**: Pass scoped critical path to GanttChart
  - File: `src/components/gantt/GanttChart.tsx`
  - Change `computeCriticalPath(allTasks)` to `computeCriticalPathScoped(allTasks, criticalPathScope)`

- [x] **C6**: Enforce drag constraints in TaskBar
  - File: `src/components/gantt/TaskBar.tsx`
  - Add `earliestStart` prop, clamp drag start date to `>= earliestStart` in onMouseMove

- [x] **C7**: Slack indicator + cascade highlights
  - File: `src/components/gantt/SlackIndicator.tsx` (new) — dashed rect showing slack region between earliest start and actual start
  - File: `src/components/gantt/CascadeHighlight.tsx` (new) — amber flash overlay on cascaded tasks
  - File: `src/components/gantt/GanttChart.tsx` — compute earliest starts, render SlackIndicator + CascadeHighlight, auto-clear cascade IDs after 2s

- [x] **C8**: Undo/Redo toolbar buttons
  - File: `src/components/shared/UndoRedoButtons.tsx` (new) — reads undoStack/redoStack length, renders buttons
  - File: `src/components/layout/Toolbar.tsx` — render `<UndoRedoButtons />` after Add Task button

- [x] **C9**: Weekend toggle in Toolbar
  - File: `src/components/layout/Toolbar.tsx` — add "Collapse Weekends" toggle near zoom controls, dispatches TOGGLE_COLLAPSE_WEEKENDS

**Execution**: C1+C2 → C3 → C4+C5+C6 → C7+C8+C9 (parallel within stages)

---

### Cross-Group Dependencies
- C5 depends on A4 (`computeCriticalPathScoped` must exist)
- C6+C7 depend on A3+A4 (`computeEarliestStart` must exist)
- C7 cascade depends on B4 (`lastCascadeIds` state must exist)
- C8 depends on B3 (undo/redo state must exist)
- C3+C9 depend on B2 (`collapseWeekends` state must exist)
- **Run Groups A and B in parallel. Start Group C after A4 and B2 complete.**

---

### Integration Verification (after merge)
1. `npm run build` — production build succeeds
2. `npm run test` — all tests pass
3. Manual smoke test:
   - Critical Path → only connected chains (not standalone tasks)
   - Scoped by project or milestone
   - Drag forward → dependents cascade with amber flash
   - Drag backward past constraint → clamped
   - Slack indicator visible when task is after earliest start
   - Ctrl+Z / Ctrl+Shift+Z → undo/redo works
   - Second tab → cascade and undo sync via collab
   - Click outside dependency modal → closes
   - Column header X → hides column
   - Collapse Weekends → weekend columns disappear in day view

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
