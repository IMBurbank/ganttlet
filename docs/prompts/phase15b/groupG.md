---
phase: 15b
group: G
stage: 2
agent_count: 1
scope:
  modify:
    - e2e/collab.spec.ts
  read_only:
    - e2e/helpers/collab-harness.ts
    - src/components/gantt/TaskBar.tsx
    - src/components/gantt/TaskBarPopover.tsx
depends_on: [E]
tasks:
  - id: G1
    summary: "Read collab.spec.ts, collab-harness.ts, TaskBar.tsx"
  - id: G2
    summary: "Complete constraint cascade cross-tab test"
  - id: G3
    summary: "Add conflict indicator cross-tab E2E test"
  - id: G4
    summary: "Run E2E collab tests"
---

# Phase 15b Group G — Constraint Cascade + Conflict Indicator Cross-Tab E2E

You are implementing Phase 15b Group G for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart with real-time sync via CRDTs.
Phase 15 added constraint types and conflict detection. This work adds E2E tests
verifying these features propagate correctly across collaborating browser tabs.

## Your files (ONLY modify these):
- `e2e/collab.spec.ts` — Collaboration E2E tests (two-browser, requires relay server)

Read-only:
- `e2e/helpers/collab-harness.ts` — `createCollabPair()` helper for two-browser setup
- `src/components/gantt/TaskBar.tsx` — task bar rendering, conflict indicators
- `src/components/gantt/TaskBarPopover.tsx` — constraint selector in popover

## Context: Existing Tests

`collab.spec.ts` already has:
- `presence indicators appear for connected users` — basic collab check
- `task edit in one tab propagates to the other` — name edit sync
- `constraint change in one tab propagates to the other` (lines 72-124) — sets SNET constraint in pageA, verifies pageB sees the constraint value. BUT: does NOT verify that dependent tasks cascaded (dates moved).
- `single-user mode works without relay` — no-relay fallback

`gantt.spec.ts` has single-tab versions:
- `constraint set via popover cascades to dependent tasks` (lines 147-179) — single-tab, no cascade date check
- `MSO constraint with past date does not crash the app` (lines 204-249) — single-tab conflict indicator

## Success Criteria:
1. Existing constraint cross-tab test enhanced with cascade date verification
2. New conflict indicator cross-tab test passes
3. `npm run e2e:collab` passes
4. Existing tests not broken
5. All changes committed with descriptive messages

## Tasks — execute in order:

### G1: Read and understand

1. Read `e2e/collab.spec.ts` — understand the full test patterns, createCollabPair usage, cleanup
2. Read `e2e/helpers/collab-harness.ts` — understand how two-browser contexts are set up
3. Read `src/components/gantt/TaskBar.tsx` — find conflict indicator selectors (look for `#ef4444`, conflict circle, dashed outline)
4. Read `src/components/gantt/TaskBarPopover.tsx` — understand constraint UI selectors

### G2: Complete constraint cascade cross-tab test

Enhance the existing `'constraint change in one tab propagates to the other'` test (around line 72).

Currently the test:
1. Opens pageA task bar popover
2. Sets SNET constraint with date 2026-07-01
3. Verifies pageB sees the constraint value

Add after step 3:
4. In pageB, check that dependent tasks' positions changed (cascade propagated)
   - After CRDT sync (wait 2000ms), check that the Gantt chart has re-rendered
   - A simple approach: check that at least one `.task-bar` element's `x` attribute changed, OR
   - Verify that the constraint-set task's x position reflects the SNET date
   - The most robust check: open a dependent task's popover in pageB and verify its start date is >= the constraint date

If verifying exact dates is too fragile (depends on demo data layout):
- At minimum verify that pageB's task bars re-rendered after the constraint change (e.g., check that a `data-task-id` attribute exists and the bar is visible)
- Add a comment explaining what would make this test more thorough

Commit: `"test(e2e): verify constraint cascade propagates across collaborator tabs"`

### G3: Add conflict indicator cross-tab E2E test

Add a new test: `'conflict indicator visible to collaborators'`

Pattern (following existing collab test structure):
```typescript
test('conflict indicator visible to collaborators', async ({ browser }) => {
  const cloudAuth = await getCloudAuth();
  const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

  try {
    const collabReady = await isCollabAvailable(pageA);
    if (!collabReady) {
      test.skip();
      return;
    }

    // In pageA, open first task bar popover
    const taskBar = pageA.locator('.task-bar').first();
    await taskBar.dblclick({ force: true });
    const popover = pageA.locator('.fade-in');
    await popover.waitFor({ timeout: 5_000 });

    // Set MSO constraint with a date far in the past → forces conflict
    const constraintSelect = popover.locator('select').last();
    await constraintSelect.selectOption('MSO');
    const dateInput = popover.locator('input[type="date"]').last();
    await dateInput.fill('2020-01-01');

    // Close popover
    await pageA.keyboard.press('Escape');

    // Wait for WASM conflict detection + CRDT sync
    await pageA.waitForTimeout(3000);

    // In pageB, verify conflict indicator is visible
    // Conflict indicators: circle[fill="#ef4444"] or rect[stroke="#ef4444"]
    const conflictCircles = pageB.locator('circle[fill="#ef4444"]');
    const conflictRects = pageB.locator('rect[stroke="#ef4444"]');

    const circleCount = await conflictCircles.count();
    const rectCount = await conflictRects.count();
    expect(circleCount + rectCount).toBeGreaterThan(0);

    // Clean up: reset constraint to ASAP
    await taskBar.dblclick({ force: true });
    const resetPopover = pageA.locator('.fade-in');
    await resetPopover.waitFor({ timeout: 5_000 });
    await resetPopover.locator('select').last().selectOption('ASAP');
    await pageA.keyboard.press('Escape');
  } finally {
    await cleanup();
  }
});
```

Adapt selectors based on what you find in TaskBar.tsx. The key conflict indicator selectors might be:
- `circle[fill="#ef4444"]` — red warning dot
- `rect[stroke="#ef4444"]` — red dashed outline on task bar
- `.conflict-indicator` — if a class exists

Commit: `"test(e2e): add conflict indicator cross-tab E2E test"`

### G4: Run E2E collab tests

```bash
npm run e2e:collab
```

If relay server compilation fails (known pre-existing issue), note it and commit anyway.
If specific tests fail with timeout issues (known popover timing problem), try increasing timeouts.
After 3 failed approaches, commit WIP.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked in .agent-status.json.
- Emergency: `git add -A && git commit -m "emergency: groupG saving work"`.
- **Calculations**: NEVER do mental math. Use `node -e "..."`.
