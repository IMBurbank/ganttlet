# Cloud Verification Plan

## Context

Ganttlet has a solid local verification pipeline: `./scripts/full-verify.sh` runs tsc, vitest,
cargo test, and Playwright E2E (including collaboration tests with the relay server). This
catches functional regressions, type errors, and scheduling engine bugs before code is committed.

However, local E2E tests run against `ws://localhost:4000` with fake auth tokens
(`GANTTLET_TEST_AUTH=1`). They cannot catch:

- **TLS/WebSocket issues**: Production uses `wss://` through Cloud Run's TLS-terminating proxy.
  WebSocket upgrade behavior, connection timeouts, and keepalive semantics differ from localhost.
- **CORS in production**: The relay enforces `RELAY_ALLOWED_ORIGINS` against real origins, not
  `http://localhost:5173`.
- **Cold start latency**: Cloud Run scales to zero. The first WebSocket connection after a cold
  start may timeout or be dropped if the relay takes too long to boot.
- **OAuth token validation**: The real auth flow calls Google's userinfo and Drive APIs. Token
  refresh, expiry, and permission checks can't be tested with fake tokens.
- **Network/async bugs**: Latency between frontend and relay services on Cloud Run surfaces
  race conditions that don't appear on localhost.

This plan adds cloud-based verification in stages, each building on the previous one.

---

## GCP Project Layout

| Project | Purpose | OAuth Status | Used By |
|---------|---------|-------------|---------|
| **ganttlet-local** (existing) | Local development. OAuth configured for `localhost` origins. Used for manual two-browser testing against real Sheets with real accounts. | Testing | Developer machines |
| **ganttlet-dev** (existing) | Cloud Run deployment for integration testing. Currently configured in `.env.production` and the deploy workflow. Steps 1–3 target this project. | Testing → External (unverified) | CI, agents |
| **ganttlet-staging** (future) | Pre-production environment. Config stored in Secret Manager, not in repo. Full smoke tests and periodic OAuth flow verification. Steps 4–6 target this project. | External (unverified) | CI, agents, manual QA |
| **ganttlet-prod** (future) | Production. Deploy only via workflow_dispatch with manual approval. | External (verified, if needed) | End users |

---

## Prerequisites: One-Time Manual Setup

These tasks require human intervention (GCP Console, GitHub UI) and must be completed before
Steps 1–3 can run autonomously. An agent can create the service accounts via `gcloud`; the
human must create the test Sheet, set sharing permissions, and add GitHub secrets.

### Service Accounts

Create three service accounts in the ganttlet-dev GCP project. The collab tests run two
browsers simultaneously, and having two writers plus a reader enables a wider range of
verification scenarios: writer-to-writer collab (simultaneous editing), writer-to-reader
(permission asymmetry and read-only enforcement), and a spare writer for Sheets API smoke
tests that don't overlap with the collab test pair. The relay distinguishes
`DriveRole::Writer` vs `DriveRole::Reader` in `server/src/auth.rs`.

| Account | Example Email | Sheet Access | Purpose |
|---------|--------------|-------------|---------|
| `ci-writer-1` | `ci-writer-1@ganttlet-dev-XXXX.iam.gserviceaccount.com` | **Editor** | Primary writer in collab tests. Creates/edits tasks, triggers sync. Also used for Sheets API write smoke tests. |
| `ci-writer-2` | `ci-writer-2@ganttlet-dev-XXXX.iam.gserviceaccount.com` | **Editor** | Second writer for writer-to-writer collab tests (simultaneous editing, conflict resolution). |
| `ci-reader-1` | `ci-reader-1@ganttlet-dev-XXXX.iam.gserviceaccount.com` | **Viewer** | Read-only user. Verifies presence indicators appear, edits propagate, and write operations are correctly rejected. |

