# E2E Tests

## Architecture

Four-layer architecture with strict boundaries:

### Layer 1: Infrastructure (`helpers/`)
Context-level setup only — no page interactions.
- **`gis-mock.ts`** — `setupMockAuth(context, token)`, `gisInitScript(token)`. Pure BrowserContext setup.
- **`service-account.ts`** — `getAccessToken(keyJson)`. Server-side JWT token exchange.
- **`sheet-lifecycle.ts`** — `resetTestSheet(token, sheetId)`. Sheets API seed data.
- **`get-sheet-id.ts`** — `getTestSheetId()`. Env var wrapper (TEST_SHEET_ID_DEV | TEST_SHEET_ID_CI).

### Layer 2: Models (`models/`)
Single source of truth for all locators and page interactions.
- **`base-page.ts`** — `BasePage`: shared locators (sign-in, onboarding, header, errors, sync), `signIn()`, `gotoAuthenticated()`.
- **`gantt-page.ts`** — `GanttPage extends BasePage`: SVG locators (task bars, dep arrows, conflict indicators), multi-step methods (`editTaskName`, `openPopover`, `toggleCriticalPath`). Also exports `PopoverModel`, `DepEditorModel`.

### Layer 3: Fixtures (`fixtures.ts`)
Instantiate models, manage lifecycle. Use model methods for setup — no raw locators.
- **Worker-scoped**: `cloudTokenA`, `cloudTokenB` (SA token exchange, once per worker)
- **Test-scoped**: `basePage`, `sandboxPage`, `mockAuthContext`, `signedInPage`, `createCloudPage`, `sheetPage`, `collabPair`

### Layer 4: Specs (`*.spec.ts`)
Use model properties and methods exclusively. The only acceptable `.page.` escapes are:
- `page.url()` for URL assertions
- `page.evaluate()` for SVG drag sequences (table panel overlaps SVG)
- `page.on()` for error/console listeners
- `page.getByText()` for dynamic test data (not reusable locators)
- `page.getByTestId()` for dynamic template card IDs (e.g., `template-card-${id}`)

## Locator Rules

Priority: `getByRole` > `getByLabel` > `getByPlaceholder` > `getByText({ exact: true })` > `getByTestId`

- **Buttons with text** → `getByRole('button', { name: '...' })`
- **Headings** → `getByRole('heading', { name | level })`
- **Form inputs with labels** → `getByLabel('...')`
- **Form inputs with placeholder** → `getByPlaceholder('...')`
- **SVG elements** → `getByTestId(...)` (no ARIA roles for SVG)
- **Structural containers** → `getByTestId(...)` (scope targets for child locators)
- **Icon-only buttons** → `getByTestId(...)` (no accessible text)

### Scoped containers
When an accessible name collides across simultaneously-visible contexts (e.g., "Ganttlet" heading in both welcome screen and header), scope the locator to a container:
```typescript
get firstVisitWelcome() { return this.page.getByTestId('first-visit-welcome'); }
get firstVisitTitle() { return this.firstVisitWelcome.getByRole('heading', { name: 'Ganttlet' }); }
```
Use `.first()` only for polymorphic elements in mutually-exclusive screens (e.g., sign-in button).

## Anti-Patterns (enforced)

- **Zero `waitForTimeout()`** — use web-first assertions or `toPass()` for polling
- **Zero `waitForFunction()`** — use `.waitFor({ state })` or web-first assertions
- **Zero CSS class selectors** in specs — use `getByTestId` for SVG, `getByRole` for standard elements
- **`{ force: true }`** — only for SVG hover where table panel overlaps (documented exception)
- **`{ exact: true }`** — required on all `getByText()` calls

## Fixture Behavior

- `collabPair` checks relay connectivity internally and auto-skips if unavailable — tests never need skip guards
- `sheetPage` and `collabPair` throw if SA keys missing — guard with `test.skip(!hasCloudAuth)` at describe level
- `createCloudPage(url)` is a factory fixture — returns `{ context, page: BasePage }` with auto-cleanup

## Tags

- `@smoke` — fast, runs everywhere (no cloud auth needed)
- `@cloud` — requires GCP_SA_KEY_WRITER1_DEV
- `@collab` — requires two SA keys + relay
- `@slow` — long-running (collab sync, promotion flow)

Filter: `npx playwright test --grep @smoke`

## Commands

- `npm run e2e:collab` — Run E2E with relay
- `npx playwright test` — Run without relay (collab tests skip)
- `npx playwright test --grep @smoke` — Smoke tests only
- `./scripts/full-verify.sh` — Full verification (handles all setup)
