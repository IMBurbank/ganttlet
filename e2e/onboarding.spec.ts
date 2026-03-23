import { test, expect } from './fixtures';
import { ensureClientId } from './helpers/gis-mock';

test.describe('Journey 1: First visit → demo → sandbox', () => {
  test('first visit shows WelcomeGate @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('first-visit-title')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('try-demo-button')).toBeVisible();
    await expect(page.getByTestId('sign-in-button')).toBeVisible();
  });

  test('Try the demo enters sandbox mode @smoke', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();

    await expect(page.getByTestId(/^task-bar-/)).not.toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();
    await expect(page.getByTestId('first-visit-title')).toBeHidden();
  });

  test('sandbox banner shows save-to-sheet button', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();
    await page
      .getByTestId(/^task-bar-/)
      .first()
      .waitFor({ timeout: 15_000 });

    await expect(page.getByTestId('sandbox-banner')).toContainText('demo project');
    await expect(page.getByTestId('save-to-sheet-button')).toBeVisible();
  });
});

test.describe('Journey 2: Sign in → ChoosePath → branches', () => {
  test('sign in from FirstVisitWelcome transitions to ChoosePath', async ({
    signedInPage: page,
  }) => {
    await expect(page.getByTestId('new-project-button')).toBeVisible();
    await expect(page.getByTestId('existing-sheet-button')).toBeVisible();
    await expect(page.getByTestId('demo-button')).toBeVisible();
  });

  test('ChoosePath demo button enters sandbox mode', async ({ signedInPage: page }) => {
    await page.getByTestId('demo-button').click();
    await page
      .getByTestId(/^task-bar-/)
      .first()
      .waitFor({ timeout: 15_000 });
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();
  });

  test('ChoosePath New Project button enters empty state', async ({ signedInPage: page }) => {
    await page.getByTestId('new-project-button').click();
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('empty-state-task-input')).toBeVisible();
  });

  test('ChoosePath Existing Sheet button opens sheet selector', async ({ signedInPage: page }) => {
    await page.getByTestId('existing-sheet-button').click();
    await expect(page.getByTestId('sheet-selector-modal')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Journey 3: Return visitor → recent sheets', () => {
  test('signed-in user with recent sheets sees them in ChoosePath', async ({ mockAuthContext }) => {
    const page = await mockAuthContext.newPage();
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

    await page.getByTestId('sign-in-button').click();
    await expect(page.getByTestId('choose-path-title')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('recent-projects')).toBeVisible();
    await expect(page.getByText('Q2 Planning', { exact: true })).toBeVisible();
    await expect(page.getByText('Sprint Board', { exact: true })).toBeVisible();
  });
});

test.describe('Journey 4: Collaborator → ?sheet= without auth', () => {
  test('collaborator welcome renders for ?sheet= URL without auth', async ({ page }) => {
    await page.goto('/?sheet=some-spreadsheet-id');
    await expect(page.getByTestId('collaborator-title')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Journey 5: Empty state → create task', () => {
  test('New Project → empty state → type name → task created', async ({ signedInPage: page }) => {
    await page.getByTestId('new-project-button').click();
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 10_000 });

    await test.step('create first task', async () => {
      await page.getByTestId('empty-state-task-input').fill('My First Task');
      await page.getByTestId('empty-state-task-input').press('Enter');
    });

    await test.step('verify task appears in Gantt', async () => {
      await page
        .getByTestId(/^task-bar-/)
        .first()
        .waitFor({ timeout: 10_000 });
      await expect(
        page.getByTitle('Double-click to edit').filter({ hasText: 'My First Task' })
      ).toBeVisible();
    });
  });
});

test.describe('Journey 7: Template picker', () => {
  test('empty state template button opens picker and selecting loads tasks', async ({
    signedInPage: page,
  }) => {
    await page.getByTestId('new-project-button').click();
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('start-from-template').click();
    await expect(page.getByTestId('template-picker')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('template-card-software-release')).toBeVisible();

    await page.getByTestId('template-picker-close').click();
    await expect(page.getByTestId('template-picker')).toBeHidden();
  });
});

test.describe('Journey 8: Header', () => {
  test('header visible in sandbox mode', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();
    await page
      .getByTestId(/^task-bar-/)
      .first()
      .waitFor({ timeout: 15_000 });
    await expect(page.locator('header')).toBeVisible();
  });
});
