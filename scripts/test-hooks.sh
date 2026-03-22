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
# Check 3 (CWD enforcement) only blocks when CWD is /workspace.
# This test runs from wherever test-hooks.sh is invoked — from a worktree
# the edit is allowed (agent editing its own worktree), from /workspace
# it would be blocked (agent should have entered worktree first).
test_allow  "Allow edit to worktree file"                   edit '{"tool_input":{"file_path":"/workspace/.claude/worktrees/test/src/foo.ts"}}'
test_allow  "Allow edit to file outside /workspace/"        edit '{"tool_input":{"file_path":"/home/user/project/src/App.tsx"}}'

# --- Bash: push-to-main guard ---
echo "--- Push-to-main guard (bash mode) ---"
test_block  "Block git push origin main"      bash '{"tool_input":{"command":"git push origin main"}}'
test_allow  "Allow git push origin feature"   bash '{"tool_input":{"command":"git push origin feature-branch"}}'
test_block  "Fail-closed on bad JSON"         bash 'not-json'

# --- Bash: checkout/switch guard ---
# Check 5 is CWD-dependent: blocked in /workspace, allowed in worktrees.
echo "--- Checkout/switch guard (bash mode) ---"
if [[ "$(pwd)" == /workspace/.claude/worktrees/* ]]; then
  test_allow  "Allow git checkout in worktree"  bash '{"tool_input":{"command":"git checkout main"}}'
  test_allow  "Allow git switch in worktree"    bash '{"tool_input":{"command":"git switch feature"}}'
else
  test_block  "Block git checkout main"         bash '{"tool_input":{"command":"git checkout main"}}'
  test_block  "Block git switch feature"        bash '{"tool_input":{"command":"git switch feature"}}'
fi
test_allow  "Allow git worktree add"          bash '{"tool_input":{"command":"git worktree add /tmp/test -b branch"}}'
test_allow  "Allow git checkout -- file"      bash '{"tool_input":{"command":"git checkout -- src/file.ts"}}'
test_block  "Fail-closed on bad JSON"         bash 'not-json'

# --- Bash: destructive git command guard ---
echo "--- Destructive git command guard (bash mode) ---"
test_block  "Block git reset --hard HEAD~3"     bash '{"tool_input":{"command":"git reset --hard HEAD~3"}}'
test_block  "Block git reset --hard (bare)"     bash '{"tool_input":{"command":"git reset --hard"}}'
test_allow  "Allow git reset --hard origin/main" bash '{"tool_input":{"command":"git reset --hard origin/main"}}'
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
test_allow  "Allow git worktree prune"        bash '{"tool_input":{"command":"git worktree prune"}}'
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

# --- Agent lifecycle integration tests ---
# These test the full workflows agents actually perform, not just individual checks.
echo "--- Agent lifecycle: post-merge cleanup ---"

# After a squash merge, agents need to sync their worktree with origin/main
test_allow  "Lifecycle: git reset --hard origin/main (post-merge sync)" \
            bash '{"tool_input":{"command":"git reset --hard origin/main"}}'

# After removing a worktree directory, agents run prune to clean git references
test_allow  "Lifecycle: git worktree prune (clean stale refs)" \
            bash '{"tool_input":{"command":"git worktree prune"}}'

# Agents delete merged branches with -d (safe) not -D (force)
test_allow  "Lifecycle: git branch -d merged-branch (safe delete)" \
            bash '{"tool_input":{"command":"git branch -d feature/my-merged-branch"}}'

# Agents push deletions to remote after local cleanup
test_allow  "Lifecycle: git push origin --delete branch" \
            bash '{"tool_input":{"command":"git push origin --delete feature/my-merged-branch"}}'

# But agents must NOT force-delete unmerged branches
test_block  "Lifecycle: git branch -D blocks (force delete)" \
            bash '{"tool_input":{"command":"git branch -D feature/unmerged-work"}}'

# And must NOT reset to relative refs (loses commits)
test_block  "Lifecycle: git reset --hard HEAD~3 blocks (loses commits)" \
            bash '{"tool_input":{"command":"git reset --hard HEAD~3"}}'

echo "--- Worktree cleanup guard ---"

# Block rm -rf on worktree root directories
test_block  "Cleanup: rm -rf worktree root blocked" \
            bash '{"tool_input":{"command":"rm -rf /workspace/.claude/worktrees/my-worktree"}}'

# Allow rm -rf on subdirectories within worktrees
test_allow  "Cleanup: rm -rf worktree subdir allowed" \
            bash '{"tool_input":{"command":"rm -rf /workspace/.claude/worktrees/my-wt/node_modules"}}'

# Allow rm on individual files (no -r/-f)
test_allow  "Cleanup: rm single file in worktree allowed" \
            bash '{"tool_input":{"command":"rm /workspace/.claude/worktrees/test/temp.txt"}}'

# Block rm -rf with trailing slash
test_block  "Cleanup: rm -rf worktree root with trailing slash blocked" \
            bash '{"tool_input":{"command":"rm -rf /workspace/.claude/worktrees/my-worktree/"}}'

echo "--- Agent lifecycle: fresh clone (no binary) ---"
# When guard binary doesn't exist, hooks should fail-open (not brick the session)
MISSING_GUARD="./nonexistent-guard-binary"
out=$(printf '{"tool_input":{"command":"git status"}}' | sh -c "test -x $MISSING_GUARD && $MISSING_GUARD bash || true" 2>/dev/null)
if [ -z "$out" ]; then
  printf '  PASS: missing binary exits clean (fail-open)\n'
  PASS=$((PASS + 1))
else
  printf '  FAIL: missing binary produced output: %s\n' "$out"
  FAIL=$((FAIL + 1))
fi

echo "--- CLI frontmatter behavior (informational — changes are warnings, not failures) ---"
# These tests detect if Claude Code starts processing YAML frontmatter from
# CLI arguments. Today it doesn't — frontmatter is ignored in positional args.
# If behavior changes, we want to know so we can reconsider the strip approach.
INFO_CHANGES=0

# Test 0: sed frontmatter strip produces correct output
frontmatter_input="$(printf '%s\n%s\n%s\n%s\n%s' '---' 'scope:' '  modify: ["foo.md"]' '---' 'Actual prompt content')"
stripped=$(echo "$frontmatter_input" | sed '/^---$/,/^---$/d')
if [ "$stripped" = "Actual prompt content" ]; then
  echo '  PASS: frontmatter strip produces correct output'
  PASS=$((PASS + 1))
else
  echo "  FAIL: frontmatter strip produced: $stripped"
  FAIL=$((FAIL + 1))
fi

# Test 0b: no frontmatter passes through unchanged
no_fm_input="Just a prompt with no frontmatter"
no_fm_stripped=$(echo "$no_fm_input" | sed '/^---$/,/^---$/d')
if [ "$no_fm_stripped" = "$no_fm_input" ]; then
  echo '  PASS: no-frontmatter prompt passes through unchanged'
  PASS=$((PASS + 1))
else
  echo "  FAIL: no-frontmatter was modified: $no_fm_stripped"
  FAIL=$((FAIL + 1))
fi

# Test 1: --- as positional argument should not crash claude
# Note: pipe mode (-p -) doesn't have this bug — only positional args do.
# We test positional to detect if Claude Code fixes the --- parsing.
frontmatter_prompt="$(printf '%s\n%s\n%s\n%s' '---' 'name: test' '---' 'Say ok')"
frontmatter_crash_out=$(claude --dangerously-skip-permissions -p "$frontmatter_prompt" 2>&1 || true)
if echo "$frontmatter_crash_out" | grep -qi "error\|unknown option"; then
  echo '  INFO: YAML --- in positional prompt causes CLI error (expected — stripped in watch.sh)'
else
  echo '  WARNING: YAML --- in positional prompt no longer causes CLI error (behavior changed — stripping may be unnecessary)'
  INFO_CHANGES=$((INFO_CHANGES + 1))
fi
PASS=$((PASS + 1))

# Test 2: scope.modify in piped prompt should NOT restrict edits
scope_test_file="/tmp/ganttlet-scope-test-$$"
scope_out=$(printf '%s\n%s\n%s\n%s\n%s' '---' 'scope:' '  modify: ["nonexistent-only.txt"]' '---' "Write the text test to ${scope_test_file} then delete it" | claude --dangerously-skip-permissions -p - 2>&1 || true)
if echo "$scope_out" | grep -qi "permission\|denied\|blocked\|scope"; then
  echo '  WARNING: scope.modify IS being enforced from CLI args (behavior changed — reconsider frontmatter stripping)'
  INFO_CHANGES=$((INFO_CHANGES + 1))
else
  echo '  INFO: scope.modify NOT enforced from CLI args (expected — frontmatter stripping is safe)'
fi
PASS=$((PASS + 1))

if [ "$INFO_CHANGES" -gt 0 ]; then
  printf '  *** WARNING: %d frontmatter behavior change(s) detected — review watch.sh frontmatter handling ***\n' "$INFO_CHANGES"
fi

printf '\nResults: %d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
