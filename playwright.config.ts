import { defineConfig } from '@playwright/test';

const withRelay = !!process.env.E2E_RELAY;
const hasCloudAuth = !!process.env.GCP_SA_KEY_WRITER1_DEV;
// Skip local servers only when a remote BASE_URL is provided (cloud deploy pipeline)
const isRemote = !!process.env.BASE_URL && !process.env.BASE_URL.includes('localhost');

export default defineConfig({
  testDir: './e2e',
  timeout: hasCloudAuth ? 60_000 : 30_000,
  expect: { timeout: hasCloudAuth ? 20_000 : 10_000 },
  retries: 1,
  // Reset test sheet to seed state before tests (when cloud auth + sheet ID available)
  globalSetup: hasCloudAuth ? './e2e/global-setup.ts' : undefined,
  globalTeardown: hasCloudAuth ? './e2e/global-teardown.ts' : undefined,
  reporter: [['html']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  // Skip local servers only when running against a remote deployment (BASE_URL set to non-localhost)
  webServer: isRemote
    ? []
    : [
        {
          command: 'npx vite --host 0.0.0.0 --mode e2e',
          port: 5173,
          reuseExistingServer: !process.env.CI,
        },
        ...(withRelay
          ? [
              {
                command: 'cd server && cargo build --release && ./target/release/ganttlet-relay',
                port: 4000,
                reuseExistingServer: !process.env.CI,
                env: {
                  RELAY_HOST: '0.0.0.0',
                  RELAY_PORT: '4000',
                  RELAY_ALLOWED_ORIGINS: 'http://localhost:5173',
                  RUST_LOG: 'info',
                  GANTTLET_TEST_AUTH: '1',
                },
              },
            ]
          : []),
      ],
});
