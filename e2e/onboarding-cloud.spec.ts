/**
 * Cloud-auth onboarding E2E tests.
 * These require GCP_SA_KEY_WRITER1_DEV (service account key) in the environment.
 * They skip locally (no SA keys) and run in CI where secrets are available.
 * Uses setupMockAuth which blocks the real GIS library and injects a synthetic
 * google.accounts.oauth2 with the real SA token — so API calls work.
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

test.describe('Onboarding Cloud E2E', () => {
  test.skip(!hasCloudAuth, 'Requires GCP_SA_KEY_WRITER1_DEV');

  test('signed-in user with no URL params sees ChoosePath', async ({ browser }) => {
    const token = await getToken();
    const context = await browser.newContext();
    await setupMockAuth(context, token);
    const page = await context.newPage();

    await page.goto('/');
    await ensureClientId(page);
    await page.getByTestId('sign-in-button').click();

    await expect(
      page.getByTestId('choose-path-title').or(page.getByTestId('return-visitor-title'))
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('?sheet= with auth reaches non-welcome state', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const token = await getToken();
    const context = await browser.newContext();
    await setupMockAuth(context, token);
    const page = await context.newPage();

    // Sign in first
    await page.goto('/');
    await ensureClientId(page);
    await page.getByTestId('sign-in-button').click();
    await page.waitForTimeout(2000);

    // Navigate to sheet URL
    await page.goto(`/?sheet=${testSheetId}&room=${testSheetId}`);
    await ensureClientId(page);

    // Should reach a non-welcome state (task bars, empty state, loading, or error)
    await expect(
      page
        .locator('.task-bar')
        .first()
        .or(page.getByTestId('empty-state'))
        .or(page.getByTestId('loading-skeleton'))
        .or(page.getByTestId('error-banner'))
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('first-visit-title')).not.toBeVisible();

    await context.close();
  });

  test('?sheet= without auth shows CollaboratorWelcome', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const token = await getToken();
    const context = await browser.newContext();
    await setupMockAuth(context, token);
    const page = await context.newPage();

    await page.goto(`/?sheet=${testSheetId}`);

    // Should show CollaboratorWelcome (not signed in yet)
    await expect(page.getByTestId('collaborator-title')).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('error or loading on non-existent sheet', async ({ browser }) => {
    const token = await getToken();
    const context = await browser.newContext();
    await setupMockAuth(context, token);
    const page = await context.newPage();

    // Sign in first
    await page.goto('/');
    await ensureClientId(page);
    await page.getByTestId('sign-in-button').click();
    await page.waitForTimeout(2000);

    // Navigate to a non-existent sheet ID
    await page.goto('/?sheet=NONEXISTENT_SHEET_ID_12345');
    await ensureClientId(page);

    // Should show error, loading, or collaborator welcome (depends on auth persistence)
    await expect(
      page
        .getByTestId('error-banner')
        .or(page.getByTestId('loading-skeleton'))
        .or(page.getByTestId('collaborator-title'))
    ).toBeVisible({ timeout: 30_000 });

    await context.close();
  });
});
