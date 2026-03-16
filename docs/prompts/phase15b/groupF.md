---
phase: 15b
group: F
stage: 2
agent_count: 1
scope:
  modify:
    - e2e/gantt.spec.ts
  read_only:
    - src/utils/dependencyUtils.ts
    - src/components/gantt/DependencyArrow.tsx
    - src/components/shared/DependencyEditorModal.tsx
    - src/data/fakeData.ts
depends_on: [E]
tasks:
  - id: F1
    summary: "Read gantt.spec.ts, fakeData.ts, DependencyEditorModal.tsx"
  - id: F2
    summary: "Add E2E test for SF arrow rendering"
  - id: F3
    summary: "Run E2E tests"
---

# Phase 15b Group F — SF Arrow Rendering E2E Test

You are implementing Phase 15b Group F for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart. The UI renders SVG dependency arrows between
task bars. Phase 15 added the SF (Start-to-Finish) dependency type. This E2E test
verifies that SF arrows render correctly in the browser.

## Your files (ONLY modify these):
- `e2e/gantt.spec.ts` — Gantt E2E tests (single-tab, no relay server needed)

Read-only:
- `src/utils/dependencyUtils.ts` — arrow path geometry (recently fixed SF backward path)
- `src/components/gantt/DependencyArrow.tsx` — renders arrows
- `src/components/shared/DependencyEditorModal.tsx` — modal for adding/editing dependencies
- `src/data/fakeData.ts` — demo data loaded on startup

## Context: Existing E2E Tests

`gantt.spec.ts` already has these arrow-related tests:
- `dependency arrows are connected` — verifies arrows exist with valid path data
- `dependency arrow heads render as triangles` — checks arrowhead shape

These test FS arrows (the default in demo data). Your test adds SF-specific coverage.

## Success Criteria:
1. New E2E test creates an SF dependency and verifies the arrow renders
2. Test passes with `npm run e2e`
3. Existing tests are not broken
4. Changes committed with descriptive message

## Tasks — execute in order:

### F1: Read and understand

1. Read `e2e/gantt.spec.ts` — understand test patterns, beforeEach, selectors used
2. Read `src/components/shared/DependencyEditorModal.tsx` — understand how to open the dependency editor and add an SF dependency via UI
3. Read `src/data/fakeData.ts` — understand which tasks exist in demo data and their dependencies
4. Check what selectors are used for task rows, dependency arrows, and the dependency editor

### F2: Add SF arrow rendering E2E test

Add a new test: `'SF dependency renders correct arrow path'`

The test should:
1. Open the dependency editor for a task (find a task in the table, look for a way to add a dependency)
2. Add an SF dependency from one task to another
3. Wait for the arrow to render
4. Verify a `g.dependency-arrow` exists with:
   - A `.dep-stroke` path with valid SVG path data
   - A `.dep-head` path (arrowhead)
5. Verify the arrowhead points LEFT (SF arrowhead should point toward the successor's end)
   - Parse the arrowhead path: for SF, the tip x coordinate should be less than the base x coordinate
6. Clean up: remove the dependency or reset state

**Approach for creating an SF dependency via UI:**
- The DependencyEditorModal has a type dropdown that includes SF (added in Phase 15)
- Look for how other tests interact with task rows and popovers
- You may need to: click a task row → open dependency editor → select predecessor → choose SF type → save

**If opening the dependency editor proves too complex:**
- Fall back to verifying that existing demo data arrows render correctly (FS arrows)
- Then add a simpler assertion: evaluate `document.querySelectorAll('g.dependency-arrow')` and verify arrow count and path validity
- Note in a comment that a full SF arrow test requires creating an SF dependency first

Commit: `"test(e2e): add SF dependency arrow rendering test"`

### F3: Run E2E tests

```bash
npm run e2e
```

All single-tab tests must pass. If the test fails, investigate and fix (up to 3 approaches).

If E2E infrastructure is not available (Playwright not installed, Chromium missing), commit the test anyway with a note.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked in .agent-status.json.
- Emergency: `git add -A && git commit -m "emergency: groupF saving work"`.
- **Calculations**: NEVER do mental math. Use `taskEndDate`/`taskDuration` shell functions for dates, `python3 -c` for arithmetic.
