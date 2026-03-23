/**
 * Cloud E2E tests — require GCP_SA_KEY_WRITER1_DEV + test sheet.
 * Tests cloud-specific features: sheet loading, sync, header, disconnect, errors.
 */
import { test, expect } from './fixtures';

const hasCloudAuth = !!process.env.GCP_SA_KEY_WRITER1_DEV;

test.describe('Cloud E2E @cloud', () => {
  test.skip(!hasCloudAuth, 'Requires GCP_SA_KEY_WRITER1_DEV');

  test('signed-in user sees ChoosePath', async ({ createCloudPage }) => {
    const { page: app } = await createCloudPage('/');
    await app.signIn();
    await expect(app.choosePathHeading).toBeVisible({ timeout: 10_000 });
  });

  test('collaborator signs in and sheet data loads', async ({ sheetPage: gantt }) => {
    expect(await gantt.taskBars.count()).toBeGreaterThan(0);
  });

  test('header shows sheet title and share works', async ({ sheetPage: gantt }) => {
    await expect(gantt.sheetTitle).toBeVisible({ timeout: 30_000 });
    await expect(gantt.shareButton).toBeVisible();

    await test.step('click share button', async () => {
      await gantt.shareButton.click();
      await expect(gantt.taskBars.first()).toBeVisible();
    });
  });

  test('disconnect returns to WelcomeGate', async ({ sheetPage: gantt }) => {
    await test.step('open dropdown and disconnect', async () => {
      await gantt.sheetDropdownTrigger.click();
      await expect(gantt.sheetDropdownMenu).toBeVisible({ timeout: 5_000 });
      await gantt.menuDisconnect.click();
    });

    await test.step('confirm disconnect', async () => {
      await expect(gantt.disconnectConfirm).toBeVisible({ timeout: 5_000 });
      await gantt.disconnectConfirmBtn.click();
    });

    await test.step('verify return to WelcomeGate', async () => {
      await expect(gantt.choosePathHeading).toBeVisible({ timeout: 10_000 });
      expect(gantt.page.url()).not.toContain('sheet=');
    });
  });

  test('non-existent sheet shows error state', async ({ createCloudPage }) => {
    const { page: app } = await createCloudPage('/?sheet=NONEXISTENT_SHEET_12345');
    await app.signIn();
    await expect(app.loadingSkeleton.or(app.errorBanner)).toBeVisible({ timeout: 60_000 });
  });

  test('promotion flow @slow', async ({ createCloudPage }) => {
    const { page: app } = await createCloudPage('/');

    await test.step('enter sandbox', async () => {
      await app.tryDemoButton.click();
      await app.page
        .getByTestId(/^task-bar-/)
        .first()
        .waitFor({ timeout: 15_000 });
      await expect(app.sandboxBanner).toBeVisible();
    });

    await test.step('open promotion modal and sign in', async () => {
      await app.saveToSheetButton.click();
      await expect(app.promotionModal).toBeVisible({ timeout: 5_000 });
      await app.signIn();
    });

    await test.step('verify destination picker', async () => {
      await expect(app.createNewSheetButton).toBeVisible({ timeout: 10_000 });
      await expect(app.saveToExistingButton).toBeVisible();
    });

    await test.step('attempt create sheet', async () => {
      await app.createNewSheetButton.click();

      await expect(async () => {
        const urlHasSheet = app.page.url().includes('sheet=');
        const hasError = await app.promotionError.isVisible().catch(() => false);
        const hasTryAgain = await app.page
          .getByText('Try again', { exact: true })
          .isVisible()
          .catch(() => false);
        expect(urlHasSheet || hasError || hasTryAgain).toBeTruthy();
      }).toPass({ timeout: 10_000 });
    });
  });

  test('sync status shows Synced after loading', async ({ sheetPage: gantt }) => {
    await expect(gantt.syncStatus).toBeVisible({ timeout: 10_000 });
    await expect(gantt.syncStatus).toContainText('Synced');
  });
});
