# Completed Phases & Architecture Details

This file preserves detailed design notes from completed phases for reference.
See [CLAUDE.md](/CLAUDE.md) for the active project guide.

## Phase Summary

| Phase | Name | Groups | Key Deliverable |
|-------|------|--------|-----------------|
| 0 | Promote ui-demo-2 to root | 1 | Project scaffold |
| 1 | Bug Fixes | 4 (1A-1D) | Cascade/drag/CPM/CRUD fixes |
| 2 | Testing Infrastructure | 1 | Vitest + 45 unit tests |
| 3 | Google Sheets Integration | 2 (3A-3B) | OAuth2 + Sheets sync |
| 4 | Real-Time Collaboration | 3 (4A-4C) | Yjs/Yrs CRDT + relay server |
| 5 | Rust WASM Scheduling Engine | 1 | CPM/cascade in Rust WASM |
| 6 | Gantt Chart UX | 3 | Undo/redo, weekend collapse, drag constraints |
| 7 | Hierarchy & Task Movement | 3 (A-C) | Reparenting, dependency validation |
| 8 | Bug Fixes + OKR + Deployment | 3 | Cascade shadow trail, E2E, Firebase+Cloud Run |
| 9 | Deployment Hardening + UX | 3 (A-C) | Static server, IAP, Cloud Armor |
| 10 | Architecture Hardening | 4 (A-D) | CORS, token auth, Sheets backoff, CI/CD |
| 11 | Testing + Presence Fix | 3 (E-G) | E2E harness, presence fix, CI pipeline |
| 12 | Scheduling Engine Overhaul | 5 (H-L) | Asymmetric cascade, SNET constraints, CPM fixes |
| 13 | Agent Infrastructure | 4 (A-D) | Skills, orchestrator, hooks, GitHub pipeline |
| 13a | Post-Implementation Cleanup | 2 (E-F) | Doc alignment, skill enrichment |
| Plugin | Plugin Adoption | — | LSP plugins, code review, protective hooks |
| 14 | Drag Reliability & Sync Integrity | 6 (A-F) | Dispatch split, atomic drag, CRDT structural sync |
| 15 | Scheduling Engine: Constraints & Conflicts | 4 (A-D) | All constraint types, SF deps, conflict detection, constraint UI |
| 16 | Date Calculation Bug Fixes | 9 (A-I) | Inclusive end_date convention, taskDuration, WEEKEND_VIOLATION, bar width |
| 18 | Onboarding UX | — | State machine, welcome flows, sheet management |
| 20 | Frontend Redesign | 10 (A-J) | Y.Doc state, TaskStore/UIStore, SheetsAdapter, virtualization, undo, drag perf |

---

## Core Features (Planned)
- **Interactive Gantt chart**: Drag to reschedule, resize to change duration, in-browser
- **Dependency management**: FS, FF, SS link types with lag/lead (SF dropped — too rare to justify complexity)
- **Critical Path Method (CPM)**: Auto-calculate early/late start/finish, total/free float
- **Cascade updates**: When a task date changes, all dependent tasks auto-update
- **Two-way Google Sheets sync**: Edit in Sheets or in the app; changes flow both directions
- **Real-time collaboration**: See other users' cursors and edits in near real-time (like Google Sheets)
- **WBS (Work Breakdown Structure)**: Hierarchical task grouping with summary tasks
- **Milestones**: Zero-duration markers for key dates
- **Resource assignment**: Basic resource tracking (stretch goal)

---

## Architecture Details

### Real-Time Collaboration
- Uses Yjs (browser) and Yrs (server) for CRDT-based real-time sync
- One Yrs document per room (room = Google Sheet ID)
- Fast path: User edit → Yjs update → WebSocket → relay → other clients (milliseconds)
- Slow path: Client debounces Yjs changes → writes to Google Sheets API (seconds)
- Yjs awareness protocol handles cursor/presence — ephemeral, never persisted

