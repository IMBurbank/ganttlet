# Task Queue

Claimable tasks for multi-agent development.
**Convention**: write your agent/branch name next to `[x]` when you claim a task.

---

## Phase 11: Testing Infrastructure & Presence Fix — DONE
See `docs/completed-phases.md` for details.

---

## Phase 12: Scheduling Engine Overhaul — DONE
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
- [x] In `cascade.rs`, ensure cascade only shifts start_date and end_date by the delta
- [x] Duration must NEVER change — verify by computing duration before and after
- [x] Add test: cascade preserves duration for all downstream tasks

**H2: Implement asymmetric cascade**
- [x] Forward moves (positive delta): push dependents forward (current behavior, keep)
- [x] Backward moves (negative delta): return empty results — do NOT cascade to dependents
- [x] The frontend will handle slack visualization separately using `compute_earliest_start()`
- [x] Add tests: forward cascade pushes; backward move returns empty vec

**H3: Commit and verify**
- [x] `cd crates/scheduler && cargo test` — all tests pass
- [x] `cd crates/scheduler && cargo clippy` — no warnings

Execution: H1 → H2 → H3

### Group I: Fix Critical Path Calculation & Scoping

All work in cpm.rs and graph.rs. CriticalPathScope is defined in cpm.rs (not types.rs).

**I1: Debug and fix critical path computation**
- [x] Write failing test: linear chain A→B→C→D, verify all 4 are critical
- [x] Write failing test: diamond A→B, A→C, B→D, C→D with different durations, verify correct path
- [x] Debug forward/backward passes — trace ES/EF/LS/LF for test cases
- [x] Fix float calculation: ensure tasks on the longest path have float ≈ 0
- [x] Verify fix: all failing tests now pass

**I2: Fix scoped critical path for project and workstream**
- [x] Diagnose why scoped computation drops the chain — likely cross-scope dependency filtering
- [x] Fix: when filtering tasks by project/workstream, include all dependencies between filtered tasks
- [x] Test: project-scoped CP returns correct chain within that project
- [x] Test: workstream-scoped CP returns correct chain within that workstream

**I3: Remove milestone scope option**
- [x] Remove `Milestone` variant from `CriticalPathScope` enum in `cpm.rs`
- [x] Remove milestone BFS-backward logic from `compute_critical_path_scoped()`
- [x] Update `compute_critical_path_scoped()` to handle only Project and Workstream
- [x] Update WASM binding in `lib.rs` if return type changes

**I4: Add critical dependency identification**
- [x] Extend `compute_critical_path()` to also return critical edges (dependency arrows)
- [x] Critical dependency = both from_task and to_task are on the critical path
- [x] Return as `Vec<(String, String)>` (from_id, to_id) alongside critical task IDs
- [x] Update the `compute_critical_path_scoped` WASM binding in `lib.rs` to return edges

**I5: Comprehensive test suite + verify**
- [x] Test: empty project returns empty critical path
- [x] Test: single task is always critical
- [x] Test: parallel paths — only longest is critical
- [x] Test: task with slack is NOT critical
- [x] Test: adding lag to a dependency can change the critical path
- [x] Test: scoped CP for project with internal dependencies only
- [x] Test: scoped CP for workstream
- [x] `cd crates/scheduler && cargo test` — all pass
- [x] `cd crates/scheduler && cargo clippy` — no warnings

Execution: I1 → I2 → I3 → I4 → I5

### Group L: SNET Constraint + Recalculate-to-Earliest

New scheduling features in types.rs, constraints.rs, lib.rs, and date_utils.rs.

**L1: Add SNET (Start No Earlier Than) constraint**
- [x] Add `constraint_type` and `constraint_date` optional fields to Task in `types.rs`
- [x] Define `ConstraintType` enum with only two variants: `ASAP` (default) and `SNET`
- [x] Update `compute_earliest_start()` in `constraints.rs` to respect SNET — floor ES at constraint date
- [x] Add tests: task with SNET constraint returns correct earliest start

