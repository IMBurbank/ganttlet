import { Browser, BrowserContext, Page } from '@playwright/test';

export interface CollabPair {
  pageA: Page;
  pageB: Page;
  contextA: BrowserContext;
  contextB: BrowserContext;
  cleanup: () => Promise<void>;
}

/**
 * Creates two independent browser contexts pointing at the same app URL
 * with a shared room for collaboration testing.
 * Both wait for `.task-bar` to appear and collab to connect before returning.
 */
export async function createCollabPair(browser: Browser): Promise<CollabPair> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  // Use a shared room ID for both pages
  const roomId = `e2e-test-${Date.now()}`;
  const url = `/?room=${roomId}`;

  // Navigate both pages to the app with the room param
  await Promise.all([pageA.goto(url), pageB.goto(url)]);

  // Wait for the app to fully render in both pages
  await Promise.all([
    pageA.locator('.task-bar').first().waitFor({ timeout: 15_000 }),
    pageB.locator('.task-bar').first().waitFor({ timeout: 15_000 }),
  ]);

  // Inject test auth tokens (dev mode exposes __ganttlet_setTestAuth)
  await pageA.evaluate(() => {
    const setter = (window as unknown as Record<string, unknown>).__ganttlet_setTestAuth;
    if (typeof setter === 'function') setter('userA');
  });
  await pageB.evaluate(() => {
    const setter = (window as unknown as Record<string, unknown>).__ganttlet_setTestAuth;
    if (typeof setter === 'function') setter('userB');
  });

  // Wait for collab connections using DOM polling instead of fixed timeout
  await Promise.all([
    pageA.locator('[data-collab-status="connected"]').waitFor({ timeout: 10_000 }).catch(() => {}),
    pageB.locator('[data-collab-status="connected"]').waitFor({ timeout: 10_000 }).catch(() => {}),
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
