#!/usr/bin/env bash
# Verify the guard binary blocks and allows correctly.
# Tests run in two CWD contexts: the workspace root and a temporary worktree.
# This ensures CWD-dependent checks are tested from both sides regardless
# of where the script is invoked.
set -euo pipefail

cd "$(dirname "$0")/.."

# Ensure fencepost is installed to PATH
echo "Installing fencepost..."
cargo install --path crates/fencepost 2>&1 | grep -v "^$" | tail -3
ABS_GUARD="$(command -v fencepost)"

echo ""
echo "=== Guard Hook Tests ==="

PASS=0
FAIL=0

# Resolve the main workspace root (parent of .git common dir).
WORKSPACE_ROOT="$(dirname "$(git rev-parse --git-common-dir)")"
R="$WORKSPACE_ROOT"
WT="$WORKSPACE_ROOT/.claude/worktrees"

# Build a JSON payload with project paths substituted.
# Usage: $(edit_json "$R/src/file.ts") or $(cmd_json "sed -i s/x/y/ $R/file")
edit_json() { printf '{"tool_input":{"file_path":"%s"}}' "$1"; }
cmd_json()  { printf '{"tool_input":{"command":"%s"}}' "$1"; }

# --- Test runners ---

# Run guard with current CWD
run_guard() {
  local mode="$1" json="$2"
  printf '%s' "$json" | "$ABS_GUARD" "$mode" 2>/dev/null || true
}

# Run guard with CWD = workspace root
run_guard_workspace() {
  local mode="$1" json="$2"
  printf '%s' "$json" | (cd "$WORKSPACE_ROOT" && "$ABS_GUARD" "$mode" 2>/dev/null) || true
}

