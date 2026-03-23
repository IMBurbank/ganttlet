/**
 * Collaboration E2E tests — require two SA keys + test sheet + relay.
 * Tests real-time multi-user sync via Yjs.
 */
import { test, expect } from './fixtures';

const hasCloudAuth =
  !!process.env.GCP_SA_KEY_WRITER1_DEV &&
  !!(process.env.GCP_SA_KEY_WRITER2_DEV || process.env.GCP_SA_KEY_READER1_DEV);

test.describe('Collaboration E2E @collab', () => {
  test.setTimeout(180_000);
  test.skip(!hasCloudAuth, 'Requires two SA keys for collab');

  test('presence indicators appear for connected users @slow', async ({ collabPair }) => {
    const collabReady = await collabPair.pageA.collabStatus.isVisible().catch(() => false);
    if (!collabReady) {
      test.skip(true, 'Collab relay not available');
      return;
    }

    await expect(collabPair.pageB.presenceIndicators.first()).toBeVisible({ timeout: 15_000 });
  });

  test('task edit in one tab propagates to the other @slow', async ({ collabPair }) => {
    const collabReady = await collabPair.pageA.collabStatus.isVisible().catch(() => false);
    if (!collabReady) {
      test.skip(true, 'Collab relay not available');
      return;
    }

    const newName = 'Collab E2E Sync Test';

    await test.step('edit task name on page A', async () => {
      await collabPair.pageA.editTaskName(0, newName);
    });

    await test.step('verify propagation to page B', async () => {
      await expect(collabPair.pageB.editableCells.filter({ hasText: newName })).toBeVisible({
        timeout: 15_000,
      });
    });
  });

  test('constraint change in one tab propagates @slow', async ({ collabPair }) => {
    const collabReady = await collabPair.pageA.collabStatus.isVisible().catch(() => false);
    if (!collabReady) {
      test.skip(true, 'Collab relay not available');
      return;
    }

    await test.step('set SNET constraint on page A', async () => {
      const popover = await collabPair.pageA.openPopover(0);
      await popover.setConstraint('SNET', '2026-07-01');
      await popover.close();
    });

    await test.step('verify constraint synced to page B', async () => {
      // Poll by opening/closing the popover until the synced value appears.
      // Uses raw locators instead of PopoverModel because the model's close()
      // asserts toBeHidden which would throw inside the toPass retry loop.
      const pageB = collabPair.pageB.page;
      await expect(async () => {
        await collabPair.pageB.taskBar(0).dispatchEvent('dblclick');
        const popover = pageB.getByTestId('task-popover');
        await popover.waitFor({ timeout: 3_000 });
        const val = await popover.getByLabel('Constraint', { exact: true }).inputValue();
        await pageB.keyboard.press('Escape');
        expect(val).toBe('SNET');
      }).toPass({ timeout: 15_000 });
    });

    await test.step('verify task bars still render', async () => {
      expect(await collabPair.pageB.taskBars.count()).toBeGreaterThan(0);
    });
  });

  test('conflict indicator visible to collaborators @slow', async ({ collabPair }) => {
    const collabReady = await collabPair.pageA.collabStatus.isVisible().catch(() => false);
    if (!collabReady) {
      test.skip(true, 'Collab relay not available');
      return;
    }

    await test.step('set MSO with past date on page A', async () => {
      const popover = await collabPair.pageA.openPopover(0);
      await popover.setConstraint('MSO', '2020-01-01');
      await popover.close();
    });

    await test.step('verify conflict indicator on page B', async () => {
      await expect(async () => {
        const indicators = await collabPair.pageB.conflictIndicators.count();
        const outlines = await collabPair.pageB.conflictOutlines.count();
        expect(indicators + outlines).toBeGreaterThan(0);
      }).toPass({ timeout: 15_000 });
    });
  });
});

// Outside the cloud-auth-gated describe — runs in all environments
test.describe('Single-user resilience', () => {
  test('single-user mode works without relay @smoke', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.getByTestId('try-demo-button').click();
    await page
      .getByTestId(/^task-bar-/)
      .first()
      .waitFor({ timeout: 15_000 });

    await test.step('edit task in single-user mode', async () => {
      const nameCell = page.getByTitle('Double-click to edit').first();
      await nameCell.dblclick();
      const input = page.getByTestId('inline-edit-input');
      await input.waitFor({ timeout: 15_000 });
      await input.fill('Single User Edit');
      await page.locator('header').click();

      await expect(
        page.getByTitle('Double-click to edit').filter({ hasText: 'Single User Edit' })
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step('verify no unexpected errors', async () => {
      const unexpectedErrors = consoleErrors.filter(
        (msg) => !msg.includes('WebSocket') && !msg.includes('ws://')
      );
      expect(unexpectedErrors).toHaveLength(0);
    });
  });
});
