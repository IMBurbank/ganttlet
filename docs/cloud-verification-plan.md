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

## Step 1: Deploy to Dev + Health Check

**Target**: ganttlet-dev (existing Cloud Run project)

**Goal**: Confirm the deploy pipeline works and both Cloud Run services are alive after deploy.

**Motivation**: The deploy workflow (`deploy.yml`) builds and pushes images, but has no
post-deploy verification. A deploy could succeed (container starts) while the app is broken
(missing env var, bad WASM build, relay crash on first connection). A health check catches
these immediately.

**What to do**:

1. Add a `verify-dev` job to `deploy.yml` that runs after `deploy-staging` (the current
   staging job deploys to the dev project — see GCP Project Layout).
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

## Step 2: Service Account for Dev CI

**Target**: ganttlet-dev

**Goal**: Enable automated Sheets API and relay auth testing without real user accounts.

**Motivation**: The app's core value prop is real-time collaboration on Google Sheets. Testing
only the UI without Sheets integration misses a huge category of bugs (schema mismatches,
API rate limits, permission errors). A service account lets CI authenticate to Sheets and the
relay without interactive OAuth sign-in or token babysitting.

**What to do**:

1. In the ganttlet-dev GCP project, create a service account (e.g.,
   `ci-test@ganttlet-dev-XXXX.iam.gserviceaccount.com`).
2. Create a test Google Sheet in the dev project. Share it with the service account email
   (Editor access).
3. Download the service account key JSON. Store it as a GitHub Actions secret
   (`GCP_SA_KEY_DEV`).
4. In the relay server, add a service-account auth path: if the token is a JWT signed by a
   Google service account (instead of a user access token), validate it via Google's public
   keys. Alternatively, for dev/CI only, the relay can accept service account tokens through
   the existing `GANTTLET_TEST_AUTH=1` bypass.
5. Write a script (`scripts/cloud-smoke-test.sh`) that:
   - Uses the service account key to obtain an access token.
   - Opens a WebSocket to the relay, sends the auth message, and verifies the connection
     stays open (not rejected).
   - Calls the Sheets API to read/write the test sheet, verifying round-trip data integrity.
6. Add this script as a post-deploy step in the workflow after the Step 1 health check.

**Auth approach for the relay**: For the dev environment specifically, deploying with
`GANTTLET_TEST_AUTH=1` is acceptable — it bypasses Google token validation so the service
account's self-signed JWT is accepted. This tests the WebSocket infrastructure without
requiring changes to the relay's auth code. For staging/prod, the relay should validate
real tokens (user or service account).

**Secrets to add to GitHub**:
- `GCP_SA_KEY_DEV` — service account key JSON
- `TEST_SHEET_ID_DEV` — ID of the test Google Sheet

---

## Step 3: Full E2E Against Live Dev Deployment

**Target**: ganttlet-dev

**Goal**: Run the complete Playwright E2E suite (including collaboration tests) against the
live dev Cloud Run services, not localhost.

**Motivation**: This is the step that actually validates the things local E2E can't — real
TLS, real load balancer, real WebSocket through Cloud Run's proxy, real network latency. If
the collab tests pass against the live dev deployment, we have high confidence that the same
code will work in staging and production.

**What to do**:

1. Add a Playwright config variant (or env-var override) that points `baseURL` at the dev
   frontend URL and `VITE_COLLAB_URL` at the dev relay URL, instead of localhost.
2. The collab test harness (`e2e/helpers/collab-harness.ts`) injects test auth via
   `__ganttlet_setTestAuth`. For cloud testing, the frontend needs to be built with
   `VITE_TEST_AUTH=1` (or the dev deployment needs `GANTTLET_TEST_AUTH=1` on the relay) so
   that fake tokens are accepted.
3. Run the E2E suite in the deploy workflow after the service account smoke test passes.
   This confirms both infrastructure (Step 1) and application behavior (Step 3) in one
   pipeline.
4. Capture Playwright traces and screenshots on failure, upload as workflow artifacts.

**Key consideration**: The dev Cloud Run frontend is built with production env vars
(`VITE_COLLAB_URL=wss://...`), so it will connect to the real relay, not localhost. The
`__ganttlet_setTestAuth` hook is only available when `import.meta.env.DEV` is true — but
Cloud Run serves a production build. Solutions:
- Build the dev frontend with `--mode e2e` instead of production mode (exposes test hooks).
- Or add a `VITE_TEST_AUTH` build flag that's set for dev deployments only.
- Or skip client-side test auth and use the service account token from Step 2 directly.

