# Completed Phases & Architecture Details

This file preserves detailed design notes from completed phases for reference.
See [CLAUDE.md](/CLAUDE.md) for the active project guide.

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

## Plugin Adoption — DONE
Added Claude Code plugins, protective hooks, and automated code review to the CI pipeline. See `docs/plugin-adoption-plan.md` for the full plan and decision log.
- **Plugins**: `github`, `rust-analyzer-lsp`, `typescript-lsp`, `code-review` — configured in `.claude/settings.json`
- **Protective hooks**: PreToolUse hooks block edits to `package-lock.json`, `src/wasm/scheduler/`, `.env`; block `git push` to `main`
- **Dockerfile**: Added `rust-analyzer` (rustup component) and `typescript-language-server` (npm global) to dev stage
- **agent-work.yml**: OAuth token auth, plugin install steps (cached), review-fix loop (max 3 iterations with progress comments on PR), complexity-based budgets, stale branch cleanup, workflow run link on issue
- **pr-review.yml**: New workflow for non-agent PRs — runs `/code-review` on open/synchronize, skips agent branches and drafts
- **Validated**: Docker build, LSP binaries, plugin loading, full CI pipeline (issues #2, #7, #9 → PRs created, reviewed, merged)
