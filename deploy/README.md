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

## Cloud Console Setup

Complete these steps in the Google Cloud Console before deploying. If you skip them, the deploy script will pause and direct you back here.

### 1. Create a GCP project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top of the page → **New Project**
3. Enter a project name (e.g. "Ganttlet Production")
4. Click **Create**
5. Select the new project from the project dropdown

> **Alternatively**, the deploy script can create the project for you — it will prompt if no project with the given name is found.

### 2. Link a billing account

1. Go to [Billing](https://console.cloud.google.com/billing/linkedaccount) for your project
2. Link an active billing account

Cloud Run requires billing to be enabled.

### 3. Configure the OAuth consent screen

1. Go to [APIs & Services > OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. Choose **External** user type
3. Fill in the required fields (app name, support email)
4. Add scopes:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.metadata.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
5. Click **Save**

### 4. Create an OAuth client ID

1. Go to [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **+ Create Credentials > OAuth client ID**
3. Application type: **Web application**
4. Name: e.g. "Ganttlet Production"
5. Leave redirect URIs empty for now (you'll add them after deploy)
6. Click **Create** and copy the **Client ID** — the deploy script will ask for it

## Deploy

Once the Cloud Console setup is complete, deploy everything with a single command:

```bash
source deploy/deploy.sh
```

The script will:
1. Ask for your GCP project name (finds the project or offers to create it)
2. If the project was just created, pause so you can complete the Cloud Console Setup above
3. Ask for your OAuth Client ID (or recover it from a previous deploy)
4. Deploy the relay server, frontend, and update CORS
5. Print a summary with URLs and remaining manual steps

To skip the project prompt:

```bash
source deploy/deploy.sh --project "Ganttlet Production"
```

## Post-Deploy: Add OAuth Redirect URIs

After the first deploy, you need to register the frontend URL with your OAuth client:

1. Go to [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click your OAuth 2.0 Client ID
3. Add your `FRONTEND_URL` (printed in the deploy summary) to both:
   - **Authorized JavaScript origins**
   - **Authorized redirect URIs**
4. Click **Save**

Without this step, Google Sign-In will fail on the production domain.

## Redeployment

After code changes, redeploy everything or just the part that changed:

```bash
source deploy/deploy.sh                    # full redeploy
source deploy/deploy.sh --frontend-only    # frontend only
source deploy/deploy.sh --relay-only       # relay server only
source deploy/deploy.sh --cors-only        # update CORS origins only
```

The script automatically recovers `RELAY_URL`, `FRONTEND_URL`, and `GOOGLE_CLIENT_ID` from existing services and `.env.production`, so redeployment works in a fresh terminal.

## Flags Reference

| Flag | Description |
|------|-------------|
| `--project "Name"` | Skip the interactive project name prompt |
| `--relay-only` | Deploy only the relay server |
| `--frontend-only` | Deploy only the frontend |
| `--cors-only` | Only update CORS origins on the relay server |

## Advanced: Individual Scripts

For manual control, you can run each step independently. Use `source` (not `./`) so environment variables propagate between steps.

### Setup

```bash
source deploy/setup.sh                   # interactive prompt
source deploy/setup.sh "My Project"      # pass project name
source deploy/setup.sh --skip-apis       # re-source without re-enabling APIs
```

### Deploy relay server

```bash
source deploy/cloudrun/deploy.sh
# Exports: RELAY_URL
```

### Deploy frontend

Requires `RELAY_URL` and `GOOGLE_CLIENT_ID` in the environment:

```bash
export GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
source deploy/frontend/deploy.sh
# Exports: FRONTEND_URL
```

### Update CORS

Requires `FRONTEND_URL` in the environment:

```bash
source deploy/cloudrun/update-cors.sh
```

### Full manual pipeline

```bash
# 1. Setup
source deploy/setup.sh

# 2. Set OAuth Client ID (from Cloud Console Setup step 4)
export GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com

# 3. Deploy relay server (exports RELAY_URL)
source deploy/cloudrun/deploy.sh

# 4. Deploy frontend (exports FRONTEND_URL)
source deploy/frontend/deploy.sh

# 5. Update relay CORS
source deploy/cloudrun/update-cors.sh

# 6. Add OAuth redirect URIs (see Post-Deploy section above)
```

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

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `PROJECT_ID` not set | Run `source deploy/setup.sh` or `source deploy/deploy.sh` |
| Setup can't find your project | Check the project name matches exactly (case-sensitive) |
| "Billing account not linked" | Visit the link printed during project creation |
| WebSocket connection fails | Check `VITE_COLLAB_URL` uses `wss://` (not `ws://` or `https://`) |
| CORS errors in console | Ensure `ALLOWED_ORIGINS` includes your frontend Cloud Run URL |
| Google Sign-In fails | Add frontend URL to OAuth redirect URIs (see Post-Deploy section) |
| Build fails on WASM | Install `wasm-pack` and run `npm run build:wasm` first |
| Frontend 503 on startup | Check that the Docker build produced `dist/index.html` |