**Files to modify**:
- `playwright.config.ts` — support `BASE_URL` env var override
- `.github/workflows/deploy.yml` — add E2E job after deploy
- `e2e/helpers/collab-harness.ts` — support cloud auth (service account token or test mode)
- Possibly `deploy/frontend/Dockerfile` or build args — for dev-mode builds

---

## Step 4: Staging Project + Secret Manager

**Target**: ganttlet-staging (new project)

**Goal**: Create a dedicated staging environment with config stored in the cloud, not in the
repo.

**Motivation**: Staging should mirror production as closely as possible. Checking in
`.env.staging` with OAuth client IDs and relay URLs defeats that purpose — it ties the
staging config to a specific commit and exposes infrastructure details in the repo. Secret
Manager (or Cloud Run env vars set via `gcloud`) keeps config out of the codebase.

**What to do**:

1. Create the `ganttlet-staging` GCP project using `deploy/setup.sh`.
   - Link billing account.
   - Configure OAuth consent screen → **External (unverified)**. This avoids the 7-day
     refresh token expiry that "Testing" status imposes. The "unverified app" warning is
     irrelevant for test accounts.
   - Create an OAuth client ID for the staging frontend URL.
   - Add test users (your accounts + any QA accounts) on the consent screen.
   - Enable APIs: Cloud Run, Sheets, Drive, Artifact Registry, Secret Manager.
2. Set up Workload Identity Federation for the staging project (same pattern as dev).
3. Store staging config in Secret Manager (or as Cloud Run env vars):
   - `VITE_GOOGLE_CLIENT_ID` (staging OAuth client ID)
   - `VITE_COLLAB_URL` (staging relay URL — known after first relay deploy)
   - `RELAY_ALLOWED_ORIGINS` (staging frontend URL)
   - `GOOGLE_CLIENT_ID` (same as VITE_GOOGLE_CLIENT_ID, used by deploy scripts)
4. Add staging-specific secrets to GitHub:
   - `GCP_PROJECT_ID_STAGING`
   - `WIF_PROVIDER_STAGING`
   - `WIF_SERVICE_ACCOUNT_STAGING`
   - `GCP_SA_KEY_STAGING` (service account for CI smoke tests)
   - `TEST_SHEET_ID_STAGING`
5. Update `deploy.yml` to use per-environment secrets:
   - `deploy-staging` job reads `*_STAGING` secrets.
   - `deploy-production` job reads `*_PRODUCTION` secrets.
   - `build-and-push` pushes images to both projects' Artifact Registries (or a shared one).
6. The staging frontend build uses the staging OAuth client ID and relay URL, pulled from
   Secret Manager or passed as build args.

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

## Step 5: Staging Smoke Tests + E2E Verification

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
   account and test sheet).
3. Run the Playwright E2E suite from Step 3 against staging Cloud Run services.
4. Capture Playwright traces and screenshots on failure, upload as workflow artifacts.

**Auth**: The staging relay should validate real tokens (not `GANTTLET_TEST_AUTH=1`). The
service account from Step 4 authenticates via a real JWT, so this also validates that staging
auth is correctly configured.

---

## Step 6: Visual Regression + Periodic OAuth Verification

**Target**: ganttlet-staging

**Goal**: Catch visual UI regressions and verify the full OAuth sign-in flow periodically.

**Motivation**: Steps 1–5 cover functional correctness but not visual regressions — CSS
changes, layout shifts, missing icons, broken SVG rendering. Visual baselines catch these.
Separately, all automated tests use service accounts, which bypass the user-facing OAuth
consent flow. A periodic test with a real Google account ensures the sign-in experience
still works.

**What to do (visual regression)**:

1. Add `expect(page).toHaveScreenshot()` assertions to E2E tests for key views:
   - Gantt chart with task bars and dependency arrows
   - Table view with editable cells
   - Presence indicators (multi-user avatars)
   - Tooltip overlays
2. Store baselines in `e2e/__screenshots__/`.
3. Set a `maxDiffPixels` threshold in `playwright.config.ts`.
4. Screenshot diffs are uploaded as workflow artifacts on failure.

**What to do (periodic OAuth verification)**:

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
- Step 1: Post-deploy health check against dev Cloud Run
- Step 2: Service account setup in dev project + cloud smoke test script
- Step 3: Playwright E2E against live dev Cloud Run deployment
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
| `src/collab/yjsProvider.ts` | WebSocket provider, reads `VITE_COLLAB_URL` |
| `src/sheets/oauth.ts` | OAuth + `__ganttlet_setTestAuth` dev hook |
