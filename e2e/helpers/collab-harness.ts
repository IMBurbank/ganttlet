import { Browser, BrowserContext, Page } from '@playwright/test';
import { getTestSheetId } from './get-sheet-id';

export interface CollabPair {
  pageA: Page;
  pageB: Page;
  contextA: BrowserContext;
  contextB: BrowserContext;
  cleanup: () => Promise<void>;
}

export interface CloudAuthOptions {
  tokenA: string;
  tokenB: string;
}

/**
 * Inject a service account token into the page by mocking the Google Identity
 * Services (GIS) library. Provides a synthetic google.accounts.oauth2 object
 * that fires the callback synchronously when requestAccessToken() is called.
 */
export function gisInitScript(token: string): string {
  return `
    window.__ganttlet_cloud_token = ${JSON.stringify(token)};

    // Provide a fake client ID so initOAuth() doesn't bail out
    window.__ganttlet_config = window.__ganttlet_config || {};
    window.__ganttlet_config.googleClientId = 'fake-e2e-client-id';

    // Provide a synthetic google.accounts.oauth2 object immediately.
    window.google = window.google || {};
    window.google.accounts = window.google.accounts || {};
    window.google.accounts.oauth2 = {
      initTokenClient: (config) => {
        const storedCallback = config.callback;
        return {
          requestAccessToken: () => {
            storedCallback({
              access_token: window.__ganttlet_cloud_token,
              expires_in: '3600',
              token_type: 'Bearer',
              scope: config.scope,
            });
          },
        };
      },
      revoke: (token, callback) => { if (callback) callback(); },
    };
  `;
}

/**
 * Creates two independent browser contexts for collaboration testing.
 *
 * Cloud mode (cloudAuth provided): navigates to ?sheet={sheetId}&room=
 * using the ephemeral sheet (or TEST_SHEET_ID_DEV override). Signs in via
 * GIS mock with real SA tokens. Both pages load real sheet data so
 * dataSource='sheet' and Yjs connects.
 *
 * Local mode (no cloudAuth): enters sandbox via "Try the demo" button.
 * Yjs doesn't connect in sandbox mode — collab tests skip gracefully.
 */
export async function createCollabPair(
  browser: Browser,
  cloudAuth?: CloudAuthOptions
): Promise<CollabPair> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  const testSheetId = getTestSheetId();
  const roomId = `e2e-test-${Date.now()}`;

  if (cloudAuth && testSheetId) {
    // Cloud mode: block real GIS + inject SA tokens
    for (const [ctx, token] of [
      [contextA, cloudAuth.tokenA],
      [contextB, cloudAuth.tokenB],
    ] as [BrowserContext, string][]) {
      await ctx.addInitScript(gisInitScript(token));
      await ctx.route('**/accounts.google.com/**', (route) => route.abort());
    }

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Navigate both to ?sheet=TEST_SHEET_ID&room=ROOM_ID
    const url = `/?sheet=${testSheetId}&room=${roomId}`;
    await Promise.all([pageA.goto(url), pageB.goto(url)]);

    // Sign in on both pages (CollaboratorWelcome → click sign in → load sheet)
    for (const page of [pageA, pageB]) {
      // Ensure client ID persists after navigation
      await page.evaluate(() => {
        (window as any).__ganttlet_config = (window as any).__ganttlet_config || {};
        (window as any).__ganttlet_config.googleClientId = 'fake-e2e-client-id';
      });
      const collabBtn = page.getByTestId('collaborator-sign-in-button');
      await collabBtn.waitFor({ timeout: 10_000 });
      await collabBtn.click();
    }

    // Wait for both pages to load sheet data (task bars appear)
    await Promise.all([
      pageA.locator('.task-bar').first().waitFor({ timeout: 60_000 }),
      pageB.locator('.task-bar').first().waitFor({ timeout: 60_000 }),
    ]);

    // Wait for collab connections — generous timeout for large sheets
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

    const cleanup = async () => {
      await contextA.close();
      await contextB.close();
    };

    return { pageA, pageB, contextA, contextB, cleanup };
  }

  // Local mode: enter sandbox via "Try the demo" button
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await Promise.all([pageA.goto('/'), pageB.goto('/')]);

  await Promise.all([
    pageA.getByTestId('try-demo-button').click(),
    pageB.getByTestId('try-demo-button').click(),
  ]);

  // Wait for task bars
  await Promise.all([
    pageA.locator('.task-bar').first().waitFor({ timeout: 15_000 }),
    pageB.locator('.task-bar').first().waitFor({ timeout: 15_000 }),
  ]);

  // Inject test auth tokens via dev-mode hook
  await pageA.evaluate(() => {
    const setter = (window as unknown as Record<string, unknown>).__ganttlet_setTestAuth;
    if (typeof setter === 'function') setter('userA');
  });
  await pageB.evaluate(() => {
    const setter = (window as unknown as Record<string, unknown>).__ganttlet_setTestAuth;
    if (typeof setter === 'function') setter('userB');
  });

  // Wait for collab connections
  await Promise.all([
    pageA
      .locator('[data-collab-status="connected"]')
      .waitFor({ timeout: 10_000 })
      .catch(() => {}),
    pageB
      .locator('[data-collab-status="connected"]')
      .waitFor({ timeout: 10_000 })
      .catch(() => {}),
  ]);

  const cleanup = async () => {
    await contextA.close();
    await contextB.close();
  };

  return { pageA, pageB, contextA, contextB, cleanup };
}

/**
 * Checks whether the collab relay WebSocket is available.
 */
export async function isCollabAvailable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-collab-status="connected"]');
    return el !== null;
  });
}
