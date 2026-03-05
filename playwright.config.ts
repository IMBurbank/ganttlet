import { defineConfig } from '@playwright/test';

const withRelay = !!process.env.E2E_RELAY;
const isCloud = !!process.env.E2E_CLOUD;

export default defineConfig({
  testDir: './e2e',
  timeout: isCloud ? 60_000 : 30_000,
  expect: { timeout: isCloud ? 20_000 : 10_000 },
  retries: 1,
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
  // In cloud mode, don't start local servers — frontend and relay are on Cloud Run
  webServer: isCloud
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
                command:
                  'cd server && cargo build --release && ./target/release/ganttlet-relay',
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
