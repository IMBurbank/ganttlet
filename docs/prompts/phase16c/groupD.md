---
phase: 16c
group: D
stage: 2
agent_count: 1
scope:
  modify:
    - src/utils/dateUtils.ts
    - src/utils/__tests__/dateUtils.test.ts
    - src/components/gantt/GanttChart.tsx
    - src/components/gantt/TaskBar.tsx
    - src/components/gantt/TodayLine.tsx
    - src/utils/dependencyUtils.ts
  read_only:
    - docs/tasks/phase16c.yaml
depends_on: [A, B]
tasks:
  - id: D1
    summary: "Add getDayPx to dateUtils.ts and replace 3 callsites"
---

# Phase 16c Group D — Extract getDayPx Utility

You are implementing Phase 16c Group D for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

The zoom-to-pixel-per-day formula `zoom === 'day' ? colWidth : zoom === 'week' ? colWidth / 7 : colWidth / 30`
is duplicated identically in 3 files. If zoom-level pixel constants change or a new zoom
level is added, all 3 must be updated consistently. This group extracts a shared utility.

Additionally, `TodayLine.tsx` duplicates the `getColumnWidth` logic inline instead of
calling the existing shared `getColumnWidth` function from `dateUtils.ts`.

## Your files (ONLY modify these):

**Modify:**
- `src/utils/dateUtils.ts` — add `getDayPx` utility
- `src/utils/__tests__/dateUtils.test.ts` — add tests for `getDayPx`
- `src/components/gantt/GanttChart.tsx` — replace inline dayPx ternary
- `src/components/gantt/TaskBar.tsx` — replace inline dayPx ternary
- `src/components/gantt/TodayLine.tsx` — replace inline colWidth ternary with `getColumnWidth`
- `src/utils/dependencyUtils.ts` — replace inline dayPx ternary

## Tasks — execute in order:

### D1: Add getDayPx to dateUtils.ts and replace callsites

**Step 1: Read all 4 files to confirm the duplication pattern**

Read the relevant lines in each file to confirm the exact formula before changing anything.

**Step 2: Add getDayPx to dateUtils.ts**

Add near the existing `getColumnWidth` function:

```typescript
/**
 * Pixel width of a single calendar day at the given zoom level.
 * Day zoom: 1 column = 1 day, so dayPx = colWidth.
 * Week zoom: 1 column = 7 days, so dayPx = colWidth / 7.
 * Month zoom: 1 column = 30 days, so dayPx = colWidth / 30.
 */
export function getDayPx(zoom: ZoomLevel): number {
  const colWidth = getColumnWidth(zoom);
  return zoom === 'day' ? colWidth : zoom === 'week' ? colWidth / 7 : colWidth / 30;
}
```

**Step 3: Add tests in dateUtils.test.ts**

Add alongside the existing `getColumnWidth` tests:

```typescript
describe('getDayPx', () => {
  it('returns colWidth for day zoom', () => {
    expect(getDayPx('day')).toBe(36);
  });

  it('returns colWidth/7 for week zoom', () => {
    expect(getDayPx('week')).toBeCloseTo(100 / 7);
  });

  it('returns colWidth/30 for month zoom', () => {
    expect(getDayPx('month')).toBe(180 / 30);
  });
});
```

**Step 4: Replace in GanttChart.tsx**

Find the line (around line 128):
```typescript
const dayPx = zoom === 'day' ? colWidth : zoom === 'week' ? colWidth / 7 : colWidth / 30;
```

Replace with:
```typescript
const dayPx = getDayPx(zoom);
```

Add `getDayPx` to the import from `dateUtils`.

**Step 5: Replace in TaskBar.tsx**

Same pattern — find the dayPx ternary (around line 103), replace with `getDayPx(zoom)`,
add to imports.

**Step 6: Replace in dependencyUtils.ts**

Same pattern — find the dayPx ternary (around line 28), replace with `getDayPx(zoom)`,
add to imports.

**Step 7: Fix TodayLine.tsx**

Find the inline colWidth computation (around line 14):
```typescript
const colWidth = zoom === 'day' ? 36 : zoom === 'week' ? 100 : 180;
```

Replace with:
```typescript
const colWidth = getColumnWidth(zoom);
```

Add `getColumnWidth` to imports from `dateUtils` (it may already import other things
from there).

**Step 8: Verify no inline dayPx ternaries remain**

```bash
grep -rn "colWidth / 7\|colWidth / 30" src/ --include='*.ts' --include='*.tsx'
```

Should return zero results (only the getDayPx implementation in dateUtils.ts).

Commit: `"refactor: extract getDayPx utility, replace 3 duplicates, fix TodayLine import"`

### Final verification

```bash
npx tsc --noEmit 2>&1 | tail -5
npx vitest run 2>&1 | tail -10
```

Both must pass.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupD saving work"`.
