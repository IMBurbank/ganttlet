import { test, expect } from '@playwright/test';
import { setupMockAuth, ensureClientId } from './helpers/mock-auth';

test.describe('Onboarding UX E2E', () => {
  test('first visit shows WelcomeGate with Try the demo button', async ({ page }) => {
    await page.goto('/');

    // WelcomeGate renders FirstVisitWelcome for unauthenticated users
    await expect(page.getByTestId('first-visit-title')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('try-demo-button')).toBeVisible();
    await expect(page.getByTestId('sign-in-button')).toBeVisible();
  });

  test('Try the demo enters sandbox mode with task bars', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();

    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });
    const taskBarCount = await page.locator('.task-bar').count();
    expect(taskBarCount).toBeGreaterThan(0);
  });

  test('sandbox mode shows sandbox banner with save button', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });

    await expect(page.getByTestId('sandbox-banner')).toBeVisible();
    await expect(page.getByTestId('save-to-sheet-button')).toBeVisible();
    await expect(page.getByTestId('sandbox-banner')).toContainText('demo project');
  });

  test('collaborator welcome renders for ?sheet= URL without auth', async ({ page }) => {
    await page.goto('/?sheet=some-spreadsheet-id');

    await expect(page.getByTestId('collaborator-title')).toBeVisible({ timeout: 10_000 });
  });

  test('cell editing preserves user-typed task name', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });

    const nameCell = page.getByTitle('Double-click to edit').first();
    await nameCell.dblclick();

    const input = page.locator('input.inline-edit-input');
    await input.waitFor({ timeout: 5_000 });

    const customName = 'Onboarding E2E Task';
    await input.fill(customName);
    await page.locator('header').click();

    await expect(
      page.getByTitle('Double-click to edit').filter({ hasText: customName })
    ).toBeVisible();
  });
});

test.describe('Onboarding Auth E2E (mock auth)', () => {
  test('sign in from FirstVisitWelcome transitions to ChoosePath', async ({ browser }) => {
    const context = await browser.newContext();
    await setupMockAuth(context);
    const page = await context.newPage();

    await page.goto('/');
    await ensureClientId(page);
    await expect(page.getByTestId('first-visit-title')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('sign-in-button').click();

    await expect(page.getByTestId('choose-path-title')).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('signed-in user with no sheets sees ChoosePath', async ({ browser }) => {
    const context = await browser.newContext();
    await setupMockAuth(context);
    const page = await context.newPage();

    await page.goto('/');
    await ensureClientId(page);
    await page.getByTestId('sign-in-button').click();

    await expect(page.getByTestId('choose-path-title')).toBeVisible({ timeout: 10_000 });
    // ChoosePath shows New Project, Connect Existing Sheet, Demo
    await expect(page.getByRole('button', { name: 'Demo' })).toBeVisible();

    await context.close();
  });

  test('ChoosePath demo button enters sandbox mode', async ({ browser }) => {
    const context = await browser.newContext();
    await setupMockAuth(context);
    const page = await context.newPage();

    await page.goto('/');
    await ensureClientId(page);
    await page.getByTestId('sign-in-button').click();
    await expect(page.getByTestId('choose-path-title')).toBeVisible({ timeout: 10_000 });

    // Click demo from ChoosePath
    await page.getByRole('button', { name: 'Demo' }).click();
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });

    // Should show sandbox banner
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();

    await context.close();
  });
});
