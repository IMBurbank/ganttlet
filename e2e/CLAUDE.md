# E2E Tests

## Constraints
- `E2E_RELAY=1` required for collaboration tests
- Use `data-testid` selectors, not CSS class selectors
- Wait for WASM initialization before interacting with scheduling features
- Collab tests use two browser contexts to simulate two users
- Cloud E2E tests use ephemeral sheets (created per-run, deleted on success)
- Use `getTestSheetId()` from `e2e/helpers/get-sheet-id.ts` — never hardcode sheet IDs
- `TEST_SHEET_ID_DEV` overrides ephemeral sheets for local development only

## Commands
- `npm run e2e:collab` — Run E2E with relay
- `npx playwright test` — Run without relay (collab tests skip)
- `./scripts/full-verify.sh` — Full verification (handles all setup)
