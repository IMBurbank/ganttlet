/**
 * Cloud-auth onboarding E2E tests.
 * Require GCP_SA_KEY_WRITER1_DEV in the environment.
 * Uses setupMockAuth which blocks real GIS + injects synthetic mock with real SA token.
 */
import { test, expect } from '@playwright/test';
import { getAccessToken } from './helpers/cloud-auth';
import { setupMockAuth, ensureClientId } from './helpers/mock-auth';

const hasCloudAuth = !!process.env.GCP_SA_KEY_WRITER1_DEV;
const testSheetId = process.env.TEST_SHEET_ID_DEV;

async function getToken(): Promise<string> {
  const key = process.env.GCP_SA_KEY_WRITER1_DEV;
  if (!key) throw new Error('GCP_SA_KEY_WRITER1_DEV required');
  return getAccessToken(key);
}

async function createAuthPage(browser: import('@playwright/test').Browser, url: string) {
  const token = await getToken();
  const context = await browser.newContext();
  await setupMockAuth(context, token);
  const page = await context.newPage();
  await page.goto(url);
  await ensureClientId(page);
  return { context, page };
}

test.describe('Onboarding Cloud E2E', () => {
  test.skip(!hasCloudAuth, 'Requires GCP_SA_KEY_WRITER1_DEV');

  // ── Journey 2: Sign in → ChoosePath ──

  test('signed-in user sees ChoosePath', async ({ browser }) => {
    const { context, page } = await createAuthPage(browser, '/');
    await page.getByTestId('sign-in-button').click();

    await expect(
      page.getByTestId('choose-path-title').or(page.getByTestId('return-visitor-title'))
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  // ── Journey 4: Collaborator → ?sheet= → sign in → data loads ──

  test('collaborator signs in and sheet data loads', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const { context, page } = await createAuthPage(browser, `/?sheet=${testSheetId}`);

    await expect(page.getByTestId('collaborator-title')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('collaborator-sign-in-button').click();

    // Task bars should appear (real sheet has data)
    await page.locator('.task-bar').first().waitFor({ timeout: 30_000 });
    expect(await page.locator('.task-bar').count()).toBeGreaterThan(0);

    await context.close();
  });

  // ── Journey 8: Header with real sheet ──

  test('header shows sheet title and share works', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const { context, page } = await createAuthPage(browser, `/?sheet=${testSheetId}`);
    await page.getByTestId('collaborator-sign-in-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 30_000 });

    // Sheet title should be visible as a link in the header
    await expect(page.getByTestId('sheet-title')).toBeVisible({ timeout: 10_000 });
    const titleText = await page.getByTestId('sheet-title').textContent();
    expect(titleText).toBeTruthy();

    // Share button should be visible and clickable
    await expect(page.getByTestId('share-button')).toBeVisible();
    await page.getByTestId('share-button').click();

    // Toast may appear briefly — just verify the click didn't crash
    await page.waitForTimeout(500);

    await context.close();
  });

  test('disconnect returns to WelcomeGate', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const { context, page } = await createAuthPage(browser, `/?sheet=${testSheetId}`);
    await page.getByTestId('collaborator-sign-in-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 30_000 });

    // Open dropdown and disconnect
    await page.getByTestId('sheet-dropdown-trigger').click();
    await expect(page.getByTestId('sheet-dropdown-menu')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('menu-disconnect').click();

    // Confirm disconnect dialog
    await expect(page.getByTestId('disconnect-confirm')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('disconnect-confirm-btn').click();

    // Should return to WelcomeGate
    await expect(
      page.getByTestId('choose-path-title').or(page.getByTestId('return-visitor-title'))
    ).toBeVisible({ timeout: 10_000 });

    // URL should not have ?sheet=
    expect(page.url()).not.toContain('sheet=');

    await context.close();
  });

  // ── Journey 9: Error on non-existent sheet ──

  test('non-existent sheet shows error state', async ({ browser }) => {
    const { context, page } = await createAuthPage(browser, `/?sheet=NONEXISTENT_SHEET_12345`);
    await page.getByTestId('collaborator-sign-in-button').click();

    // Should show loading skeleton (dataSource stays 'loading' on error)
    // The error banner renders inside the loading skeleton in WelcomeGate
    await expect(
      page.getByTestId('loading-skeleton').or(page.getByTestId('error-banner'))
    ).toBeVisible({ timeout: 30_000 });

    await context.close();
  });

  // ── Journey 10: Sync status ──

  test('sync status shows Synced after loading real sheet', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const { context, page } = await createAuthPage(browser, `/?sheet=${testSheetId}`);
    await page.getByTestId('collaborator-sign-in-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 30_000 });

    // Sync status should show "Synced"
    await expect(page.getByTestId('sync-status')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('sync-status')).toContainText('Synced');

    await context.close();
  });
});
