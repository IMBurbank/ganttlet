# Phase 14 Validation — Drag Reliability & Sync Integrity

You are the validation agent for Phase 14. Your job is to verify that all six agent groups
completed their work correctly, fix any issues from the merges, and ensure everything works together.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.

## Phase 1: Diagnostic (do NOT fix anything yet)

Run each check below. Record PASS or FAIL. Do not attempt any fixes until all checks are done.

### V1: Build Verification
- Run `npm run build:wasm` — PASS/FAIL: ___
- Run `npx tsc --noEmit` — PASS/FAIL: ___
- Run `npm run test` — PASS/FAIL: ___
- Run `cd crates/scheduler && cargo test` — PASS/FAIL: ___

### V2: Drag Throttle (R1)
- Read `src/components/gantt/TaskBar.tsx`
- Verify RAF-based throttle exists in `onMouseMove` (requestAnimationFrame pattern)
- Verify CRDT broadcast is throttled to ~100ms (performance.now() comparison)
- Verify `localDispatch` is used for RAF renders, `dispatch` (collabDispatch) for CRDT
- Verify move handler updates BOTH `dragRef.current.lastStartDate` AND `dragRef.current.lastEndDate`
- PASS/FAIL: ___

### V3: Dispatch Split (R1)
- Read `src/state/GanttContext.tsx`
- Verify both `localDispatch` (React only) and `collabDispatch` (React + Yjs) exist
- Verify both are exposed via context
- Verify `useLocalDispatch` hook exists and works
- Verify `useAwareness` hook is exported (needed by Group F for ghost bars)
- PASS/FAIL: ___

### V4: Duration Derivation (R2, R7, R9)
- Read `src/state/ganttReducer.ts`
- Verify MOVE_TASK and RESIZE_TASK handlers compute `duration` from `daysBetween(startDate, endDate)` instead of trusting the action payload
- Read `src/types/index.ts` — verify `duration` field has documentation comment
- Read `src/utils/dateUtils.ts` — verify `daysBetween` has documentation comment
- Read `src/sheets/sheetsMapper.ts`:
  - Verify `taskToRow` computes duration from dates, not `task.duration`
  - Verify `rowToTask` computes duration from dates, not column 4
- Read `src/collab/yjsBinding.ts`:
  - Verify RESIZE_TASK case computes duration from dates (NOT `action.newDuration` which is now optional)
- Read `src/state/actions.ts`:
  - Verify `newDuration` is optional (not required) on RESIZE_TASK payload
- PASS/FAIL: ___

### V5: SET_TASKS Guard (R3)
- Read `src/state/GanttContext.tsx`
- Verify active drag tracking exists (`activeDragRef` or similar)
- Verify the Yjs observer's SET_TASKS dispatch preserves the dragged task's dates
- PASS/FAIL: ___

### V6: Atomic COMPLETE_DRAG (R4)
- Read `src/state/actions.ts` — verify COMPLETE_DRAG action type exists
- Read `src/state/ganttReducer.ts` — verify COMPLETE_DRAG handler exists with atomic position + cascade
- Verify COMPLETE_DRAG is in UNDOABLE_ACTIONS
- Read `src/collab/yjsBinding.ts` — verify COMPLETE_DRAG case in applyActionToYjs
- Read `src/components/gantt/TaskBar.tsx` — verify mouseup dispatches COMPLETE_DRAG (not CASCADE_DEPENDENTS)
- Read `src/state/GanttContext.tsx` — verify COMPLETE_DRAG is in TASK_MODIFYING_ACTIONS
- PASS/FAIL: ___

### V7: Arrow Rendering (R5)
- Read `src/components/gantt/DependencyLayer.tsx`
- Verify guards exist for missing taskYPositions entries
- Read `src/components/gantt/DependencyArrow.tsx`
- Verify memoization of arrow point calculations
- PASS/FAIL: ___

### V8: Awareness Ghost Bar (R6)
- Read `src/collab/awareness.ts` — verify `setDragIntent` function exists
- Read `src/types/index.ts` — verify CollabUser has `dragging` field
- Read `src/components/gantt/TaskBar.tsx` — verify drag intent broadcast during drag
- Read `src/components/gantt/GanttChart.tsx` — verify ghost bar rendering for remote drags
- PASS/FAIL: ___

### V9: Duration Semantics (R7)
- Verify `duration` is consistently calendar days everywhere
- Check `daysBetween` uses `differenceInCalendarDays` (not business days)
- Check no code path sets `duration` directly from user input without computing from dates
- Search for `businessDaysBetween` — verify it's NOT used to set `task.duration`
- Read `src/state/ganttReducer.ts` UPDATE_TASK_FIELD handler — verify it recomputes duration when field is startDate or endDate
- PASS/FAIL: ___

