# Task Queue

Claimable tasks for multi-agent development.
**Convention**: write your agent/branch name next to `[x]` when you claim a task.

---

## Phase 11: Testing Infrastructure & Presence Fix (PENDING)
Single stage, three parallel agent groups, then automated validation.
Run `./scripts/launch-phase.sh all` for the full pipeline:
stage1 (E+F+G parallel) → merge → validate (fix-and-retry until all checks pass)

**Context**: Presence/highlighting is broken after Phase 10. An initial server-side fix has been
applied to ws.rs (buffering binary messages during auth), but it is NOT sufficient — presence
is still broken. Group E must diagnose the full end-to-end awareness flow and fix all root causes.

### Agent Groups & File Ownership

```
Group E (Presence Diagnosis/Fix + Tests)  Group F (Playwright E2E Tests)           Group G (CI Pipeline for E2E)
  server/src/ws.rs                         e2e/collab.spec.ts (new)                .github/workflows/ci.yml
  server/src/room.rs                       e2e/tooltip.spec.ts (new)               .github/workflows/e2e.yml (new)
  server/tests/ws_auth_test.rs (new)       e2e/helpers/collab-harness.ts (new)
  server/tests/awareness_test.rs (new)     playwright.config.ts
  server/Cargo.toml (dev-deps only)        package.json (scripts only)
  src/collab/yjsProvider.ts
  src/collab/awareness.ts
```

Zero file overlap confirmed. No interface contracts needed between groups.

### Group E: Diagnose & Fix Presence + Server Integration Tests

Presence/highlighting is broken after Phase 10. The initial server-side fix (buffering binary
messages during auth) is NOT sufficient. This group must diagnose the full awareness flow
end-to-end (client → server → other clients), fix all root causes, and add integration tests
that prove awareness works.

**E1: Verify the existing ws.rs fix compiles**
- [ ] Run `cargo check` and `cargo test` in server/ to confirm AuthResult changes work
- [ ] Fix any compilation errors

**E2: Diagnose the full presence flow end-to-end**
- [ ] Add tracing to ws.rs and room.rs to trace awareness message flow
- [ ] Test locally with two browser tabs, read server logs
- [ ] Determine: are awareness messages arriving? being stored? relayed to other clients?
- [ ] Document findings in a code comment

**E3: Fix the root cause(s)**
Likely candidates (investigate all):
- [ ] Client-side: force awareness re-announce after auth succeeds (yjsProvider.ts)
- [ ] Server-side: ensure last_awareness is properly stored and relayed to late joiners (room.rs)
- [ ] Timing: verify replay happens correctly relative to send_task spawn (ws.rs)
- [ ] Client-side: ensure setLocalAwareness runs when WS is actually connected

**E4: Add integration test for auth flow with pre-auth binary messages**
- [ ] Create `server/tests/ws_auth_test.rs`
- [ ] Test: binary messages sent before auth are buffered and replayed (not dropped)
- [ ] Test: auth timeout after 5 seconds closes connection
- [ ] Test: empty token is rejected with error
- [ ] Add `tokio-tungstenite` and `futures-util` to `[dev-dependencies]`

**E5: Add integration test for awareness relay**
- [ ] Create `server/tests/awareness_test.rs`
- [ ] Test: awareness from client A is received by client B
- [ ] Test: late joiner receives awareness state
- [ ] Test: presence works with the auth-then-awareness flow (exact production sequence)

**E6: Commit and verify**
- [ ] `cd server && cargo test` — all tests pass
- [ ] `npx tsc --noEmit` — TypeScript changes compile

Execution: E1 → E2 → E3 → E4 → E5 → E6

### Group F: Playwright E2E Tests for Collaboration & Core UI

**F1: Add `test:e2e` npm script and update Playwright config**
- [ ] Add `"test:e2e": "npx playwright test"` to package.json scripts
- [ ] Update playwright.config.ts: expect timeout, traces, retries

**F2: Create collaboration test harness**
- [ ] Create `e2e/helpers/collab-harness.ts` with `createCollabPair()` utility
- [ ] Handles two browser contexts connecting to same page
- [ ] Includes `isCollabAvailable()` check for graceful skipping

**F3: Create collaboration E2E tests**
- [ ] Create `e2e/collab.spec.ts`
- [ ] Test: presence indicators appear for connected users
- [ ] Test: task edit in one tab propagates to the other
- [ ] Test: single-user mode works without relay

**F4: Create tooltip E2E test**
- [ ] Create `e2e/tooltip.spec.ts`
- [ ] Test: hovering over task bar shows tooltip without console errors
- [ ] Test: moving mouse away hides tooltip

**F5: Run and verify**
- [ ] `npm run test:e2e` passes (collab tests skip if no relay)
- [ ] Existing gantt.spec.ts tests still pass

Execution: F1 → F2 → F3 → F4 → F5

### Group G: CI Pipeline for E2E Tests

**G1: Add Playwright E2E workflow**
- [ ] Create `.github/workflows/e2e.yml` — separate workflow for E2E tests
- [ ] Install Playwright browsers, build WASM, run tests
- [ ] Upload report and traces as artifacts

**G2: Verify server integration tests run in CI**
- [ ] Confirm `cd server && cargo test` in ci.yml picks up new integration tests
- [ ] Update to `cargo test --all-targets` if needed

**G3: Commit and verify**
- [ ] Commit with descriptive message

Execution: G1 → G2 → G3

### Validation Agent (runs automatically after merge)

A dedicated agent runs all checks, fixes any failures, and produces a final report.
Runs up to 3 fix-and-retry cycles. See `docs/prompts/validate.md` for the full spec.

**Checks (V1–V10):**
- [ ] V1: Server compilation + server tests (including new ws_auth and awareness tests)
- [ ] V2: TypeScript compilation
- [ ] V3: Vitest unit tests
- [ ] V4: WASM build
- [ ] V5: Rust scheduler tests
- [ ] V6: E2E tests WITHOUT relay (collab tests skip, tooltip tests pass)
- [ ] V7: E2E tests WITH relay (presence test MUST pass — this is the key gate)
- [ ] V8: All new files exist
- [ ] V9: ws.rs presence fix is in place
- [ ] V10: yjsProvider has awareness re-announce

**Fix-and-retry**: If any check fails, the validation agent diagnoses the root cause,
applies a fix, commits it, and re-runs. Up to 3 full cycles.

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
