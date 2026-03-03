#!/usr/bin/env bash
# setup.sh — Resolve or create a GCP project by name, enable APIs, export PROJECT_ID.
#
# Usage:
#   source deploy/setup.sh                   # interactive prompt
#   source deploy/setup.sh "My Project"      # pass project name directly
#   source deploy/setup.sh --skip-apis       # skip API enablement (re-sourcing)
#
# After sourcing, PROJECT_ID is exported and ready for deploy scripts.

# NOTE: Do not use `set -e` here. This script is `source`d by deploy scripts
# (which are themselves `source`d into interactive shells for env var export).
# With `set -e`, any command failure would kill the user's terminal session.
set -uo pipefail

SKIP_APIS=false
PROJECT_NAME=""

for arg in "$@"; do
  case "$arg" in
    --skip-apis) SKIP_APIS=true ;;
    *) PROJECT_NAME="$arg" ;;
  esac
done

# ── Verify gcloud is installed and authenticated ─────────────────────────────

if ! command -v gcloud &>/dev/null; then
  echo "ERROR: gcloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install"
  return 1 2>/dev/null || exit 1
fi

ACCOUNT=$(gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>/dev/null || true)
if [[ -z "$ACCOUNT" ]]; then
  echo "No active gcloud account. Running 'gcloud auth login'..."
  gcloud auth login
fi

# ── Get project name from user ───────────────────────────────────────────────

if [[ -z "$PROJECT_NAME" ]]; then
  echo ""
  echo "Enter the name of your Google Cloud project."
  echo "This can be a display name (e.g. 'Ganttlet Production')."
  echo "If no project with this name exists, you'll be prompted to create one."
  echo ""
  read -rp "Project name: " PROJECT_NAME
fi

if [[ -z "$PROJECT_NAME" ]]; then
  echo "ERROR: Project name cannot be empty."
  return 1 2>/dev/null || exit 1
fi

# ── Search for existing projects by name ─────────────────────────────────────

echo ""
echo "Searching for projects named '${PROJECT_NAME}'..."

MATCHES=$(gcloud projects list \
  --filter="name='${PROJECT_NAME}'" \
  --format="value(projectId,name)" \
  2>/dev/null || true)

if [[ -n "$MATCHES" ]]; then
  # Count matches
  MATCH_COUNT=$(echo "$MATCHES" | wc -l | tr -d ' ')

  if [[ "$MATCH_COUNT" -eq 1 ]]; then
    PROJECT_ID=$(echo "$MATCHES" | awk '{print $1}')
    DISPLAY_NAME=$(echo "$MATCHES" | cut -f2-)
    echo "Found project: ${DISPLAY_NAME} (${PROJECT_ID})"
  else
    echo "Found ${MATCH_COUNT} projects named '${PROJECT_NAME}':"
    echo ""
    INDEX=1
    while IFS=$'\t' read -r pid pname; do
      echo "  ${INDEX}) ${pname} (${pid})"
      INDEX=$((INDEX + 1))
    done <<< "$MATCHES"
    echo ""
    read -rp "Enter number to select (1-${MATCH_COUNT}): " SELECTION

    if [[ -z "$SELECTION" ]] || [[ "$SELECTION" -lt 1 ]] || [[ "$SELECTION" -gt "$MATCH_COUNT" ]]; then
      echo "ERROR: Invalid selection."
      return 1 2>/dev/null || exit 1
    fi

    PROJECT_ID=$(echo "$MATCHES" | sed -n "${SELECTION}p" | awk '{print $1}')
  fi
else
  # ── No match — offer to create ───────────────────────────────────────────

  echo "No project found with name '${PROJECT_NAME}'."
  echo ""
  read -rp "Create a new project? (y/N): " CREATE_CONFIRM

  if [[ "${CREATE_CONFIRM,,}" != "y" ]]; then
    echo "Aborted. No PROJECT_ID set."
    return 1 2>/dev/null || exit 1
  fi

  # Generate a project ID from the name (lowercase, hyphens, max 30 chars)
  SUGGESTED_ID=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | cut -c1-30)
  # Append random suffix for uniqueness
  SUGGESTED_ID="${SUGGESTED_ID}-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-6)"

  echo ""
  echo "Project IDs must be globally unique. Suggested: ${SUGGESTED_ID}"
  read -rp "Project ID [${SUGGESTED_ID}]: " CUSTOM_ID
  PROJECT_ID="${CUSTOM_ID:-$SUGGESTED_ID}"

  # Flag consumed by deploy.sh to skip duplicate manual-setup prompt
  SETUP_CREATED_PROJECT=true

  echo ""
  echo "Creating project '${PROJECT_NAME}' (${PROJECT_ID})..."
  if ! gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"; then
    echo "ERROR: Failed to create project. The ID may already be taken — try a different one."
    return 1 2>/dev/null || exit 1
  fi

  echo ""
  echo "IMPORTANT: Complete the Cloud Console Setup before deploying."
  echo "See deploy/README.md § 'Cloud Console Setup' for full instructions."
  echo ""
  echo "  1. Link a billing account:"
  echo "     https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}"
  echo ""
  echo "  2. Configure the OAuth consent screen:"
  echo "     https://console.cloud.google.com/apis/credentials/consent?project=${PROJECT_ID}"
  echo ""
  echo "  3. Create an OAuth client ID:"
  echo "     https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"
  echo ""
  read -rp "Press Enter once you've completed these steps..."
fi

# ── Set project in gcloud config ─────────────────────────────────────────────

export PROJECT_ID
gcloud config set project "$PROJECT_ID" 2>/dev/null

echo ""
echo "PROJECT_ID=${PROJECT_ID} (exported)"

# ── Enable required APIs ─────────────────────────────────────────────────────

if [[ "$SKIP_APIS" == "false" ]]; then
  echo ""
  echo "Enabling required APIs..."
  gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    containerregistry.googleapis.com \
    sheets.googleapis.com \
    drive.googleapis.com \
    --project="$PROJECT_ID"
  echo "APIs enabled."
fi

echo ""
echo "Setup complete. You can now run:"
echo "  ./deploy/cloudrun/deploy.sh    # deploy relay server"
echo "  ./deploy/frontend/deploy.sh    # deploy frontend"
