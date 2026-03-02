# Ganttlet Deployment Guide

Full deployment pipeline for the Ganttlet application: static frontend and relay server, both on Google Cloud Run.

## Architecture

```
Browser ──HTTPS──▶ Cloud Run (Go static file server, SPA)
   │
   └──WSS──▶ Cloud Run (Rust relay server, CRDT sync)
```

All business logic runs in the browser (React + WASM). The relay server only forwards Yjs CRDT updates over WebSocket. The frontend is served by a minimal Go binary with SPA fallback and security headers.

## Prerequisites

1. **Node.js 18+** and **npm**:
   ```bash
   # Install via nvm (recommended): https://github.com/nvm-sh/nvm
   nvm install 20
   nvm use 20
   node --version  # should print v20.x.x
   npm --version   # should print 10.x.x
   ```
2. **Google Cloud SDK (gcloud)**:
   ```bash
   # Install: https://cloud.google.com/sdk/docs/install
   gcloud auth login
   ```
3. **wasm-pack** (for building the Rust scheduler):
   ```bash
   curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
   ```

## Initial Setup

Run the setup script to select (or create) your GCP project. This finds the project by name, sets `PROJECT_ID` in your shell, and enables the required APIs:

```bash
source deploy/setup.sh
```

The script will:
1. Prompt you for a **project name** (e.g. "Ganttlet Production")
2. Search your GCP account for a project with that name
3. If found, select it and export `PROJECT_ID`
4. If not found, offer to create a new project with that name
5. Enable Cloud Run, Cloud Build, and Container Registry APIs

You can also pass the project name directly:

```bash
source deploy/setup.sh "Ganttlet Production"
```

To re-source in a new shell without re-enabling APIs:

```bash
source deploy/setup.sh --skip-apis
```

> **Note:** All deploy scripts automatically run `setup.sh` interactively if `PROJECT_ID` is not already set, so you can also just run a deploy script directly.

## Deployment Steps

### 1. Setup

If you haven't already run setup (see [Initial Setup](#initial-setup)):

```bash
source deploy/setup.sh
```

> **Important:** Use `source` (not `./`) throughout these steps so exported variables (`PROJECT_ID`, `RELAY_URL`, `FRONTEND_URL`) are available to subsequent steps.

### 2. Deploy the Relay Server

The relay server must be deployed first. The script exports `RELAY_URL` so subsequent steps can use it automatically.

```bash
source deploy/cloudrun/deploy.sh
```

See `deploy/cloudrun/README.md` for detailed Cloud Run configuration.

### 3. Deploy the Frontend

The frontend deploy script automatically writes `.env.production` from the `RELAY_URL` exported in step 2, then builds and deploys. It exports `FRONTEND_URL` for step 4.

```bash
source deploy/frontend/deploy.sh
```

This builds the frontend in a multi-stage Docker build (Node → Go → distroless) and deploys to Cloud Run. The Go server provides:
- Static file serving from the Vite build output
- SPA fallback (all unknown routes serve `index.html`)
- Security headers (CSP, X-Frame-Options, etc.)
- Health check endpoints (`/healthz`, `/readyz`)

### 4. Update Relay Server CORS

Point the relay server's allowed origins at the frontend. This updates the env var without a full rebuild — `FRONTEND_URL` was exported in step 3:

```bash
source deploy/cloudrun/update-cors.sh
```

### 5. Configure OAuth Redirect URIs

**Manual step** in the Google Cloud Console:

