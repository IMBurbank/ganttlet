#!/usr/bin/env bash
# Verify the guard binary blocks and allows correctly.
# Tests the same functional cases as the original node-VM hook tests.
set -euo pipefail

cd "$(dirname "$0")/.."

GUARD="./target/release/guard"

echo "Building guard binary..."
cargo build --release -p guard 2>&1 | grep -v "^$" | tail -5

echo ""
echo "=== Guard Hook Tests ==="

PASS=0
FAIL=0

run_guard() {
  local mode="$1"
  local json="$2"
  printf '%s' "$json" | "$GUARD" "$mode" 2>/dev/null || true
}

test_block() {
  local desc="$1" mode="$2" json="$3"
  local out
  out=$(run_guard "$mode" "$json")
  if printf '%s' "$out" | grep -q '"decision":"block"'; then
    printf '  PASS: %s\n' "$desc"
    PASS=$((PASS + 1))
  else
    printf '  FAIL: %s (expected block, got: %s)\n' "$desc" "$out"
    FAIL=$((FAIL + 1))
  fi
}

test_allow() {
  local desc="$1" mode="$2" json="$3"
  local out
  out=$(run_guard "$mode" "$json")
  if printf '%s' "$out" | grep -q '"decision":"block"'; then
    printf '  FAIL: %s (unexpected block: %s)\n' "$desc" "$out"
    FAIL=$((FAIL + 1))
  else
    printf '  PASS: %s\n' "$desc"
    PASS=$((PASS + 1))
  fi
}

# --- Edit/Write: protected file guard ---
echo "--- Protected file guard (edit mode) ---"
test_block  "Block .env file"           edit '{"tool_input":{"file_path":"/foo/.env"}}'
test_block  "Block package-lock.json"   edit '{"tool_input":{"file_path":"/workspace/package-lock.json"}}'
test_block  "Block src/wasm/scheduler/" edit '{"tool_input":{"file_path":"/workspace/src/wasm/scheduler/scheduler.js"}}'
test_block  "Fail-closed on bad JSON"   edit 'not-json'
test_block  "Fail-closed on empty input" edit ''

# --- Edit/Write: workspace isolation guard ---
echo "--- Workspace isolation guard (edit mode) ---"
test_block  "Block edit to /workspace/src/foo.ts"           edit '{"tool_input":{"file_path":"/workspace/src/foo.ts"}}'
test_allow  "Allow edit to worktree file"                   edit '{"tool_input":{"file_path":"/workspace/.claude/worktrees/test/src/foo.ts"}}'
test_allow  "Allow edit to file outside /workspace/"        edit '{"tool_input":{"file_path":"/home/user/project/src/App.tsx"}}'

# --- Bash: push-to-main guard ---
echo "--- Push-to-main guard (bash mode) ---"
test_block  "Block git push origin main"      bash '{"tool_input":{"command":"git push origin main"}}'
test_allow  "Allow git push origin feature"   bash '{"tool_input":{"command":"git push origin feature-branch"}}'
test_block  "Fail-closed on bad JSON"         bash 'not-json'

# --- Bash: checkout/switch guard ---
echo "--- Checkout/switch guard (bash mode) ---"
test_block  "Block git checkout main"         bash '{"tool_input":{"command":"git checkout main"}}'
test_block  "Block git switch feature"        bash '{"tool_input":{"command":"git switch feature"}}'
test_allow  "Allow git worktree add"          bash '{"tool_input":{"command":"git worktree add /tmp/test -b branch"}}'
test_allow  "Allow git checkout -- file"      bash '{"tool_input":{"command":"git checkout -- src/file.ts"}}'
test_block  "Fail-closed on bad JSON"         bash 'not-json'

# --- Bash: destructive git command guard ---
echo "--- Destructive git command guard (bash mode) ---"
test_block  "Block git reset --hard"            bash '{"tool_input":{"command":"git reset --hard HEAD~3"}}'
test_allow  "Allow git reset --soft"            bash '{"tool_input":{"command":"git reset --soft HEAD~1"}}'
test_allow  "Allow git reset (no flag)"         bash '{"tool_input":{"command":"git reset HEAD~1"}}'
test_block  "Block git clean -fd"               bash '{"tool_input":{"command":"git clean -fd"}}'
test_block  "Block git clean --force"           bash '{"tool_input":{"command":"git clean --force"}}'
test_allow  "Allow git clean -n (dry run)"      bash '{"tool_input":{"command":"git clean -n"}}'
test_block  "Block git branch -D"               bash '{"tool_input":{"command":"git branch -D feature-branch"}}'
test_allow  "Allow git branch -d (safe delete)" bash '{"tool_input":{"command":"git branch -d feature-branch"}}'
test_allow  "Allow git branch piped to grep -D" bash '{"tool_input":{"command":"git branch -a | grep -D 3 pattern"}}'
test_block  "Block git clean -xfd (combined)"   bash '{"tool_input":{"command":"git clean -xfd"}}'

# --- Bash: worktree removal guard ---
echo "--- Worktree removal guard (bash mode) ---"
test_block  "Block git worktree remove"       bash '{"tool_input":{"command":"git worktree remove /tmp/test"}}'
test_block  "Block git worktree prune"        bash '{"tool_input":{"command":"git worktree prune"}}'
test_allow  "Allow git worktree add"          bash '{"tool_input":{"command":"git worktree add /tmp/test"}}'
test_block  "Fail-closed on bad JSON"         bash 'not-json'

# --- Bash: file-modification guard ---
echo "--- Bash file-modification guard (bash mode) ---"
test_block  "Block sed -i on /workspace/"           bash '{"tool_input":{"command":"sed -i s/foo/bar/ /workspace/src/test.ts"}}'
test_block  "Block redirect to /workspace/"         bash '{"tool_input":{"command":"echo hello > /workspace/src/test.ts"}}'
test_block  "Block tee to /workspace/"              bash '{"tool_input":{"command":"echo hello | tee /workspace/src/test.ts"}}'
test_allow  "Allow sed -i in worktree"              bash '{"tool_input":{"command":"sed -i s/foo/bar/ /workspace/.claude/worktrees/test/src/test.ts"}}'
test_allow  "Allow redirect to worktree"            bash '{"tool_input":{"command":"echo hello > /workspace/.claude/worktrees/test/src/test.ts"}}'
test_allow  "Allow normal bash commands"            bash '{"tool_input":{"command":"git status"}}'
test_block  "Fail-closed on bad JSON"               bash 'not-json'

# --- Infrastructure error simulation ---
# /dev/null gives Ok("") in Rust (not ENXIO), so fail-closed (block) is correct here.
# True ENXIO/EAGAIN/ENOENT behavior (fail-open) is verified by `cargo test -p guard`.
echo "--- Stdin fail-closed on empty input (via /dev/null) ---"
for mode in edit bash; do
  out=$("$GUARD" "$mode" </dev/null 2>/dev/null || true)
  if printf '%s' "$out" | grep -q '"decision":"block"'; then
    printf '  PASS: empty stdin on %s mode blocks (fail-closed)\n' "$mode"
    PASS=$((PASS + 1))
  else
    printf '  FAIL: empty stdin on %s mode did not block — unexpected allow\n' "$mode"
    FAIL=$((FAIL + 1))
  fi
done

printf '\nResults: %d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
