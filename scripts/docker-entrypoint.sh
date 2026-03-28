#!/usr/bin/env bash
# Container entrypoint: seeds credentials, installs tools, runs the given command.
# No hardcoded paths — works with any project mount point.

set -euo pipefail

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

# Detect the project root from CWD (set by docker-compose working_dir or WORKDIR)
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Auto-install git hooks if in a git repo
if [[ -d "$PROJECT_ROOT/.git" ]]; then
  ln -sf ../../scripts/pre-commit-hook.sh "$PROJECT_ROOT/.git/hooks/pre-commit" 2>/dev/null || true
  ln -sf ../../scripts/post-merge-hook.sh "$PROJECT_ROOT/.git/hooks/post-merge" 2>/dev/null || true
fi

# Install fencepost binary to PATH (required by .claude/settings.json hooks)
if [[ -f "$PROJECT_ROOT/Cargo.toml" ]] && ! command -v fencepost &>/dev/null; then
  echo "[entrypoint] Installing fencepost..."
  (cd "$PROJECT_ROOT" && cargo install --path crates/fencepost 2>&1) || echo "[entrypoint] WARNING: fencepost install failed — hooks may not work"
fi

exec "$@"
