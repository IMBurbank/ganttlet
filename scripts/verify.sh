#!/usr/bin/env bash
# PostToolUse hook: runs tsc + vitest after edits to .ts/.tsx files.
# Exits non-zero if either check fails, so agents know to fix errors.

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
TSC_EXIT=0
npx tsc --noEmit 2>&1 | tail -20 || TSC_EXIT=$?

# Unit tests
echo "[vitest]"
VITEST_EXIT=0
npx vitest run --reporter=dot 2>&1 | tail -30 || VITEST_EXIT=$?

if [[ $TSC_EXIT -ne 0 || $VITEST_EXIT -ne 0 ]]; then
  exit 1
fi

exit 0
