/**
 * fixtures.ts — Composable Playwright fixtures for Ganttlet E2E tests.
 *
 * Fixture hierarchy:
 *   Worker-scoped: cloudTokenA, cloudTokenB (expensive SA token exchange)
 *   Test-scoped:   sandboxPage, mockAuthContext, signedInPage, sheetPage, collabPair
 *
 * All test-scoped fixtures auto-cleanup via the use() callback pattern.
 * Tests never need try/finally or manual cleanup() calls.
 */
import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { getAccessToken } from './helpers/service-account';
import { setupMockAuth, ensureClientId } from './helpers/gis-mock';
import { getTestSheetId } from './helpers/get-sheet-id';
import { GanttPage } from './models/gantt-page';

// ─── Type declarations ───────────────────────────────────────────────────────

type WorkerFixtures = {
  cloudTokenA: string | undefined;
  cloudTokenB: string | undefined;
};

type CloudPageResult = { context: BrowserContext; page: Page };

type TestFixtures = {
  sandboxPage: GanttPage;
  mockAuthContext: BrowserContext;
  signedInPage: Page;
  createCloudPage: (url: string) => Promise<CloudPageResult>;
  sheetPage: GanttPage;
  collabPair: { pageA: GanttPage; pageB: GanttPage };
};

// ─── Fixture definitions ─────────────────────────────────────────────────────

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped: SA token exchange (expensive, reuse across tests in a worker)
  cloudTokenA: [
    async ({}, use) => {
      const key = process.env.GCP_SA_KEY_WRITER1_DEV;
      const token = key ? await getAccessToken(key) : undefined;
      await use(token);
    },
    { scope: 'worker' },
  ],

  cloudTokenB: [
    async ({}, use) => {
      const key = process.env.GCP_SA_KEY_WRITER2_DEV || process.env.GCP_SA_KEY_READER1_DEV;
      const token = key ? await getAccessToken(key) : undefined;
      await use(token);
    },
    { scope: 'worker' },
  ],

  // sandboxPage: enters demo mode, waits for task bars, returns GanttPage
  sandboxPage: async ({ page }, use) => {
    await page.goto('/');
    await page.getByTestId('try-demo-button').click();
    const gantt = new GanttPage(page);
    await gantt.waitForTaskBars();
    await use(gantt);
  },

  // mockAuthContext: BrowserContext with fake GIS mock (no real token)
  mockAuthContext: async ({ browser }, use) => {
    const context = await browser.newContext();
    await setupMockAuth(context);
    await use(context);
    await context.close();
  },

  // signedInPage: signed in via mock auth, at ChoosePath screen (raw Page)
  signedInPage: async ({ mockAuthContext }, use) => {
    const page = await mockAuthContext.newPage();
    await page.goto('/');
    await ensureClientId(page);
    await page.getByTestId('sign-in-button').click();
    await page.getByTestId('choose-path-title').waitFor({ timeout: 10_000 });
    await use(page);
  },

  // createCloudPage: factory for pages with real SA token auth at any URL
  createCloudPage: async ({ browser, cloudTokenA }, use) => {
    if (!cloudTokenA) throw new Error('createCloudPage requires GCP_SA_KEY_WRITER1_DEV');
    const contexts: BrowserContext[] = [];

    const factory = async (url: string): Promise<CloudPageResult> => {
      const context = await browser.newContext();
      contexts.push(context);
      await setupMockAuth(context, cloudTokenA);
      const page = await context.newPage();
      await page.goto(url);
      await ensureClientId(page);
      return { context, page };
    };

    await use(factory);

    // Auto-cleanup all contexts created by the factory
    for (const ctx of contexts) {
      await ctx.close().catch(() => {});
    }
  },

  // sheetPage: connected to real test sheet, data loaded, returns GanttPage
  sheetPage: async ({ browser, cloudTokenA }, use) => {
    if (!cloudTokenA) throw new Error('sheetPage requires GCP_SA_KEY_WRITER1_DEV');
    const sheetId = getTestSheetId();
    if (!sheetId) throw new Error('sheetPage requires TEST_SHEET_ID_DEV or TEST_SHEET_ID_CI');

    const context = await browser.newContext();
    try {
      await setupMockAuth(context, cloudTokenA);
      const page = await context.newPage();
      await page.goto(`/?sheet=${sheetId}`);
      await ensureClientId(page);
      await page.getByTestId('collaborator-sign-in-button').click();
      const gantt = new GanttPage(page);
      await gantt.waitForTaskBars(60_000);
      await use(gantt);
    } finally {
      await context.close();
    }
  },

  // collabPair: two pages connected to same sheet via Yjs, both with task bars
  collabPair: async ({ browser, cloudTokenA, cloudTokenB }, use) => {
    if (!cloudTokenA || !cloudTokenB) {
      throw new Error('collabPair requires two SA keys');
    }
    const sheetId = getTestSheetId();
    if (!sheetId) throw new Error('collabPair requires test sheet ID');

    const roomId = `e2e-test-${Date.now()}`;
    const url = `/?sheet=${sheetId}&room=${roomId}`;

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      await setupMockAuth(contextA, cloudTokenA);
      await setupMockAuth(contextB, cloudTokenB);

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await Promise.all([pageA.goto(url), pageB.goto(url)]);

      for (const page of [pageA, pageB]) {
        await ensureClientId(page);
        await page.getByTestId('collaborator-sign-in-button').click();
      }

      const ganttA = new GanttPage(pageA);
      const ganttB = new GanttPage(pageB);

      await Promise.all([ganttA.waitForTaskBars(60_000), ganttB.waitForTaskBars(60_000)]);

      // Wait for collab connections (generous timeout for large sheets)
      await Promise.all([
        pageA
          .locator('[data-collab-status="connected"]')
          .waitFor({ timeout: 45_000 })
          .catch(() => {}),
        pageB
          .locator('[data-collab-status="connected"]')
          .waitFor({ timeout: 45_000 })
          .catch(() => {}),
      ]);

      await use({ pageA: ganttA, pageB: ganttB });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  },
});

export { expect } from '@playwright/test';
