import { Browser, BrowserContext, Page } from '@playwright/test';

export interface CollabPair {
  pageA: Page;
  pageB: Page;
  contextA: BrowserContext;
  contextB: BrowserContext;
  cleanup: () => Promise<void>;
}

/**
 * Creates two independent browser contexts pointing at the same app URL.
 * Both wait for `.task-bar` to appear before returning.
 */
export async function createCollabPair(browser: Browser): Promise<CollabPair> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  // Navigate both pages to the app
  await Promise.all([pageA.goto('/'), pageB.goto('/')]);

  // Wait for the app to fully render in both pages
  await Promise.all([
    pageA.locator('.task-bar').first().waitFor({ timeout: 15_000 }),
    pageB.locator('.task-bar').first().waitFor({ timeout: 15_000 }),
  ]);

  const cleanup = async () => {
    await contextA.close();
    await contextB.close();
  };

  return { pageA, pageB, contextA, contextB, cleanup };
}

/**
 * Checks whether the collab relay WebSocket is available by looking for
 * a connected status indicator in the page state. Returns false if the
 * relay is not running (single-user mode).
 */
export async function isCollabAvailable(page: Page): Promise<boolean> {
  // Give the WebSocket a moment to connect
  await page.waitForTimeout(2_000);

  // Check if the app has established a collab connection by evaluating
  // whether the provider status is 'connected'. We look for any sign
  // that the WebSocket provider successfully connected.
  return page.evaluate(() => {
    // The app stores collab state — check if any awareness users exist
    // beyond the local client, or if there's a connected WebSocket.
    const wsElements = document.querySelectorAll('[data-collab-status="connected"]');
    if (wsElements.length > 0) return true;

    // Fallback: check if there are presence indicators rendered
    const presenceIndicators = document.querySelectorAll('.pulse-dot');
    if (presenceIndicators.length > 0) return true;

    return false;
  });
}