### Auth & Permissions
- Google OAuth2 provides identity (no separate user database)
- Google Drive sharing permissions are the ACL:
  - Sheet owner/editor → can edit in Ganttlet (writer role)
  - Sheet viewer → can view the live Gantt chart (reader role)
  - No access → connection refused
- Client sends Google access token on WebSocket connect
- Server validates token with Google, checks Drive permissions, assigns role
- Server never stores tokens — validates per connection

### Google Sheets Sync
- Client-side only — the server never reads or writes Sheets
- Each client reads/writes the Sheet using the user's own OAuth token
- Clients poll for external Sheet changes on a periodic interval (~30s)
- Google Sheets is the persistence layer — if the server goes down, no data is lost
- Google Sheets version history provides audit trail for free

### Deployment Model
- Same server binary for public and enterprise deployments, different config
- Enterprise (e.g., Google): runs inside corporate VPC, behind corporate auth, no data leaves the perimeter
- Public: hosted instance with standard Google OAuth
- Server config: bind address, allowed origins, Google OAuth client ID — nothing else

---

## Phase 0: Promote ui-demo-2 to root — DONE
- Copied ui-demo-2 src/, config files to workspace root
- Removed ui-demo-1/, ui-demo-2/, ui-demo-3/
- Package renamed to "ganttlet"

## Phase 1: Bug Fixes — DONE
- **1A**: Fix cascade/drag bug in TaskBar (incorrect delta on mouseUp)
- **1B**: Remove SF dependency type, fix CPM forward/backward pass for SS/FF
- **1C**: CPM engine corrections (store dep type in adjacency list)
- **1D**: Add/Delete task CRUD (ADD_TASK, DELETE_TASK actions, context menu, toolbar button)

## Phase 2: Testing Infrastructure — DONE
- Vitest + jsdom setup
- 45 unit tests for criticalPathUtils, dependencyUtils, summaryUtils, dateUtils, ganttReducer

## Phase 3: Google Sheets Integration — DONE
- **3A**: Google OAuth2 (Identity Services, PKCE flow, sign-in/sign-out)
- **3B**: Sheets sync (sheetsClient, sheetsMapper, sheetsSync, debounced write, polling)

## Phase 4: Real-Time Collaboration — DONE
- **4A**: Yjs client (yjsProvider, yjsBinding, awareness protocol)
- **4B**: Relay server (Rust axum + tokio WebSocket, room management, auth)
- **4C**: Integration testing (build + unit tests pass)

## Phase 5: Rust→WASM Scheduling Engine — DONE
Replaced the JS CPM utils with a Rust module compiled to WebAssembly (`crates/scheduler/`).
- CPM: topological sort, forward pass (ES/EF), backward pass (LS/LF), zero-float detection
- Cycle detection (`would_create_cycle`) via BFS reachability
- Cascade dependents (`cascade_dependents`) with date arithmetic
- All functions exposed via `#[wasm_bindgen]`, wired into React via `schedulerWasm.ts`
- Cloud Run deployment config in `deploy/cloudrun/`

## Phase 6: Gantt Chart UX Improvements — DONE
Ten UX fixes and features, split into three parallel agent groups with zero file overlap.
- Scoped critical path, undo/redo, cascade highlights, weekend collapse
- Drag constraints, slack indicators, collab sync fix, column close buttons, dependency modal fix
- Three parallel groups: WASM scheduler enhancements, state management + collab sync, UI + visual feedback

## Phase 7: Hierarchy Enforcement, Task Movement & UX Improvements — DONE
Ten issues completed across three parallel agent groups (A, B, C). All merged to main.
- Hierarchy enforcement (project > workstream > task), field consistency
- Task reparenting, dependency validation, auto-focus on new tasks
- Pane collapse shortcut, task bar popover, workstream critical path scope

