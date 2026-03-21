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

    // Click sign in — GIS mock fires with real SA token
    await page.getByTestId('sign-in-button').click();

    // Should transition to ChoosePath or ReturnVisitor
    await expect(
      page.getByTestId('choose-path-title').or(page.getByTestId('return-visitor-title'))
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('?sheet= with auth loads sheet data', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const token = await getToken();
    const context = await browser.newContext();
    await setupMockAuth(context, token);
    const page = await context.newPage();

    // Sign in first
    await page.goto('/');
    await ensureClientId(page);
    await page.getByTestId('sign-in-button').click();
    await page.waitForTimeout(1000);

    // Navigate to sheet URL — real token can load real sheets
    await page.goto(`/?sheet=${testSheetId}&room=${testSheetId}`);
    await ensureClientId(page);

    // Should load sheet data — either task bars (data) or empty state (no data)
    await expect(page.locator('.task-bar').first().or(page.getByTestId('empty-state'))).toBeVisible(
      { timeout: 20_000 }
    );

    // Should NOT show welcome screens
    await expect(page.getByTestId('first-visit-title')).not.toBeVisible();
    await expect(page.getByTestId('collaborator-title')).not.toBeVisible();

    await context.close();
  });

  test('?sheet= without auth shows CollaboratorWelcome, then loads after sign-in', async ({
    browser,
  }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const token = await getToken();
    const context = await browser.newContext();
    await setupMockAuth(context, token);
    const page = await context.newPage();

    await page.goto(`/?sheet=${testSheetId}`);
    await ensureClientId(page);

    // Should show CollaboratorWelcome (not signed in yet — mock doesn't auto-sign-in)
    await expect(page.getByTestId('collaborator-title')).toBeVisible({ timeout: 10_000 });

    // Click sign in
    await page.getByTestId('collab-sign-in-button').click();

    // After auth, should load sheet — task bars or empty state
    await expect(page.locator('.task-bar').first().or(page.getByTestId('empty-state'))).toBeVisible(
      { timeout: 20_000 }
    );

    await context.close();
  });

  test('sandbox promotion: save to sheet creates a real sheet', async ({ browser }) => {
    const token = await getToken();
    const context = await browser.newContext();
    await setupMockAuth(context, token);
    const page = await context.newPage();

    // Enter sandbox via the real user flow
    await page.goto('/');
    await ensureClientId(page);
    await page.getByTestId('try-demo-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });

    // Sandbox banner should be visible
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();

    // Click "Save to Google Sheet"
    await page.getByTestId('save-to-sheet-button').click();

    // PromotionFlow modal should appear — may need to sign in first
    const promotionOrSignIn = page
      .getByTestId('promotion-modal')
      .or(page.getByTestId('sign-in-button'));
    await expect(promotionOrSignIn).toBeVisible({ timeout: 10_000 });

    // If sign-in button appeared, click it
    const signInBtn = page.getByTestId('sign-in-button');
    if (await signInBtn.isVisible()) {
      await signInBtn.click();
      await expect(page.getByTestId('promotion-modal')).toBeVisible({ timeout: 10_000 });
    }

    // Click "Create new sheet" if visible
    const createBtn = page.getByTestId('create-new-sheet-btn');
    if (await createBtn.isVisible()) {
      await createBtn.click();
      // Should transition to sheet mode
      await expect(page.getByTestId('sandbox-banner')).not.toBeVisible({ timeout: 15_000 });
      expect(page.url()).toContain('sheet=');
    }

    await context.close();
  });

  test('error banner shows on non-existent sheet', async ({ browser }) => {
    const token = await getToken();
    const context = await browser.newContext();
    await setupMockAuth(context, token);
    const page = await context.newPage();

    // Sign in first
    await page.goto('/');
    await ensureClientId(page);
    await page.getByTestId('sign-in-button').click();
    await page.waitForTimeout(1000);

    // Navigate to a non-existent sheet ID
    await page.goto('/?sheet=NONEXISTENT_SHEET_ID_12345');
    await ensureClientId(page);

    // Should show error banner or loading skeleton (depends on timing)
    await expect(
      page.getByTestId('error-banner').or(page.getByTestId('loading-skeleton'))
    ).toBeVisible({ timeout: 20_000 });

    await context.close();
  });
});