**L2: Implement recalculate-to-earliest**
- [x] New function `recalculate_earliest(tasks, scope, today_date) -> Vec<RecalcResult>` in `constraints.rs`
- [x] Add `RecalcResult` struct to `types.rs`: `{ id, new_start, new_end }`
- [x] Scope: single task (+ all dependents), workstream, or project
- [x] Runs forward pass to compute ES for each task in scope
- [x] Snaps each task to its ES, but floors at `today_date` (never schedule in the past)
- [x] Preserves task durations — only start/end dates change
- [x] Respects SNET constraints — task won't move earlier than its constraint date
- [x] Add tests: recalculate snaps to earliest; respects today floor; respects SNET

**L3: WASM binding + verify**
- [x] Add `recalculate_earliest` WASM binding at end of `lib.rs`
- [x] `cd crates/scheduler && cargo test` — all tests pass
- [x] `cd crates/scheduler && cargo clippy` — no warnings

Execution: L1 → L2 → L3

### Group J: Cascade UX + Recalculate UI (Stage 2)

Runs after Stage 1 merges. Has full ownership of all frontend files — no parallel conflicts.

**J1: Update cascade behavior in reducer**
- [x] Update CASCADE_DEPENDENTS in `ganttReducer.ts` to check delta direction
- [x] Forward cascade (positive delta): apply shifted dates + show cascade highlight (existing behavior)
- [x] Backward move (negative delta): do NOT apply shifts to dependents (WASM returns empty)
- [x] Update `CascadeHighlight` to show the cascade animation for forward moves only

**J2: Add recalculate action to reducer**
- [x] New action: `RECALCULATE_EARLIEST` with scope (task ID, workstream, project, or all)
- [x] Add `recalculateEarliest()` wrapper to `schedulerWasm.ts`
- [x] Call WASM `recalculate_earliest()` with today's date
- [x] Apply returned date changes to all affected tasks
- [x] Trigger summary date recalculation after
- [x] Add to undo stack

**J3: Add recalculate to context menu**
- [x] Right-click task → "Recalculate to earliest"
- [x] Right-click workstream row → "Recalculate workstream"
- [x] Right-click project row → "Recalculate project"
- [x] Each dispatches `RECALCULATE_EARLIEST` with appropriate scope

**J4: Add recalculate button to toolbar**
- [x] Add "Recalculate All" button to toolbar (next to existing controls)
- [x] Dispatches `RECALCULATE_EARLIEST` with project-wide scope
- [x] Brief animation or toast confirming the recalculation ran

**J5: Extend cascade highlight duration**
- [x] Increase cascade highlight from 2 seconds to 10 seconds
- [x] Clear highlight early if the same user makes another edit
- [x] Ensure recalculate also shows highlight on affected tasks

**J6: Commit and verify**
- [x] `npx tsc --noEmit` — compiles
- [x] `npm run test` — all unit tests pass
- [x] `npm run format:check && npm run lint` — clean

Execution: J1 → J2 → J3 → J4 → J5 → J6

### Group K: Critical Path UI + Float Visualization (Stage 3)

Runs after J merges. Has full ownership of all frontend files — no parallel conflicts.
Builds on J's changes to ganttReducer.ts, schedulerWasm.ts, Toolbar.tsx, and types/index.ts.

**K1: Update critical path rendering**
- [x] Add `computeCriticalPathScoped()` wrapper update to `schedulerWasm.ts` — returns task IDs + edges
- [x] Update `GanttChart.tsx` to pass critical dependency edges to `DependencyLayer`
- [x] Update `DependencyLayer.tsx` to highlight critical dependency arrows (red, thicker)
- [x] Ensure the full chain from first task to last task is visually connected

**K2: Remove milestone from critical path scope**
- [x] Remove milestone option from scope dropdown in Toolbar.tsx
- [x] Update `CriticalPathScope` type in `types/index.ts` — remove milestone variant
- [x] Update reducer `SET_CRITICAL_PATH_SCOPE` if needed

**K3: Implement float/slack visualization**
- [x] After a backward move exposes slack, show a lighter-shaded ghost bar on each dependent
      extending from its new earliest possible start to its current start
- [x] Create or update `SlackIndicator.tsx` to render the slack window on affected task bars
- [x] Slack indicator appears after backward moves and clears on next edit
- [x] Use `computeEarliestStart()` WASM call to determine the slack window size

