---
name: cloud-deployment
description: "Use when working on Cloud Run deployment, staging/prod environments, health checks, or GCP configuration. Covers promotable artifacts, environment injection, and verification."
---

# Cloud Deployment Guide

## Promotable Artifacts Pattern
Frontend and relay Docker images must be identical across environments (dev → staging → prod).
Environment-specific config is injected at deploy time — never baked into the build.

## Environment Variable Injection
- OAuth client IDs, relay URLs, allowed origins → Cloud Run env vars or Secret Manager
- Test-specific code paths (e.g., `__ganttlet_setTestAuth`) must not exist in production builds
- E2E tests against cloud environments inject auth via Playwright's `page.addInitScript()`

## Cloud Run Pipeline
- Frontend: static build served from Cloud Run container (Go static server + Vite dist)
- Relay: Rust binary in a separate Cloud Run service
- Both services scale independently

### Deploy Pipeline Stages (`.github/workflows/deploy.yml`)
The workflow triggers on push to `main` or manual `workflow_dispatch` (with `dev` or `production` target):

```
ci (reusable ci.yml)
  └─► build-and-push (WIF auth → Artifact Registry)
        ├─► deploy-dev (on push or dispatch=dev)
        │     └─► verify-dev (health checks: relay /health, frontend HTML, WebSocket upgrade)
        │           └─► smoke-test-dev (SA token exchange, Sheets API write/read, relay WebSocket)
        │                 └─► e2e-dev (Playwright against live Cloud Run, traces on failure)
        └─► deploy-production (dispatch=production only, requires `production` environment approval)
```

**Key details:**
- `build-and-push` builds both images in one job: relay via `Dockerfile.server`, frontend via `deploy/frontend/Dockerfile`. Images tagged with `github.sha`.
- Image registry path: `{REGION}-docker.pkg.dev/{PROJECT_ID}/ganttlet/{SERVICE}:{SHA}` (repo name is `ganttlet` in Artifact Registry).
- Dev deploy outputs `relay_url` and `frontend_url` which are passed to downstream verification jobs.
- Production deploy uses a GitHub `environment: production` gate for manual approval.
- Both dev and production reuse the same `WIF_PROVIDER` / `WIF_SERVICE_ACCOUNT` secrets (no per-environment WIF yet).

### Container Architecture
- **Relay** (`Dockerfile.server`): Multi-stage — `rust:1.85-slim` builder → `debian:bookworm-slim` runtime. Binary at `/usr/local/bin/ganttlet-relay`. Exposes port 4000 locally; Cloud Run sets `PORT` env var which the server reads as fallback.
- **Frontend** (`deploy/frontend/Dockerfile`): Three-stage — `node:20-alpine` builds Vite dist (WASM must be pre-built in context), `golang:1.22-alpine` builds the Go static file server, `distroless/static-debian12` runtime. Runs as `nonroot:nonroot`, exposes 8080.

## Health Checks & Smoke Tests
See `docs/cloud-verification-plan.md` for the staged verification plan:
1. Health checks (liveness/readiness endpoints)
2. Service account smoke tests
3. E2E against live Cloud Run
4. Staging project with Secret Manager
5. Visual regression baselines

## GCP Project Layout
- **ganttlet-dev**: Current Cloud Run deployment target (CI pushes here on every `main` merge)
- **ganttlet-staging** (future): Pre-production with Secret Manager config, real token validation
- **ganttlet-prod** (future): Production, manual approval via `workflow_dispatch`
- See `docs/cloud-verification-plan.md` for full details

## Gotchas & Known Issues

1. **Workload Identity Federation (WIF) is required — no SA key auth in CI.** The deploy workflow uses `google-github-actions/auth@v2` with `workload_identity_provider` and `service_account` secrets. The job MUST have `permissions: { contents: read, id-token: write }` or the OIDC token exchange will fail silently. If you add a new job that calls GCP, copy both the auth step AND the permissions block. See `.github/workflows/deploy.yml` lines 30–32 and 37–40.

2. **Relay port fallback chain: `RELAY_PORT` > `PORT` > 4000.** Cloud Run sets the `PORT` env var automatically, but the relay code checks `RELAY_PORT` first. If you set `RELAY_PORT` explicitly in Cloud Run env vars, it will override Cloud Run's `PORT` and the container may listen on the wrong port, causing health check failures. Do NOT set `RELAY_PORT` in Cloud Run deployments. See `server/src/config.rs` lines 27–32.

3. **Wildcard CORS origins are rejected at startup.** If `RELAY_ALLOWED_ORIGINS` contains `*`, the relay filters it out and logs an error. If no valid origins remain, it falls back to `http://localhost:5173` — which means the Cloud Run relay will reject all production frontend requests. Always set explicit origins. See `server/src/config.rs` lines 41–49.

4. **Frontend Dockerfile skips WASM build — pre-built WASM must be in the Docker context.** The `deploy/frontend/Dockerfile` runs `npx tsc -b && npx vite build` but does NOT run `npm run build:wasm` because there is no Rust toolchain in the Node image. The `build-and-push` job in `deploy.yml` installs Rust/wasm-pack and runs `npm run build:wasm` BEFORE `docker build`, relying on the WASM output being in the build context. If the WASM build step is skipped or reordered, the frontend image will be built without the scheduler. See `.github/workflows/deploy.yml` lines 54–72.

5. **`GANTTLET_TEST_AUTH=1` bypasses ALL auth on the relay.** When this env var is set, `validate_token()` accepts any non-empty string as a valid token and `check_drive_permission()` returns `Writer` for everyone. This is set on the dev relay for CI testing. NEVER set this on staging or production — it would allow unauthenticated access to all rooms. See `server/src/auth.rs` lines 88–94 and 147–149.

6. **Dev and production deploy jobs share the same GCP secrets.** Both `deploy-dev` and `deploy-production` reference `secrets.WIF_PROVIDER`, `secrets.WIF_SERVICE_ACCOUNT`, and `secrets.GCP_PROJECT_ID`. There are no per-environment secret variants (`_DEV` / `_PROD`) for WIF — staging will need separate secrets (`WIF_PROVIDER_STAGING`, etc.) as noted in `docs/cloud-verification-plan.md` Step 4.

7. **The `deploy.yml` job named `deploy-dev` actually deploys to the ganttlet-dev project, not staging.** The cloud-verification-plan notes this naming confusion. The job condition `github.event_name == 'push'` means every merge to `main` auto-deploys to dev. Production requires `workflow_dispatch` with explicit environment selection plus GitHub environment approval.

## Lessons Learned
<!-- Managed by curation pipeline — do not edit directly -->