## Phase 8: Bug Fixes, OKR Enhancement, Cascade UX & Deployment — DONE
All three groups completed and merged to main.
- Bug fixes: cell editability (P0 regression), workstream critical path crash (P0)
- OKR picker modal, seed data for workstream OKRs
- Cascade shadow trail (replaced jittery highlight), critical path highlighting fix
- Playwright E2E tests, Firebase Hosting + Cloud Run deployment

## Phase 9: Deployment Hardening, Cascade Bug Fix & UX Polish — DONE
Three parallel agent groups — all independent, no sequential stage needed.
- **Group A (UX Polish)**: Share button (copy URL to clipboard), remove fake user presence icons
- **Group B (Cascade Bug Fix)**: Dispatch CASCADE_DEPENDENTS on end-date edit, duration change, and bar resize across TaskRow, TaskBar, TaskBarPopover + reducer tests
- **Group C (Deployment Hardening)**: Go static file server replacing Firebase Hosting, hyper HTTP client replacing reqwest in relay server, IAP setup script, Cloud Armor WAF rules, health check endpoints
- **Post-merge fixes**: SERVICE_NAME leak between deploy scripts, CSP wasm-unsafe-eval, Cloud Run port/h2c config, OAuth setup docs, deploy/setup.sh project-by-name flow

## Phase 10: Architecture Hardening — DONE
Two-stage pipeline: stage 1 (A+B parallel) → merge → stage 2 (C+D parallel) → merge.
- **Group A (CORS Hardening)**: Removed `CorsLayer::permissive()` fallback, strict origin allowlist with `"*"` rejection, default to localhost; fixed Tooltip `getBoundingClientRect` crash (capture rect synchronously before setTimeout)
- **Group B (Token Auth)**: Moved OAuth token from WebSocket URL query param to post-connect auth message; server accepts upgrade unconditionally, reads first message as auth JSON with 5-second timeout
- **Group C (Sheets Sync)**: Exponential backoff with jitter for Sheets API (1s–60s, 5 attempts, Retry-After); atomic `values.update` replacing clear-then-write; merge incoming Sheets data by task ID instead of full replacement; propagate polling changes to Yjs; hydrate Yjs from Sheets on initialization
- **Group D (CI/CD)**: GitHub Actions CI workflow (tsc, vitest, cargo test on PRs); deploy pipeline (build images, push to Artifact Registry); agent-work workflow (trigger on `agent-ready` label, run Claude Code); updated CLAUDE.md with single-agent issue workflow

## Phase 11: Testing Infrastructure & Presence Fix — DONE
Single stage, three parallel agent groups (E+F+G) → merge → validation agent.
- **Group E (Presence Fix + Server Tests)**: Diagnosed full awareness flow end-to-end; fixed root causes in ws.rs, room.rs, yjsProvider.ts; added integration tests
- **Group F (Playwright E2E Tests)**: Added collaboration test harness, E2E tests, tooltip tests
- **Group G (CI Pipeline for E2E)**: Added Playwright E2E workflow, verified server integration tests run in CI

## Phase 12: Scheduling Engine Overhaul — DONE
Three-stage pipeline: stage 1 (H+I+L parallel) → merge → stage 2 (J) → merge → stage 3 (K) → merge → validation.
- **Group H (Cascade Fixes)**: Fixed cascade duration corruption bug; implemented asymmetric cascade (forward-only push, backward moves expose slack instead of cascading)
- **Group I (Critical Path)**: Debugged and fixed CPM forward/backward passes; fixed scoped critical path for project/workstream; removed milestone scope; added critical edge identification
- **Group L (Constraints + Recalc)**: Added SNET (Start No Earlier Than) constraint type; implemented recalculate-to-earliest with today-floor and constraint respect
- **Group J (Cascade UX + Recalculate UI)**: Updated cascade behavior for asymmetric cascade in reducer; added RECALCULATE_EARLIEST action with context menu and toolbar button; extended cascade highlight to 10 seconds
- **Group K (Critical Path UI + Float Viz)**: Updated critical path rendering with critical edge highlighting; removed milestone scope from UI; added float/slack visualization for backward moves

