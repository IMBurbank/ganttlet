---
phase: 20
type: validation
stage: final
depends_on: [A, B, C, D, E, F, G, H, I, J]
checks:
  - id: V1
    summary: "Zero stale architecture references"
  - id: V2
    summary: "Build verification (tsc + vitest + E2E)"
  - id: V3
    summary: "TaskStore O(1) subscriptions"
  - id: V4
    summary: "Y.Doc mutations write correct state"
  - id: V5
    summary: "Observation handler routes by origin"
  - id: V6
    summary: "Sandbox mode with local Y.Doc"
  - id: V7
    summary: "Sheets sync bidirectional"
  - id: V8
    summary: "Drag commit-on-drop"
  - id: V9
    summary: "Per-client undo"
  - id: V10
    summary: "Full E2E + cloud"
  - id: V11
    summary: "Documentation accuracy"
  - id: V12
    summary: "Full verify"
---

# Phase 20 Validation — Complete Frontend Redesign

You are the validation agent for Phase 20. Verify all 10 groups completed their work
correctly, fix merge issues, and ensure the full redesign works end-to-end.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation.

## Validation Steps

### V1: Zero stale references (run FIRST — catches import errors before tsc)
```bash
grep -rn "useGanttState\|useGanttDispatch\|GanttContext\|ganttReducer\|applyActionToYjs\|collabDispatch\|guardedDispatch\|withLocalUpdate\|pendingFullSyncRef" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```
Must return zero results. Fix any remaining imports.

### V2: Build verification
```bash
npx tsc --noEmit
npx vitest run
npx playwright test
```
All must pass. If vitest fails, check new test files from all groups.

### V3: TaskStore O(1) verification
Verify a test exists that: subscribes to task A, updates task B, asserts A's listener NOT called.

### V4: Y.Doc mutation correctness
```bash
npx vitest run src/mutations/
npx vitest run src/schema/
```

### V5: Observation handler origin routing
```bash
npx vitest run src/collab/__tests__/observer.test.ts
```
Verify: 'local' sync, 'sheets' no-cascade, remote RAF-batched.

### V6: Sandbox mode
Open `http://localhost:5173` → "Try the demo" → task bars render → edit a task name →
verify Y.Doc is the state source (the edit persists via Y.Doc observation, not reducer).

### V7: Sheets sync
```bash
npx vitest run src/sheets/__tests__/SheetsAdapter.test.ts
```
Verify: three-way merge logic, conflict detection, attribution columns written.

### V8: Drag commit-on-drop
```bash
npx playwright test e2e/gantt.spec.ts -g "drag"
```
Verify: CSS transform during drag, single Y.Doc transaction on mouseup.

### V9: Per-client undo
```bash
npx vitest run src/collab/__tests__/undoManager.test.ts
npx playwright test e2e/gantt.spec.ts -g "undo|redo"
```

### V10: Full E2E
```bash
npx playwright test
```
All 29 local tests must pass.

### V11: Documentation accuracy
```bash
./scripts/lint-agent-paths.sh
```
Verify zero stale file paths in agent structure maps.
Spot-check: read CLAUDE.md, verify it describes the new architecture (Y.Doc, TaskStore, etc.).

### V12: Full verify
```bash
./scripts/full-verify.sh
```
Everything passes: tsc, vitest, cargo test, E2E.

## Fix-and-Retry

If any check fails:
1. Read the error
2. Identify which group's code is at fault
3. Fix (you have write access to all files)
4. Re-run the check
5. Up to 3 retries per check
