# Design 6: Error Handling + Header Validation UI

## Summary

Build the sync error UI (banners, status indicators), error code discrimination
in the polling loop, polling backoff, offline detection, header validation error
screen, and CSV template download.

## Requirements

REQ-EH-1–6, REQ-HV-1–5 (UI)

## Dependencies

- Design 1 (`SyncError` type, `classifySyncError`, `validateHeaders`)
- Can be built in parallel with Designs 2–5

## Files

| File | Action | Change |
|---|---|---|
| `src/components/onboarding/ErrorBanner.tsx` | Create | Persistent banners for auth/not_found/forbidden/network |
| `src/components/onboarding/SyncStatus.tsx` | Create | Status indicator for rate_limit (replaces/extends existing SyncStatusIndicator) |
| `src/components/onboarding/HeaderMismatchError.tsx` | Create | Column mismatch screen with expected vs found |
| `src/sheets/sheetsSync.ts` | Modify | Polling backoff (3 consecutive errors → double, max 300s), error discrimination |
| `src/sheets/sheetsClient.ts` | Modify | Discriminate HTTP status codes in retry exhaustion |
| `src/components/layout/Header.tsx` | Modify | Integrate ErrorBanner + SyncStatus |

## Implementation Details

**Error banner rules:**

- One notification per error sequence (set on first failure, clear on success)
- `syncError.type` determines banner content:
  - `auth`: "Session expired. [Re-authorize]" — clicking triggers `signIn()`
  - `not_found`: "Can't access this sheet." + [Open another sheet] — stops polling
  - `forbidden`: Same as not_found
  - `network`: "You're offline. Changes saved locally." — detected via `navigator.onLine`
  - `rate_limit`: NOT a banner — shows in sync status indicator: "Sync paused — retrying"

**Polling backoff:**

```
consecutiveErrors = 0
on poll error: consecutiveErrors++
  if consecutiveErrors >= 3: interval = min(interval * 2, 300000)
on poll success: consecutiveErrors = 0, interval = 30000
```

**Offline detection:**

```typescript
window.addEventListener('online', () => {
  dispatch({ type: 'SET_SYNC_ERROR', error: null });
  // trigger immediate sync cycle
});
window.addEventListener('offline', () => {
  dispatch({
    type: 'SET_SYNC_ERROR',
    error: { type: 'network', message: 'You are offline', since: Date.now() },
  });
});
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