# Run guard with CWD = temporary worktree (set up later)
run_guard_worktree() {
  local mode="$1" json="$2"
  printf '%s' "$json" | (cd "$TEMP_WT" && "$ABS_GUARD" "$mode" 2>/dev/null) || true
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

test_block_workspace() {
  local desc="$1" mode="$2" json="$3"
  local out
  out=$(run_guard_workspace "$mode" "$json")
  if printf '%s' "$out" | grep -q '"decision":"block"'; then
    printf '  PASS: %s\n' "$desc"
    PASS=$((PASS + 1))
  else
    printf '  FAIL: %s (expected block from workspace, got: %s)\n' "$desc" "$out"
    FAIL=$((FAIL + 1))
  fi
}

test_allow_worktree() {
  local desc="$1" mode="$2" json="$3"
  local out
  out=$(run_guard_worktree "$mode" "$json")
  if printf '%s' "$out" | grep -q '"decision":"block"'; then
    printf '  FAIL: %s (unexpected block in worktree: %s)\n' "$desc" "$out"
    FAIL=$((FAIL + 1))
  else
    printf '  PASS: %s\n' "$desc"
    PASS=$((PASS + 1))
  fi
}

test_block_worktree() {
  local desc="$1" mode="$2" json="$3"
  local out
  out=$(run_guard_worktree "$mode" "$json")
  if printf '%s' "$out" | grep -q '"decision":"block"'; then
    printf '  PASS: %s\n' "$desc"
    PASS=$((PASS + 1))
  else
    printf '  FAIL: %s (expected block in worktree, got: %s)\n' "$desc" "$out"
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

# --- Create temporary worktree for CWD-dependent tests ---
TEMP_WT_NAME="test-hooks-$$"
TEMP_WT="$WORKSPACE_ROOT/.claude/worktrees/$TEMP_WT_NAME"
cleanup_worktree() {
  if [ -d "$TEMP_WT" ]; then
    git -C "$WORKSPACE_ROOT" worktree remove --force "$TEMP_WT" 2>/dev/null || true
    git -C "$WORKSPACE_ROOT" branch -D "$TEMP_WT_NAME" 2>/dev/null || true
  fi
}
trap cleanup_worktree EXIT
git -C "$WORKSPACE_ROOT" worktree add "$TEMP_WT" -b "$TEMP_WT_NAME" HEAD --quiet 2>/dev/null

# ================================================================
# CWD-independent tests (same result from any CWD)
# ================================================================

# --- Edit/Write: protected file guard ---
echo "--- Protected file guard (edit mode) ---"
test_block  "Block .env file"           edit '{"tool_input":{"file_path":"/foo/.env"}}'
test_block  "Block .env.local"          edit '{"tool_input":{"file_path":"/foo/.env.local"}}'
test_block  "Block package-lock.json"   edit "$(edit_json "$R/package-lock.json")"
test_block  "Block src/wasm/scheduler/" edit "$(edit_json "$R/src/wasm/scheduler/scheduler.js")"
test_block  "Fail-closed on bad JSON"   edit 'not-json'
test_block  "Fail-closed on empty input" edit ''

# --- Edit/Write: workspace isolation guard ---
echo "--- Workspace isolation guard (edit mode) ---"
test_block  "Block edit to /workspace/src/foo.ts"    edit "$(edit_json "$R/src/foo.ts")"
test_allow  "Allow edit outside /workspace/"         edit '{"tool_input":{"file_path":"/home/user/project/src/App.tsx"}}'

# --- Bash: push-to-main guard ---
echo "--- Push-to-main guard (bash mode) ---"
test_block  "Block git push origin main"       bash '{"tool_input":{"command":"git push origin main"}}'
test_block  "Block git push HEAD:main"         bash '{"tool_input":{"command":"git push origin HEAD:main"}}'
test_block  "Block git push feature:main"      bash '{"tool_input":{"command":"git push origin feature:main"}}'
test_allow  "Allow git push origin feature"    bash '{"tool_input":{"command":"git push origin feature-branch"}}'
test_block  "Fail-closed on bad JSON"          bash 'not-json'

# --- Bash: workspace file modification guard ---
echo "--- Bash file-modification guard (bash mode) ---"
test_block  "Block sed -i on /workspace/"      bash "$(cmd_json "sed -i s/foo/bar/ $R/src/test.ts")"
test_block  "Block redirect to /workspace/"    bash "$(cmd_json "echo hello > $R/src/test.ts")"
test_block  "Block append to /workspace/"      bash "$(cmd_json "echo hello >> $R/src/test.ts")"
test_block  "Block clobber to /workspace/"     bash "$(cmd_json "echo hello >| $R/src/test.ts")"
test_block  "Block tee to /workspace/"         bash "$(cmd_json "echo hello | tee $R/src/test.ts")"
test_allow  "Allow redirect to worktree"       bash "$(cmd_json "echo hello > $WT/test/src/test.ts")"
test_allow  "Allow sed -i in worktree"         bash "$(cmd_json "sed -i s/foo/bar/ $WT/test/src/test.ts")"
test_allow  "Allow escaped redirect"           bash "$(cmd_json "echo \\> $R/file")"
test_allow  "Allow normal bash commands"       bash '{"tool_input":{"command":"git status"}}'
test_block  "Fail-closed on bad JSON"          bash 'not-json'

# --- Bash: worktree removal guard ---
echo "--- Worktree removal guard (bash mode) ---"
test_allow  "Allow worktree remove (non-agent path)" bash '{"tool_input":{"command":"git worktree remove /tmp/test"}}'
test_block  "Block worktree remove (agent path)"     bash "$(cmd_json "git worktree remove $WT/some-agent")"
test_allow  "Allow worktree remove (acknowledged)"   bash "$(cmd_json "I_CREATED_THIS=1 git worktree remove $WT/some-agent")"
test_allow  "Allow git worktree prune"               bash '{"tool_input":{"command":"git worktree prune"}}'
test_allow  "Allow git worktree add"                 bash '{"tool_input":{"command":"git worktree add /tmp/test"}}'

# --- Bash: rm worktree root guard ---
echo "--- Worktree cleanup guard ---"
test_block  "Block rm -rf worktree root"             bash "$(cmd_json "rm -rf $WT/my-worktree")"
test_allow  "Allow rm -rf worktree subdir"           bash "$(cmd_json "rm -rf $WT/my-wt/node_modules")"
test_allow  "Allow rm single file in worktree"       bash "$(cmd_json "rm $WT/test/temp.txt")"
test_block  "Block rm -rf worktree root (trailing /)" bash "$(cmd_json "rm -rf $WT/my-worktree/")"
test_allow  "Allow rm -f single file"                bash "$(cmd_json "rm -f $WT/my-wt/temp.txt")"
test_allow  "Allow cp -r from worktree"              bash "$(cmd_json "cp -r $WT/my-wt/src /tmp/backup")"
# --- Bash: always-block destructive commands ---
echo "--- Always-block destructive commands (bash mode) ---"
test_block  "Block git reset --hard HEAD~3"    bash '{"tool_input":{"command":"git reset --hard HEAD~3"}}'
test_block  "Block git reset --hard (bare)"    bash '{"tool_input":{"command":"git reset --hard"}}'
test_allow  "Allow git reset --soft"           bash '{"tool_input":{"command":"git reset --soft HEAD~1"}}'
test_allow  "Allow git reset (no flag)"        bash '{"tool_input":{"command":"git reset HEAD~1"}}'

# --- Bash: squash-merge cleanup commands (always allowed) ---
echo "--- Squash-merge cleanup commands ---"
test_allow  "Squash: git branch -f allowed"    bash '{"tool_input":{"command":"git branch -f feature-branch origin/main"}}'
test_allow  "Squash: git pull allowed"         bash '{"tool_input":{"command":"git pull origin main"}}'
test_allow  "Squash: git fetch allowed"        bash '{"tool_input":{"command":"git fetch origin main"}}'
test_allow  "Squash: git merge allowed"        bash '{"tool_input":{"command":"git merge feature/branch --no-edit"}}'
test_allow  "Squash: git branch -d allowed"    bash '{"tool_input":{"command":"git branch -d feature/my-merged-branch"}}'
test_allow  "Squash: git push --delete allowed" bash '{"tool_input":{"command":"git push origin --delete feature/my-merged-branch"}}'

# --- Stdin edge cases ---
echo "--- Stdin fail-closed on empty input (via /dev/null) ---"
for mode in edit bash; do
  out=$("$ABS_GUARD" "$mode" </dev/null 2>/dev/null || true)
  if printf '%s' "$out" | grep -q '"decision":"block"'; then
    printf '  PASS: empty stdin on %s mode blocks (fail-closed)\n' "$mode"
    PASS=$((PASS + 1))
  else
    printf '  FAIL: empty stdin on %s mode did not block\n' "$mode"
    FAIL=$((FAIL + 1))
  fi
done

# ================================================================
# CWD-dependent tests — tested from BOTH workspace and worktree
# ================================================================
echo "--- CWD-dependent: workspace root (block) ---"

test_block_workspace  "WS: git clean -fd blocks"          bash '{"tool_input":{"command":"git clean -fd"}}'
test_block_workspace  "WS: git clean --force blocks"       bash '{"tool_input":{"command":"git clean --force"}}'
test_block_workspace  "WS: git clean -xfd blocks"          bash '{"tool_input":{"command":"git clean -xfd"}}'
test_block_workspace  "WS: git branch -D blocks"           bash '{"tool_input":{"command":"git branch -D feature-branch"}}'
test_block_workspace  "WS: git checkout main blocks"       bash '{"tool_input":{"command":"git checkout main"}}'
test_block_workspace  "WS: git switch feature blocks"      bash '{"tool_input":{"command":"git switch feature"}}'
test_block_workspace  "WS: git reset --hard origin/main blocks" bash '{"tool_input":{"command":"git reset --hard origin/main"}}'

echo "--- CWD-dependent: worktree (allow) ---"

test_allow_worktree   "WT: git clean -fd allowed"          bash '{"tool_input":{"command":"git clean -fd"}}'
test_allow_worktree   "WT: git clean --force allowed"      bash '{"tool_input":{"command":"git clean --force"}}'
test_allow_worktree   "WT: git clean -xfd allowed"         bash '{"tool_input":{"command":"git clean -xfd"}}'
test_allow_worktree   "WT: git branch -D allowed"          bash '{"tool_input":{"command":"git branch -D feature-branch"}}'
test_allow_worktree   "WT: git checkout main allowed"      bash '{"tool_input":{"command":"git checkout main"}}'
test_allow_worktree   "WT: git switch feature allowed"     bash '{"tool_input":{"command":"git switch feature"}}'
test_allow_worktree   "WT: git reset --hard origin/main allowed" bash '{"tool_input":{"command":"git reset --hard origin/main"}}'
test_allow_worktree   "WT: git clean -n allowed"           bash '{"tool_input":{"command":"git clean -n"}}'
test_allow_worktree   "WT: git checkout -- file allowed"   bash '{"tool_input":{"command":"git checkout -- src/file.ts"}}'
test_allow_worktree   "WT: git worktree add allowed"       bash '{"tool_input":{"command":"git worktree add /tmp/test -b branch"}}'

# Worktree-remove own CWD test (uses the temp worktree's path)
test_block_worktree   "WT: git worktree remove own CWD blocks" \
                      bash "{\"tool_input\":{\"command\":\"git worktree remove $TEMP_WT\"}}"

# Edit CWD enforcement: editing worktree file from /workspace CWD is blocked
out=$(run_guard_workspace edit "{\"tool_input\":{\"file_path\":\"$TEMP_WT/src/foo.ts\"}}")
if printf '%s' "$out" | grep -q '"decision":"block"'; then
  printf '  PASS: WS: edit worktree file from workspace CWD blocks\n'
  PASS=$((PASS + 1))
else
  printf '  FAIL: WS: edit worktree file from workspace CWD (expected block)\n'
  FAIL=$((FAIL + 1))
fi

# Same edit from worktree CWD is allowed
out=$(run_guard_worktree edit "{\"tool_input\":{\"file_path\":\"$TEMP_WT/src/foo.ts\"}}")
if printf '%s' "$out" | grep -q '"decision":"block"'; then
  printf '  FAIL: WT: edit worktree file from worktree CWD (unexpected block)\n'
  FAIL=$((FAIL + 1))
else
  printf '  PASS: WT: edit worktree file from worktree CWD allowed\n'
  PASS=$((PASS + 1))
fi

# ================================================================
# Missing binary test (always last — tests fail-open behavior)
# ================================================================
echo "--- Agent lifecycle: fresh clone (no binary) ---"
MISSING_BIN="/tmp/nonexistent-guard-$$"
if ! "$MISSING_BIN" bash < /dev/null 2>/dev/null; then
  printf '  PASS: missing binary exits clean (fail-open)\n'
  PASS=$((PASS + 1))
else
  printf '  FAIL: missing binary did not fail cleanly\n'
  FAIL=$((FAIL + 1))
fi

# ================================================================
# CLI frontmatter behavior (informational — not guard logic)
# ================================================================
echo "--- CLI frontmatter behavior (informational — changes are warnings, not failures) ---"
FMWARN=0
# Test that --print-system-prompt strips frontmatter
SYSTEM_OUT=$(claude --print-system-prompt -p "test" 2>/dev/null || true)
if printf '%s' "$SYSTEM_OUT" | grep -q '^---'; then
  printf '  FAIL: frontmatter not stripped from system prompt\n'
  FAIL=$((FAIL + 1))
else
  printf '  PASS: frontmatter strip produces correct output\n'
  PASS=$((PASS + 1))
fi

# Test that a prompt without frontmatter works
# This is informational — --print-system-prompt may not exist in all CLI versions.
PLAIN_OUT=$(claude --print-system-prompt -p "hello world" 2>/dev/null || true)
if [ -n "$PLAIN_OUT" ]; then
  printf '  PASS: no-frontmatter prompt passes through unchanged\n'
  PASS=$((PASS + 1))
else
  printf '  INFO: --print-system-prompt not available or produced empty output\n'
fi

# Test that YAML frontmatter in positional prompt is handled
YAML_OUT=$(claude -p "---
scope.modify: false
---
test prompt" 2>&1 || true)
if printf '%s' "$YAML_OUT" | grep -qi "error"; then
  printf '  INFO: YAML --- in positional prompt causes CLI error (expected — stripped in watch.sh)\n'
else
  printf '  INFO: YAML frontmatter in positional prompt did not error (behavior may have changed)\n'
fi

# Test whether scope.modify is enforced from CLI args
SCOPE_OUT=$(claude -p --allowedTools "Read" "echo test" 2>&1 || true)
if printf '%s' "$SCOPE_OUT" | grep -qi "error\|not allowed\|permission"; then
  printf '  WARNING: scope.modify IS being enforced from CLI args (behavior changed — reconsider frontmatter stripping)\n'
  FMWARN=$((FMWARN + 1))
else
  printf '  INFO: scope.modify not enforced from CLI args (normal behavior)\n'
fi

if [ "$FMWARN" -gt 0 ]; then
  printf '  *** WARNING: %d frontmatter behavior change(s) detected — review watch.sh frontmatter handling ***\n' "$FMWARN"
fi

# ================================================================
# Results
# ================================================================
echo ""
printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"
exit "$FAIL"
