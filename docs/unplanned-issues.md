# Unplanned Issues

Triage buffer for issues not yet assigned to a phase. A planning agent picks
items from **Backlog**, moves them to **Claimed**, and once planned into
`docs/TASKS.md` + `CLAUDE.md`, moves them to **Planned**.

## Rules (agents MUST follow these)
1. Claim up to 3 items at a time by moving them to **Claimed** with your agent ID.
2. Plan each item into `docs/TASKS.md` under the appropriate phase.
3. Move planned items to **Planned** with a reference to the phase/group/task.
4. Do not modify items claimed by another agent.
5. A user may add new items to **Backlog** at any time.

---

## Backlog
<!-- Add new issues here. One per line, prefixed with `- [ ]`. -->
- [ ] Bug: Presence/user icons blink in and out rapidly (~2x/sec) during multi-user sessions on deployed Google Cloud instance. Two accounts in different tabs — presence starts stable then degrades into rapid flicker. Accompanied by console error: `Uncaught Error: Unexpected end of array` in minified bundle (`index-DdRucPbz.js:49`). Likely a Yjs/awareness decode failure causing reconnect loops. May be related to Phase 11 presence fixes (awareness re-announce, per-client storage in room.rs).
- [ ] Feature: Broadcast cascade highlighting to other collaborators. When a user triggers a cascade, show the shading animation on all connected clients (not just the originating client). Could use Yjs awareness or a transient CRDT field to broadcast affected task IDs + originating user.
- [ ] Feature: Additional constraint types — ALAP, SNLT, FNET, FNLT, MSO, MFO. Needed for professional scheduling parity with MS Project / P6.
- [ ] Feature: Negative float / conflict detection — when hard constraints (MSO, MFO) conflict with dependency logic, flag the conflict visually (red indicator on task bar) rather than silently producing an impossible schedule.
- [ ] Feature: Calendar support — working days vs calendar days, skip weekends, holiday definitions. Duration calculations currently assume all days are workdays. Needs project calendar, task calendar, and resource calendar support.
- [ ] Feature: SF (Start-to-Finish) dependency type — currently only FS, SS, FF are supported.
- [ ] Infra: Promotable artifacts — make frontend/relay images deployable across environments without rebuilding. Currently `VITE_COLLAB_URL` (`src/collab/yjsProvider.ts:5`) and `VITE_GOOGLE_CLIENT_ID` (`src/sheets/oauth.ts:51`) are compiled into the bundle at build time via `import.meta.env.VITE_*`. To promote one image from dev → staging → prod, these must become runtime config. Approaches: (1) inject a `window.__ganttlet_config` object via a `<script>` tag served by the Go static server, populated from Cloud Run env vars at startup; or (2) fetch `/config.json` on app init, served by the Go binary from env vars. The Go server (`deploy/frontend/main.go`) already serves the frontend — it can template or serve config. The relay image is already promotable (config comes from env vars). See `docs/cloud-verification-plan.md` "Promotable artifacts" constraint and Step 4.
- [ ] Infra: Single-artifact deployment pipeline — update `deploy.yml` and deploy scripts to build once and promote through environments. Currently `deploy.yml` rebuilds images per environment (`deploy/frontend/cloudbuild.yaml` runs `vite build` with environment-specific `.env.production`). After the promotable artifacts issue is resolved (runtime config), restructure the pipeline to: (1) build frontend and relay images once, tag with git SHA, push to a shared Artifact Registry; (2) deploy the same image to dev with dev-specific Cloud Run env vars; (3) after dev verification (Steps 1–3 of cloud-verification-plan.md) passes, deploy the same tagged image to staging with staging env vars; (4) after staging verification (Step 5), promote to prod via manual `workflow_dispatch`. This ensures what's tested is exactly what's deployed. Depends on the promotable artifacts issue above. See CLAUDE.md "Promotable artifacts" constraint.

## Claimed
<!-- Agents move items here while planning. Format: `- [AGENT_ID] description` -->


## Planned
<!-- Agents move items here after planning into docs/TASKS.md. Format: `- [x] description → Phase X, Group Y, Task Z` -->


---

## Archive
