---
name: google-sheets-sync
description: "Use when working on Google Sheets integration, OAuth2 flow, or the sync layer. Covers sheetsClient, sheetsMapper, sheetsSync modules and data mapping patterns."
---

# Google Sheets Sync Guide

## Architecture
Google Sheets is the single source of truth for project data. There is no application
database. All Sheets I/O runs in the browser via Google Sheets API v4.

## OAuth2 Flow
- Client-side OAuth2 token handling (Google Identity Services)
- Permissions derived from Google Drive sharing (no separate auth system)
- Token refresh handled automatically by the Google auth library

## Key Modules
- `sheetsClient.ts` — Low-level Sheets API wrapper (read/write ranges, batch operations)
- `sheetsMapper.ts` — Maps between Ganttlet task format and Sheets row format
- `sheetsSync.ts` — Orchestrates bidirectional sync (Ganttlet ↔ Sheets)

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

### Dependency Serialization
Dependencies serialize as `fromId:type:lag` joined by `;`. Example: `task-1:FS:0;task-2:SS:1`. Parsed by `parseDependencies()` in `sheetsMapper.ts`. Note: `toId` is NOT stored in the sheet — it is reconstructed at read time from the owning task's ID (`task.dependencies.map(d => ({ ...d, toId: task.id }))`).

### Sync Mechanism
- **Write path**: `scheduleSave()` in `sheetsSync.ts` debounces writes by 2000ms (`WRITE_DEBOUNCE_MS`). Uses a JSON hash of key task fields to skip no-op writes.
- **Read path**: `startPolling()` polls the sheet every 30s (`POLL_INTERVAL_MS`). Changes are dispatched as `MERGE_EXTERNAL_TASKS` and also propagated to Yjs for CRDT sync.
- **Write range**: Hard-coded to `Sheet1!A1:R{rowCount}` — column R is the 18th column matching the 18 fields.
- **Read range**: Hard-coded to `Sheet1` (entire sheet).

## Gotchas & Known Issues

1. **`toId` is not persisted in the sheet.** The dependency serialization format (`fromId:type:lag`) omits the `toId` field. On read, `rowsToTasks()` reconstructs it from the owning task's ID. If you change the dependency model to support many-to-many or move dependencies to a separate structure, the round-trip will break. See `src/sheets/sheetsMapper.ts` lines 65–79 and 93–94.

2. **Booleans are string-compared, not parsed.** `done`, `isMilestone`, and `isSummary` are stored as `"true"`/`"false"` strings and compared with strict equality (`get(9) === 'true'`). If a user manually edits the Sheet and enters `TRUE` (Sheets default for checkboxes), `Yes`, or `1`, the value will be read as `false`. See `src/sheets/sheetsMapper.ts` `rowToTask()`.

3. **Summary tasks without children are silently dropped on write.** `tasksToRows()` filters with `.filter(t => !t.isSummary || t.childIds.length > 0)` — summary tasks that have no children are excluded from the sheet write. This means a newly created summary task won't persist until children are assigned. See `src/sheets/sheetsMapper.ts` line 83.

4. **Hash function only covers a subset of fields.** The `hashTasks()` function in `sheetsSync.ts` hashes `id`, `name`, `startDate`, `endDate`, `duration`, `owner`, `done`, `dependencies`, `parentId`, and `childIds` — but NOT `description`, `notes`, `okrs`, `workStream`, `project`, `functionalArea`, `isMilestone`, or `isSummary`. Changes to these fields alone will NOT trigger a write to Sheets and will NOT be detected by polling. See `src/sheets/sheetsSync.ts` lines 21–27.

5. **Token expiry is checked but never refreshed automatically.** `getAccessToken()` in `src/sheets/oauth.ts` returns `null` if `Date.now() >= expiresAt`, but there is no automatic refresh — the user must sign in again. The SKILL description says "Token refresh handled automatically by the Google auth library" but the actual code does not call `google.accounts.oauth2.initTokenClient` with `prompt: 'none'` for silent refresh. API calls will fail silently after token expiry (caught by the try/catch in `sheetsSync.ts` which only logs to console).

6. **Polling ignores empty sheets to avoid data loss.** If `incomingTasks.length === 0` during a poll, the result is silently discarded (no merge, no dispatch). This prevents overwriting local data when the sheet is empty, but also means a legitimate "delete all tasks" action in Sheets will not propagate to Ganttlet. See `src/sheets/sheetsSync.ts` line 87.

7. **Retry logic treats non-ok responses as thrown `Response` objects.** `sheetsClient.ts` does `if (!res.ok) throw res` — the retry handler then checks `error instanceof Response && error.status === 429` for rate limiting. This is unusual; most code throws `Error` objects. Any middleware that wraps fetch or changes the Response prototype could break the 429/Retry-After detection. See `src/sheets/sheetsClient.ts` lines 26–29 and 56.

## Testing Patterns
- Unit tests mock the Sheets API responses
- Test data mapping independently from API calls
- Verify round-trip: Ganttlet → Sheets format → Ganttlet produces identical data
- `retryWithBackoff` has dedicated tests in `src/sheets/__tests__/sheetsClient.test.ts` covering exponential backoff, max delay cap, and attempt exhaustion
