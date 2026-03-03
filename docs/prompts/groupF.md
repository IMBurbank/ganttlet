# Phase 11 Group F — Playwright E2E Tests for Collaboration & Core UI

You are implementing Phase 11 Group F for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- e2e/collab.spec.ts (new)
- e2e/tooltip.spec.ts (new)
- e2e/helpers/collab-harness.ts (new)
- playwright.config.ts
- package.json (only `scripts` section — add `test:e2e` script)

Do NOT modify e2e/gantt.spec.ts (existing tests).

## Background

The project has an existing Playwright setup (playwright.config.ts) with 4 E2E tests in
e2e/gantt.spec.ts. These tests run against a Vite dev server but do NOT test collaboration
features (presence, multi-user sync) or UI regression traps like tooltip rendering.

The presence bug from Phase 10 (awareness lost during auth handshake) would have been caught by
an E2E test that opens two browser contexts and checks for presence indicators. The Tooltip
getBoundingClientRect crash would have been caught by a test that hovers over a task bar and
asserts no console errors.

## Tasks — execute in order:

### F1: Add `test:e2e` npm script and update Playwright config
- In `package.json`, add script: `"test:e2e": "npx playwright test"`
- In `playwright.config.ts`:
  - Add `expect: { timeout: 10_000 }` for slower E2E assertions
  - Add `use: { trace: 'on-first-retry' }` for debugging failures
  - Set `retries: 1` (retry once on failure to handle flaky CI)
  - Add global setup to fail tests if unexpected `console.error` fires (see F3)

### F2: Create collaboration test harness
Create `e2e/helpers/collab-harness.ts`:
- Export `createCollabPair(browser)` function that:
  1. Creates two new browser contexts (contextA, contextB)
  2. Opens the same page URL in both (e.g., `/?demo=true` or `/` with seed data)
  3. Waits for `.task-bar` to appear in both pages (app fully loaded)
  4. Returns `{ pageA, pageB, contextA, contextB, cleanup }` where cleanup closes both contexts
- This harness abstracts the two-user setup so individual tests stay concise
- NOTE: Both contexts connect to the same Vite dev server and collab relay. If the relay isn't
  running, the tests should still pass by testing single-user behaviors. Add a `isCollabAvailable()`
  helper that checks if the WebSocket connection status shows "connected".

### F3: Create collaboration E2E tests
Create `e2e/collab.spec.ts` with these test cases:

**Test: "presence indicators appear for connected users"**
- Use the collab harness to open two browser contexts
- In pageA, click on a task row to select it (triggering awareness update)
- In pageB, verify that a presence indicator appears (look for collab-related CSS classes
  or colored borders that indicate another user is viewing a task)
- If collab relay is not available, skip this test with `test.skip()`

**Test: "task edit in one tab propagates to the other"**
- Use the collab harness
- In pageA, double-click a task name, change it, blur to save
- In pageB, verify the new task name appears within 5 seconds
- If collab relay is not available, skip this test

**Test: "single-user mode works without relay"**
- Open a single page (no collab harness)
- Verify the app loads, task bars render, editing works
- Verify no uncaught errors in the console

### F4: Create tooltip E2E test
Create `e2e/tooltip.spec.ts`:

**Test: "hovering over a task bar shows tooltip without errors"**
- Navigate to the app, wait for task bars to load
- Set up a console error listener: `page.on('console', msg => ...)` to capture errors
- Hover over the first `.task-bar` SVG element
- Wait 500ms for the tooltip to appear
- Assert that NO console errors were fired (especially no `getBoundingClientRect` errors)
- Assert that a tooltip element is visible (or at least no crash occurred)

**Test: "moving mouse away hides tooltip"**
- Hover over a task bar, wait for tooltip
- Move mouse to a neutral area (e.g., the header)
- Assert tooltip is no longer visible

### F5: Run and verify
- Run `npm run test:e2e` locally
- All new tests should pass (collab tests may skip if no relay is running)
- The existing gantt.spec.ts tests must still pass
- Commit with descriptive message