1. Go to [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click your OAuth 2.0 Client ID
3. Add `${FRONTEND_URL}` to both:
   - **Authorized JavaScript origins**
   - **Authorized redirect URIs**
4. Click **Save**

Without this step, Google Sign-In will fail on the production domain.

## Security Hardening (Optional)

### Identity-Aware Proxy (IAP)

Restrict access to authenticated Google Workspace users:

```bash
./deploy/cloudrun/iap-setup.sh
```

### Cloud Armor WAF

Add rate limiting and OWASP protection:

```bash
./deploy/cloudrun/cloud-armor.sh
```

This creates a security policy with:
- Rate limiting (100 requests/minute)
- SQL injection protection (OWASP CRS)
- XSS protection (OWASP CRS)

## Health Checks

The frontend server exposes two probe endpoints:

| Endpoint | Type | Behavior |
|----------|------|----------|
| `GET /healthz` | Liveness | Always returns `200 ok` |
| `GET /readyz` | Readiness | Returns `200 ok` if `index.html` exists, `503` otherwise |

## Environment Variables Reference

### Pipeline variables (set automatically by deploy scripts)

| Variable | Set by | Used by | Description |
|----------|--------|---------|-------------|
| `PROJECT_ID` | `setup.sh` | all scripts | GCP project ID |
| `RELAY_URL` | `cloudrun/deploy.sh` | `frontend/deploy.sh` | Relay server HTTPS URL |
| `FRONTEND_URL` | `frontend/deploy.sh` | CORS update step | Frontend HTTPS URL |

### Optional overrides

| Variable | Script | Default | Description |
|----------|--------|---------|-------------|
| `REGION` | all | `us-central1` | Cloud Run region |
| `SERVICE_NAME` | frontend | `ganttlet-frontend` | Frontend Cloud Run service name |
| `SERVICE_NAME` | cloudrun | `ganttlet-relay` | Relay Cloud Run service name |
| `ALLOWED_ORIGINS` | cloudrun | (empty — must set) | CORS origins for relay server (frontend Cloud Run URL) |
| `MIN_INSTANCES` | cloudrun | `0` | Minimum Cloud Run instances |
| `MAX_INSTANCES` | cloudrun | `10` | Maximum Cloud Run instances |

### Frontend Build (Vite)

| Variable | File | Description |
|----------|------|-------------|
| `VITE_COLLAB_URL` | `.env.production` | WebSocket URL for the relay server (written automatically from `RELAY_URL`) |

## Full End-to-End Pipeline

All URLs are passed between steps automatically — no manual copying required:

```bash
# ── 1. Setup — select project, enable APIs ──
source deploy/setup.sh
# Prompts for project name, finds/creates it, exports PROJECT_ID

# ── 2. Deploy relay server (exports RELAY_URL) ──
source deploy/cloudrun/deploy.sh

# ── 3. Deploy frontend (reads RELAY_URL, writes .env.production, exports FRONTEND_URL) ──
source deploy/frontend/deploy.sh

# ── 4. Update relay CORS with frontend URL (no rebuild) ──
source deploy/cloudrun/update-cors.sh

# ── 5. Configure OAuth redirect URIs ──
# Manual step: add ${FRONTEND_URL} to OAuth redirect URIs in Google Cloud Console
# See step 5 in Deployment Steps above

# ── 6. (Optional) Enable IAP and Cloud Armor ──
./deploy/cloudrun/iap-setup.sh
./deploy/cloudrun/cloud-armor.sh
```

## Redeployment

For redeployment after code changes, `RELAY_URL` is already known so `.env.production` is not overwritten. If `PROJECT_ID` is no longer in your shell, any script will prompt for it automatically.

```bash
source deploy/frontend/deploy.sh                                    # frontend only
source deploy/cloudrun/deploy.sh                                    # relay server only
source deploy/cloudrun/deploy.sh && source deploy/frontend/deploy.sh  # both
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `PROJECT_ID` not set | Run `source deploy/setup.sh` or any deploy script will prompt |
| Setup can't find your project | Check the project name matches exactly (case-sensitive) |
| "Billing account not linked" | Visit the link printed during project creation |
| WebSocket connection fails | Check `VITE_COLLAB_URL` uses `wss://` (not `ws://` or `https://`) |
| CORS errors in console | Ensure `ALLOWED_ORIGINS` includes your frontend Cloud Run URL |
| Google Sign-In fails | Add frontend URL to OAuth redirect URIs (step 5) |
| Build fails on WASM | Install `wasm-pack` and run `npm run build:wasm` first |
| Frontend 503 on startup | Check that the Docker build produced `dist/index.html` |
