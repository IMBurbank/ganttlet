# Relay Server

## Constraints
- Stateless WebSocket relay — NEVER touches Google Sheets
- Never stores persistent state, never runs business logic
- All scheduling, rendering, and data transformation happens in the browser
- Strict CORS origin allowlisting — no wildcards in production

## Commands
- `cargo test --manifest-path server/Cargo.toml` — Run server tests

## Never
- Add Sheets API calls or any persistence layer
- Add business logic (scheduling, constraint checking, etc.)
- Weaken CORS or auth validation