**Agent creates** (via `gcloud` in the dev container):
```bash
gcloud iam service-accounts create ci-writer-1 --display-name="CI Writer 1" --project=PROJECT_ID
gcloud iam service-accounts create ci-writer-2 --display-name="CI Writer 2" --project=PROJECT_ID
gcloud iam service-accounts create ci-reader-1 --display-name="CI Reader 1" --project=PROJECT_ID
gcloud iam service-accounts keys create ci-writer-1-key.json --iam-account=ci-writer-1@PROJECT_ID.iam.gserviceaccount.com
gcloud iam service-accounts keys create ci-writer-2-key.json --iam-account=ci-writer-2@PROJECT_ID.iam.gserviceaccount.com
gcloud iam service-accounts keys create ci-reader-1-key.json --iam-account=ci-reader-1@PROJECT_ID.iam.gserviceaccount.com
```

**Human does**:
1. Create a test Google Sheet (or designate an existing one) in the dev project.
2. Share it with `ci-writer-1@...` as **Editor**.
3. Share it with `ci-writer-2@...` as **Editor**.
4. Share it with `ci-reader-1@...` as **Viewer**.
5. Note the Sheet ID (from the URL: `docs.google.com/spreadsheets/d/{SHEET_ID}/...`).

### GitHub Secrets

**Human adds** these secrets to the GitHub repo (Settings → Secrets and variables → Actions):

| Secret Name | Value | Source |
|-------------|-------|--------|
| `GCP_SA_KEY_WRITER1_DEV` | Contents of `ci-writer-1-key.json` | Agent-generated key file |
| `GCP_SA_KEY_WRITER2_DEV` | Contents of `ci-writer-2-key.json` | Agent-generated key file |
| `GCP_SA_KEY_READER1_DEV` | Contents of `ci-reader-1-key.json` | Agent-generated key file |
| `TEST_SHEET_ID_DEV` | The test Sheet ID | From the Sheet URL |

### Dev Relay Configuration

**Human does** (or agent via `gcloud` if authenticated):

Deploy the dev relay with `GANTTLET_TEST_AUTH=1` so service account JWTs are accepted without
real Google token validation. This is acceptable for dev only — staging and production must
validate real tokens.

```bash
gcloud run services update ganttlet-relay \
  --update-env-vars="GANTTLET_TEST_AUTH=1" \
  --project=PROJECT_ID \
  --region=us-central1
```

---

## Step 1: Deploy to Dev + Health Check (no manual intervention)

**Target**: ganttlet-dev (existing Cloud Run project)

**Goal**: Confirm the deploy pipeline works and both Cloud Run services are alive after deploy.

**Motivation**: The deploy workflow (`deploy.yml`) builds and pushes images, but has no
post-deploy verification. A deploy could succeed (container starts) while the app is broken
(missing env var, bad WASM build, relay crash on first connection). A health check catches
these immediately.

**What to do**:

1. Add a `verify-dev` job to `deploy.yml` that runs after the dev deploy job. (Note: as of
   this writing, the workflow job is named `deploy-staging` but actually deploys to the
   ganttlet-dev project — this naming should be fixed as part of the pipeline rework.)
2. The job should:
   - Curl the relay health endpoint (`/health`) and assert 200.
   - Curl the frontend URL and assert 200 + check that the HTML contains expected markers
     (e.g., the root `<div id="root">` or a `<script>` tag with the WASM loader).
   - Attempt a WebSocket upgrade to the relay (`wss://{relay}/ws/health-check`) and verify
     the connection is accepted (it will be dropped after auth timeout, but the upgrade
     itself confirms TLS + routing work).
3. The frontend and relay URLs are outputs of the `gcloud run deploy` commands — capture them
   and pass to the verify job.

**Files to modify**:
- `.github/workflows/deploy.yml` — add verify job
- Optionally `scripts/smoke-test.sh` — standalone script agents can also run manually

**No auth required** — this step only tests that services are reachable and responding.

---

## Step 2: Service Account Smoke Tests (no manual intervention)

**Target**: ganttlet-dev

**Prerequisite**: One-time manual setup (above) must be complete — service accounts created,
test Sheet shared, GitHub secrets added, dev relay configured with `GANTTLET_TEST_AUTH=1`.

**Goal**: Verify Sheets API integration and relay WebSocket connectivity using service accounts.

**Motivation**: The app's core value prop is real-time collaboration on Google Sheets. Testing
only the UI without Sheets integration misses a huge category of bugs (schema mismatches,
API rate limits, permission errors). Service accounts let CI authenticate without interactive
OAuth sign-in or token babysitting.

**What to do**:

