#!/usr/bin/env bash
# scripts/reset-hooks.sh — Emergency recovery when PreToolUse hooks brick a session.
#
# Run this from YOUR TERMINAL (not Claude Code) when all tools are blocked:
#   bash /workspace/scripts/reset-hooks.sh
#
# What it does: temporarily removes all hooks from settings.json so tools work again.
# The hook definitions are preserved in git — restore them after fixing the bug:
#   git checkout -- .claude/settings.json
#
# After recovery, fix the hooks and re-run: bash scripts/test-hooks.sh

set -euo pipefail

TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || echo "/workspace")
SETTINGS="${TOPLEVEL}/.claude/settings.json"

if [[ ! -f "$SETTINGS" ]]; then
  echo "ERROR: $SETTINGS not found"
  exit 1
fi

# Verify hooks are actually broken by checking if test-hooks.sh fails
if bash "$(dirname "$0")/test-hooks.sh" 2>/dev/null; then
  echo "Hooks are passing all tests — no reset needed."
  exit 0
fi

echo "Hook tests failing. Removing hooks from settings.json..."

# Back up current settings
cp "$SETTINGS" "${SETTINGS}.bak"
echo "Backup saved to ${SETTINGS}.bak"

# Remove hooks while preserving everything else
node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));
delete settings.hooks;
fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2) + '\n');
console.log('Hooks removed. Tools should work now.');
console.log('');
console.log('To restore hooks after fixing: git checkout -- .claude/settings.json');
console.log('To verify restored hooks work:  bash scripts/test-hooks.sh');
"
