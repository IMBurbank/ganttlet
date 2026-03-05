# Phase 12 Validation — Post-Merge Verification & Fix

You are the validation agent for Phase 12. Your job is to:
1. Run every verification check
2. If anything fails, **diagnose and fix the issue** — do NOT just report it
3. Re-run the failed check to confirm the fix works
4. Repeat until all checks pass
5. Print the final validation report

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all checks
sequentially. When a check fails, fix it immediately before moving on.

You may modify ANY file in the repository to fix issues. Commit each fix with a descriptive
message before re-running the check.

## Context

Phase 12 overhauled the scheduling engine across three stages:
- **Stage 1** (Rust): Fixed cascade bugs, fixed CPM, added SNET constraints, added recalculate-to-earliest
- **Stage 2** (Frontend): Wired asymmetric cascade UX, added recalculate UI, extended cascade highlights
- **Stage 3** (Frontend): Added critical path edge highlighting, float/slack visualization, removed milestone scope

The engine was largely non-functional before this phase. These checks verify it now works correctly.

## Checks — execute in order:

### V1: WASM build
```bash
npm run build:wasm 2>&1
```
- If fail: read error output, fix the Rust code, re-run until it builds

### V2: Rust scheduler tests
```bash
cd crates/scheduler && cargo test 2>&1
```
- Record: number of tests run, number passed/failed
- If any test fails: read the failure output, diagnose root cause, fix, re-run
- Keep iterating until all scheduler tests pass

### V3: TypeScript compilation
```bash
npx tsc --noEmit 2>&1
```
- If fail: read errors, fix the TypeScript issues, re-run until clean

### V4: Unit tests (Vitest)
```bash
npm run test 2>&1
```
- If fail: read test output, fix failing tests or the code they test, re-run

### V5: Format and lint
```bash
npm run format:check && npm run lint 2>&1
```
- If fail: run `npm run format` and `npm run lint:fix`, then re-check
- If still failing: fix manually

### V6: Critical path test — functional verification
Read `crates/scheduler/src/cpm.rs` and verify:
- There are tests for a linear chain (A→B→C→D) where all tasks are critical
- There are tests for a diamond pattern with different durations
- There is a test for scoped critical path by project
- There is a test for scoped critical path by workstream
- The milestone scope variant has been REMOVED from `CriticalPathScope`

If any are missing: create the test, run `cd crates/scheduler && cargo test` to verify.

### V7: Cascade test — functional verification
Read `crates/scheduler/src/cascade.rs` and verify:
- There is a test that forward cascade (positive delta) pushes dependents forward
- There is a test that backward move (negative delta) returns an EMPTY result vec
- There is a test that cascade preserves task durations (duration before == duration after)

If any are missing: create the test, run `cd crates/scheduler && cargo test` to verify.

### V8: Recalculate test — functional verification
Read `crates/scheduler/src/constraints.rs` and verify:
- There is a `recalculate_earliest` function
- There is a test that tasks with slack snap to their earliest possible dates
- There is a test that the today_date floor prevents scheduling in the past
- There is a test that SNET constraints are respected during recalculation
- There is a test for scoping (by workstream or by task ID)

If any are missing: create the test, run `cd crates/scheduler && cargo test` to verify.

### V9: Milestone scope removed — frontend verification
Read `src/types/index.ts` and verify:
- `CriticalPathScope` does NOT have a `milestone` variant
- Only `project` and `workstream` variants remain

Read `src/components/layout/Toolbar.tsx` and verify:
- The scope dropdown does NOT include a "Milestone" option

If milestone is still present: remove it, run `npx tsc --noEmit` to verify no type errors.

## Final Report

After ALL checks pass (fixing issues along the way), print the final summary:

```
╔══════════════════════════════════════════════════════╗
║           PHASE 12 VALIDATION REPORT                 ║
╠══════════════════════════════════════════════════════╣
║ V1  WASM build                : PASS / FAIL         ║
║ V2  Scheduler tests (N total) : PASS / FAIL         ║
║ V3  TypeScript compilation    : PASS / FAIL         ║
║ V4  Unit tests (N total)      : PASS / FAIL         ║
║ V5  Format + lint             : PASS / FAIL         ║
║ V6  Critical path tests       : PASS / FAIL         ║
║     - Linear chain test       : PASS / FAIL / DNE   ║
║     - Diamond pattern test    : PASS / FAIL / DNE   ║
║     - Scoped CP (project)     : PASS / FAIL / DNE   ║
║     - Scoped CP (workstream)  : PASS / FAIL / DNE   ║
║     - Milestone removed       : YES  / NO           ║
║ V7  Cascade tests             : PASS / FAIL         ║
║     - Forward cascade         : PASS / FAIL / DNE   ║
║     - Backward empty          : PASS / FAIL / DNE   ║
║     - Duration preserved      : PASS / FAIL / DNE   ║
║ V8  Recalculate tests         : PASS / FAIL         ║
║     - Snap to earliest        : PASS / FAIL / DNE   ║
║     - Today floor             : PASS / FAIL / DNE   ║
║     - SNET respected          : PASS / FAIL / DNE   ║
║     - Scoping works           : PASS / FAIL / DNE   ║
║ V9  Milestone scope removed   : PASS / FAIL         ║
║     - types/index.ts          : PASS / FAIL         ║
║     - Toolbar dropdown        : PASS / FAIL         ║
╠══════════════════════════════════════════════════════╣
║ Fixes applied                 : N commits           ║
║ OVERALL                       : PASS / FAIL         ║
╚══════════════════════════════════════════════════════╝
```

If you applied fixes, list each commit with its message.

If OVERALL is still FAIL after your best efforts, explain which check(s) you could not fix
and what the remaining issue is, so a human can take over.
