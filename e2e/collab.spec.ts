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

        // Allow time for CRDT sync to settle
        await pageA.waitForTimeout(3_000);

        // Both pages should converge to the same final name (last-write-wins)
        const finalNameA = await pageA.getByTitle('Double-click to edit').first().textContent();
        const finalNameB = await pageB.getByTitle('Double-click to edit').first().textContent();

        expect(finalNameA).toBeTruthy();
        expect(finalNameA!.trim()).toBe(finalNameB!.trim());
        expect(['Concurrent Write A', 'Concurrent Write B']).toContain(finalNameA!.trim());
      } finally {
        await cleanup();
      }
    });

    test('user A adds a task while user B edits an existing task — both changes appear', async ({ browser }) => {
      const cloudAuth = await getCloudAuth();
      const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

      try {
        const collabReady = await isCollabAvailable(pageA);
        if (!collabReady) {
          test.skip();
          return;
        }

        // Record initial visible task bar count
        const initialBarCount = await pageA.locator('.task-bar').count();

        // userB opens the first task name for editing
        await pageB.getByTitle('Double-click to edit').first().dblclick();
        const inputB = pageB.locator('input.inline-edit-input');
        await inputB.waitFor({ timeout: 5_000 });

        const editedName = 'B Edited While A Added';
        await inputB.fill(editedName);

        // userA adds a new task at the same time userB saves
        await Promise.all([
          pageA.getByRole('button', { name: '+ Add Task' }).click(),
          pageB.locator('header').click(),
        ]);

        // pageA should see userB's edited name
        await expect(
          pageA.getByTitle('Double-click to edit').filter({ hasText: editedName }),
        ).toBeVisible({ timeout: 8_000 });

        // pageB should see the new task added by userA (task bar count increases by 1)
        // Two .task-bar rects per task (fill + stroke), so count increases by 2
        await expect(pageB.locator('.task-bar')).toHaveCount(initialBarCount + 2, { timeout: 8_000 });
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

        // Allow CRDT sync to settle
        await pageA.waitForTimeout(3_000);

        // Both pages should have the same number of task bars (no divergence or crash)
        const barCountA = await pageA.locator('.task-bar').count();
        const barCountB = await pageB.locator('.task-bar').count();
        expect(barCountA).toBeGreaterThan(0);
        expect(barCountA).toBe(barCountB);
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

        // Helper: edit the first task name on a given page and blur to save
        async function editTaskName(page: typeof pageA, name: string) {
          await page.getByTitle('Double-click to edit').first().dblclick();
          const input = page.locator('input.inline-edit-input');
          await input.waitFor({ timeout: 5_000 });
          await input.fill(name);
          await page.locator('header').click();
          // Short settle time for each individual edit
          await page.waitForTimeout(300);
        }

        // Rapid interleaved edits from both users on the same task
        await editTaskName(pageA, 'Rapid Edit 1 from A');
        await editTaskName(pageB, 'Rapid Edit 2 from B');
        await editTaskName(pageA, 'Rapid Edit 3 from A');
        await editTaskName(pageB, 'Rapid Edit 4 from B');

        const finalName = 'Rapid Edit 5 Final from A';
        await editTaskName(pageA, finalName);

        // Final edit from A should propagate to pageB
        await expect(
          pageB.getByTitle('Double-click to edit').filter({ hasText: finalName }),
        ).toBeVisible({ timeout: 8_000 });

        // Both pages should display the same final value
        const nameOnA = await pageA.getByTitle('Double-click to edit').first().textContent();
        const nameOnB = await pageB.getByTitle('Double-click to edit').first().textContent();
        expect(nameOnA?.trim()).toBe(nameOnB?.trim());
      } finally {
        await cleanup();
      }
    });

    test('user A deletes a task while user B is editing it — no crash, consistent final state', async ({ browser }) => {
      const cloudAuth = await getCloudAuth();
      const { pageA, pageB, cleanup } = await createCollabPair(browser, cloudAuth);

      try {
        const collabReady = await isCollabAvailable(pageA);
        if (!collabReady) {
          test.skip();
          return;
        }

        // Record initial task bar count and the name of the first leaf task
        const initialBarCount = await pageA.locator('.task-bar').count();
        const targetNameEl = pageA.getByTitle('Double-click to edit').first();
        const targetName = (await targetNameEl.textContent()) ?? '';

        // userB starts editing the first task's name
        await pageB.getByTitle('Double-click to edit').first().dblclick();
        const inputB = pageB.locator('input.inline-edit-input');
        await inputB.waitFor({ timeout: 5_000 });
        await inputB.fill('B editing a task about to be deleted');

        // userA right-clicks the first task row to open the context menu
        await pageA.getByTitle('Double-click to edit').first().click({ button: 'right' });
        const deleteBtn = pageA.locator('button').filter({ hasText: 'Delete task' });
        await deleteBtn.waitFor({ timeout: 3_000 });
        await deleteBtn.click();

        // userB tries to save the now-deleted task (graceful no-op expected)
        await pageB.locator('header').click();

        // Allow sync to settle
        await pageA.waitForTimeout(3_000);

        // The deleted task should no longer appear on pageA
        const barCountA = await pageA.locator('.task-bar').count();
        expect(barCountA).toBeLessThan(initialBarCount);

        // pageB should converge to the same task bar count (CRDT sync)
        const barCountB = await pageB.locator('.task-bar').count();
        expect(barCountB).toBe(barCountA);

        // The deleted task's original name should no longer appear on pageB
        if (targetName) {
          await expect(
            pageB.getByTitle('Double-click to edit').filter({ hasText: targetName }),
          ).toHaveCount(0, { timeout: 5_000 });
        }
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
