---
phase: 18
group: C
stage: 2
agent_count: 1
scope:
  modify:
    - src/sheets/sheetsSync.ts
    - src/sheets/sheetsClient.ts
    - src/state/GanttContext.tsx
    - src/components/layout/Header.tsx
  create:
    - src/components/onboarding/ErrorBanner.tsx
    - src/components/onboarding/SyncStatus.tsx
    - src/components/onboarding/HeaderMismatchError.tsx
  delete:
    - src/components/panels/SyncStatusIndicator.tsx
  test:
    - src/components/onboarding/__tests__/ErrorBanner.test.tsx
    - src/components/onboarding/__tests__/SyncStatus.test.tsx
    - src/components/onboarding/__tests__/HeaderMismatchError.test.tsx
    - src/sheets/__tests__/pollingBackoff.test.ts
    - src/sheets/__tests__/syncErrorRecovery.test.ts
  read_only:
    - src/types/index.ts
    - src/sheets/syncErrors.ts
    - src/sheets/sheetsMapper.ts
    - src/utils/recentSheets.ts
depends_on: [A]
tasks:
  - id: C1
    summary: "Read sheetsSync.ts, sheetsClient.ts, GanttContext.tsx, Header.tsx"
  - id: C2
    summary: "Replace setInterval polling with setTimeout backoff + hard-stop"
  - id: C3
    summary: "Add HTTP status discrimination to sheetsClient.ts"
  - id: C4
    summary: "Add online/offline event listeners to GanttContext.tsx"
  - id: C5
    summary: "Create ErrorBanner.tsx"
  - id: C6
    summary: "Create SyncStatus.tsx replacing SyncStatusIndicator"
  - id: C7
    summary: "Create HeaderMismatchError.tsx"
  - id: C8
    summary: "Integrate ErrorBanner + SyncStatus into Header.tsx"
  - id: C9
    summary: "Integration test: error → local edit → recovery → save"
---

# Phase 18 Group C — Error Handling + Header Validation UI

You are implementing Phase 18 Group C for the Ganttlet project.
Read `CLAUDE.md` for full project context. Read `docs/proposals/designs/design-6.md` for the
detailed design specification.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart with real-time Google Sheets sync. This group builds
the error handling UI, polling backoff, offline detection, and header validation error screen.

## Your files:
Modify:
- `src/sheets/sheetsSync.ts` — Replace setInterval with setTimeout, add backoff + hard-stop
- `src/sheets/sheetsClient.ts` — Throw Response on retry exhaustion
- `src/state/GanttContext.tsx` — Add online/offline event listeners
- `src/components/layout/Header.tsx` — Integrate ErrorBanner + SyncStatus

Create:
- `src/components/onboarding/ErrorBanner.tsx` — Persistent banners per syncError.type
- `src/components/onboarding/SyncStatus.tsx` — Replaces SyncStatusIndicator
- `src/components/onboarding/HeaderMismatchError.tsx` — Column mismatch screen

Delete:
- `src/components/panels/SyncStatusIndicator.tsx` — Replaced by SyncStatus.tsx

Read-only:
- `src/types/index.ts` — SyncError type (from Group A)
- `src/sheets/syncErrors.ts` — classifySyncError (from Group A)
- `src/sheets/sheetsMapper.ts` — SHEET_COLUMNS for CSV download
- `src/utils/recentSheets.ts` — removeRecentSheet (created by Group B in the same stage).
  Since B and C run in parallel, this file may not exist when you run tsc/tests. Add a
  TODO comment at the call site with the intended import and function call. The merge-fix
  agent will wire it after both branches merge. Do NOT add a broken import that fails tsc.

## Tasks — execute in order

### C1: Read and understand current sync implementation
Read sheetsSync.ts (polling with setInterval), sheetsClient.ts (retry logic),
GanttContext.tsx (how syncError/dispatch flow), Header.tsx (current SyncStatusIndicator usage).

### C2: Replace setInterval polling with recursive setTimeout + backoff + hard-stop
In `src/sheets/sheetsSync.ts`:
- Replace `setInterval` with a recursive `setTimeout` pattern
- Track `consecutiveErrors` counter
- When `consecutiveErrors >= 3`: double the interval (cap at 300,000ms / 5 minutes)
- On successful poll: reset to 30,000ms, clear counter
- `syncError` set once per error sequence, not per retry
- For `not_found`/`forbidden`: clear the setTimeout handle, do NOT reschedule (hard stop)
- Unit tests in `pollingBackoff.test.ts`: backoff progression, reset on success, hard-stop on 404

