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
