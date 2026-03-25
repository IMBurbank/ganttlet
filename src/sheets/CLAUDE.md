# Google Sheets Sync

## Architecture
- **SheetsAdapter** (`SheetsAdapter.ts`) — service class orchestrating bidirectional Y.Doc ↔ Sheets sync
- Three-way merge with base values stored in IndexedDB (per sheetId)
- Write path: mark dirty on Y.Doc `'local'` origin observation → debounce 2s → pre-write validation → writeSheet API → update base values on success
- Read path: poll every 30s → three-way merge per task (sheet vs ydoc vs base) → inject changes via `doc.transact({}, 'sheets')` → surface conflicts to UIStore
- Attribution columns: `lastModifiedBy` + `lastModifiedAt` track per-task edit origin

## Constraints
- Sheets is the single source of truth for persistence — no application database
- Mapper field ordering must match spreadsheet column layout exactly
- Changing field order breaks existing spreadsheets
- No Google JS SDK / gapi — raw `fetch()` only
- SheetsAdapter writes use `'sheets'` transaction origin (not undoable, no cascade)

## Never
- Use Google JS SDK / gapi
- Add a separate database or persistence layer
- Change mapper field ordering without migration plan
