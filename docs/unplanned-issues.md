# Unplanned Issues

Triage buffer for issues not yet assigned to a phase. A planning agent picks
items from **Backlog**, moves them to **Claimed**, and once planned into
`docs/tasks/phaseN.yaml` + `CLAUDE.md`, moves them to **Planned**.

## Rules (agents MUST follow these)
1. Claim up to 3 items at a time by moving them to **Claimed** with your agent ID.
2. Plan each item into `docs/tasks/phaseN.yaml` under the appropriate phase.
3. Move planned items to **Planned** with a reference to the phase/group/task.
4. Do not modify items claimed by another agent.
5. A user may add new items to **Backlog** at any time.

---

## Backlog
<!-- Add new issues here. One per line, prefixed with `- [ ]`. -->

### Bugs

- [ ] Bug: Presence/user icons blink in and out rapidly (~2x/sec) during multi-user sessions on deployed Google Cloud instance. Two accounts in different tabs — presence starts stable then degrades into rapid flicker. Accompanied by console error: `Uncaught Error: Unexpected end of array` in minified bundle (`index-DdRucPbz.js:49`). Likely a Yjs/awareness decode failure causing reconnect loops. May be related to Phase 11 presence fixes (awareness re-announce, per-client storage in room.rs).

### Scheduling Engine

- [ ] Feature: Additional constraint types — ALAP, SNLT, FNET, FNLT, MSO, MFO. Needed for professional scheduling parity with MS Project / P6.
- [ ] Feature: Negative float / conflict detection — when hard constraints (MSO, MFO) conflict with dependency logic, flag the conflict visually (red indicator on task bar) rather than silently producing an impossible schedule. Depends on additional constraint types.
- [ ] Feature: Calendar support — working days vs calendar days, holiday definitions. Duration calculations currently assume all weekdays are workdays. Needs project calendar, task calendar, and resource calendar support.
- [ ] Feature: SF (Start-to-Finish) dependency type — currently only FS, SS, FF are supported. Intentionally dropped in Phase 1 as too rare, but noted for professional scheduling parity.
- [ ] Feature: Duration mode preference toggle — let users choose between calendar days and business days for duration display/calculation. Currently `duration` is always derived via `workingDaysBetween()` (business days, Mon-Fri) regardless of settings. Allow toggle per sheet, project, workstream or task.

### Collaboration & UX

- [ ] Feature: Broadcast cascade highlighting to other collaborators. When a user triggers a cascade, show the shading animation on all connected clients (not just the originating client). Could use Yjs awareness or a transient CRDT field to broadcast affected task IDs + originating user.
- [ ] Feature: Mobile/touch drag support — add `touchstart/touchmove/touchend` handlers parallel to mouse handlers. Requires `touch-action: none` CSS on the SVG canvas and single-touch tracking (ignore multi-touch pinch). Reuses same drag logic, date calculation, dispatch, and CRDT broadcast pipeline. Effort: 2-3 days. Identified in Phase 14 Section 8.1.

### Infrastructure & Deployment

