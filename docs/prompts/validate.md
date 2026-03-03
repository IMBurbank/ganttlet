# Phase 11 Validation — Post-Merge Verification & Fix

You are the validation agent for Phase 11. Your job is to:
1. Run every verification check
2. If anything fails, **diagnose and fix the issue** — do NOT just report it
3. Re-run the failed check to confirm the fix works
4. Repeat until all checks pass
5. Print the final validation report

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all checks
sequentially. When a check fails, fix it immediately before moving on.

You may modify ANY file in the repository to fix issues. Commit each fix with a descriptive
message before re-running the check.

## Checks — execute in order:

### V1: Rust compilation and server tests
```bash
cd server && cargo check 2>&1
```
- If fail: read the error output, fix the code, re-run until it compiles

```bash
cd server && cargo test 2>&1
```
- Record: number of tests run, number passed/failed
- Specifically look for these new test files and confirm they exist and ran:
  - `server/tests/ws_auth_test.rs`
  - `server/tests/awareness_test.rs`
- If any test fails: read the failure output, diagnose root cause, fix the code or test, re-run
- If a test file doesn't exist (DNE): note it as a gap — the phase agent failed to create it.
  Create the test yourself following the spec in TASKS.md, then re-run.
- Keep iterating until all server tests pass

### V2: TypeScript compilation
```bash
npx tsc --noEmit 2>&1
```
- If fail: read errors, fix the TypeScript issues, re-run until clean

### V3: Unit tests (Vitest)
```bash
npm run test 2>&1
```
- If fail: read test output, fix failing tests or the code they test, re-run

### V4: WASM build
```bash
npm run build:wasm 2>&1
```
- If fail: fix and re-run

### V5: Rust scheduler tests
```bash
cd crates/scheduler && cargo test 2>&1
```
- If fail: fix and re-run

### V6: E2E tests WITHOUT relay (baseline — collab tests should skip)
```bash
npm run test:e2e 2>&1
```
- Verify: tooltip tests ran and passed
- Verify: collab tests were SKIPPED (not failed) since no relay is running
- Verify: existing gantt.spec.ts tests still pass
- If any test that should pass fails: fix it and re-run
- If collab tests fail instead of skipping: fix the skip logic in the collab harness

### V7: E2E tests WITH relay (full validation — presence MUST work)

This is the most critical check. Start the relay server in the background:
```bash
cd server && RELAY_ALLOWED_ORIGINS="http://localhost:5173" cargo run &
RELAY_PID=$!
sleep 3  # wait for server to start
```

Verify the relay started:
```bash
curl -s http://localhost:4000/healthz || echo "Relay not responding"
```
If the relay didn't start, check `cargo run` output, fix any issues, and retry.

Run E2E tests:
```bash
npm run test:e2e 2>&1
```
- **CRITICAL**: The presence/collab tests should NOT be skipped now — the relay is running
- **CRITICAL**: The "presence indicators appear" test must PASS
- If the presence test fails:
  1. Capture the relay server logs
  2. Read the test output to understand what happened
  3. Check if awareness messages are flowing (add tracing if needed)
  4. Fix the root cause in server code (ws.rs, room.rs) or client code (yjsProvider.ts, awareness.ts)
  5. Rebuild the relay: `cd server && cargo build && cargo run &`
  6. Re-run E2E tests
  7. Repeat until presence works
- If other E2E tests fail: fix and re-run

Stop the relay when done:
```bash
kill $RELAY_PID 2>/dev/null
wait $RELAY_PID 2>/dev/null
```

### V8: Check new files exist
Verify these files were created by the phase:
- `server/tests/ws_auth_test.rs` — exists and is non-empty
- `server/tests/awareness_test.rs` — exists and is non-empty
- `e2e/collab.spec.ts` — exists and is non-empty
- `e2e/tooltip.spec.ts` — exists and is non-empty
- `e2e/helpers/collab-harness.ts` — exists and is non-empty
- `.github/workflows/e2e.yml` — exists and is non-empty

If any are missing: create them following the spec in TASKS.md and the group prompt files
(docs/prompts/groupE.md, groupF.md, groupG.md). Then re-run the relevant checks above.

### V9: Check ws.rs has the presence fix
Read `server/src/ws.rs` and verify:
- `AuthResult` struct exists with `buffered_messages` field
- `wait_for_auth()` returns `AuthResult` (not bare `String`)
- Buffered messages are replayed after `join_room()`

If any of these are missing: apply the fix (see groupE.md for details) and re-run V1.

### V10: Check yjsProvider.ts has awareness re-announce
Read `src/collab/yjsProvider.ts` and verify:
- There is awareness-related code in the `status: 'connected'` handler
- The client re-announces or re-sets awareness after auth/connection

If missing: add awareness re-announce logic (e.g., re-set local state to trigger a broadcast)
and re-run V2, V3, and V7.

## Final Report

After ALL checks pass (fixing issues along the way), print the final summary:

```
╔══════════════════════════════════════════════════════╗
║           PHASE 11 VALIDATION REPORT                 ║
╠══════════════════════════════════════════════════════╣
║ V1  Server compilation        : PASS / FAIL         ║
║ V1  Server tests (N total)    : PASS / FAIL         ║
║     - ws_auth_test.rs         : PASS / FAIL / DNE   ║
║     - awareness_test.rs       : PASS / FAIL / DNE   ║
║ V2  TypeScript compilation    : PASS / FAIL         ║
║ V3  Unit tests (N total)      : PASS / FAIL         ║
║ V4  WASM build                : PASS / FAIL         ║
║ V5  Scheduler tests           : PASS / FAIL         ║
║ V6  E2E without relay         : PASS / FAIL         ║
║     - tooltip tests           : PASS / FAIL         ║
║     - collab tests skipped    : YES  / NO           ║
║     - gantt.spec.ts           : PASS / FAIL         ║
║ V7  E2E with relay            : PASS / FAIL         ║
║     - presence test           : PASS / FAIL         ║
║     - collab edit test        : PASS / FAIL         ║
║     - tooltip tests           : PASS / FAIL         ║
║ V8  New files exist           : ALL  / MISSING: ... ║
║ V9  ws.rs presence fix        : PASS / FAIL         ║
║ V10 yjsProvider awareness     : PASS / FAIL         ║
╠══════════════════════════════════════════════════════╣
║ Fixes applied                 : N commits           ║
║ OVERALL                       : PASS / FAIL         ║
╚══════════════════════════════════════════════════════╝
```

If you applied fixes, list each commit with its message.

If OVERALL is still FAIL after your best efforts, explain which check(s) you could not fix
and what the remaining issue is, so a human can take over.
