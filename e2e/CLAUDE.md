# E2E Tests

## Architecture

Fixture-based architecture using Playwright's `test.extend()`:

- **`fixtures.ts`** — Central fixtures: `sandboxPage`, `mockAuthContext`, `signedInPage`, `sheetPage`, `collabPair`
- **`models/gantt-page.ts`** — GanttPage, PopoverModel, DepEditorModel (domain verbs for test readability)
- **`helpers/service-account.ts`** — SA JWT token exchange (server-side)
- **`helpers/gis-mock.ts`** — Synthetic GIS injection (browser-side)
- **`helpers/sheet-lifecycle.ts`** — Test sheet reset/seed
- **`helpers/get-sheet-id.ts`** — Env var wrapper (TEST_SHEET_ID_DEV | TEST_SHEET_ID_CI)

## Constraints

- `E2E_RELAY=1` required for collaboration tests
- Locator priority: `getByRole` > `getByLabel` > `getByText({ exact: true })` > `getByTestId`
- `data-testid` only for SVG/custom elements (task bars, dep arrows, conflict indicators)
- **Zero `waitForTimeout()`** — use web-first assertions or `toPass()` for polling
- Wait for WASM initialization before interacting with scheduling features
- Collab tests use `collabPair` fixture (two browser contexts, auto-cleanup)
- Use `getTestSheetId()` from `helpers/get-sheet-id.ts` — never hardcode sheet IDs
- Use `test.step()` for multi-step interactions (appears in HTML report)
- Tag tests with `@smoke`, `@cloud`, `@collab`, `@slow` for filtering

## Commands

- `npm run e2e:collab` — Run E2E with relay
- `npx playwright test` — Run without relay (collab tests skip)
- `npx playwright test --grep @smoke` — Smoke tests only
- `./scripts/full-verify.sh` — Full verification (handles all setup)
