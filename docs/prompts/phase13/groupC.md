# Phase 13 Group C — Hooks & Guardrails

You are implementing Phase 13 Group C for the Ganttlet project.
Read CLAUDE.md and `docs/agent-orchestration-recommendations.md` (Sections 2B, 8, and 13) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

## Success Criteria (you're done when ALL of these are true):
1. `scripts/verify.sh` supports `AGENT_SCOPE` env var (rust, ts, full)
2. `scripts/verify.sh` has output deduplication (same result as previous run shows 1-line summary)
3. `scripts/verify.sh` has rate limiting (skips if last run was < 30 seconds ago)
4. `scripts/verify.sh` uses compact output (JSON reporter for vitest, error-count-first for tsc)
5. `scripts/pre-commit-hook.sh` exists and rejects `todo!()`, `unimplemented!()`, and commented-out tests
6. `.claude/settings.local.json` is valid JSON and hooks still work
7. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- `bash -n scripts/verify.sh` fails
- `bash -n scripts/pre-commit-hook.sh` fails
- `.claude/settings.local.json` is invalid JSON
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool. Agents edit code and get automatic
verification feedback via a PostToolUse hook (`scripts/verify.sh`). The hook currently runs
`tsc --noEmit` + `vitest run` on every `.ts/.tsx` edit, producing 30-50 lines of output
each time. Over a session with many edits, this floods the agent's context.

## Your files (ONLY modify these):
- `scripts/verify.sh`
- `scripts/pre-commit-hook.sh` (new file)
- `.claude/settings.local.json`

Do NOT modify `CLAUDE.md`, `scripts/launch-phase.sh`, `.github/`, or any source code files.
Other agents own those files.

## Progress Tracking

After completing each major task (C1, C2, etc.), append a status line to `claude-progress.txt`
in the worktree root:

```
C1: DONE — added AGENT_SCOPE support to verify.sh
C2: IN PROGRESS — implementing output dedup
```

On restart, read `claude-progress.txt` FIRST to understand where you left off.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK (not "stop all work").
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.
- Emergency: If running out of context, `git add -A && git commit -m "emergency: groupC saving work"`.

## Tasks — execute in order:

### C1: Fix exit code capture bug and add agent-scope awareness to verify.sh

Read the current `scripts/verify.sh` (42 lines). It runs tsc + vitest for all .ts/.tsx edits.
For Rust-focused agents, this is irrelevant noise.

**IMPORTANT — Pre-existing bug to fix first:** The current exit code capture is broken:
```bash
npx tsc --noEmit 2>&1 | tail -20 || TSC_EXIT=$?
```
In a pipe, `$?` is the exit code of `tail` (the last command), NOT `tsc`. Since `tail` almost
never fails, `TSC_EXIT` always stays 0. Fix this by using `PIPESTATUS` or running without pipe:
```bash
TSC_OUTPUT=$(npx tsc --noEmit 2>&1) || true
TSC_EXIT=${PIPESTATUS[0]:-$?}
```
Apply the same fix to the vitest invocation. This bug means verify.sh currently never reports
real failures to agents — fix it before adding new features.

1. Add an `AGENT_SCOPE` env var check near the top of the script, after the file path extraction:
```bash
AGENT_SCOPE="${AGENT_SCOPE:-full}"
```

2. Add scope-based routing:
```bash
case "$AGENT_SCOPE" in
  rust)
    # Only check Rust files
    if [[ ! "$FILE" =~ \.(rs)$ ]]; then
      exit 0
    fi
    echo "[cargo check]"
    (cd crates/scheduler && cargo check 2>&1 | tail -20)
    exit $?
    ;;
  ts)
    # Only check TypeScript files (current behavior)
    if [[ ! "$FILE" =~ \.(ts|tsx)$ ]]; then
      exit 0
    fi
    # ... existing tsc + vitest logic ...
    ;;
  full|*)
    # Check based on file type (current behavior)
    if [[ "$FILE" =~ \.(rs)$ ]]; then
      echo "[cargo check]"
      (cd crates/scheduler && cargo check 2>&1 | tail -20)
      exit $?
    fi
    if [[ ! "$FILE" =~ \.(ts|tsx)$ ]]; then
      exit 0
    fi
    # ... existing tsc + vitest logic ...
    ;;
esac
```

