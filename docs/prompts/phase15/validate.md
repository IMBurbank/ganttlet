---
phase: 15
type: validation
stage: final
depends_on: [A, B, C, D]
checks:
  - id: V1
    summary: "Build verification"
  - id: V2
    summary: "Constraint types work"
  - id: V3
    summary: "SF dependency works"
  - id: V4
    summary: "Conflict detection works"
  - id: V5
    summary: "Constraint UI works"
  - id: V6
    summary: "Conflict indicator renders"
  - id: V7
    summary: "Sheets sync round-trips"
  - id: V8
    summary: "SF in dependency editor"
  - id: V9
    summary: "Existing behavior unchanged"
  - id: V10
    summary: "Type consistency Rust/TS/Sheets"
---

# Phase 15 Validation — Scheduling Engine Constraints, SF & Conflict Detection

You are the validation agent for Phase 15. Your job is to verify that all four agent groups
completed their work correctly, fix any issues from the merges, and ensure everything works together.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.

## Scope

You may modify these files to add tests and fix integration issues:
- `src/state/__tests__/ganttReducer.test.ts`
- `src/sheets/__tests__/sheetsMapper.test.ts`

You may read (but should NOT modify unless fixing merge issues) all files modified by Groups A-D:
- `crates/scheduler/src/types.rs`
- `crates/scheduler/src/constraints.rs`
- `crates/scheduler/src/cpm.rs`
- `crates/scheduler/src/cascade.rs`
- `crates/scheduler/src/graph.rs`
- `crates/scheduler/src/lib.rs`
- `src/types/index.ts`
- `src/utils/schedulerWasm.ts`
- `src/sheets/sheetsMapper.ts`
- `src/state/ganttReducer.ts`
- `src/state/actions.ts`
- `src/components/gantt/TaskBar.tsx`
- `src/components/gantt/TaskBarPopover.tsx`
- `src/components/table/TaskRow.tsx`
- `src/components/shared/DependencyEditorModal.tsx`

## Phase 1: Diagnostic (do NOT fix anything yet)

Run each check below. Record PASS or FAIL. Do not attempt any fixes until all checks are done.

### V1: Build Verification
- Run `npm run build:wasm` — PASS/FAIL: ___
- Run `npx tsc --noEmit` — PASS/FAIL: ___
- Run `npm run test` — PASS/FAIL: ___
- Run `cd crates/scheduler && cargo test` — PASS/FAIL: ___

### V2: Constraint Types (ALAP/SNLT/FNET/FNLT/MSO/MFO)
- Read `crates/scheduler/src/types.rs` — verify ConstraintType has 8 variants
- Read `crates/scheduler/src/constraints.rs` — verify all 8 types handled in compute_earliest_start
- Read `crates/scheduler/src/constraints.rs` — verify all 8 types handled in recalculate_earliest
- Verify tests exist for each new constraint type
- PASS/FAIL: ___

### V3: SF Dependency
- Read `crates/scheduler/src/types.rs` — verify DepType has SF
- Read `crates/scheduler/src/constraints.rs` — verify SF in compute_earliest_start
- Read `crates/scheduler/src/cpm.rs` — verify SF in forward + backward pass
- Read `crates/scheduler/src/cascade.rs` — verify SF cascade logic
- Read `crates/scheduler/src/graph.rs` — verify SF in cycle detection
- Verify tests exist for SF in each module
- PASS/FAIL: ___

### V4: Conflict Detection
- Read `crates/scheduler/src/lib.rs` — verify detect_conflicts WASM export exists
- Read `src/utils/schedulerWasm.ts` — verify detectConflicts wrapper exists
- Verify conflict detection catches: SNLT violation, FNLT violation, MSO conflict, MFO conflict
- Verify tests exist for conflict detection
- PASS/FAIL: ___

### V5: Constraint UI
- Read `src/state/actions.ts` — verify SET_CONSTRAINT action exists
- Read `src/state/ganttReducer.ts` — verify SET_CONSTRAINT handler
- Verify SET_CONSTRAINT is in TASK_MODIFYING_ACTIONS and UNDOABLE_ACTIONS
- Read `src/components/gantt/TaskBarPopover.tsx` — verify constraint dropdown with 8 options + date picker
- Read `src/components/table/TaskRow.tsx` — verify constraint column exists
- PASS/FAIL: ___

