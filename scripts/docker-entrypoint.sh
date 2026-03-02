#!/usr/bin/env bash
# Seed container-local gcloud config from host credentials (read-only mount).
# Runs once per fresh volume — skips if already initialized.

GCLOUD_DIR="$HOME/.config/gcloud"
GCLOUD_HOST="$HOME/.config/gcloud-host"

# Ensure the named volume is owned by the current user (Docker creates it as root)
if [[ -d "$GCLOUD_DIR" && ! -w "$GCLOUD_DIR" ]]; then
  sudo chown -R "$(id -u):$(id -g)" "$GCLOUD_DIR"
fi

if [[ -d "$GCLOUD_HOST" && ! -f "$GCLOUD_DIR/.seeded" ]]; then
  echo "[entrypoint] Seeding gcloud config from host credentials..."
  cp -a "$GCLOUD_HOST/." "$GCLOUD_DIR/" 2>/dev/null || true
  touch "$GCLOUD_DIR/.seeded"
fi

exec "$@"