1. Write a script (`scripts/cloud-smoke-test.sh`) that:
   - Reads `GCP_SA_KEY_WRITER1_DEV`, `GCP_SA_KEY_WRITER2_DEV`, and `GCP_SA_KEY_READER1_DEV`
     from environment (provided by GitHub Actions secrets).
   - Uses each key to obtain an access token via Google's OAuth2 token endpoint.
   - For `ci-writer-1`:
     - Opens a WebSocket to the relay, sends the auth message, verifies the connection
       stays open (not rejected).
     - Calls the Sheets API to write a test value to the test sheet.
   - For `ci-reader-1`:
     - Opens a WebSocket to the relay, verifies connection with reader permissions.
     - Calls the Sheets API to read the test value back, verifying round-trip integrity.
     - Attempts a write and verifies it is rejected (read-only enforcement).
   - `ci-writer-2` is reserved for collab E2E tests in Step 3 (not used in smoke tests).
2. Add this script as a post-deploy step in the workflow after the Step 1 health check.

**Auth approach for the relay**: The dev relay runs with `GANTTLET_TEST_AUTH=1`, which
accepts any non-empty token. This tests the WebSocket infrastructure (TLS, connection
lifecycle, message relay) without requiring the relay to validate real Google tokens. The
service account tokens are still real — they authenticate to the Sheets API directly. For
staging/prod, the relay will validate tokens for real.

**Files to modify**:
- `scripts/cloud-smoke-test.sh` — new script
- `.github/workflows/deploy.yml` — add smoke test job after verify-dev

---

## Step 3: Full E2E Against Live Dev Deployment (no manual intervention)

**Target**: ganttlet-dev

**Prerequisite**: Steps 1 and 2 passing. Service accounts and test Sheet already configured.

**Goal**: Run the complete Playwright E2E suite (including collaboration tests) against the
live dev Cloud Run services, not localhost.

**Motivation**: This is the step that actually validates the things local E2E can't — real
TLS, real load balancer, real WebSocket through Cloud Run's proxy, real network latency. If
the collab tests pass against the live dev deployment, we have high confidence that the same
code will work in staging and production.

**Auth approach**: Use real service account tokens (Option C). The frontend is a standard
production build — identical across dev, staging, and prod. No build flags, no special modes.
The same artifact can be promoted between environments without rebuilding.

The `__ganttlet_setTestAuth` hook in `src/sheets/oauth.ts` only exists in dev-mode builds
(`import.meta.env.DEV`), so Cloud Run's production build doesn't expose it. Instead, the
E2E harness uses Playwright's `page.addInitScript()` to inject auth externally before the
app loads. This works by intercepting the Google Identity Services (GIS) library: the init
script replaces `google.accounts.oauth2.initTokenClient` with a stub that immediately calls
the app's token callback with the service account access token. From the app's perspective,
the normal OAuth flow completed — `handleTokenResponse` processes the token, sets `authState`,
calls `notifyAuthChange()`, and everything downstream works normally.

This means:
- The frontend code has zero test-specific paths in production builds
- Auth injection is purely a test infrastructure concern
- The same frontend image is promotable from dev → staging → prod

**What to do**:

1. Add env-var overrides to `playwright.config.ts` so that `baseURL` can point at the dev
   Cloud Run frontend URL instead of localhost. The relay URL does not need overriding —
   it's already baked into the production frontend build via `.env.production`. Playwright
   should NOT start its own webServers when running against cloud deployments (both Vite
   and relay are already running on Cloud Run).
2. Create a helper (e.g., `e2e/helpers/cloud-auth.ts`) that:
   - Reads service account key JSON from environment variables.
   - Exchanges the key for a Google access token via the OAuth2 token endpoint
     (`https://oauth2.googleapis.com/token`) using a JWT assertion.
   - Returns the access token string.
3. Update the collab harness to accept an optional auth mode. In cloud mode:
   - Call the cloud-auth helper to obtain real access tokens for each service account.
   - Use `page.addInitScript(token => { ... }, token)` to define a GIS mock before the app
     loads. The mock replaces `google.accounts.oauth2.initTokenClient` so that when the app
     calls it, the callback fires immediately with the service account token.
   - The app's `handleTokenResponse` processes the token normally — sets `authState`, fetches
     userinfo, calls `notifyAuthChange()`.