## Phase 13: Agent Infrastructure Improvements — DONE
Single stage with 4 parallel groups (zero file overlap) + validation. Implemented recommendations from `docs/agent-orchestration-recommendations.md`. All P0 and P1 items addressed. Post-implementation review: `docs/phase13-review.md`.
- **Group A (CLAUDE.md + Skills)**: Restructured CLAUDE.md to lean 113-line core with behavioral rules at top; extracted `docs/architecture.md` and `docs/multi-agent-guide.md`; created 8 skill files in `.claude/skills/` with YAML frontmatter and lessons learned sections
- **Group B (Orchestrator)**: Enhanced `scripts/launch-phase.sh` with enriched retry context (log tails + progress file), `--max-turns`/`--max-budget-usd` on all invocations, rich merge conflict context (diffs + branch summaries), partial stage success tracking, preflight checks, `MODEL` env var for model selection, stall detection watchdog
- **Group C (Hooks & Guardrails)**: Made `scripts/verify.sh` scope-aware via `AGENT_SCOPE` env var (rust/ts/full), added hash-based output deduplication, 30s rate limiting cooldown, compact output format; fixed pre-existing PIPESTATUS exit code bug; created `scripts/pre-commit-hook.sh` rejecting todo!()/unimplemented!()/commented-out tests
- **Group D (GitHub Pipeline)**: Created `.github/ISSUE_TEMPLATE/agent-task.yml` with structured fields; added `.github/workflows/agent-gate.yml` quality gate; overhauled `.github/workflows/agent-work.yml` with env-var-based prompt construction (shell injection protection), 2-attempt retry loop, complexity-based `--max-turns`/`--max-budget-usd`, `.agent-summary.md` PR body
- **Known issues**: WATCH mode uses `-p` (sparse text output) instead of interactive mode (rich TUI) — a regression from Phase 12. `docs/multi-agent-guide.md` doesn't reflect Group B's new features (written in parallel). See `docs/phase13-review.md` for full review.

## Phase 13a: Post-Implementation Cleanup — DONE
Two parallel groups fixing cross-group inconsistencies from Phase 13.
- **Group E (Doc Alignment)**: Updated `docs/multi-agent-guide.md` with Group B's new launch-phase.sh features (preflight, partial success, watchdog, model selection, resume); fixed WATCH mode description contradiction; added pre-commit hook reference to CLAUDE.md
- **Group F (Skill Enrichment)**: Enriched `google-sheets-sync` skill (data mapping, gotchas, failure modes) and `cloud-deployment` skill (troubleshooting, gcloud commands, promotion flow, deploy gotchas)

