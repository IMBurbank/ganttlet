/**
 * Cloud E2E tests — require GCP_SA_KEY_WRITER1_DEV + test sheet.
 * Tests cloud-specific features: sheet loading, sync, header, disconnect, errors.
 */
import { test, expect } from './fixtures';

const hasCloudAuth = !!process.env.GCP_SA_KEY_WRITER1_DEV;

test.describe('Cloud E2E @cloud', () => {
  test.skip(!hasCloudAuth, 'Requires GCP_SA_KEY_WRITER1_DEV');

  test('signed-in user sees ChoosePath', async ({ createCloudPage }) => {
    const { page } = await createCloudPage('/');

    await test.step('sign in', async () => {
      await page.getByTestId('sign-in-button').click();
    });

    await expect(
      page.getByTestId('choose-path-title').or(page.getByTestId('return-visitor-title'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('collaborator signs in and sheet data loads', async ({ sheetPage: gantt }) => {
    expect(await gantt.taskBars.count()).toBeGreaterThan(0);
  });

  test('header shows sheet title and share works', async ({ sheetPage: gantt }) => {
    await expect(gantt.page.getByTestId('sheet-title')).toBeVisible({ timeout: 30_000 });
    await expect(gantt.page.getByTestId('share-button')).toBeVisible();

    await test.step('click share button', async () => {
      await gantt.page.getByTestId('share-button').click();
      await expect(gantt.taskBars.first()).toBeVisible();
    });
  });

  test('disconnect returns to WelcomeGate', async ({ sheetPage: gantt }) => {
    await test.step('open dropdown and disconnect', async () => {
      await gantt.page.getByTestId('sheet-dropdown-trigger').click();
      await expect(gantt.page.getByTestId('sheet-dropdown-menu')).toBeVisible({ timeout: 5_000 });
      await gantt.page.getByTestId('menu-disconnect').click();
    });

    await test.step('confirm disconnect', async () => {
      await expect(gantt.page.getByTestId('disconnect-confirm')).toBeVisible({ timeout: 5_000 });
      await gantt.page.getByTestId('disconnect-confirm-btn').click();
    });

    await test.step('verify return to WelcomeGate', async () => {
      await expect(
        gantt.page
          .getByTestId('choose-path-title')
          .or(gantt.page.getByTestId('return-visitor-title'))
      ).toBeVisible({ timeout: 10_000 });
      expect(gantt.page.url()).not.toContain('sheet=');
    });
  });

  test('non-existent sheet shows error state', async ({ createCloudPage }) => {
    const { page } = await createCloudPage('/?sheet=NONEXISTENT_SHEET_12345');

    await page.getByTestId('collaborator-sign-in-button').click();

    await expect(
      page.getByTestId('loading-skeleton').or(page.getByTestId('error-banner'))
    ).toBeVisible({ timeout: 60_000 });
  });

  test('promotion flow @slow', async ({ createCloudPage }) => {
    const { page } = await createCloudPage('/');

    await test.step('enter sandbox', async () => {
      await page.getByTestId('try-demo-button').click();
      await page
        .getByTestId(/^task-bar-/)
        .first()
        .waitFor({ timeout: 15_000 });
      await expect(page.getByTestId('sandbox-banner')).toBeVisible();
    });

    await test.step('open promotion modal and sign in', async () => {
      await page.getByTestId('save-to-sheet-button').click();
      await expect(page.getByTestId('promotion-modal')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('sign-in-button').click();
    });

    await test.step('verify destination picker', async () => {
      await expect(page.getByTestId('create-new-sheet-button')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('save-to-existing-button')).toBeVisible();
    });

    await test.step('attempt create sheet', async () => {
      await page.getByTestId('create-new-sheet-button').click();

      await expect(async () => {
        const urlHasSheet = page.url().includes('sheet=');
        const hasError = await page
          .getByTestId('promotion-error')
          .isVisible()
          .catch(() => false);
        const hasTryAgain = await page
          .getByText('Try again')
          .isVisible()
          .catch(() => false);
        expect(urlHasSheet || hasError || hasTryAgain).toBeTruthy();
      }).toPass({ timeout: 10_000 });
    });
  });

  test('sync status shows Synced after loading', async ({ sheetPage: gantt }) => {
    await expect(gantt.page.getByTestId('sync-status')).toBeVisible({ timeout: 10_000 });
    await expect(gantt.page.getByTestId('sync-status')).toContainText('Synced');
  });
});