4. The collab tests use different account pairings depending on the scenario:
   - **Writer-to-reader** (default): `ci-writer-1` for pageA (editor), `ci-reader-1` for
     pageB (observer). Tests permission asymmetry — edits propagate from writer to reader,
     reader sees presence but cannot edit.
   - **Writer-to-writer**: `ci-writer-1` for pageA, `ci-writer-2` for pageB. Tests
     simultaneous editing, conflict resolution, and bidirectional sync.
5. Run the E2E suite in the deploy workflow after the smoke test passes.
6. Capture Playwright traces and screenshots on failure, upload as workflow artifacts.

**Environments and auth summary**:

| Environment | Frontend Build | Relay Auth | E2E Token Injection |
|-------------|---------------|------------|---------------------|
| Local E2E | `vite --mode e2e` (dev) | `GANTTLET_TEST_AUTH=1` | `__ganttlet_setTestAuth` hook (exists in dev builds) |
| Dev Cloud Run | `vite build` (production) | `GANTTLET_TEST_AUTH=1` | `page.addInitScript()` GIS mock with real SA tokens |
| Staging Cloud Run | `vite build` (production) | Real Google token validation | `page.addInitScript()` GIS mock with real SA tokens |
| Prod | `vite build` (production) | Real Google token validation | No E2E — manual QA only |

**Files to modify**:
- `e2e/helpers/cloud-auth.ts` — new helper: SA key → access token exchange
- `e2e/helpers/collab-harness.ts` — support cloud auth mode via `addInitScript` GIS mock
- `playwright.config.ts` — support `BASE_URL` env var override, skip webServers for cloud
- `.github/workflows/deploy.yml` — add E2E job after smoke test

---

## Step 4: Staging Project + Secret Manager (requires manual GCP Console work)

**Target**: ganttlet-staging (new project)

**Prerequisite**: The promotable artifacts migration must be complete before this step.
The frontend must read `GANTTLET_GOOGLE_CLIENT_ID` and `GANTTLET_COLLAB_URL` from runtime
config (served by the Go static server from Cloud Run env vars), not from compile-time
`VITE_*` vars. Without this, staging would require a separate frontend build, defeating
the single-artifact principle. See `docs/unplanned-issues.md` for the migration task.

**Goal**: Create a dedicated staging environment with config stored in the cloud, not in the
repo.

**Motivation**: Staging should mirror production as closely as possible. Checking in
`.env.staging` with OAuth client IDs and relay URLs defeats that purpose — it ties the
staging config to a specific commit and exposes infrastructure details in the repo. Secret
Manager (or Cloud Run env vars set via `gcloud`) keeps config out of the codebase.

**Manual steps required**:

1. Create the `ganttlet-staging` GCP project using `deploy/setup.sh`.
   - Link billing account.
   - Configure OAuth consent screen → **External (unverified)**. This avoids the 7-day
     refresh token expiry that "Testing" status imposes. The "unverified app" warning is
     irrelevant for test accounts.
   - Create an OAuth client ID for the staging frontend URL.
   - Add test users (your accounts + any QA accounts) on the consent screen.
   - Enable APIs: Cloud Run, Sheets, Drive, Artifact Registry, Secret Manager.
2. Set up Workload Identity Federation for the staging project (same pattern as dev).
3. Create `ci-writer-1`, `ci-writer-2`, and `ci-reader-1` service accounts (same pattern as
   dev prerequisites).
4. Create a test Google Sheet, share with all three service accounts (Editors/Viewer).
5. Store staging config as Cloud Run env vars (or Secret Manager):
   - **Frontend service env vars** (read by the Go static server, served to browser at
     runtime after the promotable artifacts migration — see `docs/unplanned-issues.md`):
     - `GANTTLET_GOOGLE_CLIENT_ID` (staging OAuth client ID)
     - `GANTTLET_COLLAB_URL` (staging relay WebSocket URL)
   - **Relay service env vars** (already runtime-configured):
     - `RELAY_ALLOWED_ORIGINS` (staging frontend URL)
   - Note: Until the promotable artifacts migration is complete, the frontend still uses
     `VITE_GOOGLE_CLIENT_ID` and `VITE_COLLAB_URL` as compile-time vars via `.env.production`.
     The `GANTTLET_*` names above are the target runtime equivalents that the Go server will
     read. The migration replaces `import.meta.env.VITE_*` references in source code with
     reads from `window.__ganttlet_config`, populated by the Go server from these env vars.
