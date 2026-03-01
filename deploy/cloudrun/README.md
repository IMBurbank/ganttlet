# Deploy Ganttlet Relay Server to Google Cloud Run

This directory contains the deployment script for running the Ganttlet collaboration relay server on Google Cloud Run.

## Prerequisites

1. **Google Cloud SDK (gcloud)** installed and authenticated:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **APIs enabled** on your GCP project:
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable containerregistry.googleapis.com
   ```

3. **Dockerfile.server** at the repository root (already included in the repo).

## Environment Variables

### Deploy script variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PROJECT_ID` | Yes | — | Your GCP project ID |
| `REGION` | No | `us-central1` | Cloud Run region |
| `SERVICE_NAME` | No | `ganttlet-relay` | Cloud Run service name |
| `ALLOWED_ORIGINS` | No | `https://your-frontend-domain.com` | Comma-separated CORS origins |
| `MIN_INSTANCES` | No | `0` | Minimum Cloud Run instances |
| `MAX_INSTANCES` | No | `10` | Maximum Cloud Run instances |
| `MEMORY` | No | `256Mi` | Memory allocation per instance |
| `CPU` | No | `1` | CPU allocation per instance |

### Server runtime variables (set automatically or via deploy script)

| Variable | Description |
|---|---|
| `PORT` | Set automatically by Cloud Run. The server uses this if `RELAY_PORT` is not set. |
| `RELAY_PORT` | Explicit port override (takes priority over `PORT`). |
| `RELAY_HOST` | Bind address. Defaults to `0.0.0.0` (correct for Cloud Run). |
| `RELAY_ALLOWED_ORIGINS` | Comma-separated CORS origins. Set via `ALLOWED_ORIGINS` in the deploy script. |
| `RUST_LOG` | Logging level. Set to `info` by the deploy script. |

## Step-by-Step Deployment

### 1. Set your project ID

```bash
export PROJECT_ID=my-gcp-project
```

### 2. Set allowed origins

Set this to your frontend's production URL:

```bash
export ALLOWED_ORIGINS=https://ganttlet.example.com
```

### 3. Run the deploy script

```bash
cd /path/to/ganttlet
chmod +x deploy/cloudrun/deploy.sh
./deploy/cloudrun/deploy.sh
```

### 4. Configure your frontend

The deploy script prints the service URL on completion. Copy the WebSocket URL and add it to your `.env`:

```bash
VITE_COLLAB_URL=wss://ganttlet-relay-abc123-uc.a.run.app
```

Note: Cloud Run provides HTTPS/WSS termination automatically. Always use `wss://` (not `ws://`) for the production WebSocket URL.

### 5. Verify the deployment

Check that the service is running:

```bash
gcloud run services describe ganttlet-relay \
  --region=us-central1 \
  --format='value(status.url)'
```

## How It Works

- Cloud Run automatically sets the `PORT` environment variable for each container instance.
- The relay server checks `RELAY_PORT` first, then falls back to `PORT`, then defaults to `4000`.
- The deploy script uses `--port=4000` to tell Cloud Run which port the container listens on.
- Cloud Run handles TLS termination, so clients connect via `wss://` while the server itself listens on plain WebSocket.
- `--use-http2` and `--session-affinity` are enabled for better WebSocket support.

## Updating

To redeploy after code changes, simply run the deploy script again:

```bash
./deploy/cloudrun/deploy.sh
```

Cloud Build will rebuild the image and Cloud Run will perform a rolling update with zero downtime.
