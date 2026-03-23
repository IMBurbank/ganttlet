/**
 * gis-mock.ts — Synthetic Google Identity Services (GIS) mock for E2E tests.
 *
 * Browser-side concern: injects a fake google.accounts.oauth2 object via
 * addInitScript, blocks the real GIS library, and provides page-level auth
 * helpers (ensureClientId, signInOnPage).
 *
 * For cloud tests: pass a real SA token to setupMockAuth — the GIS mock fires
 * it synchronously when requestAccessToken() is called, giving the app a real
 * token without a real OAuth popup.
 */
import { BrowserContext, Page } from '@playwright/test';

/**
 * Returns a JS string for addInitScript that creates a synthetic
 * google.accounts.oauth2 object. The mock fires the callback synchronously
 * when requestAccessToken() is called — no real OAuth flow.
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
 * Set up a browser context with mock Google auth.
 * Call before creating pages. The mock fires synchronously when
 * signIn() is called — no real OAuth popup or network request.
 */
export async function setupMockAuth(
  context: BrowserContext,
  token = 'fake-e2e-token'
): Promise<void> {
  await context.addInitScript(gisInitScript(token));
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

/**
 * Sign in on a page that's showing a WelcomeGate screen.
 * Handles both FirstVisitWelcome and CollaboratorWelcome sign-in buttons.
 * Call after page.goto() + ensureClientId().
 */
export async function signInOnPage(page: Page): Promise<void> {
  await ensureClientId(page);

  // Both FirstVisitWelcome and CollaboratorWelcome have a "Sign in with Google" button.
  // Only one is visible at a time — click whichever is showing.
  const signInBtn = page.getByRole('button', { name: 'Sign in with Google' });
  await signInBtn.first().waitFor({ timeout: 5_000 });
  await signInBtn.first().click();

  // Wait for sign-in to complete — button disappears
  await signInBtn.first().waitFor({ state: 'hidden', timeout: 10_000 });
}