3. Keep the existing behavior as the default (backwards compatible).
4. Verify: `bash -n scripts/verify.sh` — no syntax errors
5. Commit: `"feat(hooks): add AGENT_SCOPE env var to verify.sh for scope-aware verification"`

### C2: Add output deduplication

When the same test/compile output repeats across runs, show a 1-line summary instead of the full output.

1. Define a temp file path for storing previous output hash:
```bash
VERIFY_HASH_FILE="${TMPDIR:-/tmp}/.verify-hash-$(echo "$FILE" | md5sum | cut -d' ' -f1)"
```

2. After running tsc, compare output to previous:
```bash
TSC_OUTPUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?
TSC_HASH=$(echo "$TSC_OUTPUT" | md5sum | cut -d' ' -f1)

if [[ -f "${VERIFY_HASH_FILE}-tsc" ]] && [[ "$(cat "${VERIFY_HASH_FILE}-tsc")" == "$TSC_HASH" ]]; then
  if [[ $TSC_EXIT -ne 0 ]]; then
    ERROR_COUNT=$(echo "$TSC_OUTPUT" | grep -c "error TS" || echo "0")
    echo "[tsc: same ${ERROR_COUNT} errors as previous run]"
  else
    echo "[tsc: still clean]"
  fi
else
  # New/different output — show it
  if [[ $TSC_EXIT -ne 0 ]]; then
    ERROR_COUNT=$(echo "$TSC_OUTPUT" | grep -c "error TS" || echo "0")
    echo "[tsc: ${ERROR_COUNT} errors]"
    echo "$TSC_OUTPUT" | grep "error TS" | head -5
  else
    echo "[tsc: clean]"
  fi
  echo "$TSC_HASH" > "${VERIFY_HASH_FILE}-tsc"
fi
```

3. Do the same for vitest output.

4. Verify: `bash -n scripts/verify.sh` — no syntax errors
5. Commit: `"feat(hooks): add output deduplication to verify.sh — suppress repeated results"`

### C3: Add rate limiting

Prevent running verification more than once every 30 seconds:

1. Add rate limit check at the top of the script (after reading the JSON input):
```bash
VERIFY_COOLDOWN="${VERIFY_COOLDOWN:-30}"  # seconds
LAST_VERIFY_FILE="${TMPDIR:-/tmp}/.verify-last-run"
NOW=$(date +%s)

if [[ -f "$LAST_VERIFY_FILE" ]]; then
  LAST_RUN=$(cat "$LAST_VERIFY_FILE" 2>/dev/null || echo 0)
  ELAPSED=$(( NOW - LAST_RUN ))
  if [[ $ELAPSED -lt $VERIFY_COOLDOWN ]]; then
    echo "[verify: skipped, last run ${ELAPSED}s ago (cooldown: ${VERIFY_COOLDOWN}s)]"
    exit 0
  fi
fi
```

2. At the end of the script (after verification runs), update the timestamp:
```bash
echo "$NOW" > "$LAST_VERIFY_FILE"
```

3. Verify: `bash -n scripts/verify.sh` — no syntax errors
4. Commit: `"feat(hooks): add rate limiting to verify.sh — 30s cooldown between runs"`

### C4: Use compact output format

Replace verbose test output with compact summaries:

1. For vitest, use JSON reporter piped through a compact formatter:
```bash
VITEST_OUTPUT=$(npx vitest run --reporter=json 2>/dev/null) || true
VITEST_EXIT=$?

if [[ $VITEST_EXIT -eq 0 ]]; then
  PASS_COUNT=$(echo "$VITEST_OUTPUT" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      try { const r=JSON.parse(d); console.log(r.numPassedTests || 0); }
      catch { console.log('?'); }
    });
  " 2>/dev/null || echo "?")
  echo "[vitest: ${PASS_COUNT} tests passing]"
else
  # Show only failed tests
  echo "$VITEST_OUTPUT" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      try {
        const r=JSON.parse(d);
        const failed=r.testResults?.filter(t=>t.status==='failed') || [];
        if(failed.length===0) console.log('[vitest: exit ' + $VITEST_EXIT + ' but no failed tests in JSON]');
        else failed.slice(0,5).forEach(t=>console.log('FAIL: ' + t.name + ': ' + (t.message||'').slice(0,200)));
      } catch { console.log('[vitest: parse error — raw output follows]'); }
    });
  " 2>/dev/null || echo "$VITEST_OUTPUT" | tail -15
fi
```

