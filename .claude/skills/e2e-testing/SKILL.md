---
name: e2e-testing
description: "Use when writing or debugging E2E tests, working with the relay server, or troubleshooting Playwright issues. Covers relay startup, collab test patterns, and Docker requirements."
---

# E2E Testing Guide

## Playwright Setup
- Tests live in `e2e/`
- Config: `playwright.config.ts`
- Browser: Chromium (pre-installed in Docker container)

## Relay Server & Collab Tests
Collaboration tests (`e2e/collab.spec.ts`) require the relay server — without it, they
silently skip via `test.skip()`.

**How the relay starts:** Setting `E2E_RELAY=1` tells `playwright.config.ts` to add the relay
as a second `webServer`. Playwright runs `cargo build --release` in `server/` (cached by Cargo)
then starts the binary and waits for port 4000 before running tests.

## Verification Commands
- `npm run e2e` — runs E2E tests (collab tests SKIP if relay not running)
- `npm run e2e:collab` — runs E2E with relay (builds relay if needed)
- `./scripts/full-verify.sh` — **always use this for final verification** (sets `E2E_RELAY=1` automatically)

**Never use bare `npm run e2e` as final check** — collab tests skip silently.

## Collab Test Patterns
- Cross-tab sync: open two browser contexts, edit in one, verify in the other
- Presence indicators: verify avatar/cursor appears for connected users
- Tests use `test.skip()` guard for relay availability

## CI Pipeline
- `e2e.yml` GitHub Actions workflow runs on pushes to main, PRs, and manual dispatch
- Sets `E2E_RELAY=1` and builds relay binary before Playwright
- Rust build artifacts cached via `actions/cache` (~5s on cache hit vs ~90s cold)
- Report + traces uploaded only on failure

## Docker Requirements
- Dockerfile includes Playwright's Chromium system libraries
- Chromium browser binary pre-installed
- Relay server source (`server/`) volume-mounted for build cache persistence

## Mock Auth Pattern
E2E tests use a synthetic Google Identity Services (GIS) mock for auth:

- **`setupMockAuth(context, token)`**: Call on a BrowserContext before creating pages.
  Injects synthetic `google.accounts.oauth2` via `addInitScript` and blocks the real GIS
  library via `context.route('**/accounts.google.com/**', route.abort())`.
- **`ensureClientId(page)`**: Sets `window.__ganttlet_config.googleClientId` after `page.goto()`.
  Needed because some environments clear `__ganttlet_config` between init script and page load.
- **`signInOnPage(page)`**: Clicks the sign-in button (collaborator or first-visit) and waits
  for buttons to disappear via `waitForFunction` (not timeout).

For cloud E2E tests that need real Sheets API access, use `gisInitScript` from
`e2e/helpers/collab-harness.ts` with a real service account token from `cloud-auth.ts`.

## Cloud Auth Pattern
- SA keys: `GCP_SA_KEY_WRITER1_DEV`, `GCP_SA_KEY_WRITER2_DEV`, `GCP_SA_KEY_READER1_DEV`
- `getAccessToken(keyJson, extraScopes?)` in `e2e/helpers/cloud-auth.ts` exchanges JWT for token
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
