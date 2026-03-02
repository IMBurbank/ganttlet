# Ganttlet Deployment Guide

Full deployment pipeline for the Ganttlet application: static frontend on Firebase Hosting and relay server on Google Cloud Run.

## Architecture

```
Browser ──HTTPS──▶ Firebase Hosting (static SPA)
   │
   └──WSS──▶ Cloud Run (Rust relay server, CRDT sync)
```

All business logic runs in the browser (React + WASM). The relay server only forwards Yjs CRDT updates over WebSocket.

## Prerequisites

1. **Node.js 18+** and **npm**
2. **Firebase CLI**:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
3. **Google Cloud SDK (gcloud)**:
   ```bash
   # Install: https://cloud.google.com/sdk/docs/install
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```
4. **A Google Cloud project** with these APIs enabled:
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable containerregistry.googleapis.com
   ```
5. **wasm-pack** (for building the Rust scheduler):
   ```bash
   curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
   ```

## Environment Variables

### Frontend (Vite)

| Variable | File | Description |
|----------|------|-------------|
| `VITE_COLLAB_URL` | `.env.production` | WebSocket URL for the relay server (`wss://...`) |

### Relay Server (Cloud Run)

| Variable | Description |
|----------|-------------|
| `PROJECT_ID` | GCP project ID (required) |
| `REGION` | Cloud Run region (default: `us-central1`) |
| `ALLOWED_ORIGINS` | CORS origins, defaults to Firebase Hosting URLs |
| `MIN_INSTANCES` | Minimum instances (default: `0`) |
| `MAX_INSTANCES` | Maximum instances (default: `10`) |

## Deployment Steps

### 1. Deploy the Relay Server (Cloud Run)

The relay server must be deployed first so you have the WebSocket URL for the frontend.

```bash
export PROJECT_ID=your-gcp-project

# Deploy
chmod +x deploy/cloudrun/deploy.sh
./deploy/cloudrun/deploy.sh
```

The script will print the service URL on completion. Note the WebSocket URL — you'll need it next.

See `deploy/cloudrun/README.md` for detailed Cloud Run configuration.

### 2. Configure Frontend Environment

Update `.env.production` with the relay server URL from step 1:

```bash
# .env.production
VITE_COLLAB_URL=wss://ganttlet-relay-abc123-uc.a.run.app
```

### 3. Set Up Firebase Hosting

```bash
# Initialize Firebase in the project (first time only)
firebase init hosting
# Select your project, set public directory to "dist", configure as SPA

# Or just set the active project if firebase.json already exists
firebase use YOUR_PROJECT_ID
```

### 4. Deploy the Frontend

```bash
chmod +x deploy/frontend/deploy.sh
./deploy/frontend/deploy.sh
```

This builds the production bundle (`npm run build`) and deploys to Firebase Hosting.

Your app will be available at:
- `https://YOUR_PROJECT_ID.web.app`
- `https://YOUR_PROJECT_ID.firebaseapp.com`

### 5. Update Cloud Run CORS (if needed)

If you use a custom domain, update the allowed origins:

```bash
export ALLOWED_ORIGINS=https://ganttlet.example.com,https://YOUR_PROJECT_ID.web.app
./deploy/cloudrun/deploy.sh
```

### 6. Configure OAuth Redirect URIs

This is a **manual step** in the Google Cloud Console:

1. Go to [Google Cloud Console > APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click your OAuth 2.0 Client ID
3. Add these to **Authorized JavaScript origins**:
   - `https://YOUR_PROJECT_ID.web.app`
   - `https://YOUR_PROJECT_ID.firebaseapp.com`
   - Any custom domains
4. Add these to **Authorized redirect URIs**:
   - `https://YOUR_PROJECT_ID.web.app`
   - `https://YOUR_PROJECT_ID.firebaseapp.com`
5. Click **Save**

Without this step, Google Sign-In will fail on the production domain.

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
firebase use $PROJECT_ID
./deploy/frontend/deploy.sh

# 5. Configure OAuth redirect URIs (manual — see step 6 above)

# 6. Verify
# Open https://YOUR_PROJECT_ID.web.app in a browser
# Check that the Gantt chart loads and real-time sync works
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
| CORS errors in console | Ensure `ALLOWED_ORIGINS` includes your frontend domain |
| Google Sign-In fails | Add production URL to OAuth redirect URIs (step 6) |
| Build fails on WASM | Install `wasm-pack` and run `npm run build:wasm` first |
| Firebase deploy fails | Run `firebase login` and `firebase use PROJECT_ID` |
