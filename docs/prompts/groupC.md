# Phase 9 Group C — Deployment Hardening

You are implementing Phase 9 Group C for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- deploy/frontend/main.go (new)
- deploy/frontend/go.mod (new)
- deploy/frontend/Dockerfile (new)
- deploy/frontend/deploy.sh (rewrite)
- deploy/cloudrun/iap-setup.sh (new)
- deploy/cloudrun/cloud-armor.sh (new)
- deploy/cloudrun/deploy.sh (minor update)
- deploy/README.md (rewrite)
- firebase.json (delete)
- server/Cargo.toml (edit)
- server/src/auth.rs (rewrite)

## Tasks — execute in order:

### C1: Replace Firebase Hosting with Go static file server

**Create `deploy/frontend/main.go`:**
- Go binary using `net/http.FileServer`
- Serve files from configurable directory (default `/app/dist`, override via `DIST_DIR` env)
- SPA fallback: for any request where the file doesn't exist on disk, serve `index.html`
- Port via `PORT` env var (Cloud Run standard), default `8080`
- Security headers on all responses:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: https://www.googleapis.com https://sheets.googleapis.com https://accounts.google.com; img-src 'self' data: https:; frame-src https://accounts.google.com;`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- Structured logging (requests + startup)

**Create `deploy/frontend/go.mod`:**
```
module github.com/anthropics/ganttlet/frontend
go 1.22
```
No external dependencies — stdlib only.

**Create `deploy/frontend/Dockerfile`:**
Multi-stage build:
1. Stage 1 (`node:20-alpine`): `npm ci && npm run build` to produce `dist/`
2. Stage 2 (`golang:1.22-alpine`): build the Go binary
3. Stage 3 (`gcr.io/distroless/static-debian12`): copy binary + dist, run as nonroot

**Rewrite `deploy/frontend/deploy.sh`:**
```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to your GCP project}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-ganttlet-frontend}"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "==> Building container image with Cloud Build..."
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="${IMAGE_NAME}" \
  --timeout=600 \
  /workspace

echo "==> Deploying to Cloud Run (${REGION})..."
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE_NAME}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=128Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --startup-probe-path=/healthz

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')

echo ""
echo "==> Frontend deployment complete!"
echo "    URL: ${SERVICE_URL}"
```

**Delete `firebase.json`.**

### C2: Add health check / readiness probe endpoints

In `deploy/frontend/main.go`:
- `GET /healthz` → 200 OK with body `ok` (liveness probe)
- `GET /readyz` → check that `dist/index.html` exists on disk; 200 if yes, 503 if not (readiness probe)

Register these routes BEFORE the static file handler so they take priority.

### C3: Replace reqwest with hyper in relay server

**In `server/Cargo.toml`:**
Replace:
```toml
reqwest = { version = "0.12", features = ["json"] }
```
With:
```toml
hyper = { version = "1", features = ["client", "http1"] }
hyper-util = { version = "0.1", features = ["client-legacy", "tokio", "http1"] }
hyper-rustls = { version = "0.27", features = ["http1", "webpki-tokio"] }
http-body-util = "0.1"
bytes = "1"
```

**In `server/src/auth.rs`:**
Replace `reqwest::Client` usage with hyper-based HTTP calls:

1. Remove `use reqwest::Client;`
2. Add necessary imports for hyper, hyper-util, hyper-rustls, http-body-util
3. Create a helper function to build an HTTPS client:
   ```rust
   fn https_client() -> hyper_util::client::legacy::Client<
       hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
       http_body_util::Empty<bytes::Bytes>,
   > {
       let tls = hyper_rustls::HttpsConnectorBuilder::new()
           .with_webpki_roots()
           .https_only()
           .enable_http1()
           .build();
       hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
           .build(tls)
   }
   ```
4. Replace both `validate_token()` and `check_drive_permission()` to use this client:
   - Build a `hyper::Request` with GET method, URI, and `Authorization: Bearer <token>` header
   - Send via `client.request(req).await`
   - Collect body with `http_body_util::BodyExt::collect()`
   - Parse with `serde_json::from_slice()`
5. Keep the same error handling structure (AuthError variants).
6. Run `cd server && cargo check` to verify.

### C4: Add IAP configuration

Create `deploy/cloudrun/iap-setup.sh`:
```bash
#!/usr/bin/env bash
# Enable Identity-Aware Proxy for Cloud Run services.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"

echo "==> Enabling IAP API..."
gcloud services enable iap.googleapis.com --project="${PROJECT_ID}"

echo ""
echo "IAP setup steps (manual):"
echo "1. Go to: https://console.cloud.google.com/security/iap?project=${PROJECT_ID}"
echo "2. Enable IAP for each Cloud Run service"
echo "3. Add authorized users/groups"
echo "4. Configure OAuth consent screen if not already done"
echo ""
echo "For automated setup, use 'gcloud iap web enable' after configuring a backend service."
```

### C5: Configure Cloud Armor WAF rules

Create `deploy/cloudrun/cloud-armor.sh`:
```bash
#!/usr/bin/env bash
# Configure Cloud Armor security policy for the frontend.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
POLICY_NAME="${POLICY_NAME:-ganttlet-waf}"

echo "==> Creating Cloud Armor security policy..."
gcloud compute security-policies create "${POLICY_NAME}" \
  --project="${PROJECT_ID}" \
  --description="Ganttlet WAF policy" \
  2>/dev/null || echo "Policy already exists"

echo "==> Adding rate limiting rule..."
gcloud compute security-policies rules create 1000 \
  --security-policy="${POLICY_NAME}" \
  --project="${PROJECT_ID}" \
  --expression="true" \
  --action=throttle \
  --rate-limit-threshold-count=100 \
  --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  2>/dev/null || echo "Rate limit rule already exists"

echo "==> Adding OWASP CRS rules..."
gcloud compute security-policies rules create 2000 \
  --security-policy="${POLICY_NAME}" \
  --project="${PROJECT_ID}" \
  --expression="evaluatePreconfiguredWaf('sqli-v33-stable')" \
  --action=deny-403 \
  2>/dev/null || echo "SQLi rule already exists"

gcloud compute security-policies rules create 2001 \
  --security-policy="${POLICY_NAME}" \
  --project="${PROJECT_ID}" \
  --expression="evaluatePreconfiguredWaf('xss-v33-stable')" \
  --action=deny-403 \
  2>/dev/null || echo "XSS rule already exists"

echo ""
echo "==> Cloud Armor policy '${POLICY_NAME}' configured."
echo "    Apply to a backend service with:"
echo "    gcloud compute backend-services update SERVICE_NAME --security-policy=${POLICY_NAME}"
```

## Priority

C1-C3 are critical. C4-C5 are stretch goals (additive config scripts). Prioritize C1-C3.

## Verification
After all tasks, run:
```bash
cd server && cargo check
```
Cargo check must pass. Commit your changes with descriptive messages.
