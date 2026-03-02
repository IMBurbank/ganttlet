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

## Phase 7: Hierarchy Enforcement, Task Movement & UX Improvements (DONE)
Completed across three parallel agent groups. All merged to main.

---

## Phase 8: Bug Fixes, OKR Enhancement, Cascade UX & Deployment
Fixes Phase 7 regressions, adds OKR picker, improves cascade visuals, adds E2E testing, and deploys to Google Cloud.
See `CLAUDE.md` for interface contracts and file ownership.

### Group A: Table Editing Fix + OKR Enhancement
**Files**: `src/components/table/InlineEdit.tsx`, `src/components/table/TaskRow.tsx`, `src/components/table/TaskTable.tsx`, `src/data/fakeData.ts`, `src/components/shared/OKRPickerModal.tsx` (new)
**Branch**: `feature/phase8-table-okr`

- [ ] **A1**: Fix cell editability bug (P0)
  - Reproduce by testing each cell type in the dev server
  - In `InlineEdit.tsx`: ensure `autoEdit` effect only triggers on `true` transitions, not on prop cycling
  - In `TaskTable.tsx`: delay `CLEAR_FOCUS_NEW_TASK` by two animation frames for reliability
  - In `TaskRow.tsx`: verify `readOnly` is ONLY on `workStream` (for tasks) and `project` (for tasks + workstreams) — no other cells affected
  - Add regression test that all non-inherited cells remain editable by role

- [ ] **A2**: Populate OKR seed data in `fakeData.ts`
  - Add OKRs to workstream summary tasks (currently all `okrs: []`):
    - `pe`: `["KR: API p99 latency < 200ms", "KR: Zero-downtime migration", "KR: 99.9% uptime SLA"]`
    - `ux`: `["KR: User satisfaction > 4.5/5", "KR: Ship design system v2", "KR: WCAG 2.1 AA compliance"]`
    - `gtm`: `["KR: 20% market share increase", "KR: 3x website conversion rate", "KR: 50 published content pieces"]`
  - Verify every leaf task has at least one OKR from its parent workstream's set

- [ ] **A3**: Create OKR picker modal + wire into TaskRow
  - New file: `src/components/shared/OKRPickerModal.tsx`
  - Multi-select picker showing parent workstream's OKRs (via `findWorkstreamAncestor()`)
  - Dispatches `UPDATE_TASK_FIELD` with `field: 'okrs'`
  - In `TaskRow.tsx`: replace OKR cell's `InlineEdit` with a click handler opening the picker

- [ ] **A4**: Tests
  - Editability regression test: verify each cell type is editable/read-only as expected per hierarchy role
  - OKR inheritance test: verify new tasks inherit parent workstream OKRs

**Execution**: A1 → A2 → A3 → A4

---

### Group B: Critical Path Fixes + Cascade UX
**Files**: `crates/scheduler/src/cpm.rs`, `crates/scheduler/src/types.rs`, `crates/scheduler/src/lib.rs`, `src/utils/schedulerWasm.ts`, `src/components/gantt/CascadeHighlight.tsx`, `src/components/gantt/GanttChart.tsx`, `src/state/ganttReducer.ts`, `src/types/index.ts`, `src/state/GanttContext.tsx`, `src/state/actions.ts`
**Branch**: `feature/phase8-critpath-cascade`

- [ ] **B1**: Fix critical path highlighting (P1)
  - In `cpm.rs` line 226: remove `(has_predecessors || has_successors)` guard so all zero-float tasks are marked critical
  - Update Rust test `standalone_task_not_critical` — a task that determines the project end IS critical
  - Run `cargo test` to verify

- [ ] **B2**: Fix workstream critical path crash (P0)
  - Wrap ALL WASM wrapper functions in `schedulerWasm.ts` with try-catch, return safe defaults on error
  - Debug-log the scope object to verify serde deserialization matches between TS and Rust
  - Verify workstream scope no longer crashes

- [ ] **B3**: Rebuild WASM + verify
  - Run `npm run build:wasm` after Rust changes
  - Run `cargo test` for Rust tests
  - Verify critical path in browser

- [ ] **B4**: Replace cascade highlight with shadow trail (P2)
  - Add `CascadeShift` type to `src/types/index.ts`: `{ taskId: string; fromStartDate: string; fromEndDate: string }`
  - Add `cascadeShifts: CascadeShift[]` to `GanttState`
  - Add `SET_CASCADE_SHIFTS` action to `src/state/actions.ts`
  - In `ganttReducer.ts` `CASCADE_DEPENDENTS` handler: capture pre-cascade dates for affected tasks
  - In `GanttChart.tsx`: read `cascadeShifts`, compute original X via `dateToXCollapsed`, pass to CascadeHighlight
  - In `CascadeHighlight.tsx`: render gradient shadow from original→current position, fade over 2s
  - In `GanttContext.tsx`: auto-clear cascade shifts after 2s

- [ ] **B5**: Tests
  - Rust: critical path marks all zero-float tasks, workstream scope filters correctly
  - Vitest: WASM wrapper returns empty set on error (not crash), cascade shift state is populated

**Execution**: B1 → B2 → B3 (rebuild WASM) → B4 → B5

---

### Group C: Testing + Deployment (after A+B merge)
**Files**: `playwright.config.ts` (new), `e2e/` (new directory), `deploy/frontend/` (new directory), `package.json` (Playwright dep)

- [ ] **C1**: Playwright setup
  - Install Playwright, create config targeting `localhost:5173`, add `"e2e"` script to package.json

- [ ] **C2**: Critical E2E tests
  - `e2e/gantt.spec.ts`: cell editing works, critical path highlights full chain, workstream scope doesn't crash, arrow connectivity

- [ ] **C3**: Frontend deployment (Firebase Hosting)
  - `firebase.json` with SPA rewrite rule
  - `deploy/frontend/deploy.sh`: runs `npm run build` → `firebase deploy --only hosting`
  - Environment config: `VITE_COLLAB_URL` for relay server

- [ ] **C4**: Production environment config
  - Update `deploy/cloudrun/deploy.sh` `ALLOWED_ORIGINS` for Firebase URL
  - Document OAuth redirect URI setup
  - Create `deploy/README.md` with full deployment pipeline

**Execution**: C1 → C2 → C3 → C4

---

### Execution Order
```
Stage 1 (parallel):     Group A (worktree)  ──┐
                         Group B (worktree)  ──┤
                                               ├── merge to main
Stage 2 (sequential):   Group C (from main) ──┘
```

### Verification (after A+B merge)
1. `npx tsc --noEmit` + `npm run test` pass
2. All table cells editable (except inherited project/workStream)
3. OKR picker shows workstream OKRs, selection persists
4. Critical path highlights full chain for project scope
5. Workstream critical path scope works without crash
6. Cascade shows shadow trail from original → current position

### Verification (after C merge)
1. `npx playwright test` runs successfully
2. `npm run build` produces valid `dist/`
3. Deployment scripts documented and executable

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
