# Google Sheets Sync

## Architecture
- **SheetsAdapter** (`SheetsAdapter.ts`) — service class orchestrating bidirectional Y.Doc ↔ Sheets sync
- Three-way merge with base values stored in IndexedDB (per sheetId), hashed by canonical Task object (`hashTask`)
- Write path: mark dirty on Y.Doc `ORIGIN.LOCAL` observation → debounce 2s → pre-write validation → writeSheet API → update base values on success
- Read path: poll every 30s → three-way merge per task (sheet vs ydoc vs base) → inject changes via `doc.transact({}, ORIGIN.SHEETS)` → surface conflicts to UIStore
- Attribution columns: `lastModifiedBy` + `lastModifiedAt` track per-task edit origin
- **Header-based column lookup**: `rowToTask` reads by column name via `HeaderMap`, not positional index. `COLUMN_ALIASES` supports renamed columns.

## Constraints
- Sheets is the single source of truth for persistence — no application database
- Column layout defined in `SHEET_COLUMNS`. Reads use `HeaderMap` (position-independent). Writes use canonical order.
- No Google JS SDK / gapi — raw `fetch()` only
- SheetsAdapter writes use `ORIGIN.SHEETS` transaction origin (not undoable, no cascade). Never use raw string origins — always import from `src/collab/origins.ts`.

## Never
- Use Google JS SDK / gapi
- Add a separate database or persistence layer
- Use raw origin strings (`'sheets'`, `'local'`) — use `ORIGIN.SHEETS`, `ORIGIN.LOCAL` from origins.ts
- Use positional column indexing in the read path — use `HeaderMap` from `buildHeaderMap()`
