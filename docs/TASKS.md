# Task Queue

Claimable tasks for multi-agent development.
**Convention**: write your agent/branch name next to `[x]` when you claim a task.

Prior phases (0-13, 13a, Plugin Adoption) are complete. See `docs/completed-phases.md`.

---

## Phase 14: Drag Interaction Reliability & Sync Integrity

Fix fast-drag data corruption, arrow offset bugs, missing structural CRDT sync, and add
multi-user drag intent. Based on `docs/phase14-recommendations.md`.

### Context

Production bugs observed: fast click-and-drag corrupts task duration and dependencies, arrows
become offset. Investigation revealed structural sync gap: ADD_TASK, DELETE_TASK, and dependency
operations don't sync via Yjs at all. This phase fixes all data integrity issues and adds
awareness-based drag intent for multi-user UX.

### Agent Groups & File Ownership

```
Stage 1 (Core Fixes — 3 groups, parallel, zero file overlap)

Group A (Drag Throttle + Guard)         Group B (Duration + Sheets)
  src/components/gantt/TaskBar.tsx         src/state/ganttReducer.ts
  src/state/GanttContext.tsx               src/state/actions.ts
                                           src/types/index.ts
                                           src/utils/dateUtils.ts
                                           src/sheets/sheetsMapper.ts

Group C (Cascade Optimization)
  crates/scheduler/src/cascade.rs
  src/utils/schedulerWasm.ts

Stage 2 (Sync + Rendering — 2 groups, parallel, zero file overlap)

Group D (Atomic Drag + Struct Sync)     Group E (Arrow Rendering)
  src/collab/yjsBinding.ts               src/components/gantt/DependencyLayer.tsx
  src/state/GanttContext.tsx              src/components/gantt/DependencyArrow.tsx
  src/state/ganttReducer.ts               src/utils/dependencyUtils.ts
  src/state/actions.ts                    src/utils/layoutUtils.ts
  src/components/gantt/TaskBar.tsx         src/components/gantt/GanttChart.tsx

Stage 3 (Multi-User UX — 1 group)

Group F (Awareness Ghost Bar)
  src/collab/awareness.ts
  src/components/gantt/TaskBar.tsx
  src/components/gantt/GanttChart.tsx
  src/types/index.ts
```

### Group A: Drag Throttle + SET_TASKS Guard (R1, R3)

- [ ] A1: Read TaskBar.tsx, GanttContext.tsx, yjsBinding.ts
- [ ] A2: Split dispatch into localDispatch + collabDispatch
- [ ] A3: Add active drag tracking (activeDragRef)
- [ ] A4: Guard SET_TASKS during active drag
- [ ] A5: Throttle drag dispatch (RAF local, 100ms CRDT, final on mouseup)
- [ ] A6: Verify and finalize

### Group B: Duration Derivation + Semantics + Sheets (R2, R7, R9)

- [ ] B1: Read actions.ts, ganttReducer.ts, sheetsMapper.ts, types, dateUtils
- [ ] B2: Document duration semantics (calendar days comments)
- [ ] B3: Make newDuration optional on RESIZE_TASK payload
- [ ] B4: Compute duration from dates in reducer (MOVE_TASK, RESIZE_TASK, UPDATE_TASK_FIELD, ADD_TASK)
- [ ] B5: Audit businessDaysBetween usage (R7)
- [ ] B6: Sheets mapper — compute on write, ignore on read
- [ ] B7: Verify and finalize

### Group C: Cascade Optimization + Instrumentation (R8)

- [ ] C1: Read cascade.rs, types.rs, schedulerWasm.ts
- [ ] C2: Build adjacency list in cascade_dependents (HashMap)
- [ ] C3: Add new Rust tests (50+ tasks, orphans)
- [ ] C4: Add performance instrumentation in schedulerWasm.ts
- [ ] C5: Verify and finalize

### Group D: Atomic COMPLETE_DRAG + Structural CRDT Sync (R4, R10)

- [ ] D1: Read ALL files after Stage 1 merge
- [ ] D2: Add COMPLETE_DRAG action type
- [ ] D3: Add COMPLETE_DRAG handler to reducer + UNDOABLE_ACTIONS
- [ ] D4: Fix RESIZE_TASK Yjs case (compute duration) + Add COMPLETE_DRAG to Yjs
- [ ] D5: Update TaskBar mouseup to use COMPLETE_DRAG
- [ ] D6: Add COMPLETE_DRAG to TASK_MODIFYING_ACTIONS + export useAwareness
- [ ] D7: Add dependency operations to Yjs (ADD/UPDATE/REMOVE_DEPENDENCY)
- [ ] D8: Add useEffect diff for ADD_TASK/DELETE_TASK sync
- [ ] D9: Verify and finalize

### Group E: Arrow Render Consistency (R5)

- [ ] E1: Read DependencyLayer, DependencyArrow, dependencyUtils, layoutUtils, GanttChart
- [ ] E2: Fix consistency between taskYPositions and dependency data
- [ ] E3: Memoize getDependencyPoints
- [ ] E4: Ensure arrow path consistency (guard clauses)
- [ ] E5: Verify and finalize

### Group F: Drag Intent via Awareness / Ghost Bar (R6)

- [ ] F1: Read ALL files after Stage 2 merge
- [ ] F2: Extend awareness with drag intent (setDragIntent)
- [ ] F3: Extend CollabUser type with dragging field
- [ ] F4: Broadcast drag intent from TaskBar (100ms throttle)
- [ ] F5: Render ghost bars for remote drags
- [ ] F6: Verify and finalize

### Validation Agent (runs automatically after final merge)

- [ ] V1: Build verification (WASM, tsc, vitest, cargo test)
- [ ] V2: Drag throttle (R1) — RAF + 100ms broadcast
- [ ] V3: Dispatch split (R1) — localDispatch + collabDispatch
- [ ] V4: Duration derivation (R2, R7, R9) — computed from dates everywhere
- [ ] V5: SET_TASKS guard (R3) — active drag preserved
- [ ] V6: Atomic COMPLETE_DRAG (R4) — action + reducer + Yjs + TaskBar
- [ ] V7: Arrow rendering (R5) — guards + memoization
- [ ] V8: Ghost bar (R6) — awareness + rendering
- [ ] V9: Duration semantics (R7) — calendar days everywhere
- [ ] V10: Cascade optimization (R8) — adjacency list + instrumentation
- [ ] V11: Structural sync (R10) — dependency + add/delete sync
- [ ] V12: Cross-group consistency — all sets complete, no duplicate paths

---

## Phase 14 Follow-up: E2E Tests for Drag & Sync

E2E tests from `docs/phase14-recommendations.md` Section 5. Phase 14 fixes data integrity;
these tests verify the fixes under real browser + network conditions.

- [ ] Fast-drag duration preservation (Playwright, R1/R2)
- [ ] Concurrent drag + remote edit resilience (collab harness, R3/R4)
- [ ] Arrow endpoints match task bars after fast drag (visual, R5)
- [ ] Network latency simulation drag test (CDP throttling, R1/R3/R4)
- [ ] 200-task stress test with duration/dependency verification (perf, R1/R8)
- [ ] Cascade latency threshold assertion <16ms (E2E, R8)
- [ ] Ghost bar rendering for remote drag (collab harness, R6)
- [ ] Add task syncs to collaborator via CRDT within 2s (collab harness, R10)
- [ ] Delete task syncs to collaborator via CRDT within 2s (collab harness, R10)
- [ ] Add/remove dependency syncs to collaborator (collab harness, R10)
- [ ] Remove redundant duration dispatches from TaskBarPopover.tsx and TaskRow.tsx

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
