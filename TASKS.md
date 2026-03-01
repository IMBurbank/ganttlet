# Task Queue

Claimable tasks for multi-agent development.
**Convention**: write your agent/branch name next to `[x]` when you claim a task.

---

## Rust-WASM Scheduling Engine
Replace the JS CPM utils with a Rust module compiled to WebAssembly.

- [ ] Scaffold Rust crate (`crates/scheduler/`) with `wasm-bindgen` + `wasm-pack`
- [ ] Define shared types (`Task`, `Dependency`, `ScheduleResult`) in Rust
- [ ] Implement topological sort for dependency graph
- [ ] Implement forward pass (early start / early finish)
- [ ] Implement backward pass (late start / late finish, total float)
- [ ] Implement free float calculation
- [ ] Expose `schedule(tasks, deps) -> ScheduleResult` via `wasm-bindgen`
- [ ] Wire WASM module into React app, replacing JS `criticalPathUtils`

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
