---
phase: 16
group: G
stage: 4
agent_count: 1
scope:
  modify:
    - src/sheets/sheetsMapper.ts
    - src/sheets/__tests__/sheetsMapper.test.ts
    - src/collab/yjsBinding.ts
  read_only:
    - docs/plans/date-calc-fixes.md
    - src/utils/dateUtils.ts
    - src/state/ganttReducer.ts
    - src/types/index.ts
depends_on: [B, E]
tasks:
  - id: G1
    summary: "Read sheetsMapper.ts, yjsBinding.ts — understand callsites and sync paths"
  - id: G2
    summary: "Migrate sheetsMapper workingDaysBetween → taskDuration"
  - id: G3
    summary: "Migrate yjsBinding workingDaysBetween → taskDuration"
  - id: G4
    summary: "Fix yjsBinding end-date derivations → taskEndDate"
  - id: G5
    summary: "Fix yjsBinding UPDATE_TASK_FIELD — sync duration on date change (Bug 14)"
  - id: G6
    summary: "Add WEEKEND_VIOLATION to TS ConflictResult types"
  - id: G7
    summary: "Update sheetsMapper.test.ts — fix duration assertions"
---

# Phase 16 Group G — Sheets + CRDT Sync

You are implementing Phase 16 Group G for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

The sync layer (Sheets mapper and Yjs CRDT binding) uses `workingDaysBetween` (exclusive)
and has a live collaboration bug (Bug 14) where `UPDATE_TASK_FIELD` doesn't sync duration
when a date changes.

**Weekend handling strategy for Sheets import:**
Weekend dates from Sheets are NOT silently fixed. They are surfaced as `WEEKEND_VIOLATION`
conflicts using the existing constraint violation UI (red dashed border + message). The user
fixes it manually. This matches the existing UX for constraint violations.

## Your files (ONLY modify these):
- `src/sheets/sheetsMapper.ts` — Sheets→Task mapping
- `src/sheets/__tests__/sheetsMapper.test.ts` — mapper tests
- `src/collab/yjsBinding.ts` — Yjs CRDT sync binding
- `src/types/index.ts` — add WEEKEND_VIOLATION type

**Read-only:**
- `docs/plans/date-calc-fixes.md` — §Stage 5, §Bug 14
- `src/utils/dateUtils.ts` — convention functions from Group B
- `src/state/ganttReducer.ts` — understand what actions yjsBinding dispatches

## Tasks — execute in order:

### G1: Read and understand

Read both files:

1. `sheetsMapper.ts`:
   - Line 20: `workingDaysBetween` in `taskToRow` (task → Sheets row)
   - Line 51: `workingDaysBetween` in `rowToTask` (Sheets row → task)
   - Understand how dates flow between Sheets and the app

2. `yjsBinding.ts`:
   - Line 175: `workingDaysBetween` in RESIZE handling
   - Line 282: `workingDaysBetween` in COMPLETE_DRAG handling
   - Line 296: `workingDaysBetween` in CASCADE_DEPENDENTS handling
   - Lines 185-198: `UPDATE_TASK_FIELD` — writes single field, no duration recompute (Bug 14)
   - Lines 149-163: `MOVE_TASK` — preserves duration (correct, no change needed)
   - Understand the sync flow: local action → Yjs map → remote observer → SET_TASKS

### G2: Migrate sheetsMapper workingDaysBetween → taskDuration

```typescript
// sheetsMapper.ts
import { taskDuration } from '../utils/dateUtils';

// Line 20 (taskToRow):
// BEFORE:
duration: workingDaysBetween(task.startDate, task.endDate)
// AFTER:
duration: taskDuration(task.startDate, task.endDate)

// Line 51 (rowToTask):
// BEFORE:
duration: workingDaysBetween(startDate, endDate)
// AFTER:
duration: taskDuration(startDate, endDate)
```

Commit: `"fix: sheetsMapper — migrate workingDaysBetween → taskDuration (2 callsites)"`

### G3: Migrate yjsBinding workingDaysBetween → taskDuration

```typescript
// yjsBinding.ts
import { taskDuration } from '../utils/dateUtils';

// Line 175 (RESIZE):
// Line 282 (COMPLETE_DRAG):
// Line 296 (CASCADE_DEPENDENTS):
// All: workingDaysBetween(start, end) → taskDuration(start, end)
```

Commit: `"fix: yjsBinding — migrate workingDaysBetween → taskDuration (3 callsites)"`

### G4: Fix yjsBinding end-date derivations → taskEndDate

Find any places in yjsBinding.ts where end date is derived from start + duration using
raw `addBusinessDaysToDate` or `addBusinessDays`, and replace with `taskEndDate`:

```typescript
import { taskEndDate } from '../utils/dateUtils';

// BEFORE:
addBusinessDaysToDate(startDate, duration)
// AFTER:
taskEndDate(startDate, duration)
```

Check these sync paths:
- RESIZE handling
- CASCADE_DEPENDENTS result processing
- Any other place end date is derived before writing to Yjs

Commit: `"fix: yjsBinding end-date derivations → taskEndDate"`

### G5: Fix UPDATE_TASK_FIELD — sync duration on date change (Bug 14)

This is the live collaboration bug. In `yjsBinding.ts`, the `UPDATE_TASK_FIELD` handler
(lines 185-198) writes only the changed field to the Yjs map. When a date changes,
duration must also be written so remote collaborators see the correct value.

Find the `UPDATE_TASK_FIELD` case and add duration syncing:

```typescript
case 'UPDATE_TASK_FIELD': {
  // ... existing code that writes action.field to ymap ...
  ymap.set(action.field, action.value);

  // Sync duration when date fields change (Bug 14 fix)
  if (action.field === 'startDate' || action.field === 'endDate') {
    const start = (action.field === 'startDate' ? action.value : ymap.get('startDate')) as string;
    const end = (action.field === 'endDate' ? action.value : ymap.get('endDate')) as string;
    ymap.set('duration', taskDuration(start, end));
  }
  break;
}
```

**Why this works:** The reducer already recomputes duration locally (ganttReducer.ts:59).
This fix ensures the Yjs map also gets the updated duration, so when remote users receive
the Yjs update, they see the correct duration via `SET_TASKS`.

Commit: `"fix: UPDATE_TASK_FIELD syncs duration on date change (Bug 14)"`

### G6: Verify TS ConflictResult supports WEEKEND_VIOLATION

`ConflictResult` in `src/types/index.ts:36` uses `conflictType: string` — no type change needed.
The `"WEEKEND_VIOLATION"` string value from Rust `find_conflicts` (Group D, task D10) flows
through WASM deserialization automatically.

Verify by reading `src/types/index.ts` lines 36-42. The existing conflict types are string
values like `"SNLT_VIOLATED"`, `"NEGATIVE_FLOAT"`, etc. No enum or union — just strings.

**No code change needed** — just verify the TS type accepts any string as conflictType.

Commit: (no commit needed — verification only)

### G7: Update sheetsMapper.test.ts

Update all test assertions for inclusive duration:

1. Duration values in test expectations increase by 1 (inclusive counts both endpoints)
2. Verify `taskToRow` outputs correct inclusive duration
3. Verify `rowToTask` computes correct inclusive duration
4. Add test: row with weekend start date → task created (no rejection — conflict detection handles it)

**IMPORTANT:** Use `node -e` to calculate ALL expected values. NEVER compute by hand.

Commit: `"test: update sheetsMapper tests for inclusive convention"`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupG saving work"`.
- **Calculations**: NEVER do mental math. Use `node -e` with date-fns for ALL arithmetic.
