# Cloud Verification Prerequisites Setup

You are setting up the one-time prerequisites described in `docs/cloud-verification-plan.md`
under "Prerequisites: One-Time Manual Setup". Read that section first.

## Context

The ganttlet-dev GCP project already exists and has Cloud Run services deployed. You need to
create service accounts for CI testing and configure the dev relay for test auth. The human
will create a test Google Sheet, share it with the service accounts, and add GitHub secrets —
but you need to give them the service account email addresses and then receive the Sheet ID
back.

## Your tasks

### 1. Authenticate gcloud

Verify `gcloud` is authenticated and the ganttlet-dev project is set:
```bash
gcloud auth list
gcloud config get-value project
```

If not authenticated, run `gcloud auth login --no-launch-browser` and follow the prompts.
If the project isn't set, ask the human for the project ID.

### 2. Create service accounts

Create three service accounts in the ganttlet-dev project:

```bash
PROJECT_ID=$(gcloud config get-value project)

gcloud iam service-accounts create ci-writer-1 \
  --display-name="CI Writer 1" \
  --project="$PROJECT_ID"

gcloud iam service-accounts create ci-writer-2 \
  --display-name="CI Writer 2" \
  --project="$PROJECT_ID"

gcloud iam service-accounts create ci-reader-1 \
  --display-name="CI Reader 1" \
  --project="$PROJECT_ID"
```

### 3. Generate key files

Generate JSON key files for each service account. Store them temporarily — they will be
provided to the human to add as GitHub secrets, then deleted.

```bash
gcloud iam service-accounts keys create /tmp/ci-writer-1-key.json \
  --iam-account="ci-writer-1@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts keys create /tmp/ci-writer-2-key.json \
  --iam-account="ci-writer-2@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts keys create /tmp/ci-reader-1-key.json \
  --iam-account="ci-reader-1@${PROJECT_ID}.iam.gserviceaccount.com"
```

### 4. Report service account emails to the human

Print the three service account email addresses clearly so the human can share their test
Google Sheet with them:

```
Service accounts created. Please share your test Google Sheet with these emails:

  EDITOR access:
    ci-writer-1@PROJECT_ID.iam.gserviceaccount.com
    ci-writer-2@PROJECT_ID.iam.gserviceaccount.com

  VIEWER access:
    ci-reader-1@PROJECT_ID.iam.gserviceaccount.com

Then give me the Sheet ID (from the URL: docs.google.com/spreadsheets/d/{SHEET_ID}/...).
```

Wait for the human to provide the Sheet ID before proceeding.

### 5. Store the Sheet ID for local deploys

Once you have the Sheet ID, add it to `.env` (for local development) as a comment with the
value, so developers know what it is:

Add to `.env`:
```
# Test Google Sheet ID for cloud verification (shared with CI service accounts)
TEST_SHEET_ID_DEV=<the-sheet-id>
```

Add to `.env.example` (as a commented-out template):
```
# Test Google Sheet ID for cloud verification smoke tests
# TEST_SHEET_ID_DEV=your-test-sheet-id
```

### 6. Update dev relay with GANTTLET_TEST_AUTH

Set `GANTTLET_TEST_AUTH=1` on the dev relay Cloud Run service so it accepts service account
tokens without Google validation:

```bash
gcloud run services update ganttlet-relay \
  --update-env-vars="GANTTLET_TEST_AUTH=1" \
  --project="$PROJECT_ID" \
  --region=us-central1
```

Verify the update was applied:
```bash
gcloud run services describe ganttlet-relay \
  --project="$PROJECT_ID" \
  --region=us-central1 \
  --format="value(spec.template.spec.containers[0].env)"
```

### 7. Print GitHub secrets for the human

Print the key file contents so the human can add them as GitHub secrets. Format clearly:

```
Add these GitHub secrets (Settings → Secrets and variables → Actions):

Secret: GCP_SA_KEY_WRITER1_DEV
Value: <contents of /tmp/ci-writer-1-key.json>

Secret: GCP_SA_KEY_WRITER2_DEV
Value: <contents of /tmp/ci-writer-2-key.json>

Secret: GCP_SA_KEY_READER1_DEV
Value: <contents of /tmp/ci-reader-1-key.json>

Secret: TEST_SHEET_ID_DEV
Value: <the-sheet-id>
```

Alternatively, if `gh` CLI is authenticated, offer to set the secrets directly:
```bash
gh secret set GCP_SA_KEY_WRITER1_DEV < /tmp/ci-writer-1-key.json
gh secret set GCP_SA_KEY_WRITER2_DEV < /tmp/ci-writer-2-key.json
gh secret set GCP_SA_KEY_READER1_DEV < /tmp/ci-reader-1-key.json
gh secret set TEST_SHEET_ID_DEV --body "<the-sheet-id>"
```

### 8. Clean up key files

After the secrets are stored (either in GitHub or handed to the human), delete the local
key files:

```bash
rm -f /tmp/ci-writer-1-key.json /tmp/ci-writer-2-key.json /tmp/ci-reader-1-key.json
```

### 9. Verify setup

Confirm everything is in place:
- [ ] Three service accounts exist in the project
- [ ] Dev relay has `GANTTLET_TEST_AUTH=1`
- [ ] `.env` has `TEST_SHEET_ID_DEV`
- [ ] `.env.example` has the template entry
- [ ] Key files are deleted from disk
- [ ] GitHub secrets are set (or handed to human)

Print a summary of what was done and what the human still needs to do (share the Sheet if
not already done, add GitHub secrets if not done via `gh`).

### What comes next

After the prerequisites are complete, Steps 1–3 of `docs/cloud-verification-plan.md` can
proceed without manual intervention. Those steps add post-deploy health checks, service
account smoke tests, and full Playwright E2E tests against the live dev Cloud Run deployment.
The prerequisites prompt does NOT implement those steps — they are separate work items.
