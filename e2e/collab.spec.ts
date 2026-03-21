import { test, expect } from '@playwright/test';
import { createCollabPair, CloudAuthOptions } from './helpers/collab-harness';
import { getAccessToken } from './helpers/cloud-auth';

// Cloud collab needs SA keys + TEST_SHEET_ID_DEV so both pages can load
// a real sheet (dataSource='sheet') and connect via Yjs.
async function getCloudAuth(): Promise<CloudAuthOptions | undefined> {
  const keyA = process.env.GCP_SA_KEY_WRITER1_DEV;
  const keyB = process.env.GCP_SA_KEY_WRITER2_DEV || process.env.GCP_SA_KEY_READER1_DEV;
  if (!keyA || !keyB || !process.env.TEST_SHEET_ID_DEV) return undefined;
  const [tokenA, tokenB] = await Promise.all([getAccessToken(keyA), getAccessToken(keyB)]);
  return { tokenA, tokenB };
}

/** Wait for Yjs collab connection with explicit timeout — fails instead of skipping */
async function waitForCollab(
  pageA: import('@playwright/test').Page,
  pageB: import('@playwright/test').Page
) {
  await Promise.all([
    pageA.locator('[data-collab-status="connected"]').waitFor({ timeout: 30_000 }),
    pageB.locator('[data-collab-status="connected"]').waitFor({ timeout: 30_000 }),
  ]);
}

test.describe('Collaboration E2E', () => {
  // Collab tests load two pages with real sheet data — needs extra time for large sheets
  test.setTimeout(180_000);

  test('presence indicators appear for connected users', async ({ browser }) => {
    const cloudAuth = await getCloudAuth();
    const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

    try {
      // Wait for collab connection — fail if it doesn't connect
      await waitForCollab(pageA, pageB);

      // Both pages are connected and have exchanged awareness.
      // Verify that a presence indicator (pulse-dot on avatar) is visible
      // in pageB, showing that pageA's user is present.
      await expect(pageB.locator('.pulse-dot').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanup();
    }
  });

  test('task edit in one tab propagates to the other', async ({ browser }) => {
    const cloudAuth = await getCloudAuth();
    const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

    try {
      await waitForCollab(pageA, pageB);

      // In pageA, double-click a task name to edit it
      const nameCell = pageA.getByTitle('Double-click to edit').first();
      await nameCell.dblclick();

      const input = pageA.locator('input.inline-edit-input');
      await input.waitFor({ timeout: 15_000 });

      const newName = 'Collab E2E Sync Test';
      await input.fill(newName);

      // Blur to save
      await pageA.locator('header').click();

      // In pageB, verify the new task name appears
      await expect(
        pageB.getByTitle('Double-click to edit').filter({ hasText: newName })
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanup();
    }
  });

  test('constraint change in one tab propagates to the other', async ({ browser }) => {
    const cloudAuth = await getCloudAuth();
    const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

    try {
      await waitForCollab(pageA, pageB);

      // In pageA, double-click a task bar to open the popover
      const taskBar = pageA.locator('.task-bar').first();
      await taskBar.dispatchEvent('dblclick');

      const popover = pageA.locator('.fade-in');
      await popover.waitFor({ timeout: 15_000 });

      // Change constraint to SNET
      const constraintSelect = popover.locator('select').last();
      await constraintSelect.selectOption('SNET');

      // Set a constraint date
      const dateInput = popover.locator('input[type="date"]').last();
      await dateInput.fill('2026-07-01');

      // Close popover
      await pageA.keyboard.press('Escape');

      // Wait for CRDT sync — poll until pageB reflects the constraint change
      const taskBarB = pageB.locator('.task-bar').first();

      await expect(async () => {
        await taskBarB.dispatchEvent('dblclick');
        const pop = pageB.locator('.fade-in');
        await pop.waitFor({ timeout: 3_000 });
        const sel = pop.locator('select').last();
        await expect(sel).toHaveValue('SNET', { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });

      // Verify task bars still render after cascade
      const taskBarsB = pageB.locator('.task-bar');
      expect(await taskBarsB.count()).toBeGreaterThan(0);

      // Clean up: reset to ASAP
      await pageB.keyboard.press('Escape');
      await taskBar.dispatchEvent('dblclick');
      const resetPopover = pageA.locator('.fade-in');
      await resetPopover.waitFor({ timeout: 15_000 });
      await resetPopover.locator('select').last().selectOption('ASAP');
      await pageA.keyboard.press('Escape');
    } finally {
      await cleanup();
    }
  });

  test('conflict indicator visible to collaborators', async ({ browser }) => {
    const cloudAuth = await getCloudAuth();
    const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

    try {
      await waitForCollab(pageA, pageB);

      // In pageA, double-click the first task bar to open the popover
      const taskBar = pageA.locator('.task-bar').first();
      await taskBar.dispatchEvent('dblclick');

      const popover = pageA.locator('.fade-in');
      await popover.waitFor({ timeout: 15_000 });

      // Set MSO constraint with a date far in the past to force a conflict
      const constraintSelect = popover.locator('select').last();
      await constraintSelect.selectOption('MSO');

      const dateInput = popover.locator('input[type="date"]').last();
      await dateInput.fill('2020-01-01');

      // Close popover
      await pageA.keyboard.press('Escape');

      // Wait for WASM conflict detection + CRDT sync
      await pageA.waitForTimeout(3000);

      // In pageB, verify conflict indicator is visible
      const conflictRects = pageB.locator('rect[stroke="#ef4444"]');
      const conflictCircles = pageB.locator('circle[fill="#ef4444"]');

      const rectCount = await conflictRects.count();
      const circleCount = await conflictCircles.count();
      expect(rectCount + circleCount).toBeGreaterThan(0);

      // Clean up: reset constraint to ASAP
      await taskBar.dispatchEvent('dblclick');
      const resetPopover = pageA.locator('.fade-in');
      await resetPopover.waitFor({ timeout: 15_000 });
      await resetPopover.locator('select').last().selectOption('ASAP');
      await pageA.keyboard.press('Escape');
    } finally {
      await cleanup();
    }
  });

  test('single-user mode works without relay', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.getByTestId('try-demo-button').click();

    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });
    expect(await page.locator('.task-bar').count()).toBeGreaterThan(0);

    const nameCell = page.getByTitle('Double-click to edit').first();
    await nameCell.dblclick();

    const input = page.locator('input.inline-edit-input');
    await input.waitFor({ timeout: 15_000 });

    const testName = 'Single User Edit';
    await input.fill(testName);
    await page.locator('header').click();

    await expect(page.getByTitle('Double-click to edit').filter({ hasText: testName })).toBeVisible(
      { timeout: 15_000 }
    );

    const unexpectedErrors = consoleErrors.filter(
      (msg) => !msg.includes('WebSocket') && !msg.includes('ws://')
    );
    expect(unexpectedErrors).toHaveLength(0);
  });
});
