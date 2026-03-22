/**
 * global-teardown.ts — Post-test cleanup for E2E.
 *
 * Currently a no-op placeholder. The test sheet is reset at the START of
 * each run (global-setup), not cleaned up at the end. This ensures the
 * sheet is inspectable after failed runs for debugging.
 */
import type { FullConfig } from '@playwright/test';

async function globalTeardown(_config: FullConfig) {
  // Intentionally empty — sheet state is reset in global-setup, not here.
  // This keeps the sheet inspectable after failures.
}

export default globalTeardown;
