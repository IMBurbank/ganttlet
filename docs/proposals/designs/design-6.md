# Design 6: Error Handling + Header Validation UI

## Summary

Build the sync error UI (banners, status indicators), error code discrimination
in the polling loop, polling backoff, offline detection, header validation error
screen, and CSV template download.

## Requirements

REQ-EH-1–6, REQ-HV-2/5 (UI only; REQ-HV-1/3/4 are logic covered by Design 1)

## Dependencies

- Design 1 (`SyncError` type, `classifySyncError`, `validateHeaders`)
- Can be built in parallel with Designs 2–5

## Files

| File | Action | Change |
|---|---|---|
| `src/components/onboarding/ErrorBanner.tsx` | Create | Persistent banners for auth/not_found/forbidden/network |
| `src/components/onboarding/SyncStatus.tsx` | Create | Status indicator for rate_limit (replaces existing SyncStatusIndicator) |
| `src/components/panels/SyncStatusIndicator.tsx` | Delete | Replaced by `SyncStatus.tsx`; update all imports (currently used in Header.tsx) |
| `src/components/onboarding/HeaderMismatchError.tsx` | Create | Column mismatch screen with expected vs found |
| `src/sheets/sheetsSync.ts` | Modify | Replace `setInterval` with recursive `setTimeout` for dynamic backoff, error discrimination |
| `src/sheets/sheetsClient.ts` | Modify | Discriminate HTTP status codes in retry exhaustion |
| `src/state/GanttContext.tsx` | Modify | Add online/offline event listeners for network error detection |
| `src/components/layout/Header.tsx` | Modify | Integrate ErrorBanner + SyncStatus. **Note:** Design 6 lands first (Phase 18 Stage 2); Design 5 (Stage 4) adds sheet management on top. Keep changes additive. |

## Implementation Details

**Error banner rules:**

- One notification per error sequence (set on first failure, clear on success)
- `syncError.type` determines banner content:
  - `auth`: "Session expired. [Re-authorize] to keep syncing." — clicking triggers
    `signIn()`. On successful re-auth: clear `syncError`, call `scheduleSave()` to
    write any pending local changes
  - `not_found`: "Can't access this sheet. It may have been deleted." + [Open another
    sheet] — call `stopPolling()` (exported from `sheetsSync.ts`, see Design 1).
    Sheet is removed from recent sheets list via `removeRecentSheet()` (Design 2).
  - `forbidden`: Same as not_found (but does not remove from recent list)
  - When `dataSource='loading'` + any error (`forbidden`, `not_found`, `auth`): also show
    [Retry] button alongside [Open another sheet]. [Retry] re-calls `loadFromSheet()`.
  - `network`: "You're offline. Changes saved locally." — detected via `navigator.onLine`
  - `rate_limit`: NOT a banner — shows in sync status indicator: "Sync paused — retrying
    automatically"
  - `header_mismatch`: NOT handled by ErrorBanner — renders `HeaderMismatchError.tsx`
    instead (a full-screen component, not a banner overlay). Triggered when
    `syncError.type === 'header_mismatch'` and `dataSource === 'loading'`.

**Polling backoff:**

```
consecutiveErrors = 0
on poll error: consecutiveErrors++
  if consecutiveErrors >= 3: interval = min(interval * 2, 300000)
on poll success: consecutiveErrors = 0, interval = 30000
```

**Polling implementation note:** The current `startPolling()` uses `setInterval` with a
fixed `POLL_INTERVAL_MS`. Dynamic backoff requires replacing this with a recursive
`setTimeout` pattern where each cycle schedules the next with a potentially different
interval.

**Offline detection** (in `GanttContext.tsx`, not `sheetsSync.ts` — `dispatch` is only
available in the React component, not at module scope in sheetsSync):

```typescript
// Inside a useEffect in GanttContext.tsx
const handleOnline = () => {
  dispatch({ type: 'SET_SYNC_ERROR', error: null });
  // trigger immediate sync cycle
};
const handleOffline = () => {
  dispatch({
    type: 'SET_SYNC_ERROR',
    error: { type: 'network', message: 'You are offline', since: Date.now() },
  });
};
window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);
return () => {
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
};
```

**Header validation error screen** (`HeaderMismatchError.tsx`):

- Shows expected columns vs found columns side by side
- [Create a new sheet instead] → triggers sheet creation flow
- [Download header template] → generates and downloads CSV with SHEET_COLUMNS as row 1

**Local editing guarantee:**

All error states allow local editing. `syncError` overlays on the Gantt chart UI —
it never blocks task manipulation. When error resolves, `scheduleSave()` writes
current full `state.tasks`.

## Tests

1. `src/components/onboarding/__tests__/ErrorBanner.test.tsx` — each error type
2. `src/components/onboarding/__tests__/HeaderMismatchError.test.tsx`
3. `src/sheets/__tests__/pollingBackoff.test.ts` — backoff logic
4. Integration: error → local edit → recovery → save

## Commits

1. `feat: add error banners and sync status indicator`
2. `feat: add polling backoff and offline detection`
3. `feat: add header validation error screen with CSV download`
