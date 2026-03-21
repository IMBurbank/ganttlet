/**
 * mock-auth.ts — Set up mock Google auth for E2E tests.
 *
 * Uses a synthetic google.accounts.oauth2 object injected via addInitScript,
 * blocks the real GIS library from loading (which would overwrite the mock),
 * and sets __ganttlet_config.googleClientId so initOAuth() proceeds.
 *
 * For cloud E2E tests that need real API access, use the gisInitScript from
 * collab-harness.ts instead (which lets the real GIS library load and only
 * intercepts initTokenClient after it's available).
 */
import { BrowserContext, Page } from '@playwright/test';
import { gisInitScript } from './collab-harness';

/**
 * Set up a browser context with mock Google auth.
 * Call before creating pages. The mock fires synchronously when
 * signIn() is called — no real OAuth popup or network request.
 */
export async function setupMockAuth(
  context: BrowserContext,
  token = 'fake-e2e-token'
): Promise<void> {
  // Inject synthetic google.accounts.oauth2 + fake client ID before page loads
  await context.addInitScript(gisInitScript(token));

  // Block the real GIS library so it doesn't overwrite our mock
  await context.route('**/accounts.google.com/**', (route) => route.abort());
}

/**
 * Set the fake client ID after page load. The addInitScript sets it before
 * load, but some environments may clear window.__ganttlet_config.
 * Call this after page.goto() if the sign-in button doesn't work.
 */
export async function ensureClientId(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__ganttlet_config = (window as any).__ganttlet_config || {};
    (window as any).__ganttlet_config.googleClientId = 'fake-e2e-client-id';
  });
}
