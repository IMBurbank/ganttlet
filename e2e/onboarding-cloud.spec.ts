/**
 * Cloud-auth onboarding E2E tests.
 * These require GCP_SA_KEY_WRITER1_DEV (service account key) in the environment.
 * They skip locally (no SA keys) and run in CI where secrets are available.
 */
import { test, expect } from '@playwright/test';
import { getAccessToken } from './helpers/cloud-auth';
import { gisInitScript } from './helpers/collab-harness';

const hasCloudAuth = !!process.env.GCP_SA_KEY_WRITER1_DEV;
const testSheetId = process.env.TEST_SHEET_ID_DEV;

async function getToken(): Promise<string> {
  const key = process.env.GCP_SA_KEY_WRITER1_DEV;
  if (!key) throw new Error('GCP_SA_KEY_WRITER1_DEV required');
  return getAccessToken(key);
}

test.describe('Onboarding Cloud E2E', () => {
  test.skip(!hasCloudAuth, 'Requires E2E_CLOUD=1 with GCP service account keys');

  test('signed-in user with no URL params sees ChoosePath', async ({ browser }) => {
    const token = await getToken();
    const context = await browser.newContext();
    await context.addInitScript(gisInitScript(token));
    const page = await context.newPage();

    await page.goto('/');

    // FirstVisitWelcome renders first, click sign in
    await page.getByTestId('sign-in-button').click();

    // After GIS mock fires, should transition — wait for either ChoosePath or recent sheets
    await expect(
      page.getByTestId('choose-path-title').or(page.getByTestId('return-visitor'))
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('?sheet= with auth loads sheet data and shows task bars', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const token = await getToken();
    const context = await browser.newContext();
    await context.addInitScript(gisInitScript(token));
    const page = await context.newPage();

    // Sign in first to set auth state
    await page.goto('/');
    await page.getByTestId('sign-in-button').click();

    // Wait for auth to complete, then navigate to sheet URL
    await page.waitForTimeout(1000);
    await page.goto(`/?sheet=${testSheetId}&room=${testSheetId}`);

    // Should load sheet data — either task bars (data) or empty state (no data)
    await expect(page.locator('.task-bar').first().or(page.getByTestId('empty-state'))).toBeVisible(
      { timeout: 15_000 }
    );

    // Should NOT show WelcomeGate screens
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
    // Inject GIS mock but don't sign in yet
    await context.addInitScript(gisInitScript(token));
    const page = await context.newPage();

    await page.goto(`/?sheet=${testSheetId}`);

    // Should show CollaboratorWelcome (not signed in)
    await expect(page.getByTestId('collaborator-title')).toBeVisible({ timeout: 10_000 });

    // Click sign in
    await page.getByTestId('collab-sign-in-button').click();

    // After auth, should load sheet — task bars or empty state
    await expect(page.locator('.task-bar').first().or(page.getByTestId('empty-state'))).toBeVisible(
      { timeout: 15_000 }
    );

    await context.close();
  });

  test('sandbox promotion: save to sheet creates a real sheet', async ({ browser }) => {
    const token = await getToken();
    const context = await browser.newContext();
    await context.addInitScript(gisInitScript(token));
    const page = await context.newPage();

    // Enter sandbox via demo
    await page.goto('/?demo=1');
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

    // If sign-in button appeared, click it (GIS mock will auto-complete)
    const signInBtn = page.getByTestId('sign-in-button');
    if (await signInBtn.isVisible()) {
      await signInBtn.click();
      await expect(page.getByTestId('promotion-modal')).toBeVisible({ timeout: 10_000 });
    }

    // Click "Create new sheet" in the promotion modal
    const createBtn = page.getByTestId('create-new-sheet-btn');
    if (await createBtn.isVisible()) {
      await createBtn.click();

      // Should transition to sheet mode — sandbox banner gone, URL has ?sheet=
      await expect(page.getByTestId('sandbox-banner')).not.toBeVisible({ timeout: 15_000 });
      const url = page.url();
      expect(url).toContain('sheet=');
    }

    await context.close();
  });

  test('error banner shows on 403 forbidden sheet', async ({ browser }) => {
    const token = await getToken();
    const context = await browser.newContext();
    await context.addInitScript(gisInitScript(token));
    const page = await context.newPage();

    // Sign in first
    await page.goto('/');
    await page.getByTestId('sign-in-button').click();
    await page.waitForTimeout(1000);

    // Navigate to a non-existent sheet ID
    await page.goto('/?sheet=NONEXISTENT_SHEET_ID_12345');

    // Should show error banner (not_found or forbidden)
    await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 15_000 });

    // Should have retry and open-another buttons
    await expect(
      page.getByTestId('retry-btn').or(page.getByTestId('open-another-btn'))
    ).toBeVisible();

    await context.close();
  });
});
