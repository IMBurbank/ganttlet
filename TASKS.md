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

## Phase 6: Gantt Chart UX — Group A (WASM Scheduler)
- [x] A1: Fix critical path — only connected dependency chains (feature/phase6-wasm-scheduler)
- [x] A2: Add scoped critical path computation (feature/phase6-wasm-scheduler)
- [x] A3: Add `compute_earliest_start` to Rust crate (feature/phase6-wasm-scheduler)
- [x] A4: Expose all new functions in TypeScript wrapper (feature/phase6-wasm-scheduler)

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