6. Add staging-specific secrets to GitHub:
   - `GCP_PROJECT_ID_STAGING`
   - `WIF_PROVIDER_STAGING`
   - `WIF_SERVICE_ACCOUNT_STAGING`
   - `GCP_SA_KEY_WRITER1_STAGING`
   - `GCP_SA_KEY_WRITER2_STAGING`
   - `GCP_SA_KEY_READER1_STAGING`
   - `TEST_SHEET_ID_STAGING`
7. Update `deploy.yml` to use per-environment secrets:
   - `deploy-staging` job reads `*_STAGING` secrets.
   - `deploy-production` job reads `*_PRODUCTION` secrets.
   - `build-and-push` pushes images to both projects' Artifact Registries (or a shared one).
8. The staging frontend uses the same image as dev. The Go static server reads
   `GANTTLET_GOOGLE_CLIENT_ID` and `GANTTLET_COLLAB_URL` from Cloud Run env vars and serves
   them to the browser at runtime (no rebuild needed). This requires the promotable artifacts
   migration to be complete first — see `docs/unplanned-issues.md`.

**Config that does NOT go in the repo**:
- OAuth client IDs (per-project)
- Relay/frontend URLs (derived from Cloud Run after deploy)
- Service account keys
- WIF provider/service account identifiers

**Config that stays in the repo**:
- `.env.e2e` (local E2E testing only, `ws://localhost:4000`)
- `.env.example` (template for local dev)
- Cloud Run resource settings (memory, CPU, min/max instances) — these can live in deploy
  scripts since they're not sensitive

---

## Step 5: Staging Smoke Tests + E2E Verification (no manual intervention)

**Target**: ganttlet-staging

**Goal**: Automated post-deploy verification against staging, including health checks, Sheets
integration, and full E2E.

**Motivation**: Staging is the last gate before production. If a deploy passes staging
verification, it should be safe to promote to prod. This step reuses the same verification
infrastructure from Steps 1–3 but pointed at the staging project, confirming that the staging
environment specifically is working (not just dev).

**What to do**:

1. Run the same health check from Step 1 against staging URLs.
2. Run the service account smoke test from Step 2 against staging (using staging service
   accounts and test sheet).
3. Run the Playwright E2E suite from Step 3 against staging Cloud Run services. The same
   `page.addInitScript()` GIS mock injects service account tokens — no frontend changes
   needed since staging uses the same production build as dev and prod.
4. Capture Playwright traces and screenshots on failure, upload as workflow artifacts.

**Auth**: The staging relay validates real Google tokens (no `GANTTLET_TEST_AUTH=1`). The
service account access tokens are real Google-issued JWTs, so they pass validation. This is
a strictly stronger test than dev — it validates the full auth chain (token issuance → relay
validation → Drive permission check) in addition to the UI and sync tests. The same frontend
artifact from dev can be promoted to staging without rebuilding.

---

## Step 6: Visual Regression + Periodic OAuth Verification (partially manual)

**Target**: ganttlet-staging

**Goal**: Catch visual UI regressions and verify the full OAuth sign-in flow periodically.

**Motivation**: Steps 1–5 cover functional correctness but not visual regressions — CSS
changes, layout shifts, missing icons, broken SVG rendering. Visual baselines catch these.
Separately, all automated tests use service accounts, which bypass the user-facing OAuth
consent flow. A periodic test with a real Google account ensures the sign-in experience
still works.

**What to do (visual regression — no manual intervention)**:

1. Add `expect(page).toHaveScreenshot()` assertions to E2E tests for key views:
   - Gantt chart with task bars and dependency arrows
   - Table view with editable cells
   - Presence indicators (multi-user avatars)
   - Tooltip overlays
2. Store baselines in `e2e/__screenshots__/`.
3. Set a `maxDiffPixels` threshold in `playwright.config.ts`.
4. Screenshot diffs are uploaded as workflow artifacts on failure.

