# Task Queue

Claimable tasks for multi-agent development.
**Convention**: write your agent/branch name next to `[x]` when you claim a task.

---

## Phase 11: Testing Infrastructure & Presence Fix — DONE
See `docs/completed-phases.md` for details.

---

## Phase 12: Scheduling Engine Overhaul (PENDING)
Three stages. Stage 1: engine fixes in Rust (3 groups, parallel). Stage 2: cascade UX + recalculate
UI (1 group). Stage 3: critical path UI + float visualization (1 group). Stages 2 and 3 run
sequentially to avoid shared-file merge conflicts.

### Context
The scheduling engine exists as a Rust→WASM module (`crates/scheduler/`) but does NOT work as
real scheduling software yet. This phase is about building a correct, production-grade scheduling
engine designed for concurrent users collaborating over a network. Treat the current code as a
starting point, not a working system — most of it needs to be debugged, rewritten, or extended.

Key problems in the current engine:
- **Cascade is broken**: Moving a task backward incorrectly pulls all dependents backward too.
  The cascade also corrupts task durations. Forward cascade is correct but needs the duration bug
  fixed. Backward moves should NOT cascade — they should expose slack/float instead.
- **Critical path has never worked**: The CPM computation in cpm.rs exists but has never produced
  correct results end-to-end. The frontend highlighting is broken. Scoped critical path (by
  project/workstream) drops dependency chains. The milestone scope option should be removed.
- **No schedule recalculation**: There is no way to snap tasks to their earliest possible dates.
  Professional scheduling tools (MS Project, P6) provide this as a core feature. We need
  recalculate-to-earliest with constraint support (SNET).
- **No task constraints**: Tasks have no constraint types. We need at minimum ASAP (default) and
  SNET (Start No Earlier Than) to support recalculate-to-earliest without destroying intentional
  task positioning.

This is collaborative software — multiple users edit the same schedule simultaneously via
CRDT sync. The engine runs in each user's browser (via WASM), not on a server. All changes
must produce deterministic results regardless of which client computes them.

### Agent Groups & File Ownership

```
Stage 1 (Engine — Rust, 3 groups parallel)
Group H (Cascade Fixes)         Group I (Critical Path)         Group L (Constraints + Recalc)
  crates/scheduler/              crates/scheduler/               crates/scheduler/
    src/cascade.rs                 src/cpm.rs                      src/constraints.rs
                                   src/graph.rs                    src/types.rs
                                   src/lib.rs (CP bindings)        src/lib.rs (recalc binding)
                                                                   src/date_utils.rs

Stage 2 (Frontend — TypeScript, 1 group)
Group J (Cascade UX + Recalculate UI)
  src/components/gantt/TaskBar.tsx
  src/components/gantt/CascadeHighlight.tsx
  src/components/shared/ContextMenu.tsx
  src/components/layout/Toolbar.tsx
  src/state/ganttReducer.ts
  src/utils/schedulerWasm.ts
  src/types/index.ts

Stage 3 (Frontend — TypeScript, 1 group, after J merges)
Group K (Critical Path UI + Float Viz)
  src/components/gantt/GanttChart.tsx
  src/components/gantt/DependencyLayer.tsx
  src/components/gantt/SlackIndicator.tsx
  src/components/gantt/MilestoneMarker.tsx
  src/components/layout/Toolbar.tsx
  src/state/ganttReducer.ts
  src/utils/schedulerWasm.ts
  src/types/index.ts
```

Stage 1 has zero file overlap between H, I, and L except for lib.rs (see contract below).
Stages 2 and 3 run sequentially — K builds on J's merged output — so shared files are safe.

### Interface Contract (Stage 1 — lib.rs)

Both Group I and Group L add WASM bindings to `lib.rs`. To avoid conflicts:
- Group I: only modifies `compute_critical_path_scoped()` (updated return type with edges)
- Group L: only adds a new `recalculate_earliest()` function at the end of the file
- Neither group modifies the other's functions

### Group H: Cascade Bug Fix + Asymmetric Cascade

Smallest group — just two fixes to cascade.rs. Agent should be fast.

**H1: Fix cascade duration bug**
- [ ] In `cascade.rs`, ensure cascade only shifts start_date and end_date by the delta
- [ ] Duration must NEVER change — verify by computing duration before and after
- [ ] Add test: cascade preserves duration for all downstream tasks

**H2: Implement asymmetric cascade**
- [ ] Forward moves (positive delta): push dependents forward (current behavior, keep)
- [ ] Backward moves (negative delta): return empty results — do NOT cascade to dependents
- [ ] The frontend will handle slack visualization separately using `compute_earliest_start()`
- [ ] Add tests: forward cascade pushes; backward move returns empty vec

