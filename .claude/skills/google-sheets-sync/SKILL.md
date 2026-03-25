---
name: google-sheets-sync
description: "Use when working on Google Sheets integration, OAuth2 flow, or the sync layer. Covers sheetsClient, sheetsMapper, SheetsAdapter class and data mapping patterns."
---

# Google Sheets Sync Guide

## Architecture
Google Sheets is the single source of truth for persistent project data. Y.Doc is the
live session state. All Sheets I/O runs in the browser via Google Sheets API v4.
SheetsAdapter orchestrates bidirectional Y.Doc ↔ Sheets sync with three-way merge.

## OAuth2 Flow
- Client-side OAuth2 token handling (Google Identity Services)
- Permissions derived from Google Drive sharing (no separate auth system)
- Token refresh handled automatically by the Google auth library

## Key Modules
- `sheetsClient.ts` — Low-level Sheets API wrapper (read/write ranges, batch operations)
- `sheetsMapper.ts` — Maps between Ganttlet task format and Sheets row format
- `SheetsAdapter.ts` — Service class orchestrating bidirectional Y.Doc ↔ Sheets sync with three-way merge

## Three-Way Merge
On each poll cycle, SheetsAdapter compares per-task:
- `sheet_value == base_value` → local wins (write ydoc_value to Sheet)
- `ydoc_value == base_value` → external wins (inject sheet_value into Y.Doc via `'sheets'` origin)
- All three differ → **CONFLICT** → surfaced to user via UIStore
- No base (first sync) → treat as no external edit
Base values stored in IndexedDB (`ganttlet-sync-base-{sheetId}`), updated after successful writes.

## Data Mapping

### Column Layout (Row 1 = Headers)
The column order is defined in `src/sheets/sheetsMapper.ts` as `SHEET_COLUMNS`:

| Index | Column | Serialization Notes |
|-------|--------|---------------------|
| 0 | `id` | String UUID |
| 1 | `name` | Plain text |
| 2 | `startDate` | String (not a Sheets date serial) |
| 3 | `endDate` | String (not a Sheets date serial) |
| 4 | `duration` | Integer as string (`String(task.duration)`) |
| 5 | `owner` | Plain text |
| 6 | `workStream` | Plain text |
| 7 | `project` | Plain text |
| 8 | `functionalArea` | Plain text |
| 9 | `done` | `"true"` / `"false"` string |
| 10 | `description` | Plain text |
| 11 | `isMilestone` | `"true"` / `"false"` string |
| 12 | `isSummary` | `"true"` / `"false"` string |
| 13 | `parentId` | ID string or empty |
| 14 | `childIds` | Comma-separated IDs (`task.childIds.join(',')`) |
| 15 | `dependencies` | Semicolon-separated `fromId:type:lag` triples |
| 16 | `notes` | Plain text |
| 17 | `okrs` | Pipe-separated (`task.okrs.join('|')`) |
| 18 | `constraintType` | ASAP/SNET/ALAP/SNLT/FNET/FNLT/MSO/MFO or empty |
| 19 | `constraintDate` | ISO date string or empty |

### Dependency Serialization
Dependencies serialize as `fromId:type:lag` joined by `;`. Example: `task-1:FS:0;task-2:SS:1`. Parsed by `parseDependencies()` in `sheetsMapper.ts`. Note: `toId` is NOT stored in the sheet — it is reconstructed at read time from the owning task's ID (`task.dependencies.map(d => ({ ...d, toId: task.id }))`).

### Sync Mechanism
- **Write path**: SheetsAdapter marks dirty on Y.Doc `'local'` origin observation, debounces writes by 2000ms. Pre-write validation logs orphaned refs and invalid dates as warnings (non-blocking). After writing, base values updated in IndexedDB. `clearSheet` removes orphaned rows below the data range.
- **Read path**: Polls the sheet every 30s. Three-way merge per task resolves changes. Changes injected into Y.Doc via `doc.transact({}, 'sheets')`. Conflicts surfaced to UIStore. Backoff: doubles interval after 3 consecutive errors (max 300s).
- **Write range**: `Sheet1!A1:T{rowCount}` — column T is the 20th column matching the 20 `SHEET_COLUMNS` fields.
- **Read range**: `Sheet1` (entire sheet).
- **Transaction origins**: `'local'` writes are undoable and trigger cascade; `'sheets'` injections are not undoable and skip cascade.