### V6: Conflict Indicator
- Read `src/components/gantt/TaskBar.tsx` — verify red visual indicator for conflicted tasks
- Verify tooltip shows conflict reason
- Verify indicator clears when conflict is resolved
- PASS/FAIL: ___

### V7: Sheets Sync
- Read `src/sheets/sheetsMapper.ts` — verify SHEET_COLUMNS has constraintType + constraintDate
- Verify taskToRow serializes constraint fields
- Verify rowToTask parses constraint fields
- Verify round-trip preserves data
- PASS/FAIL: ___

### V8: SF in Dependency Editor
- Read `src/components/shared/DependencyEditorModal.tsx` — verify SF in DEP_TYPE_LABELS
- Verify dropdown shows 4 options (FS, FF, SS, SF)
- PASS/FAIL: ___

### V9: Existing Behavior Unchanged (Regression)
- Verify all existing Rust tests pass (cargo test)
- Verify all existing TS tests pass (npm run test)
- Read `crates/scheduler/src/constraints.rs` — verify ASAP/SNET behavior unchanged
- Read `crates/scheduler/src/cascade.rs` — verify FS/SS/FF cascade unchanged
- Read `crates/scheduler/src/cpm.rs` — verify existing CPM tests pass
- PASS/FAIL: ___

### V10: Type Consistency
- Verify ConstraintType enum (Rust) matches constraintType union (TS) matches Sheets column values
- Verify DepType enum (Rust) matches DependencyType union (TS) matches dep editor options
- Verify ConflictResult struct (Rust) matches ConflictResult interface (TS)
- PASS/FAIL: ___

## Phase 2: Integration Tests

Add integration tests to verify cross-group interactions.

### V-E2: ganttReducer.test.ts integration tests

Add tests covering:
1. SET_CONSTRAINT dispatched → task constraintType and constraintDate updated
2. SET_CONSTRAINT with ASAP → constraintDate cleared
3. SNET constraint interaction with dependencies (constrained task respects SNET floor)
4. ALAP scheduling (task scheduled as late as possible)
5. MSO conflict detection (dep conflicts with must-start-on date)
6. SF dependency cascade (predecessor start change cascades to successor end)

### V-E3: sheetsMapper.test.ts constraint tests

Add tests covering:
1. constraintType and constraintDate survive Sheets round-trip (taskToRow → rowToTask)
2. Empty/null constraint type → undefined (ASAP default)
3. Invalid constraint type string → graceful fallback
4. ASAP/ALAP with constraint date → date ignored
5. constraintDate without constraintType → date ignored

## Phase 3: Fix and Verify

For each FAILED check from Phase 1:
1. Diagnose the root cause
2. Fix it (only modify files in your scope unless fixing merge issues)
3. Re-run THAT check to confirm the fix
4. Re-run ALL checks to verify no regressions

Common issues to expect after merging 4 branches across 3 stages:
- Import conflicts
- Type mismatches between Rust and TypeScript
- Missing SF case in exhaustive patterns (Record<DependencyType, ...>)
- TASK_MODIFYING_ACTIONS or UNDOABLE_ACTIONS incomplete
- WASM function signature mismatches

## Phase 4: Final Report

Run `./scripts/full-verify.sh` and then re-run ALL 10 checks one final time. Print a summary table:

```
╔══════════════════════════════════════════════════╗
║ Phase 15 Validation Report                       ║
╠═════════════════════════╦═══════╦════════════════╣
║ CHECK                   ║ RESULT║ NOTES          ║
╠═════════════════════════╬═══════╬════════════════╣
║ V1  Build verification  ║       ║                ║
║ V2  Constraint types    ║       ║                ║
║ V3  SF dependency       ║       ║                ║
║ V4  Conflict detection  ║       ║                ║
║ V5  Constraint UI       ║       ║                ║
║ V6  Conflict indicator  ║       ║                ║
║ V7  Sheets sync         ║       ║                ║
║ V8  SF in dep editor    ║       ║                ║
║ V9  Regression check    ║       ║                ║
║ V10 Type consistency    ║       ║                ║
╠═════════════════════════╬═══════╬════════════════╣
║ OVERALL                 ║       ║                ║
╚═════════════════════════╩═══════╩════════════════╝
```

If ALL checks pass, commit any fixes/tests with: `"fix: phase 15 validation — [description]"`

If any check still fails after your fixes, mark it FAIL in the table with an explanation.