**K4: Ensure critical path highlights full chain**
- [x] Verify TaskBar renders red highlight for all critical tasks (not just some)
- [x] Verify DependencyLayer renders red arrows for all critical edges
- [x] Test with multi-level hierarchies — critical path should flow through leaf tasks only
- [x] Remove any MilestoneMarker critical path rendering that depends on removed milestone scope

**K5: Commit and verify**
- [x] `npx tsc --noEmit` — compiles
- [x] `npm run test` — all unit tests pass
- [x] `npm run format:check && npm run lint` — clean

Execution: K1 → K2 → K3 → K4 → K5

### Validation Agent (runs automatically after final merge)

**Checks:**
- [x] V1: WASM build (`npm run build:wasm`)
- [x] V2: Rust scheduler tests (`cd crates/scheduler && cargo test`)
- [x] V3: TypeScript compilation (`npx tsc --noEmit`)
- [x] V4: Unit tests (`npm run test`)
- [x] V5: Format + lint (`npm run format:check && npm run lint`)
- [x] V6: Critical path test — create a linear chain, verify all tasks highlighted as critical
- [x] V7: Cascade test — move task forward, verify dependents shift; move task back, verify dependents stay
- [x] V8: Recalculate test — scatter tasks with slack, recalculate, verify they snap to earliest
- [x] V9: Milestone scope removed — verify dropdown only shows project and workstream options

---

## Phase 13: Agent Infrastructure Improvements

Improve the multi-agent orchestration system based on recommendations from
`docs/agent-orchestration-recommendations.md`. Single stage with 4 parallel groups
(zero file overlap) + validation.

### Context

After 12 phases of multi-agent development, several patterns of agent failure have been
identified: retry context poverty (agents restart blind after crashes), missing behavioral
guardrails (agents delete tests or produce stubs under pressure), context window exhaustion
(oversized CLAUDE.md and verbose hooks), thin GitHub issue pipeline (no templates, no retry,
generic prompts), and weak progress observability (no progress files, no stall detection).

This phase addresses all of these with infrastructure improvements that benefit all future
agent work — both orchestrated phases and issue-driven single-agent work.

### Agent Groups & File Ownership

```
Stage 1 (Infrastructure — 4 groups, parallel, zero file overlap)

Group A (CLAUDE.md + Skills)           Group B (Orchestrator)
  CLAUDE.md                              scripts/launch-phase.sh
  .claude/skills/*/SKILL.md
  docs/architecture.md (new)
  docs/multi-agent-guide.md (new)

Group C (Hooks & Guardrails)           Group D (GitHub Pipeline)
  scripts/verify.sh                      .github/workflows/agent-work.yml
  scripts/pre-commit-hook.sh (new)       .github/workflows/agent-gate.yml (new)
  .claude/settings.local.json            .github/ISSUE_TEMPLATE/agent-task.yml (new)
```

No file overlap between any groups. All 4 run in parallel.

### Group A: CLAUDE.md Restructure + Skills Pattern

Restructure project knowledge for optimal agent context usage.

**A1: Audit current CLAUDE.md and plan content mapping**
- [ ] Read current CLAUDE.md (210 lines), map each section to destination

**A2: Create reference docs**
- [ ] Create `docs/architecture.md` with extracted architecture content
- [ ] Create `docs/multi-agent-guide.md` with extracted multi-agent content

**A3: Create skill files (8 skills, with "Lessons Learned" sections in orchestration/workflow/shell skills)**
- [ ] `.claude/skills/scheduling-engine/SKILL.md`
- [ ] `.claude/skills/e2e-testing/SKILL.md`
- [ ] `.claude/skills/multi-agent-orchestration/SKILL.md` — must include Lessons Learned (PIPESTATUS, heredoc quoting, stdout pollution, etc.)
- [ ] `.claude/skills/google-sheets-sync/SKILL.md`
- [ ] `.claude/skills/cloud-deployment/SKILL.md`
- [ ] `.claude/skills/issue-workflow/SKILL.md` — must include Lessons Learned (shell injection, max-turns, PR body structure)
- [ ] `.claude/skills/rust-wasm/SKILL.md`
- [ ] `.claude/skills/shell-scripting/SKILL.md` — cross-cutting bash gotchas (pipe exit codes, heredoc quoting, pipefail, sed placeholders, stdout pollution, tee vs script)

