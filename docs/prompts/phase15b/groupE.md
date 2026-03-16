---
phase: 15b
group: E
stage: 1
agent_count: 1
scope:
  modify:
    - src/utils/dependencyUtils.ts
    - src/utils/__tests__/dependencyUtils.test.ts
  read_only:
    - src/types/index.ts
    - src/components/gantt/DependencyArrow.tsx
    - src/components/gantt/DependencyLayer.tsx
depends_on: []
tasks:
  - id: E1
    summary: "Read dependencyUtils.ts, DependencyArrow.tsx, DependencyLayer.tsx"
  - id: E2
    summary: "Fix createBezierPath backward path for SF"
  - id: E3
    summary: "Add unit tests for SF path geometry"
  - id: E4
    summary: "Run full-verify.sh"
---

# Phase 15b Group E — SF Arrow Path Fix + Unit Tests

You are implementing Phase 15b Group E for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

## What this project is

Ganttlet is a collaborative Gantt chart where multiple users edit the same schedule simultaneously
(CRDT-based sync via Yjs). The scheduling engine runs as Rust→WASM in each user's browser.
The UI renders dependency arrows between tasks using SVG paths.

## Your files (ONLY modify these):
- `src/utils/dependencyUtils.ts` — arrow path geometry (getDependencyPoints, createBezierPath, createArrowHead)
- `src/utils/__tests__/dependencyUtils.test.ts` — unit tests (currently tests WASM functions only, NOT rendering)

Read-only (understand but do NOT modify):
- `src/types/index.ts` — Task, Dependency, DependencyType types
- `src/components/gantt/DependencyArrow.tsx` — React component that calls these utils
- `src/components/gantt/DependencyLayer.tsx` — renders all arrows for visible tasks

## The Bug

`createBezierPath()` in `dependencyUtils.ts` has a bug in the backward path (lines 92-110, the fallthrough case for `!sameDirection && dx <= 10`).

The backward path comment says "start stub goes right, end stub goes left" — this is correct for **FS** backward arrows. But **SF** arrows have:
- Start stub pointing **LEFT** (from predecessor's start, x - STUB)
- End stub pointing **RIGHT** (to successor's end, x + STUB)

When `dx <= 10` for SF, the path routes right from start then left to end, which is exactly **backwards** from what SF needs. The path should route left from start then right to end.

### How getDependencyPoints sets up SF:
```
SF: start = { x: fromStartX - STUB }, end = { x: toEndX + STUB }
```
Start is to the LEFT of the predecessor bar. End is to the RIGHT of the successor bar.

### The fix needed:
When `depType === 'SF'` and falling through to the backward path, the routing should:
1. Go LEFT from start (not right) — `leftX = start.x - outset`
2. Go RIGHT to end (not left) — `rightX = end.x + outset`

This is the opposite of the FS backward routing.

## Success Criteria (you're done when ALL of these are true):
1. `createBezierPath` correctly routes SF arrows when `dx <= 10` (backward case)
2. SF forward case (`dx > 10`) still works (simple bezier, no change needed)
3. FS backward case still works unchanged
4. FF and SS routing unchanged
5. New unit tests in `dependencyUtils.test.ts` cover SF path geometry
6. All existing tests still pass (`npm run test`)
7. `./scripts/full-verify.sh` passes
8. All changes committed with descriptive messages

## Tasks — execute in order:

### E1: Read and understand the current code

1. Read `src/utils/dependencyUtils.ts` — understand all three functions
2. Read `src/components/gantt/DependencyArrow.tsx` — see how functions are called
3. Read `src/types/index.ts` — find DependencyType and Dependency types
4. Read `src/utils/__tests__/dependencyUtils.test.ts` — note it tests WASM functions, not rendering

### E2: Fix createBezierPath backward path for SF

The fix is in the backward path section (currently lines 92-110). You need to handle SF differently:

**Current code (lines 92-110) — works for FS, broken for SF:**
```typescript
// Backward path: start stub goes right, end stub goes left
const rightX = start.x + outset;     // go RIGHT from start
const leftX = end.x - outset;         // go LEFT to end
```

**For SF, the routing should be reversed:**
```typescript
// SF: start stub goes left, end stub goes right
const leftX = start.x - outset;       // go LEFT from start
const rightX = end.x + outset;        // go RIGHT to end
```

Implementation approach:
1. Add `depType === 'SF'` check in the backward path section
2. When SF: swap the routing directions (left from start, right to end)
3. When FS (or undefined): keep existing behavior unchanged
4. The path shape is the same (S-curve), just mirrored horizontally

Commit: `"fix: correct SF arrow backward path routing — stub directions were reversed"`

### E3: Add unit tests for SF path geometry

Add NEW test cases to `src/utils/__tests__/dependencyUtils.test.ts` for the **rendering** functions (not the WASM functions). Import `getDependencyPoints`, `createBezierPath`, and `createArrowHead` from `../dependencyUtils`.

Tests to add:

1. **createBezierPath — SF forward (dx > 10)**: Verify simple bezier is returned
2. **createBezierPath — SF backward (dx <= 10)**: Verify path goes LEFT from start, RIGHT to end
3. **createBezierPath — FS backward (dx <= 10)**: Verify path goes RIGHT from start, LEFT to end (regression)
4. **createBezierPath — FF same direction**: Verify routing goes right for FF
5. **createBezierPath — SS same direction**: Verify routing goes left for SS
6. **createArrowHead — SF**: Verify arrowhead tip points left (toward bar end)
7. **createArrowHead — FS**: Verify arrowhead tip points right (toward bar start)

For path assertions, you can parse the SVG path string:
- Check that the first `L` command after `M` moves in the expected direction
- For SF backward: first L should go to x < start.x (leftward)
- For FS backward: first L should go to x > start.x (rightward)

Commit: `"test: add unit tests for SF/FS/FF/SS arrow path geometry"`

### E4: Run full-verify.sh

```bash
./scripts/full-verify.sh
```

All checks must pass: tsc, vitest, cargo test.

Commit any lint/type fixes if needed.

## Progress Tracking

After completing each major task (E1-E4), update `.agent-status.json` in the worktree root:

```json
{
  "group": "E",
  "phase": "15b",
  "tasks": {
    "E1": { "status": "done" },
    "E2": { "status": "in_progress" }
  },
  "last_updated": "2026-03-09T10:00:00Z"
}
```

On restart, read `.agent-status.json` and `git log --oneline -10` first. Skip completed tasks.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, update .agent-status.json with "status": "blocked".
- Emergency: `git add -A && git commit -m "emergency: groupE saving work"`.
- **Calculations**: NEVER do mental math. Use `taskEndDate`/`taskDuration` shell functions for dates, `python3 -c` for arithmetic.
