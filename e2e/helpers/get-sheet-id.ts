/**
 * get-sheet-id.ts — Get the test sheet ID for E2E tests.
 *
 * Two-sheet strategy:
 * - TEST_SHEET_ID_DEV: local development (set by developer)
 * - TEST_SHEET_ID_CI: CI environment (set in GitHub Actions workflow)
 *
 * Returns the first one that's set, or undefined if neither is available.
 */
export function getTestSheetId(): string | undefined {
  return process.env.TEST_SHEET_ID_DEV || process.env.TEST_SHEET_ID_CI || undefined;
}