**A4: Rewrite CLAUDE.md to lean core (~110-130 lines)**
- [ ] Behavioral rules at top, error protocol, commands, constraints, workflow, conservation

**A5: Verify completeness**
- [ ] No content lost — everything exists in lean core, skill, or reference doc

Execution: A1 → A2 → A3 → A4 → A5

### Group B: Orchestrator Improvements (launch-phase.sh)

Harden the multi-agent orchestrator with better retry, observability, and resilience.

**B1: Enrich retry context**
- [ ] Inject last 80 lines of log + progress file into retry prompt
- [ ] Improve validation retry with structured error extraction

**B2: Add --max-turns and --max-budget-usd**
- [ ] Add flags to all claude invocations (run_agent, build_claude_cmd, validate)

**B3: Enrich merge conflict context**
- [ ] Inject conflict diffs and branch commit summaries into merge-fix prompt

**B4: Partial stage success**
- [ ] Track succeeded/failed groups; merge successful groups, skip failed

**B5: Preflight checks**
- [ ] Clean git state, prompt files exist, WASM builds

**B6: Model selection**
- [ ] Support MODEL env var passed through to --model flag

**B7: Stall detection watchdog**
- [ ] Monitor log file growth; warn if no activity for 30 minutes

Execution: B1 → B2 → B3 → B4 → B5 → B6 → B7

### Group C: Hooks & Guardrails

Reduce hook noise and enforce code quality deterministically.

**C1: Agent-scope awareness in verify.sh**
- [ ] AGENT_SCOPE env var (rust, ts, full) routes verification appropriately

**C2: Output deduplication**
- [ ] Same result as previous run → 1-line summary instead of full output

**C3: Rate limiting**
- [ ] 30-second cooldown between verify.sh runs

**C4: Compact output format**
- [ ] Error count + first 5 errors for tsc; pass count or failure list for vitest

**C5: Pre-commit hook**
- [ ] `scripts/pre-commit-hook.sh` rejects todo!(), unimplemented!(), commented-out tests

**C6: Validate settings**
- [ ] Verify .claude/settings.local.json still works after verify.sh changes

Execution: C1 → C2 → C3 → C4 → C5 → C6

### Group D: GitHub Pipeline

Build a robust issue-to-PR pipeline for single-agent work.

**D1: Issue template**
- [ ] `.github/ISSUE_TEMPLATE/agent-task.yml` with summary, acceptance criteria, scope, files, complexity

**D2: Issue quality gate**
- [ ] `.github/workflows/agent-gate.yml` validates issues before agent launch

**D3: Overhaul agent-work.yml**
- [ ] Rich prompt construction with env vars (not template interpolation)
- [ ] Retry loop (2 attempts with error context)
- [ ] --max-turns and --max-budget-usd
- [ ] .agent-summary.md for PR body
- [ ] Complexity-based config from labels

Execution: D1 → D2 → D3

### Validation Agent (runs automatically after final merge)

**Checks:**
- [ ] V1: CLAUDE.md structure (100-150 lines, correct sections)
- [ ] V2: Skills directory (≥6 skills with YAML frontmatter)
- [ ] V3: Reference docs exist (architecture.md, multi-agent-guide.md)
- [ ] V4: Content completeness (nothing lost from original CLAUDE.md)
- [ ] V5: launch-phase.sh syntax (`bash -n`)
- [ ] V6: launch-phase.sh features (retry context, --max-turns, merge context, partial success, preflight, model, watchdog)
- [ ] V7: verify.sh syntax + features (scope, dedup, rate limit, compact output)
- [ ] V8: Pre-commit hook syntax + logic
- [ ] V9: Issue template (all required fields)
- [ ] V10: GitHub workflows (gate + overhauled agent-work)
- [ ] V11: Build verification (WASM, tsc, vitest, cargo test)
- [ ] V12: Settings JSON valid

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
