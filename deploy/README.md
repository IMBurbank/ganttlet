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

1. **Node.js 18+** and **npm**
2. **Google Cloud SDK (gcloud)**:
   ```bash
   # Install: https://cloud.google.com/sdk/docs/install
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```
3. **A Google Cloud project** with these APIs enabled:
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable containerregistry.googleapis.com
   ```
4. **wasm-pack** (for building the Rust scheduler):
   ```bash
   curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
   ```

## Environment Variables

### Frontend (Vite)

| Variable | File | Description |
|----------|------|-------------|
| `VITE_COLLAB_URL` | `.env.production` | WebSocket URL for the relay server (`wss://...`) |

### Frontend Deploy Script

| Variable | Description |
|----------|-------------|
| `PROJECT_ID` | GCP project ID (required) |
| `REGION` | Cloud Run region (default: `us-central1`) |
| `SERVICE_NAME` | Cloud Run service name (default: `ganttlet-frontend`) |

### Relay Server Deploy Script

| Variable | Description |
|----------|-------------|
| `PROJECT_ID` | GCP project ID (required) |
| `REGION` | Cloud Run region (default: `us-central1`) |
| `ALLOWED_ORIGINS` | CORS origins (default: `https://{PROJECT_ID}.web.app,...`) |
| `MIN_INSTANCES` | Minimum instances (default: `0`) |
| `MAX_INSTANCES` | Maximum instances (default: `10`) |

## Deployment Steps

### 1. Deploy the Relay Server (Cloud Run)

The relay server must be deployed first so you have the WebSocket URL for the frontend.

```bash
export PROJECT_ID=your-gcp-project
./deploy/cloudrun/deploy.sh
```

Note the service URL from the output — you'll need the WebSocket URL next.

See `deploy/cloudrun/README.md` for detailed Cloud Run configuration.

### 2. Configure Frontend Environment

Update `.env.production` with the relay server URL from step 1:

```bash
echo "VITE_COLLAB_URL=wss://ganttlet-relay-xxx-uc.a.run.app" > .env.production
```

### 3. Deploy the Frontend (Cloud Run)

```bash
./deploy/frontend/deploy.sh
```

This builds the frontend in a multi-stage Docker build (Node → Go → distroless) and deploys to Cloud Run. The Go server provides:
- Static file serving from the Vite build output
- SPA fallback (all unknown routes serve `index.html`)
- Security headers (CSP, X-Frame-Options, etc.)
- Health check endpoints (`/healthz`, `/readyz`)

### 4. Update Cloud Run CORS

Update the relay server's allowed origins to include the frontend URL:

```bash
export ALLOWED_ORIGINS=https://ganttlet-frontend-xxx-uc.a.run.app
./deploy/cloudrun/deploy.sh
```

### 5. Configure OAuth Redirect URIs

Manual step in the Google Cloud Console:

1. Go to [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click your OAuth 2.0 Client ID
3. Add the frontend Cloud Run URL to **Authorized JavaScript origins** and **Authorized redirect URIs**
4. Click **Save**

## Security Hardening (Optional)

### Identity-Aware Proxy (IAP)

Restrict access to authenticated users:

```bash
export PROJECT_ID=your-gcp-project
./deploy/cloudrun/iap-setup.sh
```

### Cloud Armor WAF

Add rate limiting and OWASP protection:

```bash
export PROJECT_ID=your-gcp-project
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

## Full End-to-End Pipeline

```bash
# 1. Set project
export PROJECT_ID=your-gcp-project

# 2. Deploy relay server
./deploy/cloudrun/deploy.sh
# Note the wss:// URL from the output

# 3. Update frontend env
echo "VITE_COLLAB_URL=wss://ganttlet-relay-xxx-uc.a.run.app" > .env.production

# 4. Deploy frontend
./deploy/frontend/deploy.sh

# 5. Update relay CORS with frontend URL
export ALLOWED_ORIGINS=https://ganttlet-frontend-xxx-uc.a.run.app
./deploy/cloudrun/deploy.sh

# 6. Configure OAuth redirect URIs (manual — see step 5 above)

# 7. (Optional) Enable IAP and Cloud Armor
./deploy/cloudrun/iap-setup.sh
./deploy/cloudrun/cloud-armor.sh
```

## Updating

To redeploy after code changes:

```bash
# Frontend only
./deploy/frontend/deploy.sh

# Relay server only
./deploy/cloudrun/deploy.sh

# Both
./deploy/cloudrun/deploy.sh && ./deploy/frontend/deploy.sh
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| WebSocket connection fails | Check `VITE_COLLAB_URL` uses `wss://` (not `ws://`) |
| CORS errors in console | Ensure `ALLOWED_ORIGINS` includes your frontend Cloud Run URL |
| Google Sign-In fails | Add frontend URL to OAuth redirect URIs (step 5) |
| Build fails on WASM | Install `wasm-pack` and run `npm run build:wasm` first |
| Frontend 503 on startup | Check that the Docker build produced `dist/index.html` |