### V10: Cascade Optimization (R8)
- Read `crates/scheduler/src/cascade.rs`
- Verify adjacency list (HashMap) is built before cascading
- Verify inner cascade function uses adjacency lookup, not full task scan
- Verify all existing tests pass: `cd crates/scheduler && cargo test`
- Read `src/utils/schedulerWasm.ts` — verify performance.mark/measure instrumentation
- PASS/FAIL: ___

### V11: Structural CRDT Sync (R10)
- Read `src/state/GanttContext.tsx`:
  - Verify TASK_MODIFYING_ACTIONS includes ADD_DEPENDENCY, UPDATE_DEPENDENCY, REMOVE_DEPENDENCY
  - Verify useEffect diff exists for ADD_TASK/DELETE_TASK sync
- Read `src/collab/yjsBinding.ts`:
  - Verify ADD_DEPENDENCY, UPDATE_DEPENDENCY, REMOVE_DEPENDENCY cases exist in applyActionToYjs
  - Verify they use targeted Y.Map field updates (not full array replacement)
- PASS/FAIL: ___

### V12: Cross-Group Consistency
- Verify TASK_MODIFYING_ACTIONS set includes ALL actions that should sync:
  MOVE_TASK, RESIZE_TASK, UPDATE_TASK_FIELD, TOGGLE_EXPAND, HIDE_TASK, SHOW_ALL_TASKS,
  CASCADE_DEPENDENTS, COMPLETE_DRAG, ADD_DEPENDENCY, UPDATE_DEPENDENCY, REMOVE_DEPENDENCY
- Verify UNDOABLE_ACTIONS includes: RESIZE_TASK, CASCADE_DEPENDENTS,
  ADD_DEPENDENCY, UPDATE_DEPENDENCY, REMOVE_DEPENDENCY, ADD_TASK, DELETE_TASK,
  REPARENT_TASK, RECALCULATE_EARLIEST, COMPLETE_DRAG
- Verify MOVE_TASK is NOT in UNDOABLE_ACTIONS (it's a drag preview action; only COMPLETE_DRAG should create undo entries)
- Verify no duplicate action handling (e.g., CASCADE_DEPENDENTS not dispatched separately if COMPLETE_DRAG handles it)
- PASS/FAIL: ___

## Phase 2: Fix and Verify

For each FAILED check from Phase 1:
1. Diagnose the root cause
2. Fix it
3. Re-run THAT check to confirm the fix
4. Re-run ALL checks to verify no regressions

Common issues to expect after merging 6 branches across 3 stages:
- Import conflicts (multiple groups importing to the same file)
- TASK_MODIFYING_ACTIONS may have duplicates or be incomplete
- Type mismatches from RESIZE_TASK payload changes (newDuration optional)
- `isLocalUpdate` access issues between yjsBinding.ts and GanttContext.tsx
- Duplicate dispatch paths (old CASCADE_DEPENDENTS + new COMPLETE_DRAG)

## Phase 3: Final Report

Re-run ALL 12 checks one final time. Print a summary table:

```
╔══════════════════════════════════════════════════╗
║ Phase 14 Validation Report                       ║
╠═════════════════════════╦═══════╦════════════════╣
║ CHECK                   ║ RESULT║ NOTES          ║
╠═════════════════════════╬═══════╬════════════════╣
║ V1  Build verification  ║       ║                ║
║ V2  Drag throttle (R1)  ║       ║                ║
║ V3  Dispatch split (R1) ║       ║                ║
║ V4  Duration derive(R2) ║       ║                ║
║ V5  SET_TASKS guard(R3) ║       ║                ║
║ V6  COMPLETE_DRAG (R4)  ║       ║                ║
║ V7  Arrow render (R5)   ║       ║                ║
║ V8  Ghost bar (R6)      ║       ║                ║
║ V9  Duration sem. (R7)  ║       ║                ║
║ V10 Cascade opt. (R8)   ║       ║                ║
║ V11 Struct sync (R10)   ║       ║                ║
║ V12 Cross-group check   ║       ║                ║
╠═════════════════════════╬═══════╬════════════════╣
║ OVERALL                 ║       ║                ║
╚═════════════════════════╩═══════╩════════════════╝
```

If ALL checks pass, commit any fixes with: `"fix: phase 14 validation — [description of fixes]"`

If any check still fails after your fixes, mark it FAIL in the table with an explanation.