- [ ] Infra: Clean up legacy deploy scripts — the manual deploy script (`deploy/frontend/deploy.sh`) still writes `.env.production` with `VITE_*` vars and rebuilds via Cloud Build, duplicating the CI pipeline. The CI pipeline (`deploy.yml`) already implements the promotable artifact pattern: one image built per SHA, config injected at deploy time via Cloud Run env vars (`GANTTLET_GOOGLE_CLIENT_ID` from `GOOGLE_CLIENT_ID_DEV`/`GOOGLE_CLIENT_ID_PROD` secrets, `GANTTLET_COLLAB_URL` derived from relay URL). The Go server serves `/config.js` setting `window.__ganttlet_config` at runtime (`deploy/frontend/main.go:31-35`), and client code (`src/collab/yjsProvider.ts:5`, `src/sheets/oauth.ts:101`) reads from it with `import.meta.env.VITE_*` fallback. Either update `deploy/frontend/deploy.sh` to use the same runtime config pattern (pass `--set-env-vars` instead of writing `.env.production`) or remove it in favor of CI-only deploys.
- [ ] Infra: Staging environment (ganttlet-staging GCP project) — create pre-production environment per `docs/cloud-verification-plan.md` Steps 4-5. Config in Secret Manager, OAuth consent set to "External (unverified)", full smoke tests and periodic OAuth flow verification. Add a `GOOGLE_CLIENT_ID_STAGING` secret and a staging deploy job to `deploy.yml` reusing the same SHA-tagged image. Add manual promotion gate (`workflow_dispatch`) for prod.
- [ ] Infra: Visual regression testing — add `expect(page).toHaveScreenshot()` assertions to E2E tests, store baselines in `e2e/__screenshots__/`, set `maxDiffPixels` threshold. Per `docs/cloud-verification-plan.md` Step 6. **Depends on: staging environment.**
- [ ] Infra: Periodic OAuth flow verification — automated test with real Google account (via refresh token) to catch OAuth consent/scope regressions. Per `docs/cloud-verification-plan.md` Step 6. **Depends on: staging environment.**

### Agent Infrastructure

- [x] Infra: Structured `.agent-status.json` for orchestrator polling — replaced plain-text `claude-progress.txt` with machine-readable JSON. CLAUDE.md, launch-phase.sh, skills, and group prompts all updated. Backward-compatible fallback to `claude-progress.txt` retained.
- [ ] Infra: Two-pass validation in orchestrator — split validation into diagnostic-then-fix passes to prevent fix-one-break-another cycles. Phase 13 §7, P2 priority. Current single-pass with retry is acceptable but suboptimal.
- [ ] Infra: Orchestrator dry-run / smoke-test mode — run orchestrator pipeline without actually executing agents to validate configuration, file assignments, and prompt construction. Phase 13 §11, P3 priority.

### Performance (Conditional)

- [ ] Perf: Web Worker for WASM cascade — only pursue if cascade latency routinely exceeds 32ms after Phase 14's adjacency list optimization (R8). Would require loading WASM in a dedicated Web Worker, serializing tasks across `postMessage` (~1-3ms overhead for 500 tasks), making drag completion asynchronous. Changes UX contract — cascade shifts would appear with slight delay after mouseup. Phase 14 instrumentation (`performance.mark/measure` in `crates/scheduler/src/cascade.rs`) provides the data to make this call. Effort: 3-5 days.

## Claimed
<!-- Agents move items here while planning. Format: `- [AGENT_ID] description` -->


## Planned
<!-- Agents move items here after planning into docs/tasks/phaseN.yaml. Format: `- [x] description → Phase X, Group Y, Task Z` -->


---

## Archive

### Resolved (previously in backlog, addressed in later phases or commits)
- [x] Promotable artifacts (runtime config) → Implemented: Go server serves `/config.js` with `window.__ganttlet_config` from env vars; `index.html` loads it; client code reads it; CI pipeline passes config via `--set-env-vars`. Only legacy manual deploy script still uses build-time `.env.production`.
- [x] Single-artifact deployment pipeline → Mostly done: `deploy.yml` builds one image per SHA, deploys to dev and prod with environment-specific env vars. Remaining: staging environment + manual promotion gate.
- [x] multi-agent-guide.md outdated (missing Group B features) → Fixed in Phase 13a Group E
- [x] CLAUDE.md missing pre-commit hook reference → Fixed in Phase 13a Group E
- [x] google-sheets-sync and cloud-deployment skills lightweight → Enriched in Phase 13a Group F
- [x] Plugin adoption M1/M2 OAuth token setup → Completed during Plugin Adoption phase
- [x] WATCH mode uses `-p` instead of interactive TUI → Accepted tradeoff (`--max-budget-usd` requires `-p` mode)
- [x] Right-size context budget via issue complexity labels → Implemented in `agent-work.yml:70-83` (large/complex→80 turns/$15, small→25/$3, default→50/$8)
