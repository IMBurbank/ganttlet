# Design 2: Sheet Selector + Recent Sheets List

## Summary

Build the modal for browsing and connecting Google Sheets. Drive API file listing
using existing `drive.metadata.readonly` scope, URL paste with ID extraction, recent
sheets list in localStorage with LRU eviction.

## Requirements

REQ-SS-1–5

## Dependencies

- Design 1 (state machine foundation)

## Files

| File | Action | Change |
|---|---|---|
| `src/components/onboarding/SheetSelector.tsx` | Create | Modal with Drive listing + URL paste input |
| `src/sheets/sheetsBrowser.ts` | Create | `listUserSheets(token): Promise<SheetInfo[]>` using Drive API |
| `src/utils/recentSheets.ts` | Create | localStorage CRUD: get, add, remove, evict (max 10, LRU) |
| `src/utils/parseSheetUrl.ts` | Create | Extract spreadsheet ID from Google Sheets URLs |

## Implementation Details

**Drive API listing** (`sheetsBrowser.ts`):

```typescript
GET https://www.googleapis.com/drive/v3/files
  ?q=mimeType='application/vnd.google-apps.spreadsheet' and trashed=false
  &fields=files(id,name,modifiedTime,iconLink)
  &orderBy=modifiedTime desc
  &pageSize=20
```

Uses raw `fetch()` with `Authorization: Bearer ${token}`. No Google SDK.

**URL parsing** (`parseSheetUrl.ts`):

- Regex: `/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/`
- Returns `string | null`
- Example: `https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0` → `ABC123`

**Recent sheets** (`recentSheets.ts`):

```typescript
type RecentSheet = { sheetId: string; title: string; lastOpened: number };
const STORAGE_KEY = 'ganttlet-recent-sheets';
const MAX_ENTRIES = 10;

export function getRecentSheets(): RecentSheet[]
export function addRecentSheet(sheet: RecentSheet): void  // LRU eviction
export function removeRecentSheet(sheetId: string): void  // on 403/404
```

**SheetSelector modal:**

- Top section: Drive API listing (up to 20 sheets)
- Bottom section: URL paste input with inline validation
- Buttons: [Connect] (enabled when valid selection), [Create New Sheet] (stub for Design 5)
- On connect: calls `onSelect(sheetId)` callback → parent sets URL params + dataSource

## Tests

1. `src/utils/__tests__/parseSheetUrl.test.ts` — valid URLs, invalid URLs, edge cases
2. `src/utils/__tests__/recentSheets.test.ts` — add, evict, remove, max 10
3. `src/components/onboarding/__tests__/SheetSelector.test.tsx` — render, select, paste

## Commits

1. `feat: add URL parser and recent sheets localStorage utility`
2. `feat: add Drive API sheet listing`
3. `feat: add SheetSelector modal component`
