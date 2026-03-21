---
phase: 18
group: B
stage: 2
agent_count: 1
scope:
  create:
    - src/components/onboarding/SheetSelector.tsx
    - src/sheets/sheetsBrowser.ts
    - src/utils/recentSheets.ts
    - src/utils/parseSheetUrl.ts
  test:
    - src/utils/__tests__/parseSheetUrl.test.ts
    - src/utils/__tests__/recentSheets.test.ts
    - src/components/onboarding/__tests__/SheetSelector.test.tsx
  read_only:
    - src/sheets/oauth.ts
    - src/types/index.ts
    - src/state/actions.ts
depends_on: [A]
tasks:
  - id: B1
    summary: "Read oauth.ts, types/index.ts for DataSource"
  - id: B2
    summary: "Create parseSheetUrl.ts"
  - id: B3
    summary: "Create recentSheets.ts"
  - id: B4
    summary: "Create sheetsBrowser.ts"
  - id: B5
    summary: "Create SheetSelector.tsx modal"
---

# Phase 18 Group B — Sheet Selector + Recent Sheets List

You are implementing Phase 18 Group B for the Ganttlet project.
Read `CLAUDE.md` for full project context. Read `docs/proposals/designs/design-2.md` for the
detailed design specification.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart with real-time Google Sheets sync. This group builds
the sheet selector modal that lets users browse their Google Sheets, paste a URL, and connect.

## Your files (ONLY create these — all new files):
- `src/utils/parseSheetUrl.ts` — Extract spreadsheet ID from Google Sheets URLs
- `src/utils/recentSheets.ts` — localStorage CRUD for recent sheets (LRU, max 10)
- `src/sheets/sheetsBrowser.ts` — Drive API v3 listing of user's spreadsheets
- `src/components/onboarding/SheetSelector.tsx` — Modal component

Read-only:
- `src/sheets/oauth.ts` — Understand `getAccessToken()` and `isSignedIn()`
- `src/types/index.ts` — Understand `DataSource`, `SyncError` types (added by Group A)
- `src/state/actions.ts` — Understand `SET_DATA_SOURCE` action (added by Group A)

## Tasks — execute in order

### B1: Read and understand auth patterns
Read `src/sheets/oauth.ts` to understand how `getAccessToken()` works.
Read `src/types/index.ts` for the `DataSource` type added by Group A in Stage 1.

### B2: Create parseSheetUrl.ts
- Regex: `/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/`
- Returns `string | null`
- Unit tests in `src/utils/__tests__/parseSheetUrl.test.ts`:
  - Standard URL with /edit → extracts ID
  - URL with #gid=0 → extracts ID
  - URL with query params → extracts ID
  - Non-Sheets URL → null
  - Empty string → null
  - Bare spreadsheet ID (no URL) → null

### B3: Create recentSheets.ts
```typescript
export type RecentSheet = { sheetId: string; title: string; lastOpened: number };
const STORAGE_KEY = 'ganttlet-recent-sheets';
const MAX_ENTRIES = 10;

export function getRecentSheets(): RecentSheet[]
export function addRecentSheet(sheet: RecentSheet): void  // LRU eviction
export function removeRecentSheet(sheetId: string): void  // on 403/404
```
- `addRecentSheet`: if entry exists, update `lastOpened`; if new and list full, drop oldest
- Unit tests: add, evict at 11 entries, remove by ID, get from empty storage, update existing

### B4: Create sheetsBrowser.ts
```typescript
export interface SheetInfo {
  id: string;
  name: string;
  modifiedTime: string;  // ISO 8601
  iconLink: string;
}

export async function listUserSheets(token: string): Promise<SheetInfo[]>
```
- Drive API v3: `GET https://www.googleapis.com/drive/v3/files`
- Query: `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
- Fields: `files(id,name,modifiedTime,iconLink)`
- `orderBy=modifiedTime desc`, `pageSize=20`
- Uses raw `fetch()` with `Authorization: Bearer ${token}`. No Google SDK.

### B5: Create SheetSelector.tsx modal
- Top section: Drive API listing (up to 20 sheets from `listUserSheets`)
- Bottom section: URL paste input with inline validation
  - Invalid URL → inline error: "Couldn't find a spreadsheet ID in this URL"
  - [Connect] disabled when no valid selection
- [Create New Sheet] button rendered as stub (no-op; Design 5 wires it)
- Callback: `onSelectSheet(sheetId: string)` — parent sets `?sheet=ID&room=ID`,
  dispatches `SET_DATA_SOURCE('loading')`
- Note: `addRecentSheet()` is called after `loadFromSheet()` succeeds in GanttContext,
  NOT at click time
- Component test covers: render, select from list, paste valid URL, paste invalid URL

## Error Handling
- NEVER compute dates mentally — use `taskEndDate`/`taskDuration` shell functions
- If a task fails after 3 approaches, commit WIP and move to the next task
- Commit after each logical change with conventional commits

## Success Criteria:
1. parseSheetUrl extracts IDs from valid URLs, returns null for invalid
2. recentSheets does LRU eviction at max 10
3. sheetsBrowser lists up to 20 spreadsheets via Drive API with correct filters
4. SheetSelector modal renders listing + URL paste + connect flow
5. All tests pass
6. All changes committed
