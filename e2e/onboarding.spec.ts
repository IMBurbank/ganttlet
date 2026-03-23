import { test, expect } from './fixtures';
import { BasePage } from './models/base-page';

test.describe('Journey 1: First visit → demo → sandbox', () => {
  test('first visit shows WelcomeGate @smoke', async ({ basePage: app }) => {
    await app.goto('/');
    await expect(app.firstVisitTitle).toBeVisible({ timeout: 10_000 });
    await expect(app.tryDemoButton).toBeVisible();
    await expect(app.signInButton).toBeVisible();
  });

  test('Try the demo enters sandbox mode @smoke', async ({ basePage: app }) => {
    await app.goto('/');
    await app.tryDemoButton.click();

    await expect(app.taskBars).not.toHaveCount(0, { timeout: 15_000 });
    await expect(app.sandboxBanner).toBeVisible();
    await expect(app.firstVisitTitle).toBeHidden();
  });

  test('sandbox banner shows save-to-sheet button', async ({ basePage: app }) => {
    await app.goto('/');
    await app.tryDemoButton.click();
    await app.taskBars.first().waitFor({ timeout: 15_000 });

    await expect(app.sandboxBanner).toContainText('demo project');
    await expect(app.saveToSheetButton).toBeVisible();
  });
});

test.describe('Journey 2: Sign in → ChoosePath → branches', () => {
  test('sign in from FirstVisitWelcome transitions to ChoosePath', async ({
    signedInPage: app,
  }) => {
    await expect(app.newProjectButton).toBeVisible();
    await expect(app.existingSheetButton).toBeVisible();
    await expect(app.demoButton).toBeVisible();
  });

  test('ChoosePath demo button enters sandbox mode', async ({ signedInPage: app }) => {
    await app.demoButton.click();
    await app.taskBars.first().waitFor({ timeout: 15_000 });
    await expect(app.sandboxBanner).toBeVisible();
  });

  test('ChoosePath New Project button enters empty state', async ({ signedInPage: app }) => {
    await app.newProjectButton.click();
    await expect(app.emptyState).toBeVisible({ timeout: 10_000 });
    await expect(app.emptyStateInput).toBeVisible();
  });

  test('ChoosePath Existing Sheet button opens sheet selector', async ({ signedInPage: app }) => {
    await app.existingSheetButton.click();
    await expect(app.sheetSelectorModal).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Journey 3: Return visitor → recent sheets', () => {
  test('signed-in user with recent sheets sees them in ChoosePath', async ({ mockAuthContext }) => {
    const rawPage = await mockAuthContext.newPage();
    const app = new BasePage(rawPage);
    await app.gotoAuthenticated('/');

    // Pre-populate recent sheets in localStorage before sign-in
    await rawPage.evaluate(() => {
      localStorage.setItem(
        'ganttlet-recent-sheets',
        JSON.stringify([
          { sheetId: 'sheet-1', title: 'Q2 Planning', lastOpened: Date.now() - 60000 },
          { sheetId: 'sheet-2', title: 'Sprint Board', lastOpened: Date.now() - 120000 },
        ])
      );
    });

    await app.signIn();
    await expect(app.mainHeading).toBeVisible({ timeout: 10_000 });
    await expect(app.recentProjects).toBeVisible();
    await expect(app.page.getByText('Q2 Planning', { exact: true })).toBeVisible();
    await expect(app.page.getByText('Sprint Board', { exact: true })).toBeVisible();
  });
});

test.describe('Journey 4: Collaborator → ?sheet= without auth', () => {
  test('collaborator welcome renders for ?sheet= URL without auth', async ({ basePage: app }) => {
    await app.goto('/?sheet=some-spreadsheet-id');
    await expect(app.collaboratorTitle).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Journey 5: Empty state → create task', () => {
  test('New Project → empty state → type name → task created', async ({ signedInPage: app }) => {
    await app.newProjectButton.click();
    await expect(app.emptyState).toBeVisible({ timeout: 10_000 });

    await test.step('create first task', async () => {
      await app.emptyStateInput.fill('My First Task');
      await app.emptyStateInput.press('Enter');
    });

    await test.step('verify task appears in Gantt', async () => {
      await app.taskBars.first().waitFor({ timeout: 10_000 });
      await expect(app.editableCells.filter({ hasText: 'My First Task' })).toBeVisible();
    });
  });
});

test.describe('Journey 7: Template picker', () => {
  test('empty state template button opens picker and selecting loads tasks', async ({
    signedInPage: app,
  }) => {
    await app.newProjectButton.click();
    await expect(app.emptyState).toBeVisible({ timeout: 10_000 });

    await app.startFromTemplate.click();
    await expect(app.templatePicker).toBeVisible({ timeout: 10_000 });
    await expect(app.page.getByTestId('template-card-software-release')).toBeVisible();

    await app.templatePickerClose.click();
    await expect(app.templatePicker).toBeHidden();
  });
});

test.describe('Journey 8: Header', () => {
  test('header visible in sandbox mode', async ({ basePage: app }) => {
    await app.goto('/');
    await app.tryDemoButton.click();
    await app.taskBars.first().waitFor({ timeout: 15_000 });
    await expect(app.header).toBeVisible();
  });
});

test.describe('Error states', () => {
  test('HeaderMismatchError shows when sheet has wrong columns', async ({ mockAuthContext }) => {
    const rawPage = await mockAuthContext.newPage();
    const app = new BasePage(rawPage);

    await test.step('mock Sheets API with wrong headers', async () => {
      await rawPage.route('**/sheets.googleapis.com/**/values/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            range: 'Sheet1!A1:T2',
            values: [
              ['wrong_col', 'bad_header', 'not_valid'],
              ['data1', 'data2', 'data3'],
            ],
          }),
        });
      });
    });

    await test.step('navigate to sheet and sign in', async () => {
      await app.gotoAuthenticated('/?sheet=mock-header-test');
      await app.signIn();
    });

    await test.step('verify header mismatch error screen', async () => {
      await expect(app.headerMismatchError).toBeVisible({ timeout: 30_000 });
      await expect(app.expectedColumns).toBeVisible();
      await expect(app.downloadTemplateBtn).toBeVisible();
      await expect(app.createNewSheetBtn).toBeVisible();
    });
  });

  test('ErrorBanner shows on sheet not found and offers navigation', async ({
    mockAuthContext,
  }) => {
    const rawPage = await mockAuthContext.newPage();
    const app = new BasePage(rawPage);

    await test.step('mock Sheets API to always return 404', async () => {
      await rawPage.route('**/sheets.googleapis.com/**', (route) => {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 404, message: 'Requested entity was not found.' },
          }),
        });
      });
    });

    await test.step('navigate to sheet and sign in', async () => {
      await app.gotoAuthenticated('/?sheet=nonexistent-mock-sheet');
      await app.signIn();
    });

    await test.step('verify error banner with open-another button', async () => {
      await expect(app.errorBanner).toBeVisible({ timeout: 30_000 });
      await expect(app.openAnotherBtn).toBeVisible();
    });
  });
});
