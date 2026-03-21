import { Browser, BrowserContext, Page } from '@playwright/test';

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
 * Services (GIS) library. This works with production builds where
 * __ganttlet_setTestAuth is not available.
 *
 * The init script intercepts google.accounts.oauth2.initTokenClient and
 * immediately fires the callback with the provided token when
 * requestAccessToken() is called.
 */
export function gisInitScript(token: string): string {
  return `
    window.__ganttlet_cloud_token = ${JSON.stringify(token)};

    // Provide a fake client ID so initOAuth() doesn't bail out
    window.__ganttlet_config = window.__ganttlet_config || {};
    window.__ganttlet_config.googleClientId = 'fake-e2e-client-id';

    // Provide a synthetic google.accounts.oauth2 object immediately.
    // This must exist BEFORE the app calls initOAuth(), which checks
    // typeof google !== 'undefined' && google.accounts.
    // The real GIS script loads async and may arrive late; our synthetic
    // version ensures the app can initialize OAuth synchronously.
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
 * Creates two independent browser contexts pointing at the same app URL
 * with a shared room for collaboration testing.
 * Both wait for `.task-bar` to appear and collab to connect before returning.
 *
 * In cloud mode (cloudAuth provided), uses addInitScript to inject real
 * service account tokens via a GIS mock instead of __ganttlet_setTestAuth.
 *
 * In local mode, injects a fake GIS token so isSignedIn() returns true,
 * then enters sandbox mode via the "Try the demo" button.
 */
export async function createCollabPair(
  browser: Browser,
  cloudAuth?: CloudAuthOptions
): Promise<CollabPair> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  if (cloudAuth) {
    // Cloud mode: inject real SA tokens via GIS mock
    await contextA.addInitScript(gisInitScript(cloudAuth.tokenA));
    await contextB.addInitScript(gisInitScript(cloudAuth.tokenB));
  }

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  // Use a shared room ID for both pages
  const roomId = `e2e-test-${Date.now()}`;

  if (cloudAuth) {
    // Cloud mode: navigate with room param — auth is already injected
    const url = `/?room=${roomId}`;
    await Promise.all([pageA.goto(url), pageB.goto(url)]);
  } else {
    // Local mode: enter sandbox via the real user flow, then set room param
    await Promise.all([pageA.goto('/'), pageB.goto('/')]);

    // Click "Try the demo" on both pages
    await Promise.all([
      pageA.getByTestId('try-demo-button').click(),
      pageB.getByTestId('try-demo-button').click(),
    ]);
  }

  // Wait for the app to fully render in both pages
  await Promise.all([
    pageA.locator('.task-bar').first().waitFor({ timeout: 15_000 }),
    pageB.locator('.task-bar').first().waitFor({ timeout: 15_000 }),
  ]);

  // In local mode, inject test auth tokens via dev-mode hook
  if (!cloudAuth) {
    await pageA.evaluate(() => {
      const setter = (window as unknown as Record<string, unknown>).__ganttlet_setTestAuth;
      if (typeof setter === 'function') setter('userA');
    });
    await pageB.evaluate(() => {
      const setter = (window as unknown as Record<string, unknown>).__ganttlet_setTestAuth;
      if (typeof setter === 'function') setter('userB');
    });
  }

  // Wait for collab connections using DOM polling instead of fixed timeout
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
 * Checks whether the collab relay WebSocket is available by looking for
 * a connected status in the app. Returns false if the relay is not running.
 */
export async function isCollabAvailable(page: Page): Promise<boolean> {
  // Check the data-collab-status attribute set by the app (no extra wait needed,
  // createCollabPair already waited for connection)
  return page.evaluate(() => {
    const el = document.querySelector('[data-collab-status="connected"]');
    return el !== null;
  });
}
