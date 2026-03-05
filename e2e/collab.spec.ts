import { test, expect } from '@playwright/test';
import { createCollabPair, isCollabAvailable, CloudAuthOptions } from './helpers/collab-harness';
import { getAccessToken } from './helpers/cloud-auth';

const isCloud = !!process.env.E2E_CLOUD;

async function getCloudAuth(): Promise<CloudAuthOptions | undefined> {
  if (!isCloud) return undefined;
  const keyA = process.env.GCP_SA_KEY_WRITER1_DEV;
  const keyB = process.env.GCP_SA_KEY_WRITER2_DEV || process.env.GCP_SA_KEY_READER1_DEV;
  if (!keyA || !keyB) {
    throw new Error('E2E_CLOUD requires GCP_SA_KEY_WRITER1_DEV and GCP_SA_KEY_WRITER2_DEV or GCP_SA_KEY_READER1_DEV');
  }
  const [tokenA, tokenB] = await Promise.all([getAccessToken(keyA), getAccessToken(keyB)]);
  return { tokenA, tokenB };
}

test.describe('Collaboration E2E', () => {
  test('presence indicators appear for connected users', async ({ browser }) => {
    const cloudAuth = await getCloudAuth();
    const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

    try {
      const collabReady = await isCollabAvailable(pageA);
      if (!collabReady) {
        test.skip();
        return;
      }

      // Both pages are connected and have exchanged awareness.
      // Verify that a presence indicator (pulse-dot on avatar) is visible
      // in pageB, showing that pageA's user is present.
      await expect(pageB.locator('.pulse-dot').first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanup();
    }
  });

  test('task edit in one tab propagates to the other', async ({ browser }) => {
    const cloudAuth = await getCloudAuth();
    const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

    try {
      const collabReady = await isCollabAvailable(pageA);
      if (!collabReady) {
        test.skip();
        return;
      }

      // In pageA, double-click a task name to edit it
      const nameCell = pageA.getByTitle('Double-click to edit').first();
      await nameCell.dblclick();

      const input = pageA.locator('input.inline-edit-input');
      await input.waitFor({ timeout: 5_000 });

      const newName = 'Collab E2E Sync Test';
      await input.fill(newName);

      // Blur to save
      await pageA.locator('header').click();

      // In pageB, verify the new task name appears within 5 seconds
      await expect(
        pageB.getByTitle('Double-click to edit').filter({ hasText: newName }),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await cleanup();
    }
  });

  test('single-user mode works without relay', async ({ page }) => {
    // Collect console errors during the test
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');

    // Wait for the app to fully render
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });

    // Verify task bars are rendered
    const taskBarCount = await page.locator('.task-bar').count();
    expect(taskBarCount).toBeGreaterThan(0);

    // Verify editing works in single-user mode
    const nameCell = page.getByTitle('Double-click to edit').first();
    await nameCell.dblclick();

    const input = page.locator('input.inline-edit-input');
    await input.waitFor({ timeout: 5_000 });

    const testName = 'Single User Edit';
    await input.fill(testName);
    await page.locator('header').click();

    await expect(
      page.getByTitle('Double-click to edit').filter({ hasText: testName }),
    ).toBeVisible({ timeout: 5_000 });

    // Filter out expected WebSocket connection errors (relay not running)
    const unexpectedErrors = consoleErrors.filter(
      (msg) => !msg.includes('WebSocket') && !msg.includes('ws://'),
    );
    expect(unexpectedErrors).toHaveLength(0);
  });
});