**H3: Commit and verify**
- [ ] `cd crates/scheduler && cargo test` — all tests pass
- [ ] `cd crates/scheduler && cargo clippy` — no warnings

Execution: H1 → H2 → H3

### Group I: Fix Critical Path Calculation & Scoping

All work in cpm.rs and graph.rs. CriticalPathScope is defined in cpm.rs (not types.rs).

**I1: Debug and fix critical path computation**
- [ ] Write failing test: linear chain A→B→C→D, verify all 4 are critical
- [ ] Write failing test: diamond A→B, A→C, B→D, C→D with different durations, verify correct path
- [ ] Debug forward/backward passes — trace ES/EF/LS/LF for test cases
- [ ] Fix float calculation: ensure tasks on the longest path have float ≈ 0
- [ ] Verify fix: all failing tests now pass

**I2: Fix scoped critical path for project and workstream**
- [ ] Diagnose why scoped computation drops the chain — likely cross-scope dependency filtering
- [ ] Fix: when filtering tasks by project/workstream, include all dependencies between filtered tasks
- [ ] Test: project-scoped CP returns correct chain within that project
- [ ] Test: workstream-scoped CP returns correct chain within that workstream

**I3: Remove milestone scope option**
- [ ] Remove `Milestone` variant from `CriticalPathScope` enum in `cpm.rs`
- [ ] Remove milestone BFS-backward logic from `compute_critical_path_scoped()`
- [ ] Update `compute_critical_path_scoped()` to handle only Project and Workstream
- [ ] Update WASM binding in `lib.rs` if return type changes

**I4: Add critical dependency identification**
- [ ] Extend `compute_critical_path()` to also return critical edges (dependency arrows)
- [ ] Critical dependency = both from_task and to_task are on the critical path
- [ ] Return as `Vec<(String, String)>` (from_id, to_id) alongside critical task IDs
- [ ] Update the `compute_critical_path_scoped` WASM binding in `lib.rs` to return edges

**I5: Comprehensive test suite + verify**
- [ ] Test: empty project returns empty critical path
- [ ] Test: single task is always critical
- [ ] Test: parallel paths — only longest is critical
- [ ] Test: task with slack is NOT critical
- [ ] Test: adding lag to a dependency can change the critical path
- [ ] Test: scoped CP for project with internal dependencies only
- [ ] Test: scoped CP for workstream
- [ ] `cd crates/scheduler && cargo test` — all pass
- [ ] `cd crates/scheduler && cargo clippy` — no warnings

Execution: I1 → I2 → I3 → I4 → I5

### Group L: SNET Constraint + Recalculate-to-Earliest

New scheduling features in types.rs, constraints.rs, lib.rs, and date_utils.rs.

**L1: Add SNET (Start No Earlier Than) constraint**
- [ ] Add `constraint_type` and `constraint_date` optional fields to Task in `types.rs`
- [ ] Define `ConstraintType` enum with only two variants: `ASAP` (default) and `SNET`
- [ ] Update `compute_earliest_start()` in `constraints.rs` to respect SNET — floor ES at constraint date
- [ ] Add tests: task with SNET constraint returns correct earliest start

**L2: Implement recalculate-to-earliest**
- [ ] New function `recalculate_earliest(tasks, scope, today_date) -> Vec<RecalcResult>` in `constraints.rs`
- [ ] Add `RecalcResult` struct to `types.rs`: `{ id, new_start, new_end }`
- [ ] Scope: single task (+ all dependents), workstream, or project
- [ ] Runs forward pass to compute ES for each task in scope
- [ ] Snaps each task to its ES, but floors at `today_date` (never schedule in the past)
- [ ] Preserves task durations — only start/end dates change
- [ ] Respects SNET constraints — task won't move earlier than its constraint date
- [ ] Add tests: recalculate snaps to earliest; respects today floor; respects SNET

**L3: WASM binding + verify**
- [ ] Add `recalculate_earliest` WASM binding at end of `lib.rs`
- [ ] `cd crates/scheduler && cargo test` — all tests pass
- [ ] `cd crates/scheduler && cargo clippy` — no warnings

Execution: L1 → L2 → L3

### Group J: Cascade UX + Recalculate UI (Stage 2)

Runs after Stage 1 merges. Has full ownership of all frontend files — no parallel conflicts.