## Plugin Adoption — DONE
Added Claude Code plugins, protective hooks, and automated code review to the CI pipeline. See `docs/plugin-adoption-plan.md` for the full plan and decision log.
- **Plugins**: `github`, `rust-analyzer-lsp`, `typescript-lsp`, `code-review` — configured in `.claude/settings.json`
- **Protective hooks**: PreToolUse hooks block edits to `package-lock.json`, `src/wasm/scheduler/`, `.env`; block `git push` to `main`
- **Dockerfile**: Added `rust-analyzer` (rustup component) and `typescript-language-server` (npm global) to dev stage
- **agent-work.yml**: OAuth token auth, plugin install steps (cached), review-fix loop (max 3 iterations with progress comments on PR), complexity-based budgets, stale branch cleanup, workflow run link on issue
- **pr-review.yml**: New workflow for non-agent PRs — runs `/code-review` on open/synchronize, skips agent branches and drafts
- **Validated**: Docker build, LSP binaries, plugin loading, full CI pipeline (issues #2, #7, #9 → PRs created, reviewed, merged)

## Phase 14: Drag Reliability & Sync Integrity — DONE
Addressed 10 recommendations (R1-R10) for drag interaction reliability and CRDT sync integrity. All 6 agent groups (A-F) implemented sequentially in one session to avoid merge conflicts. Four rounds of automated code review, all issues resolved. PR #14, squash-merged.
- **Group A (Drag Throttle + SET_TASKS Guard)**: Split dispatch into `localDispatch` (React-only, ~60fps via RAF) and `collabDispatch` (React + Yjs CRDT, 100ms throttle). Added `activeDragRef` + `guardedDispatch` to preserve dragged task dates when remote `SET_TASKS` arrives during drag.
- **Group B (Duration Derivation + Semantics)**: Made `duration` always derived from `daysBetween(startDate, endDate)` — never trusted from action payloads. Updated `MOVE_TASK`, `RESIZE_TASK`, `UPDATE_TASK_FIELD`, `ADD_TASK` reducer handlers. Sheets mapper computes duration on write, derives on read with legacy fallback.
- **Group C (Cascade Optimization)**: Replaced O(n) full-scan per cascade step with HashMap adjacency list in `crates/scheduler/src/cascade.rs`. Added `large_chain_cascade` (50-task chain) and `orphan_tasks_unaffected` Rust tests. Added `performance.mark/measure` instrumentation (dev-only).
- **Group D (Atomic Drag + Structural Sync)**: Added `COMPLETE_DRAG` action — atomic position set + cascade in one reducer pass with cascade highlight tracking. Replaced separate `MOVE_TASK` + `CASCADE_DEPENDENTS` on mouseup. Added `ADD_DEPENDENCY`, `UPDATE_DEPENDENCY`, `REMOVE_DEPENDENCY` to Yjs binding. Added `ADD_TASK`/`DELETE_TASK` full-sync triggers.
- **Group E (Arrow Render Consistency)**: Memoized `taskMap`, `visibleIds`, `criticalEdgeSet`, `arrows` in DependencyLayer. Added guard clauses for missing Y positions and missing from/to tasks.
- **Group F (Drag Intent / Ghost Bar)**: Extended Yjs awareness with drag intent (`setDragIntent`). Extended `CollabUser` type with `dragging` field. Ghost bars render as dashed outlines with collaborator name for remote drags. Date validation via `parseISO` + `isValid`.

## Phase 15: Scheduling Engine — Constraints, SF Deps & Conflict Detection — DONE
Three-stage pipeline: stage 1 (Group A) → merge → stage 2 (Groups B+C parallel) → merge → stage 3 (Group D) → merge → validate → PR. First phase using config-driven `launch-phase.sh` with supervisor orchestration. Two code review rounds, all issues resolved. PR #34, squash-merged.
- **Group A (Core Types + Constraint Engine)**: Extended `ConstraintType` enum with ALAP, SNLT, FNET, FNLT, MSO, MFO (8 total). Added `SF` to `DepType` (4 total: FS, FF, SS, SF). Implemented all constraint types in `constraints.rs` — ALAP schedules late via CPM backward pass, SNLT/FNLT flag conflicts, FNET/MSO/MFO push dates forward. SF handling in `compute_earliest_start` and CPM forward/backward pass.
- **Group B (SF Cascade + Conflict Detection)**: Implemented SF cascade logic in `cascade.rs`. Added `detect_conflicts()` function that identifies constraint violations (negative float, constraint date vs actual date mismatches). Added `ConflictResult` type with camelCase serde for WASM boundary.
- **Group C (TypeScript Types + Sheets Sync)**: Added `ConflictResult` interface to `types/index.ts` (camelCase to match Rust serde). Updated `sheetsMapper.ts` to read/write `constraintType` and `constraintDate` columns. Added `detectConflicts` WASM wrapper to `schedulerWasm.ts`.
- **Group D (Constraint UI + Conflict Indicator)**: Added `SET_CONSTRAINT` action and reducer handler. Constraint selector dropdown in `TaskBarPopover` and `TaskRow`. Red conflict indicator on `TaskBar` for constraint violations. SF dependency type option in `DependencyEditorModal` with correct arrowhead direction.
- **Orchestration improvements**: Fixed CLAUDECODE env var blocking nested sessions. Fixed merge script leaving `/workspace` on wrong branch. Added merge worktree isolation (PR #35). Added per-branch verification, stage timeouts, cleanup command (PR #36).

## Phase 16: Date Calculation Bug Fixes

Switched end_date convention from exclusive to inclusive across the entire codebase.

**Key changes:**
- Convention-encoding functions: `taskDuration`, `taskEndDate` (TS), `task_duration`, `task_end_date` (Rust)
- Shared dep-type helpers: `fs_successor_start`, `ss_successor_start`, `ff_successor_start`, `sf_successor_start`
- Migrated 14 `workingDaysBetween` callsites to `taskDuration`
- Fixed cascade FS formula, constraints FNET/FNLT/MFO, find_conflicts FF/SF
- Added WEEKEND_VIOLATION conflict detection
- Fixed bar width for inclusive convention
- Fixed Yjs UPDATE_TASK_FIELD duration sync (Bug 14)
- Renamed `dateToXCollapsed` → `dateToX` (weekend-aware default)
- Structural tests: cascade/recalculate agreement, cross-language consistency
- Pre-commit hook rejects deprecated function names

## Phase 18: Onboarding UX — DONE
State machine, welcome flows, and sheet management. Design-7 sync fixes (T1.1–T2.5, T3.1–T3.2) all implemented. 35 E2E tests, 584 unit tests passing. PR #70 + PR #75.

## Phase 20: Frontend Redesign — DONE
Complete frontend architecture redesign across 10 parallel groups (A-J).

**Core architecture changes:**
- **Group A (Y.Doc Schema)**: Y.Doc replaces useReducer for task state. `src/schema/ydoc.ts` defines Y.Map<Y.Map> structure with 19 collaborative fields per task. Stable UUIDs, JSON-serialized arrays for atomic updates.
- **Group B (TaskStore + UIStore)**: O(1) per-task subscriptions via `useSyncExternalStore`. TaskStore for task data, UIStore for per-user display state (zoom, theme, expanded tasks) persisted to localStorage. Replaces GanttContext.
- **Group C (Mutations)**: Compute-first + atomic transact pattern. Mutation functions read Y.Doc, compute cascade in WASM (outside transaction), write all changes in one `doc.transact()` call. Replaces ganttReducer task cases.
- **Group D (Observer)**: `src/collab/observer.ts` converts Y.Doc mutations into TaskStore updates. Origin-aware processing: local (sync), remote (batched via RAF), sheets (sync, skip cold derivations). Incremental summary recalculation.
- **Group E (SheetsAdapter)**: Service class replacing sheetsSync module. Three-way merge with base values in IndexedDB. Pre-write validation (non-blocking). Attribution columns (lastModifiedBy, lastModifiedAt).
- **Group F (Drag Performance)**: Pointer Events API + CSS transforms during drag (zero Y.Doc writes). Commit-on-drop pattern — single atomic write on mouseup.
- **Group G (SVG Virtualization)**: Viewport-based rendering for task bars and dependency arrows. React Compiler configuration.
- **Group H (Providers)**: TaskStoreProvider manages Y.Doc, TaskStore, mutations, undo, collab, SheetsAdapter lifecycle. UIStoreProvider manages per-user state with localStorage persistence.
- **Group I (Undo/Recovery)**: Y.UndoManager (per-client, scoped to 'local' origin). y-indexeddb for crash recovery. Error boundaries for component isolation. Pre-write validation.
- **Group J (Documentation)**: Updated all CLAUDE.md files, skills, agents, and architecture docs to reflect new architecture.
