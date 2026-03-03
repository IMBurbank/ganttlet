# Task Queue

Claimable tasks for multi-agent development.
**Convention**: write your agent/branch name next to `[x]` when you claim a task.

---

## Phase 9: Deployment Hardening, Cascade Bug Fix & UX Polish (DONE)
Three parallel agent groups (all independent, no sequential stage needed). All merged to main.

### Agent Groups & File Ownership

```
Group A (UX Polish)                    Group B (Cascade Bug Fix)              Group C (Deployment Hardening)
  src/components/layout/Header.tsx       src/components/table/TaskRow.tsx        deploy/frontend/ (rewrite w/ Go)
  src/components/panels/UserPresence.tsx src/components/gantt/TaskBar.tsx        deploy/cloudrun/ (IAP + Cloud Armor)
  src/state/GanttContext.tsx             src/components/gantt/TaskBarPopover.tsx deploy/README.md
                                         src/state/__tests__/ganttReducer.test.ts firebase.json (delete)
                                                                                server/src/auth.rs
                                                                                server/Cargo.toml
```

Zero file overlap confirmed. No interface contracts needed between groups.

### Group A: UX Polish

**A1: Add share button to Header.tsx**
- [x] Add "Share" button in header controls (after SyncStatusIndicator, before Google sign-in)
- [x] Use `navigator.clipboard.writeText(window.location.href)` on click
- [x] Show "Copied!" feedback for ~2s via local state
- [x] Style consistently with existing header buttons (text-xs, text-text-secondary, hover patterns)

**A2: Remove fake user presence icons**
- [x] In UserPresence.tsx: remove the fallback block that renders fake users when collab is disconnected — return null instead
- [x] In GanttContext.tsx: change `users: fakeUsers` to `users: []` in initialState
- [x] Remove `fakeUsers` from import (keep fakeTasks, fakeChangeHistory, defaultColumns)

Execution: A1 then A2

### Group B: Cascade Bug Fix

Root cause: `CASCADE_DEPENDENTS` is only dispatched when `startDate` changes (task moves). When `endDate` changes (via end-date edit or duration change) or when resizing a bar, no cascade is dispatched. The Rust cascade engine works fine — the bug is entirely in the dispatch call sites.

**B1: Fix TaskRow.tsx — cascade on end-date and duration changes**
- [x] `handleDateUpdate` endDate branch: add CASCADE_DEPENDENTS dispatch after existing dispatches, compute endDelta via daysBetween
- [x] `handleDurationUpdate`: save task.endDate before computing newEndDate, add CASCADE_DEPENDENTS dispatch if endDelta !== 0

**B2: Fix TaskBar.tsx — cascade on resize**
- [x] Add `lastEndDate: string` to dragRef type
- [x] In onMouseMove resize path: store `dragRef.current.lastEndDate = newEndStr`
- [x] In onMouseUp: add else branch for resize mode, dispatch CASCADE_DEPENDENTS if endDelta !== 0

**B3: Fix TaskBarPopover.tsx — cascade on end-date change**
- [x] In saveField endDate branch: add CASCADE_DEPENDENTS dispatch after existing dispatches

**B4: Add tests for cascade on duration/end-date changes**
- [x] Test: cascade dependents when end date increases (positive delta)
- [x] Test: cascade dependents when duration decreases (negative delta)

Execution: B1 → B2 → B3 → B4

### Group C: Deployment Hardening

**C1: Replace Firebase Hosting with Go static file server**
- [x] Create deploy/frontend/main.go: net/http.FileServer with SPA fallback, security headers, structured logging
- [x] Create deploy/frontend/go.mod (stdlib only)
- [x] Create deploy/frontend/Dockerfile: multi-stage (node → golang → distroless)
- [x] Rewrite deploy/frontend/deploy.sh for Cloud Run deployment
- [x] Delete firebase.json

**C2: Add health check / readiness probe endpoints**
- [x] GET /healthz → 200 OK (liveness)
- [x] GET /readyz → check dist/index.html exists, 503 if not (readiness)

**C3: Replace reqwest with hyper in relay server**
- [x] In server/Cargo.toml: replace reqwest with hyper, hyper-util, hyper-rustls, http-body-util, bytes
- [x] In server/src/auth.rs: replace Client::new() + .get() + .bearer_auth() with hyper-util legacy::Client HTTPS calls

**C4: Add IAP configuration**
- [x] Create deploy/cloudrun/iap-setup.sh: enable IAP API, document manual OAuth consent steps

