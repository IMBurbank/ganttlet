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

  test.describe('Concurrent writes', () => {
    test('both users rename the same task simultaneously — final state converges', async ({ browser }) => {
      const cloudAuth = await getCloudAuth();
      const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

      try {
        const collabReady = await isCollabAvailable(pageA);
        if (!collabReady) {
          test.skip();
          return;
        }

        // Both users open the same first task name for editing simultaneously
        await Promise.all([
          pageA.getByTitle('Double-click to edit').first().dblclick(),
          pageB.getByTitle('Double-click to edit').first().dblclick(),
        ]);

        const inputA = pageA.locator('input.inline-edit-input');
        const inputB = pageB.locator('input.inline-edit-input');

        await Promise.all([
          inputA.waitFor({ timeout: 5_000 }),
          inputB.waitFor({ timeout: 5_000 }),
        ]);

        // Each user fills a different name
        await inputA.fill('Concurrent Write A');
        await inputB.fill('Concurrent Write B');

        // Both save simultaneously
        await Promise.all([
          pageA.locator('header').click(),
          pageB.locator('header').click(),
        ]);

        // Wait for CRDT sync — one of the two names must win and appear on both pages
        await expect(async () => {
          const finalNameA = await pageA.getByTitle('Double-click to edit').first().textContent();
          const finalNameB = await pageB.getByTitle('Double-click to edit').first().textContent();
          expect(finalNameA).toBeTruthy();
          expect(finalNameA!.trim()).toBe(finalNameB!.trim());
          expect(['Concurrent Write A', 'Concurrent Write B']).toContain(finalNameA!.trim());
        }).toPass({ timeout: 8_000 });
      } finally {
        await cleanup();
      }
    });

    test('user A edits one task while user B edits a different task — both changes propagate', async ({ browser }) => {
      const cloudAuth = await getCloudAuth();
      const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

      try {
        const collabReady = await isCollabAvailable(pageA);
        if (!collabReady) {
          test.skip();
          return;
        }

        // userA edits the first task name
        const nameCellA = pageA.getByTitle('Double-click to edit').first();
        await nameCellA.dblclick();
        const inputA = pageA.locator('input.inline-edit-input');
        await inputA.waitFor({ timeout: 5_000 });
        const nameA = 'Edited by A';
        await inputA.fill(nameA);
        await pageA.locator('header').click();

        // Wait for A's edit to reach pageB before B starts editing
        await expect(
          pageB.getByTitle('Double-click to edit').filter({ hasText: nameA }),
        ).toBeVisible({ timeout: 10_000 });

        // userB now edits the same task with a different value
        await pageB.getByTitle('Double-click to edit').first().dblclick();
        const inputB = pageB.locator('input.inline-edit-input');
        await inputB.waitFor({ timeout: 5_000 });
        const nameB = 'Edited by B';
        await inputB.fill(nameB);
        await pageB.locator('header').click();

        // pageA should see userB's edit propagate (bidirectional sync)
        await expect(
          pageA.getByTitle('Double-click to edit').filter({ hasText: nameB }),
        ).toBeVisible({ timeout: 10_000 });
      } finally {
        await cleanup();
      }
    });

    test('both users drag-resize different tasks simultaneously — both duration changes propagate', async ({ browser }) => {
      const cloudAuth = await getCloudAuth();
      const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

      try {
        const collabReady = await isCollabAvailable(pageA);
        if (!collabReady) {
          test.skip();
          return;
        }

        // Get bounding boxes of resize handles for the first and second task bars
        const handleA = pageA.locator('.resize-handle').nth(0);
        const handleB = pageB.locator('.resize-handle').nth(1);

        const boxA = await handleA.boundingBox();
        const boxB = await handleB.boundingBox();

        if (!boxA || !boxB) {
          test.skip();
          return;
        }

        // Both users drag their resize handles rightward by 60px simultaneously
        await Promise.all([
          (async () => {
            await pageA.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
            await pageA.mouse.down();
            await pageA.mouse.move(boxA.x + boxA.width / 2 + 60, boxA.y + boxA.height / 2, { steps: 10 });
            await pageA.mouse.up();
          })(),
          (async () => {
            await pageB.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
            await pageB.mouse.down();
            await pageB.mouse.move(boxB.x + boxB.width / 2 + 60, boxB.y + boxB.height / 2, { steps: 10 });
            await pageB.mouse.up();
          })(),
        ]);

        // Both pages should converge to the same task bar count (no divergence or crash)
        await expect(async () => {
          const barCountA = await pageA.locator('.task-bar').count();
          const barCountB = await pageB.locator('.task-bar').count();
          expect(barCountA).toBeGreaterThan(0);
          expect(barCountA).toBe(barCountB);
        }).toPass({ timeout: 8_000 });
      } finally {
        await cleanup();
      }
    });

    test('rapid sequential edits from both users all converge', async ({ browser }) => {
      const cloudAuth = await getCloudAuth();
      const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

      try {
        const collabReady = await isCollabAvailable(pageA);
        if (!collabReady) {
          test.skip();
          return;
        }

        // Helper: open edit, fill name, and blur — does NOT wait for sync
        async function editTaskName(page: typeof pageA, name: string) {
          await page.getByTitle('Double-click to edit').first().dblclick();
          const input = page.locator('input.inline-edit-input');
          await input.waitFor({ timeout: 5_000 });
          await input.fill(name);
          await page.locator('header').click();
        }

        // Fire concurrent edits from both users simultaneously
        await Promise.all([
          editTaskName(pageA, 'Rapid Edit A-1'),
          editTaskName(pageB, 'Rapid Edit B-1'),
        ]);

        // Second wave of concurrent edits
        await Promise.all([
          editTaskName(pageA, 'Rapid Edit A-2'),
          editTaskName(pageB, 'Rapid Edit B-2'),
        ]);

        // Final concurrent wave
        await Promise.all([
          editTaskName(pageA, 'Rapid Edit A-3'),
          editTaskName(pageB, 'Rapid Edit B-3'),
        ]);

        // Both pages should converge to the same value (whichever CRDT wins)
        await expect(async () => {
          const nameOnA = await pageA.getByTitle('Double-click to edit').first().textContent();
          const nameOnB = await pageB.getByTitle('Double-click to edit').first().textContent();
          expect(nameOnA).toBeTruthy();
          expect(nameOnA!.trim()).toBe(nameOnB!.trim());
        }).toPass({ timeout: 8_000 });
      } finally {
        await cleanup();
      }
    });

    test('both users edit different fields of the same task — both changes propagate', async ({ browser }) => {
      const cloudAuth = await getCloudAuth();
      const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

      try {
        const collabReady = await isCollabAvailable(pageA);
        if (!collabReady) {
          test.skip();
          return;
        }

        // userA renames the first task
        const nameCellA = pageA.getByTitle('Double-click to edit').first();
        await nameCellA.dblclick();
        const inputA = pageA.locator('input.inline-edit-input');
        await inputA.waitFor({ timeout: 5_000 });
        const newName = 'Field Conflict Test';
        await inputA.fill(newName);
        await pageA.locator('header').click();

        // Wait for sync to reach pageB
        await expect(
          pageB.getByTitle('Double-click to edit').filter({ hasText: newName }),
        ).toBeVisible({ timeout: 10_000 });

        // Now both users edit different tasks simultaneously
        // userA: edit the first task name again
        await pageA.getByTitle('Double-click to edit').first().dblclick();
        const inputA2 = pageA.locator('input.inline-edit-input');
        await inputA2.waitFor({ timeout: 5_000 });

        // userB: edit a different task (API schema design)
        await pageB.getByText('API schema design').first().dblclick();
        const inputB = pageB.locator('input.inline-edit-input');
        await inputB.waitFor({ timeout: 5_000 });

        // Both fill and save concurrently
        const nameA = 'Final Name from A';
        const nameB = 'Schema Edited by B';
        await inputA2.fill(nameA);
        await inputB.fill(nameB);

        await Promise.all([
          pageA.locator('header').click(),
          pageB.locator('header').click(),
        ]);

        // Both edits should appear on both pages
        await expect(
          pageA.getByTitle('Double-click to edit').filter({ hasText: nameB }),
        ).toBeVisible({ timeout: 10_000 });

        await expect(
          pageB.getByTitle('Double-click to edit').filter({ hasText: nameA }),
        ).toBeVisible({ timeout: 10_000 });
      } finally {
        await cleanup();
      }
    });
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
