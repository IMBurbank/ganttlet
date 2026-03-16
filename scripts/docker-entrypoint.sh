#!/usr/bin/env bash
# Seed container-local gcloud config from host credentials (read-only mount).
# Runs once per fresh volume — skips if already initialized.

GCLOUD_DIR="$HOME/.config/gcloud"
GCLOUD_HOST="$HOME/.config/gcloud-host"

# Ensure ~/.config is writable (gh auth needs ~/.config/gh/)
if [[ -d "$HOME/.config" && ! -w "$HOME/.config" ]]; then
  sudo chown "$(id -u):$(id -g)" "$HOME/.config"
fi

# Ensure the named volume is owned by the current user (Docker creates it as root)
if [[ -d "$GCLOUD_DIR" && ! -w "$GCLOUD_DIR" ]]; then
  sudo chown -R "$(id -u):$(id -g)" "$GCLOUD_DIR"
fi

# If .gitconfig is a bind mount owned by root, copy it so git/gh can write to it
if [[ -f "$HOME/.gitconfig" && ! -w "$HOME/.gitconfig" ]]; then
  cp "$HOME/.gitconfig" "$HOME/.gitconfig.tmp"
  sudo mv "$HOME/.gitconfig.tmp" "$HOME/.gitconfig"
  sudo chown "$(id -u):$(id -g)" "$HOME/.gitconfig"
fi

if [[ -d "$GCLOUD_HOST" && ! -f "$GCLOUD_DIR/.seeded" ]]; then
  echo "[entrypoint] Seeding gcloud config from host credentials..."
  cp -a "$GCLOUD_HOST/." "$GCLOUD_DIR/" 2>/dev/null || true
  touch "$GCLOUD_DIR/.seeded"
fi

# Auto-install git hooks if in a git repo
if [[ -d /workspace/.git ]]; then
  ln -sf ../../scripts/pre-commit-hook.sh /workspace/.git/hooks/pre-commit 2>/dev/null || true
fi

# Build guard binary (required by .claude/settings.json hooks) if not already built
if [[ -f /workspace/Cargo.toml && ! -x /workspace/target/release/guard ]]; then
  echo "[entrypoint] Building guard binary..."
  (cd /workspace && cargo build --release -p guard 2>&1) || echo "[entrypoint] WARNING: guard build failed — hooks may not work"
fi

exec "$@"
