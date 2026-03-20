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
