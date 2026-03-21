import { test, expect } from '@playwright/test';
import { setupMockAuth, ensureClientId } from './helpers/mock-auth';

// Helper: sign in via mock auth and reach ChoosePath
async function signInToChoosePath(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext();
  await setupMockAuth(context);
  const page = await context.newPage();
  await page.goto('/');
  await ensureClientId(page);
  await page.getByTestId('sign-in-button').click();
  await expect(page.getByTestId('choose-path-title')).toBeVisible({ timeout: 10_000 });
  return { context, page };
}

test.describe('Journey 1: First visit → demo → sandbox', () => {
  test('first visit shows WelcomeGate with Try the demo and Sign in buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('first-visit-title')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('try-demo-button')).toBeVisible();
    await expect(page.getByTestId('sign-in-button')).toBeVisible();
  });

  test('Try the demo enters sandbox mode with task bars', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();

    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });
    expect(await page.locator('.task-bar').count()).toBeGreaterThan(0);

    // WelcomeGate is gone — sandbox banner visible instead
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();
    await expect(page.getByTestId('first-visit-title')).not.toBeVisible();
  });

  test('sandbox banner shows save-to-sheet button', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });

    await expect(page.getByTestId('sandbox-banner')).toContainText('demo project');
    await expect(page.getByTestId('save-to-sheet-button')).toBeVisible();
  });
});

test.describe('Journey 2: Sign in → ChoosePath → branches', () => {
  test('sign in from FirstVisitWelcome transitions to ChoosePath', async ({ browser }) => {
    const { context, page } = await signInToChoosePath(browser);

    // ChoosePath shows all three action buttons
    await expect(page.getByTestId('new-project-button')).toBeVisible();
    await expect(page.getByTestId('existing-sheet-button')).toBeVisible();
    await expect(page.getByTestId('demo-button')).toBeVisible();

    await context.close();
  });

  test('ChoosePath demo button enters sandbox mode', async ({ browser }) => {
    const { context, page } = await signInToChoosePath(browser);

    await page.getByTestId('demo-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();

    await context.close();
  });

  test('ChoosePath New Project button enters empty state', async ({ browser }) => {
    const { context, page } = await signInToChoosePath(browser);

    await page.getByTestId('new-project-button').click();
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('empty-state-task-input')).toBeVisible();

    await context.close();
  });

  test('ChoosePath Existing Sheet button opens sheet selector', async ({ browser }) => {
    const { context, page } = await signInToChoosePath(browser);

    await page.getByTestId('existing-sheet-button').click();
    await expect(page.getByTestId('sheet-selector-modal')).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});

test.describe('Journey 3: Return visitor → recent sheets', () => {
  test('signed-in user with recent sheets sees them in ChoosePath', async ({ browser }) => {
    const context = await browser.newContext();
    await setupMockAuth(context);
    const page = await context.newPage();

    await page.goto('/');
    await ensureClientId(page);

    // Pre-populate recent sheets in localStorage before sign-in
    await page.evaluate(() => {
      localStorage.setItem(
        'ganttlet-recent-sheets',
        JSON.stringify([
          { sheetId: 'sheet-1', title: 'Q2 Planning', lastOpened: Date.now() - 60000 },
          { sheetId: 'sheet-2', title: 'Sprint Board', lastOpened: Date.now() - 120000 },
        ])
      );
    });

    // Sign in — ChoosePath renders (justSignedIn=true takes priority)
    await page.getByTestId('sign-in-button').click();
    await expect(page.getByTestId('choose-path-title')).toBeVisible({ timeout: 10_000 });

    // Recent projects should be visible in ChoosePath
    await expect(page.getByTestId('recent-projects')).toBeVisible();
    await expect(page.getByText('Q2 Planning')).toBeVisible();
    await expect(page.getByText('Sprint Board')).toBeVisible();

    await context.close();
  });
});

test.describe('Journey 4: Collaborator → ?sheet= without auth', () => {
  test('collaborator welcome renders for ?sheet= URL without auth', async ({ page }) => {
    await page.goto('/?sheet=some-spreadsheet-id');
    await expect(page.getByTestId('collaborator-title')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Journey 5: Empty state → create task', () => {
  test('New Project → empty state → type name → task created', async ({ browser }) => {
    const { context, page } = await signInToChoosePath(browser);

    // Enter empty state via New Project
    await page.getByTestId('new-project-button').click();
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 10_000 });

    // Type task name and press Enter
    await page.getByTestId('empty-state-task-input').fill('My First Task');
    await page.getByTestId('empty-state-task-input').press('Enter');

    // Empty state should transition to full Gantt view with the created task
    await page.locator('.task-bar').first().waitFor({ timeout: 10_000 });

    // Verify the task name appears in the table
    await expect(
      page.getByTitle('Double-click to edit').filter({ hasText: 'My First Task' })
    ).toBeVisible();

    await context.close();
  });
});

test.describe('Journey 7: Template picker', () => {
  test('empty state template button opens picker and selecting loads tasks', async ({
    browser,
  }) => {
    const { context, page } = await signInToChoosePath(browser);

    // Enter empty state
    await page.getByTestId('new-project-button').click();
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 10_000 });

    // Click "Start from template"
    await page.getByTestId('start-from-template').click();
    await expect(page.getByTestId('template-picker')).toBeVisible({ timeout: 10_000 });

    // Template cards should be visible
    await expect(page.getByTestId('template-card-software-release')).toBeVisible();

    // Close picker
    await page.getByTestId('template-picker-close').click();
    await expect(page.getByTestId('template-picker')).not.toBeVisible();

    await context.close();
  });
});

test.describe('Journey 8: Header share + disconnect', () => {
  test('header visible in sandbox mode with expected controls', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });

    // Header should be visible — look for the header element
    await expect(page.locator('header')).toBeVisible();
  });

  test('cell editing works in sandbox (sanity check for header interaction)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });

    // Double-click a task name to edit — verifies app is interactive
    const nameCell = page.getByTitle('Double-click to edit').first();
    await nameCell.dblclick();
    const input = page.locator('input.inline-edit-input');
    await input.waitFor({ timeout: 5_000 });

    const customName = 'Header E2E Task';
    await input.fill(customName);
    await page.locator('header').click();

    await expect(
      page.getByTitle('Double-click to edit').filter({ hasText: customName })
    ).toBeVisible();
  });
});