**C5: Configure Cloud Armor WAF rules**
- [x] Create deploy/cloudrun/cloud-armor.sh: security policy with rate limiting, OWASP CRS (SQLi + XSS)

Execution: C1 → C2, then C3 (independent), then C4 → C5

---

## Phase 10: Architecture Hardening (PENDING)
Two stages, four parallel agent groups. Run `./scripts/launch-phase.sh all` for the full pipeline:
stage1 (A+B parallel) → merge1 → stage2 (C+D parallel) → merge2

### Stage 1: Security Hardening

```
Group A (CORS Hardening + Bug Fix)      Group B (Token Auth Flow)
  server/src/main.rs                      server/src/ws.rs
  server/src/config.rs                    src/collab/yjsProvider.ts
  src/components/shared/Tooltip.tsx
```

Zero file overlap confirmed.

### Group A: CORS Hardening + Tooltip Bug Fix

**A1: Validate and reject permissive CORS origins**
- [ ] In `config.rs`: filter out `"*"` from allowed_origins, default to `["http://localhost:5173"]` if empty
- [ ] In `main.rs`: remove `CorsLayer::permissive()` fallback, always use strict allowlist
- [ ] Update unit tests: empty defaults to localhost, `"*"` rejected, comma-separated parsing

**A2: Fix Tooltip.tsx getBoundingClientRect crash**
- [ ] In `Tooltip.tsx`: capture `e.currentTarget.getBoundingClientRect()` synchronously before `setTimeout`, not inside it (React nullifies `e.currentTarget` after the handler returns)

Execution: A1 → A2

### Group B: Token Auth Flow

**B1: Move token from URL query to WebSocket auth message (client)**
- [ ] In `yjsProvider.ts`: remove `params: { token }`, send token as text message after connect

**B2: Move token validation into WebSocket handler (server)**
- [ ] In `ws.rs`: remove Query extraction, accept upgrade unconditionally
- [ ] Read first message as auth JSON, validate token, then join room
- [ ] Add 5-second timeout for auth message

Execution: B1 → B2

### Stage 2: Sheets Sync Hardening & CI/CD (after Stage 1 merge)

### Agent Groups & File Ownership

```
Group C (Sheets Sync + Yjs Hydration)    Group D (CI/CD + Agent Workflow)
  src/sheets/sheetsClient.ts               .github/workflows/ci.yml (new)
  src/sheets/sheetsSync.ts                 .github/workflows/deploy.yml (new)
  src/sheets/sheetsMapper.ts               .github/workflows/agent-work.yml (new)
  src/state/GanttContext.tsx                CLAUDE.md
  src/collab/yjsBinding.ts
```

Zero file overlap confirmed.

### Group C: Sheets Sync Hardening + Yjs Hydration

**C1: Add exponential backoff to Sheets API calls**
- [ ] In `sheetsClient.ts`: add `retryWithBackoff()` helper, wrap all API calls
- [ ] Config: 1s initial, 60s max, 5 attempts, +/- 20% jitter, respect Retry-After

**C2: Replace clear-then-write with update**
- [ ] In `sheetsClient.ts`: add `updateSheet()` using Sheets API values.update (PUT)
- [ ] In `sheetsSync.ts`: change `scheduleSave()` to use `updateSheet()`

**C3: Merge incoming Sheets data by task ID**
- [ ] In `sheetsSync.ts`: compare incoming tasks by ID instead of full replacement
- [ ] In `GanttContext.tsx`: add `MERGE_EXTERNAL_TASKS` reducer action

**C4: Propagate Sheets changes to Yjs**
- [ ] In `sheetsSync.ts`: call `applyTasksToYjs()` after detecting external changes

**C5: Hydrate Yjs from Sheets on init**
- [ ] In `yjsBinding.ts`: add `hydrateYjsFromTasks(doc, tasks)` function
- [ ] In `GanttContext.tsx`: load Sheets → connect collab → hydrate Yjs if empty → start polling

Execution: C1 → C2 → C3 → C4 → C5

### Group D: CI/CD Pipeline + Agent Workflow

**D1: CI pipeline**
- [ ] Create `.github/workflows/ci.yml`: PR checks (tsc, vitest, cargo test)

**D2: Deploy pipeline**
- [ ] Create `.github/workflows/deploy.yml`: build images, push to Artifact Registry, deploy staging

**D3: Agent workflow**
- [ ] Create `.github/workflows/agent-work.yml`: trigger on `agent-ready` label, run Claude Code

**D4: Update CLAUDE.md for single-agent work**
- [ ] Add branch naming, verification command, PR creation instructions

Execution: D1 → D2 → D3 → D4

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
