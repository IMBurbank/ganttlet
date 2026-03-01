#!/usr/bin/env bash
# PostToolUse hook: runs tsc + vitest after edits to .ts/.tsx files.
# Always exits 0 — this hook provides feedback, not gating.

set -euo pipefail

# Read the hook JSON from stdin
INPUT=$(cat)

# Extract the file path using node (jq not guaranteed)
FILE=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try { console.log(JSON.parse(d).tool_input.file_path||''); }
    catch { console.log(''); }
  });
")

# Skip non-TS/TSX files
if [[ ! "$FILE" =~ \.(ts|tsx)$ ]]; then
  exit 0
fi

echo "--- verify: $FILE ---"

# Type-check
echo "[tsc]"
npx tsc --noEmit 2>&1 | tail -20 || true

# Unit tests
echo "[vitest]"
npx vitest run --reporter=dot 2>&1 | tail -30 || true

exit 0
