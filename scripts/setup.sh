#!/usr/bin/env bash
# Project setup — installs dependencies and tools required by Claude Code hooks.
# Run this once after cloning, or after pulling changes to crates/fencepost/.
#
# Docker users: docker-entrypoint.sh handles this automatically.

set -euo pipefail

echo "=== Project Setup ==="

# Detect project root
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$PROJECT_ROOT"

# Install Node dependencies
if [[ -f package.json ]]; then
  echo "Installing Node dependencies..."
  npm install
fi

# Install fencepost (agent workflow guard)
if [[ -f crates/fencepost/Cargo.toml ]]; then
  echo "Installing fencepost..."
  cargo install --path crates/fencepost
  echo "  Installed: $(command -v fencepost)"
fi

echo ""
echo "Setup complete. Fencepost is on PATH — Claude Code hooks are active."