NOTE: The JSON reporter might not be available or might fail. Always have a fallback that uses `tail -15` on the raw output. If the JSON approach doesn't work after testing, fall back to the dot reporter with aggressive truncation:
```bash
npx vitest run --reporter=dot 2>&1 | tail -10
```

2. For tsc, show error count + first 5 errors (already done in C2 — verify it's consistent).

3. Verify: `bash -n scripts/verify.sh` — no syntax errors
4. Commit: `"feat(hooks): use compact output format in verify.sh — less context pollution"`

### C5: Create pre-commit hook

Create `scripts/pre-commit-hook.sh` — a portable pre-commit hook that rejects known anti-patterns:

```bash
#!/usr/bin/env bash
# scripts/pre-commit-hook.sh — Reject hollow implementations and deleted tests
#
# Install: ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit
# Or run directly: ./scripts/pre-commit-hook.sh

set -euo pipefail

ERRORS=0

# Check staged files only
STAGED=$(git diff --cached --name-only --diff-filter=ACM)

# Check for todo!() / unimplemented!() in Rust files
if echo "$STAGED" | grep -q '\.rs$'; then
  if git diff --cached | grep -qE '^\+.*todo!\(\)|^\+.*unimplemented!\(\)'; then
    echo "ERROR: Commit contains todo!() or unimplemented!() in Rust files."
    echo "       Every function must have a real implementation."
    ERRORS=$((ERRORS + 1))
  fi
fi

# Check for commented-out tests
if git diff --cached | grep -qE '^\+\s*//\s*(#\[test\]|it\(|describe\(|test\()'; then
  echo "ERROR: Commit contains commented-out test declarations."
  echo "       If a test needs to change, fix it — don't comment it out."
  ERRORS=$((ERRORS + 1))
fi

# Check for empty function bodies in TypeScript (function name followed by empty braces)
if echo "$STAGED" | grep -q '\.\(ts\|tsx\)$'; then
  if git diff --cached | grep -qE '^\+.*\{\s*\}\s*$' | head -1 > /dev/null 2>&1; then
    # This is heuristic — may have false positives for legitimate empty objects
    # Only warn, don't block
    echo "WARNING: Possible empty function body detected. Verify this is intentional."
  fi
fi

# Check for "fix:" commits with failing indicators in staged content
# (This is a soft check — can't run tests in pre-commit reliably)

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "Pre-commit hook found $ERRORS error(s). Fix them before committing."
  echo "To bypass (NOT recommended): git commit --no-verify"
  exit 1
fi

exit 0
```

1. Write the script with proper permissions
2. Verify: `bash -n scripts/pre-commit-hook.sh` — no syntax errors
3. Test the hook logic: create a temp file with `todo!()`, stage it, run the hook, verify it rejects
4. Commit: `"feat: add pre-commit hook rejecting todo!(), unimplemented!(), and commented-out tests"`

### C6: Update .claude/settings.local.json

The current settings file has the PostToolUse hook for verify.sh. Verify it's still correct after
your verify.sh changes. The hook should still trigger on Edit|Write operations.

1. Read the current `.claude/settings.local.json`
2. Verify the hook configuration is still valid
3. If any changes are needed (unlikely), make them
4. Do NOT change the permissions section unless necessary
5. Commit only if changes were made

### C7: Final verification

1. Run `bash -n scripts/verify.sh` — must exit 0
2. Run `bash -n scripts/pre-commit-hook.sh` — must exit 0
3. Verify `.claude/settings.local.json` is valid JSON: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf8'))"`
4. `git status` — everything committed
5. `git diff --stat HEAD~6..HEAD` — review all your changes
6. Update `claude-progress.txt` with final status
