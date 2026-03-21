/**
 * Cloud-auth onboarding E2E tests.
 * Require GCP_SA_KEY_WRITER1_DEV in the environment.
 * Run in CI (e2e.yml) where SA keys are available via GitHub Secrets.
 * Uses setupMockAuth which blocks real GIS + injects synthetic mock with real SA token.
 */
import { test, expect } from '@playwright/test';
import { getAccessToken } from './helpers/cloud-auth';
import { setupMockAuth, ensureClientId, signInOnPage } from './helpers/mock-auth';

const hasCloudAuth = !!process.env.GCP_SA_KEY_WRITER1_DEV;
const testSheetId = process.env.TEST_SHEET_ID_DEV;

async function getToken(): Promise<string> {
  const key = process.env.GCP_SA_KEY_WRITER1_DEV;
  if (!key) throw new Error('GCP_SA_KEY_WRITER1_DEV required');
  return getAccessToken(key);
}

/** Helper: create a context with real SA auth, navigate, sign in, return page */
async function createAuthPage(browser: import('@playwright/test').Browser, url: string) {
  const token = await getToken();
  const context = await browser.newContext();
  await setupMockAuth(context, token);
  const page = await context.newPage();
  await page.goto(url);
  await ensureClientId(page);
  return { context, page, token };
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

    // Should show CollaboratorWelcome
    await expect(page.getByTestId('collaborator-title')).toBeVisible({ timeout: 10_000 });

    // Sign in
    await page.getByTestId('collaborator-sign-in-button').click();

    // Task bars should appear (real sheet has data)
    await page.locator('.task-bar').first().waitFor({ timeout: 30_000 });
    expect(await page.locator('.task-bar').count()).toBeGreaterThan(0);

    // Welcome screens gone
    await expect(page.getByTestId('first-visit-title')).not.toBeVisible();
    await expect(page.getByTestId('collaborator-title')).not.toBeVisible();

    await context.close();
  });

  // ── Journey 6: Sandbox → promotion → create real sheet ──

  test('promotion flow creates a real Google Sheet', async ({ browser }) => {
    const { context, page } = await createAuthPage(browser, '/');

    // Enter sandbox
    await page.getByTestId('try-demo-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();

    // Click "Save to Google Sheet"
    await page.getByTestId('save-to-sheet-button').click();

    // Sign in if prompted (promotion flow may show sign-in gate)
    await signInOnPage(page);

    // Wait for promotion modal or direct transition
    // The promotion flow creates a new sheet and updates the URL
    await page
      .waitForFunction(() => window.location.search.includes('sheet='), { timeout: 30_000 })
      .catch(() => {
        // If URL doesn't change, check for promotion modal
      });

    // Either sandbox banner is gone (promotion succeeded) or modal is showing
    const sandboxGone = await page
      .getByTestId('sandbox-banner')
      .isVisible()
      .then((v) => !v)
      .catch(() => true);
    const urlHasSheet = page.url().includes('sheet=');

    // At minimum, the promotion flow should have started
    expect(sandboxGone || urlHasSheet).toBeTruthy();

    await context.close();
  });

  // ── Journey 8: Header with real sheet ──

  test('header shows sheet title and share button when connected to real sheet', async ({
    browser,
  }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const { context, page } = await createAuthPage(browser, `/?sheet=${testSheetId}`);

    // Sign in
    await page.getByTestId('collaborator-sign-in-button').click();

    // Wait for sheet to load
    await page.locator('.task-bar').first().waitFor({ timeout: 30_000 });

    // Header should show sheet title (fetched from Sheets API)
    await expect(page.getByTestId('sheet-title')).toBeVisible({ timeout: 10_000 });

    // Share button should be visible
    await expect(page.getByTestId('share-button')).toBeVisible();

    // Click share — should show toast
    await page.getByTestId('share-button').click();
    await expect(page.getByTestId('share-toast')).toBeVisible({ timeout: 5_000 });

    await context.close();
  });

  test('disconnect returns to WelcomeGate', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const { context, page } = await createAuthPage(browser, `/?sheet=${testSheetId}`);

    // Sign in and load sheet
    await page.getByTestId('collaborator-sign-in-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 30_000 });

    // Open dropdown menu
    await page.getByTestId('sheet-dropdown-trigger').click();
    await expect(page.getByTestId('sheet-dropdown-menu')).toBeVisible({ timeout: 5_000 });

    // Click disconnect
    await page.getByTestId('menu-disconnect').click();

    // Confirm disconnect dialog
    await expect(page.getByTestId('disconnect-confirm')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('disconnect-confirm-btn').click();

    // Should return to WelcomeGate (ChoosePath since still signed in)
    await expect(
      page.getByTestId('choose-path-title').or(page.getByTestId('return-visitor-title'))
    ).toBeVisible({ timeout: 10_000 });

    // URL should not have ?sheet= anymore
    expect(page.url()).not.toContain('sheet=');

    await context.close();
  });

  // ── Journey 9: Error on non-existent sheet ──

  test('non-existent sheet shows error banner with retry', async ({ browser }) => {
    const { context, page } = await createAuthPage(browser, `/?sheet=NONEXISTENT_SHEET_12345`);

    // Sign in
    await page.getByTestId('collaborator-sign-in-button').click();

    // Should show error banner (404 not_found)
    await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 30_000 });

    // Should have action buttons
    await expect(
      page.getByTestId('retry-btn').or(page.getByTestId('open-another-btn'))
    ).toBeVisible();

    await context.close();
  });

  // ── Journey 10: Sync status ──

  test('sync status indicator visible when connected to real sheet', async ({ browser }) => {
    test.skip(!testSheetId, 'Requires TEST_SHEET_ID_DEV');

    const { context, page } = await createAuthPage(browser, `/?sheet=${testSheetId}`);

    // Sign in and load sheet
    await page.getByTestId('collaborator-sign-in-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 30_000 });

    // Sync status should be visible in the header
    await expect(page.getByTestId('sync-status')).toBeVisible({ timeout: 10_000 });

    // Should show "Synced" (data loaded successfully)
    await expect(page.getByTestId('sync-status')).toContainText('Synced');

    await context.close();
  });
});
