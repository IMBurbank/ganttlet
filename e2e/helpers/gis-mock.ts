/**
 * gis-mock.ts — Synthetic Google Identity Services (GIS) mock for E2E tests.
 *
 * Browser-side infrastructure: injects a fake google.accounts.oauth2 object
 * via addInitScript and blocks the real GIS library.
 *
 * Page interactions (sign-in, navigation) live in the model layer (BasePage),
 * not here. This file is pure infrastructure — context setup only.
 */
import { BrowserContext } from '@playwright/test';

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

// ensureClientId logic inlined into BasePage.gotoAuthenticated() — no export needed.
