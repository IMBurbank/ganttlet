---
phase: 15
group: C
stage: 2
agent_count: 1
scope:
  modify:
    - src/types/index.ts
    - src/utils/schedulerWasm.ts
    - src/sheets/sheetsMapper.ts
  read_only:
    - src/state/ganttReducer.ts
    - src/state/actions.ts
depends_on: [A]
tasks:
  - id: C1
    summary: "Read types/index.ts, schedulerWasm.ts, sheetsMapper.ts"
  - id: C2
    summary: "Add SF + all 8 constraint types to TS types"
  - id: C3
    summary: "Update schedulerWasm.ts with detectConflicts"
  - id: C4
    summary: "Add constraint columns to sheetsMapper.ts"
---

# Phase 15 Group C — TypeScript Types + WASM Bridge + Sheets Sync

You are implementing Phase 15 Group C for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart where multiple users edit the same schedule simultaneously
(CRDT-based sync via Yjs). The scheduling engine runs as Rust→WASM in each user's browser.
Google Sheets is the durable store — the sheetsMapper handles serialization to/from Sheets rows.

## Prerequisites

Group A (Stage 1) has already been merged. The Rust types now include:
- `ConstraintType`: ASAP, SNET, ALAP, SNLT, FNET, FNLT, MSO, MFO
- `DepType`: FS, FF, SS, SF

Group B (your Stage 2 peer) is adding `detect_conflicts` to `lib.rs` in parallel. You need to
add the TypeScript wrapper for it. If the WASM export isn't available yet when you test, write
the wrapper to match the expected signature and it will work once B's code is merged.

## Your files (ONLY modify these):
- `src/types/index.ts` — TypeScript type definitions
- `src/utils/schedulerWasm.ts` — WASM bridge (TypeScript wrappers around Rust exports)
- `src/sheets/sheetsMapper.ts` — Google Sheets column mapping and serialization

Read-only (understand but do NOT modify):
- `src/state/ganttReducer.ts` — reducer logic (owned by Group D in Stage 3)
- `src/state/actions.ts` — action types (owned by Group D in Stage 3)

## Success Criteria (you're done when ALL of these are true):
1. `DependencyType = 'FS' | 'FF' | 'SS' | 'SF'`
2. `Task.constraintType` accepts all 8 constraint types
3. `detectConflicts()` wrapper exported from schedulerWasm.ts
4. Existing WASM wrappers handle new types without breaking
5. `SHEET_COLUMNS` includes `constraintType` and `constraintDate`
6. `taskToRow` serializes constraint fields
7. `rowToTask` parses constraint fields
8. Round-trip: write→read preserves constraint data
9. `npx tsc --noEmit` passes
10. `npm run test` passes (or any Sheets-related tests pass)
11. All changes committed with descriptive messages

## Tasks — execute in order:

### C1: Read and understand the current code

1. Read `src/types/index.ts` — understand Task interface, DependencyType, Dependency interface
2. Read `src/utils/schedulerWasm.ts` — understand WASM wrapper pattern, how Task is mapped to WASM input
3. Read `src/sheets/sheetsMapper.ts` — understand SHEET_COLUMNS, taskToRow, rowToTask
4. Read `src/state/ganttReducer.ts` — understand how constraint types are used (read only)
5. Read `src/state/actions.ts` — understand action types (read only)

### C2: Add SF and all 8 constraint types to TypeScript types

In `src/types/index.ts`:

1. Update `DependencyType`:
```typescript
export type DependencyType = 'FS' | 'FF' | 'SS' | 'SF';
```

2. Update `constraintType` on the Task interface:
```typescript
constraintType?: 'ASAP' | 'SNET' | 'ALAP' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
```

3. Add a `ConflictResult` type for the detect_conflicts WASM output:
```typescript
export interface ConflictResult {
  task_id: string;
  conflict_type: string;
  constraint_date: string;
  actual_date: string;
  message: string;
}
```

