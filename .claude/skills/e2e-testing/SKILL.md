---
name: e2e-testing
description: "Use when writing or debugging E2E tests, working with the relay server, or troubleshooting Playwright issues. Covers relay startup, collab test patterns, and Docker requirements."
---

# E2E Testing Guide

## Architecture

Four-layer architecture (see `e2e/CLAUDE.md` for full rules):

1. **Infrastructure** (`e2e/helpers/`) — Context setup, token exchange. No page interactions.
2. **Models** (`e2e/models/`) — Single source of truth for all locators and interactions.
   - `BasePage` — shared locators (auth, onboarding, header, errors), `signIn()`, `gotoAuthenticated()`
   - `GanttPage extends BasePage` — SVG locators, chart interactions, `PopoverModel`, `DepEditorModel`
3. **Fixtures** (`e2e/fixtures.ts`) — Instantiate models, manage lifecycle. Use model methods.
4. **Specs** (`e2e/*.spec.ts`) — Use model properties only. No raw locators.

## Playwright Setup
- Tests live in `e2e/`
- Config: `playwright.config.ts`
- Browser: Chromium (pre-installed in Docker container)

## Relay Server & Collab Tests
Collaboration tests (`e2e/collab.spec.ts`) require the relay server. The `collabPair` fixture
checks connectivity internally and auto-skips if the relay is unavailable — no per-test
skip guards needed.

**How the relay starts:** Setting `E2E_RELAY=1` tells `playwright.config.ts` to add the relay
as a second `webServer`. Playwright runs `cargo build --release` in `server/` (cached by Cargo)
then starts the binary and waits for port 4000 before running tests.

## Verification Commands
- `npm run e2e` — runs E2E tests (collab tests SKIP if relay not running)
- `npm run e2e:collab` — runs E2E with relay (builds relay if needed)
- `./scripts/full-verify.sh` — **always use this for final verification** (sets `E2E_RELAY=1` automatically)

**Never use bare `npm run e2e` as final check** — collab tests skip silently.

## CI Workflow (`e2e.yml`)

**Auto-triggers**: pushes to `main`, PRs targeting `main` (every push to a PR branch triggers a run).

**Attestation skip**: If a commit SHA already has an `e2e-verified` status, the workflow skips test execution and re-posts the status. This avoids redundant runs but means `gh workflow run` on an already-attested SHA does nothing.

**Force a real run**: `gh workflow run e2e.yml --ref <branch> -f force=true`

**Verify tests actually ran** (not just attested):
```bash
gh run view <run-id> --log | grep "passed"
# Real run: "40 passed (42.4s)"
# Attested skip: no "passed" line, just "E2E already verified"
```

**Test count in CI**: 40 tests (29 local + 11 cloud/collab with SA keys).

## Mock Auth Pattern
E2E tests use a synthetic Google Identity Services (GIS) mock for auth:

- **`setupMockAuth(context, token)`** in `e2e/helpers/gis-mock.ts`: Call on a BrowserContext
  before creating pages. Injects synthetic `google.accounts.oauth2` via `addInitScript` and
  blocks the real GIS library via `context.route()`. This is pure infrastructure — no page
  interactions.
- **`BasePage.gotoAuthenticated(path)`** in `e2e/models/base-page.ts`: Navigates and re-sets
  the client ID (some environments clear `__ganttlet_config` between init script and page load).
- **`BasePage.signIn()`**: Clicks "Sign in with Google" button and waits for it to disappear.
  Works across all welcome screens (polymorphic — uses `.first()`).

For cloud E2E tests that need real Sheets API access, pass a real SA token to `setupMockAuth`.

## Cloud Auth Pattern
- SA keys: `GCP_SA_KEY_WRITER1_DEV`, `GCP_SA_KEY_WRITER2_DEV`, `GCP_SA_KEY_READER1_DEV`
- `getAccessToken(keyJson, extraScopes?)` in `e2e/helpers/service-account.ts` exchanges JWT for token
- Cloud tests use `setupMockAuth(context, realToken)` — blocks GIS popup but uses real token

## Test Sheet Strategy
Two pre-provisioned sheets, no runtime creation:
- **CI**: `TEST_SHEET_ID_CI` secret in GitHub Actions. Reset to seed state by `e2e/global-setup.ts` before each run. Concurrent CI runs serialized via workflow `concurrency` key.
- **Local dev**: `TEST_SHEET_ID_DEV` env var. Never touched by CI.

`e2e/global-setup.ts` clears the sheet and writes HEADER_ROW + 3 seed tasks at the start
of every run. No Drive API create/delete needed — only `spreadsheets` scope.

Key files:
- `e2e/helpers/sheet-lifecycle.ts` — `resetTestSheet()` clears + seeds
- `e2e/helpers/get-sheet-id.ts` — returns `TEST_SHEET_ID_DEV || TEST_SHEET_ID_CI`

## GIS Library Handling
The real GIS library from `accounts.google.com` overwrites the synthetic mock injected by
`addInitScript`. Always block it with `context.route('**/accounts.google.com/**', route.abort())`.
Without this, the mock's `requestAccessToken` callback is replaced and sign-in silently fails.

## Test Sheet Data
Seed data (3 tasks with FS dependency chain):
- `e2e-1` Alpha Task → `e2e-2` Beta Task → `e2e-3` Gamma Task
- Business-day dates, 5-day duration each
- Covers name editing, constraint changes, conflict detection patterns

## WebSocket in Docker
Headless Chromium in Docker may not resolve `localhost` for WebSocket connections.
`yjsProvider.ts` normalizes `localhost` to `127.0.0.1` for safety. When debugging
WS issues, verify the room ID is included in the URL (`/ws/{roomId}`, not just `/ws`).

## Weekend Invariants
- No task should start or end on a weekend in UI-created tasks.
- E2E tests should verify: after creating a task on a weekend, start snaps to Monday.
- E2E tests should verify: bar width includes the end-date column (inclusive convention).
- The `WEEKEND_VIOLATION` conflict indicator appears for tasks with weekend dates
  (typically from Sheets import).

## Lessons Learned
<!-- Managed by curation pipeline — do not edit directly -->
- 2026-03-01: E2E relay compilation failures are infrastructure issues, not code bugs. Note in summary but still write the tests.
- 2026-03-01: Date-dependent tests can flake near midnight or weekend boundaries.
