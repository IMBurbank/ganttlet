# Phase 11 Group G — CI Pipeline: E2E Tests + Console Error Gate

You are implementing Phase 11 Group G for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- .github/workflows/ci.yml
- .github/workflows/e2e.yml (new)

Do NOT modify any other workflow files.

## Background

The CI pipeline (ci.yml) currently runs type checking, Vitest unit tests, and Rust tests. It does
NOT run Playwright E2E tests. Phase 11 Groups E and F are adding server integration tests and
Playwright E2E tests respectively. This group adds CI support for running those tests.

Playwright E2E tests are heavier than unit tests (they need a browser, a Vite dev server, and
optionally the collab relay). They should run in a separate job to avoid slowing down the fast
feedback loop from unit tests.

## Tasks — execute in order:

### G1: Add Playwright E2E job to CI
Create `.github/workflows/e2e.yml`:
```yaml
name: E2E Tests

on:
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown

      - name: Install wasm-pack
        run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

      - name: Install dependencies
        run: npm install

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Build WASM
        run: npm run build:wasm

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

      - name: Upload traces
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: test-results/
          retention-days: 7
```

Key design decisions:
- Separate workflow file so E2E failures don't block the fast unit test CI
- Only chromium (not webkit/firefox) to keep CI fast
- Upload Playwright report and traces as artifacts for debugging failures
- The `webServer` config in playwright.config.ts will auto-start Vite

### G2: Update ci.yml to include server integration tests
The existing `cd server && cargo test` step already picks up new test files in `server/tests/`.
Verify this is the case. If the step only runs unit tests (not integration tests), update it to
run `cd server && cargo test --all-targets`.

### G3: Commit and verify
- Commit with descriptive message