**What to do (periodic OAuth verification — one-time manual setup)**:

1. Move the dev project's OAuth consent screen to **External (unverified)** so refresh tokens
   last months instead of 7 days.
2. Create a dedicated test Google account (e.g., `ganttlet-e2e-test@gmail.com`).
3. Manually sign in once to obtain a refresh token. Store it in GitHub secrets
   (`OAUTH_REFRESH_TOKEN_STAGING`).
4. Write an E2E test that uses the refresh token to get a fresh access token, signs in via
   the real OAuth flow (or injects the token), and verifies the full experience: sign-in →
   load Sheet → edit task → see changes in second tab → sign out.
5. Run this as a scheduled GitHub Actions workflow (weekly) or via manual `workflow_dispatch`.
   It doesn't need to run on every deploy — it's a drift detector for OAuth configuration.

**Auth strategy summary**:
- **Service account** (every deploy): Tests Sheets API integration and relay WebSocket
  connectivity. Reliable, no token expiry, no maintenance.
- **OAuth test account** (periodic/manual): Tests the full user sign-in flow, OAuth consent,
  token refresh. Requires one-time setup of a real Google account with a long-lived refresh
  token (enabled by External/unverified publishing status).

---

## Current State (as of this writing)

**Done**:
- `./scripts/full-verify.sh` — local verification (tsc + vitest + cargo test + E2E with relay)
- `playwright.config.ts` — relay as conditional second `webServer` via `E2E_RELAY=1`
- `e2e.yml` — CI E2E with relay, Rust cache, relay pre-build
- `Dockerfile` — Playwright Chromium system libs + browser binary baked in
- `GANTTLET_TEST_AUTH=1` on relay in Playwright config for local E2E
- All 9 E2E tests passing locally and in CI (including 3 collab tests)
- `deploy.yml` — builds, pushes, deploys to staging/production via Cloud Run

**Not yet done**:
- Prerequisites: Service accounts, test Sheet, GitHub secrets, dev relay `GANTTLET_TEST_AUTH`
- Step 1: Post-deploy health check against dev Cloud Run
- Step 2: Service account smoke test script + workflow integration
- Step 3: Playwright E2E against live dev Cloud Run deployment
- Promotable artifacts migration (must complete before Step 4 — see `docs/unplanned-issues.md`)
- Single-artifact deployment pipeline (must complete before Step 4 — see `docs/unplanned-issues.md`)
- Step 4: ganttlet-staging GCP project + Secret Manager config
- Step 5: Staging smoke tests + E2E verification
- Step 6: Visual regression baselines + periodic OAuth flow test

---

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/full-verify.sh` | Local agent verification (tsc, vitest, cargo test, E2E) |
| `playwright.config.ts` | E2E config, relay webServer, `E2E_RELAY` gate |
| `.github/workflows/e2e.yml` | CI E2E pipeline with relay |
| `.github/workflows/deploy.yml` | Build, push, deploy to staging/production |
| `deploy/deploy.sh` | Interactive deploy orchestrator |
| `deploy/setup.sh` | GCP project creation/resolution |
| `deploy/cloudrun/deploy.sh` | Relay Cloud Run deployment |
| `deploy/frontend/deploy.sh` | Frontend Cloud Run deployment |
| `.env.production` | Current dev project frontend config (VITE_COLLAB_URL, VITE_GOOGLE_CLIENT_ID) |
| `.env.e2e` | Local E2E override (ws://localhost:4000) |
| `server/src/auth.rs` | Relay auth — has `GANTTLET_TEST_AUTH` bypass |
| `server/src/config.rs` | Relay config from env vars |
| `e2e/helpers/collab-harness.ts` | Two-browser test harness with test auth injection |
| `e2e/helpers/cloud-auth.ts` | (Step 3) SA key → Google access token exchange |
| `scripts/cloud-smoke-test.sh` | (Step 2) Headless Sheets API + relay smoke test |
| `src/collab/yjsProvider.ts` | WebSocket provider, reads `VITE_COLLAB_URL` |
| `src/sheets/oauth.ts` | OAuth + `__ganttlet_setTestAuth` dev hook |
