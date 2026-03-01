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

## Phase 6: Gantt Chart UX Improvements (IN PROGRESS)
Ten UX fixes and features, split into three parallel agent groups.

### Group A — WASM Scheduler
- [ ] A1: Add `computeEarliestStart` to Rust scheduler
- [ ] A2: Add `computeCriticalPathScoped` for scoped critical path
- [ ] A3: Add backward-drag constraint enforcement in cascade
- [ ] A4: Add `cascadeDependentsWithIds` returning changed IDs

### Group B — State + Sync (`feature/phase6-state-sync`)
- [x] B1: Fix `CASCADE_DEPENDENTS` collab sync — add missing case to `applyActionToYjs`
- [x] B2: Add new state fields (`undoStack`, `redoStack`, `lastCascadeIds`, `criticalPathScope`, `collapseWeekends`) and action types (`UNDO`, `REDO`, `SET_LAST_CASCADE_IDS`, `SET_CRITICAL_PATH_SCOPE`, `TOGGLE_COLLAPSE_WEEKENDS`)
- [x] B3: Implement undo/redo in reducer with 50-snapshot limit
- [x] B4: Update `CASCADE_DEPENDENTS` to track changed IDs + add new reducer cases
- [x] B5: Wire up Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts for undo/redo
- [x] B6: Sync undo/redo to collab via full Yjs task array replacement

### Group C — UI + Visual (blocked on A4 + B2)
- [ ] C1: Cascade highlight animation on task bars
- [ ] C2: Slack indicator component
- [ ] C3: Scoped critical path UI controls
- [ ] C4: Collapse weekends in timeline
- [ ] C5: Undo/redo toolbar buttons
- [ ] C6: Fix dependency modal click-outside