**J1: Update cascade behavior in reducer**
- [ ] Update CASCADE_DEPENDENTS in `ganttReducer.ts` to check delta direction
- [ ] Forward cascade (positive delta): apply shifted dates + show cascade highlight (existing behavior)
- [ ] Backward move (negative delta): do NOT apply shifts to dependents (WASM returns empty)
- [ ] Update `CascadeHighlight` to show the cascade animation for forward moves only

**J2: Add recalculate action to reducer**
- [ ] New action: `RECALCULATE_EARLIEST` with scope (task ID, workstream, project, or all)
- [ ] Add `recalculateEarliest()` wrapper to `schedulerWasm.ts`
- [ ] Call WASM `recalculate_earliest()` with today's date
- [ ] Apply returned date changes to all affected tasks
- [ ] Trigger summary date recalculation after
- [ ] Add to undo stack

**J3: Add recalculate to context menu**
- [ ] Right-click task → "Recalculate to earliest"
- [ ] Right-click workstream row → "Recalculate workstream"
- [ ] Right-click project row → "Recalculate project"
- [ ] Each dispatches `RECALCULATE_EARLIEST` with appropriate scope

**J4: Add recalculate button to toolbar**
- [ ] Add "Recalculate All" button to toolbar (next to existing controls)
- [ ] Dispatches `RECALCULATE_EARLIEST` with project-wide scope
- [ ] Brief animation or toast confirming the recalculation ran

**J5: Extend cascade highlight duration**
- [ ] Increase cascade highlight from 2 seconds to 10 seconds
- [ ] Clear highlight early if the same user makes another edit
- [ ] Ensure recalculate also shows highlight on affected tasks

**J6: Commit and verify**
- [ ] `npx tsc --noEmit` — compiles
- [ ] `npm run test` — all unit tests pass
- [ ] `npm run format:check && npm run lint` — clean

Execution: J1 → J2 → J3 → J4 → J5 → J6

### Group K: Critical Path UI + Float Visualization (Stage 3)

Runs after J merges. Has full ownership of all frontend files — no parallel conflicts.
Builds on J's changes to ganttReducer.ts, schedulerWasm.ts, Toolbar.tsx, and types/index.ts.

**K1: Update critical path rendering**
- [ ] Add `computeCriticalPathScoped()` wrapper update to `schedulerWasm.ts` — returns task IDs + edges
- [ ] Update `GanttChart.tsx` to pass critical dependency edges to `DependencyLayer`
- [ ] Update `DependencyLayer.tsx` to highlight critical dependency arrows (red, thicker)
- [ ] Ensure the full chain from first task to last task is visually connected

**K2: Remove milestone from critical path scope**
- [ ] Remove milestone option from scope dropdown in Toolbar.tsx
- [ ] Update `CriticalPathScope` type in `types/index.ts` — remove milestone variant
- [ ] Update reducer `SET_CRITICAL_PATH_SCOPE` if needed

**K3: Implement float/slack visualization**
- [ ] After a backward move exposes slack, show a lighter-shaded ghost bar on each dependent
      extending from its new earliest possible start to its current start
- [ ] Create or update `SlackIndicator.tsx` to render the slack window on affected task bars
- [ ] Slack indicator appears after backward moves and clears on next edit
- [ ] Use `computeEarliestStart()` WASM call to determine the slack window size

**K4: Ensure critical path highlights full chain**
- [ ] Verify TaskBar renders red highlight for all critical tasks (not just some)
- [ ] Verify DependencyLayer renders red arrows for all critical edges
- [ ] Test with multi-level hierarchies — critical path should flow through leaf tasks only
- [ ] Remove any MilestoneMarker critical path rendering that depends on removed milestone scope

**K5: Commit and verify**
- [ ] `npx tsc --noEmit` — compiles
- [ ] `npm run test` — all unit tests pass
- [ ] `npm run format:check && npm run lint` — clean

Execution: K1 → K2 → K3 → K4 → K5

### Validation Agent (runs automatically after final merge)

**Checks:**
- [ ] V1: WASM build (`npm run build:wasm`)
- [ ] V2: Rust scheduler tests (`cd crates/scheduler && cargo test`)
- [ ] V3: TypeScript compilation (`npx tsc --noEmit`)
- [ ] V4: Unit tests (`npm run test`)
- [ ] V5: Format + lint (`npm run format:check && npm run lint`)
- [ ] V6: Critical path test — create a linear chain, verify all tasks highlighted as critical
- [ ] V7: Cascade test — move task forward, verify dependents shift; move task back, verify dependents stay
- [ ] V8: Recalculate test — scatter tasks with slack, recalculate, verify they snap to earliest
- [ ] V9: Milestone scope removed — verify dropdown only shows project and workstream options

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