## Gotchas & Known Issues

1. **`toId` is not persisted in the sheet.** The dependency serialization format (`fromId:type:lag`) omits the `toId` field. On read, `rowsToTasks()` reconstructs it from the owning task's ID. If you change the dependency model to support many-to-many or move dependencies to a separate structure, the round-trip will break. See `src/sheets/sheetsMapper.ts` lines 65–79 and 93–94.

2. **Booleans are string-compared, not parsed.** `done`, `isMilestone`, and `isSummary` are stored as `"true"`/`"false"` strings and compared with strict equality (`get(9) === 'true'`). If a user manually edits the Sheet and enters `TRUE` (Sheets default for checkboxes), `Yes`, or `1`, the value will be read as `false`. See `src/sheets/sheetsMapper.ts` `rowToTask()`.

3. **Summary tasks without children are silently dropped on write.** `tasksToRows()` filters with `.filter(t => !t.isSummary || t.childIds.length > 0)` — summary tasks that have no children are excluded from the sheet write. This means a newly created summary task won't persist until children are assigned. See `src/sheets/sheetsMapper.ts` line 83.

4. **Hash function covers all 20 persisted fields.** RESOLVED — `hashTasks()` now hashes all 20 `SHEET_COLUMNS` fields, sorted by ID for order-independence. `isExpanded` and `isHidden` are excluded (UI-only, reset on every read by `sheetsMapper`).

5. **Token expiry is checked but never refreshed automatically.** `getAccessToken()` in `src/sheets/oauth.ts` returns `null` if `Date.now() >= expiresAt`, but there is no automatic refresh — the user must sign in again. The SKILL description says "Token refresh handled automatically by the Google auth library" but the actual code does not call `google.accounts.oauth2.initTokenClient` with `prompt: 'none'` for silent refresh. API calls will fail silently after token expiry (caught by the try/catch in `SheetsAdapter` which only logs to console).

6. **Polling ignores empty sheets to avoid data loss.** If `incomingTasks.length === 0` during a poll, the result is silently discarded (no merge, no dispatch). This prevents overwriting local data when the sheet is empty, but also means a legitimate "delete all tasks" action in Sheets will not propagate to Ganttlet.

7. **Retry logic treats non-ok responses as thrown `Response` objects.** `sheetsClient.ts` does `if (!res.ok) throw res` — the retry handler then checks `error instanceof Response && error.status === 429` for rate limiting. This is unusual; most code throws `Error` objects. Any middleware that wraps fetch or changes the Response prototype could break the 429/Retry-After detection. See `src/sheets/sheetsClient.ts` lines 26–29 and 56.

8. **Saves must clear orphaned rows.** Every write path writes the data range then calls `clearSheet` on rows below the data. Without this, orphaned rows from a previous larger write persist and create a duplicate-row feedback loop via polling.

9. **Pre-write validation is non-blocking.** Orphaned dependencies, orphaned parentId/childIds, and invalid dates are logged as warnings but writes proceed. This prevents data loss from validation false positives.

## Testing Patterns
- Unit tests mock the Sheets API responses
- Test data mapping independently from API calls
- Verify round-trip: Ganttlet → Sheets format → Ganttlet produces identical data
- `retryWithBackoff` has dedicated tests in `src/sheets/__tests__/sheetsClient.test.ts` covering exponential backoff, max delay cap, and attempt exhaustion

## Duration Convention
- Sheets stores `duration` as inclusive business day count: [startDate, endDate] counting both.
- When importing: `duration = taskDuration(startDate, endDate)` (NOT `workingDaysBetween`).
- When exporting: same — `taskDuration` is the source of truth.
- Weekend dates from Sheets are NOT rejected or snapped. They surface as `WEEKEND_VIOLATION`
  conflicts in the UI. The user must fix them.

## Lessons Learned
<!-- Managed by curation pipeline — do not edit directly -->