4. Run `npx tsc --noEmit` — fix any type errors caused by the expanded union.
   Check for exhaustive switches or mappings over DependencyType that need SF added.

Commit: `"feat: add SF dependency type and all 8 constraint types to TS types"`

### C3: Update schedulerWasm.ts with detectConflicts wrapper

In `src/utils/schedulerWasm.ts`:

1. Add a `detectConflicts` wrapper following the existing pattern:
```typescript
export async function detectConflicts(tasks: Task[]): Promise<ConflictResult[]> {
  const wasm = await initScheduler();
  const wasmTasks = tasks.map(t => ({
    // ... same mapping as existing wrappers
  }));
  const result = wasm.detect_conflicts(wasmTasks);
  return result as ConflictResult[];
}
```

2. Verify the Task→WASM mapping includes `constraintType` and `constraintDate` (it should already from existing code — verify `constraintType: t.constraintType ?? null`).

3. Verify existing wrappers (cascadeDependents, computeCriticalPath, etc.) handle SF deps correctly — the dep type is just a string that passes through, so no changes should be needed.

4. Run `npx tsc --noEmit` to verify.

Commit: `"feat: add detectConflicts WASM wrapper to schedulerWasm.ts"`

### C4: Add constraint columns to sheetsMapper.ts

In `src/sheets/sheetsMapper.ts`:

1. Add `constraintType` and `constraintDate` to `SHEET_COLUMNS`:
```typescript
export const SHEET_COLUMNS = [
  'id', 'name', 'startDate', 'endDate', 'duration', 'owner',
  'workStream', 'project', 'functionalArea', 'done', 'description',
  'isMilestone', 'isSummary', 'parentId', 'childIds', 'dependencies',
  'notes', 'okrs', 'constraintType', 'constraintDate',
];
```

2. Update `taskToRow` to serialize constraint fields:
   - `constraintType`: write as string (e.g., "SNET", "ALAP") or empty string if undefined/ASAP
   - `constraintDate`: write as ISO date string or empty string if undefined

3. Update `rowToTask` to parse constraint fields:
   - `constraintType`: parse string to valid constraint type, default to undefined (ASAP) if empty/invalid
   - `constraintDate`: parse as string, undefined if empty

4. Handle edge cases:
   - Empty/null constraint type → undefined (treated as ASAP)
   - Invalid constraint type string → log warning, default to undefined
   - ASAP/ALAP with a constraint date → ignore the date (these don't use dates)
   - constraintDate without constraintType → ignore the date

5. Add or update tests if a test file exists for sheetsMapper.

6. Verify round-trip: `taskToRow(rowToTask(row))` preserves constraint data.

Commit: `"feat: add constraintType and constraintDate columns to Sheets sync"`

## Progress Tracking

After completing each major task (C1-C4), update `.agent-status.json` in the worktree root:

```json
{
  "group": "C",
  "phase": 15,
  "tasks": {
    "C1": { "status": "done" },
    "C2": { "status": "in_progress" }
  },
  "last_updated": "2026-03-08T10:30:00Z"
}
```

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, update .agent-status.json with "status": "blocked", skip dependent tasks.
- Emergency: `git add -A && git commit -m "emergency: groupC saving work"`.
- **Calculations**: NEVER do mental math or date arithmetic. Use `node -e` or `python3 -c`.

## Design Notes

### Sheets Column Order
New columns go at the END of SHEET_COLUMNS to avoid breaking existing sheets. Users with
existing Sheets will have empty cells for the new columns until they set constraints.

### Type Safety
After expanding `DependencyType` to include 'SF', check for exhaustive patterns:
- `DEP_TYPE_LABELS` in DependencyEditorModal.tsx (Group D will handle this)
- Any `switch`/`if` on DependencyType that doesn't have a default case
- The `Record<DependencyType, ...>` patterns — these will fail tsc if SF is missing

Fix any issues in YOUR files only. If issues are in files owned by other groups, note them
in your `.agent-status.json` but do not modify those files.
