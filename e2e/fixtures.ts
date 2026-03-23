/**
 * fixtures.ts — Composable Playwright fixtures for Ganttlet E2E tests.
 *
 * Fixtures instantiate page models and handle lifecycle (context creation,
 * teardown). All page interactions go through models — no raw locators here.
 *
 * Hierarchy:
 *   Worker-scoped: cloudTokenA, cloudTokenB
 *   Test-scoped:   sandboxPage, basePage, mockAuthContext, signedInPage,
 *                  createCloudPage, sheetPage, collabPair
 */
import { test as base, type BrowserContext } from '@playwright/test';
import { getAccessToken } from './helpers/service-account';
import { setupMockAuth } from './helpers/gis-mock';
import { getTestSheetId } from './helpers/get-sheet-id';
import { BasePage } from './models/base-page';
import { GanttPage } from './models/gantt-page';

// ─── Type declarations ───────────────────────────────────────────────────────

type WorkerFixtures = {
  cloudTokenA: string | undefined;
  cloudTokenB: string | undefined;
};

type CloudPageResult = { context: BrowserContext; page: BasePage };

type TestFixtures = {
  basePage: BasePage;
  sandboxPage: GanttPage;
  mockAuthContext: BrowserContext;
  signedInPage: BasePage;
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

  // basePage: wraps page with BasePage model (no navigation)
  basePage: async ({ page }, use) => {
    await use(new BasePage(page));
  },

  // sandboxPage: GanttPage in sandbox mode with task bars loaded
  sandboxPage: async ({ page }, use) => {
    const gantt = new GanttPage(page);
    await gantt.goto('/');
    await gantt.enterSandboxAndWait();
    await use(gantt);
  },

  // mockAuthContext: BrowserContext with fake GIS mock
  mockAuthContext: async ({ browser }, use) => {
    const context = await browser.newContext();
    await setupMockAuth(context);
    await use(context);
    await context.close();
  },

  // signedInPage: BasePage signed in at ChoosePath
  signedInPage: async ({ mockAuthContext }, use) => {
    const rawPage = await mockAuthContext.newPage();
    const app = new BasePage(rawPage);
    await app.gotoAuthenticated('/');
    await app.signIn();
    await app.choosePathHeading.waitFor({ timeout: 10_000 });
    await use(app);
  },

  // createCloudPage: factory returning BasePage with real SA token auth
  createCloudPage: async ({ browser, cloudTokenA }, use) => {
    if (!cloudTokenA) throw new Error('createCloudPage requires GCP_SA_KEY_WRITER1_DEV');
    const contexts: BrowserContext[] = [];

    const factory = async (url: string): Promise<CloudPageResult> => {
      const context = await browser.newContext();
      contexts.push(context);
      await setupMockAuth(context, cloudTokenA);
      const rawPage = await context.newPage();
      const app = new BasePage(rawPage);
      await app.gotoAuthenticated(url);
      return { context, page: app };
    };

    await use(factory);
    for (const ctx of contexts) {
      await ctx.close().catch(() => {});
    }
  },

  // sheetPage: GanttPage connected to real test sheet, data loaded
  sheetPage: async ({ browser, cloudTokenA }, use) => {
    if (!cloudTokenA) throw new Error('sheetPage requires GCP_SA_KEY_WRITER1_DEV');
    const sheetId = getTestSheetId();
    if (!sheetId) throw new Error('sheetPage requires TEST_SHEET_ID_DEV or TEST_SHEET_ID_CI');

    const context = await browser.newContext();
    try {
      await setupMockAuth(context, cloudTokenA);
      const rawPage = await context.newPage();
      const gantt = new GanttPage(rawPage);
      await gantt.gotoAuthenticated(`/?sheet=${sheetId}`);
      await gantt.signIn();
      await gantt.waitForTaskBars(60_000);
      await use(gantt);
    } finally {
      await context.close();
    }
  },

  // collabPair: two GanttPages connected to same sheet via Yjs
  collabPair: async ({ browser, cloudTokenA, cloudTokenB }, use, testInfo) => {
    if (!cloudTokenA || !cloudTokenB) {
      throw new Error('collabPair requires two SA keys');
    }
    const sheetId = getTestSheetId();
    if (!sheetId) throw new Error('collabPair requires test sheet ID');

    const roomId = `e2e-test-${Date.now()}`;
    const url = `/?sheet=${sheetId}&room=${roomId}`;

    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    try {
      contextA = await browser.newContext();
      contextB = await browser.newContext();
      await setupMockAuth(contextA, cloudTokenA);
      await setupMockAuth(contextB, cloudTokenB);

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const ganttA = new GanttPage(pageA);
      const ganttB = new GanttPage(pageB);

      // Navigate and sign in on both pages
      await Promise.all([ganttA.gotoAuthenticated(url), ganttB.gotoAuthenticated(url)]);
      for (const gantt of [ganttA, ganttB]) {
        await gantt.signIn();
      }

      await Promise.all([ganttA.waitForTaskBars(60_000), ganttB.waitForTaskBars(60_000)]);

      // Wait for collab connections — skip test if relay not available
      await Promise.all([
        ganttA.collabStatus.waitFor({ timeout: 45_000 }).catch(() => {}),
        ganttB.collabStatus.waitFor({ timeout: 45_000 }).catch(() => {}),
      ]);

      const collabReady = await ganttA.collabStatus.isVisible().catch(() => false);
      if (!collabReady) {
        testInfo.skip(true, 'Collab relay not available');
      }

      await use({ pageA: ganttA, pageB: ganttB });
    } finally {
      await contextA?.close().catch(() => {});
      await contextB?.close().catch(() => {});
    }
  },
});

export { expect } from '@playwright/test';