### C3: HTTP status discrimination in sheetsClient.ts
On retry exhaustion, throw the `Response` object (not a generic Error) so that
`classifySyncError` in `syncErrors.ts` can discriminate by HTTP status.

### C4: Online/offline event listeners in GanttContext.tsx
Add a `useEffect` that:
- Listens for `window` `'online'` and `'offline'` events
- `offline` → `dispatch({ type: 'SET_SYNC_ERROR', error: { type: 'network', message: 'You are offline', since: Date.now() } })`
- `online` → `dispatch({ type: 'SET_SYNC_ERROR', error: null })` + trigger immediate sync
- Cleans up listeners on unmount

### C5: Create ErrorBanner.tsx
Persistent banners based on `syncError.type`:
- `auth`: "Session expired. [Re-authorize] to keep syncing." → clicks `signIn()`.
  On re-auth success: clear `syncError`, call `scheduleSave(state.tasks)`.
- `not_found`: "Can't access this sheet. It may have been deleted." + [Open another sheet].
  Calls `stopPolling()` + `removeRecentSheet(sheetId)` (from recentSheets.ts).
- `forbidden`: Same banner text + [Open another sheet] (no removeRecentSheet).
- When `dataSource='loading'` + error (`auth`, `not_found`, or `forbidden`): also show
  [Retry] button alongside [Open another sheet]. [Retry] re-calls `loadFromSheet()`.
- `network`: "You're offline. Changes saved locally."
- `rate_limit`: NOT a banner — handled by SyncStatus (C6)
- `header_mismatch`: NOT handled by ErrorBanner — renders HeaderMismatchError (C7) instead
- Component test covers each error type + action triggers

### C6: Create SyncStatus.tsx replacing SyncStatusIndicator
- Replaces `src/components/panels/SyncStatusIndicator.tsx`
- Shows "Synced", "Syncing...", or "Sync paused — retrying automatically" (for rate_limit)
- Delete `SyncStatusIndicator.tsx`
- Update import in `Header.tsx` (primary consumer)
- Component test covers all three display states

### C7: Create HeaderMismatchError.tsx
- Renders when `syncError.type === 'header_mismatch'` and `dataSource === 'loading'`
- Shows expected columns (from SHEET_COLUMNS) vs found columns side by side
- [Create a new sheet instead] button
- [Download header template] → generates and downloads CSV with all 20 SHEET_COLUMNS as row 1
- Component test

### C8: Integrate ErrorBanner + SyncStatus into Header.tsx
- ErrorBanner renders above main content when syncError is set
- SyncStatus replaces old SyncStatusIndicator in the header bar
- Keep changes additive — Design 5 (Group F, Stage 4) will add sheet title, share button,
  and dropdown to Header.tsx later. Your ErrorBanner and SyncStatus should not interfere.

### C9: Integration test — error → local edit → recovery → save
In `src/sheets/__tests__/syncErrorRecovery.test.ts`:
- Simulate syncError being set (any type)
- Verify local edits succeed (state.tasks updates normally)
- Simulate error clearing
- Verify scheduleSave writes full state.tasks on recovery

## Error Handling
- NEVER compute dates mentally — use `taskEndDate`/`taskDuration` shell functions
- If a task fails after 3 approaches, commit WIP and move to the next task
- Commit after each logical change with conventional commits

## Success Criteria:
1. Polling uses setTimeout with dynamic backoff (>=3 errors → double, max 300s, reset on success)
2. not_found/forbidden cause hard polling stop (no reschedule)
3. sheetsClient throws Response on retry exhaustion
4. Online/offline listeners dispatch SET_SYNC_ERROR correctly
5. ErrorBanner renders correct banner per error type with correct CTAs including [Retry] for loading state. ErrorBanner does NOT handle header_mismatch (that's HeaderMismatchError).
6. SyncStatus replaces SyncStatusIndicator with 3 states: "Synced", "Syncing...", "Sync paused — retrying automatically"
7. HeaderMismatchError shows expected vs found + CSV download
8. Header.tsx integrates both components
9. syncErrorRecovery integration test passes
10. SyncStatusIndicator.tsx deleted, all imports updated
11. All tests pass, all changes committed
