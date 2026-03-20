# Design 1: State Machine + WelcomeGate + Fake Data Decoupling

## Summary

Add the `dataSource` state machine, `syncError` and `sandboxDirty` fields to GanttState.
Create a `WelcomeGate` routing component (placeholder screens). Move `fakeData.ts` to
templates. Gate auto-save and Yjs on `dataSource === 'sheet'`. Change `loadFromSheet()`
to throw on HTTP errors. Add header validation function to `sheetsMapper.ts`.

## Requirements

REQ-SM-STATE-1–9, REQ-FD-1–7, REQ-WG-4, REQ-HV-1/3/4 (logic only)

## Dependencies

- Issue #62 (prerequisite)

## Files

| File | Action | Change |
|---|---|---|
| `src/types/index.ts` | Modify | Add `DataSource`, `SyncError` types; add `dataSource`, `syncError`, `sandboxDirty` to `GanttState` |
| `src/state/actions.ts` | Modify | Add `SET_DATA_SOURCE`, `SET_SYNC_ERROR`, `ENTER_SANDBOX` actions |
| `src/state/ganttReducer.ts` | Modify | Add 4 action cases + `sandboxDirty` auto-tracking. Move `TASK_MODIFYING_ACTIONS` from GanttContext to a shared constant (e.g. `actions.ts`) so reducer can import it. |
| `src/data/fakeData.ts` | Move | → `src/data/templates/softwareRelease.ts` |
| `src/data/defaultColumns.ts` | Create | Extract `defaultColumns` (needed at init regardless of mode) |
| `src/sheets/syncErrors.ts` | Create | `classifySyncError(err) → SyncError` |
| `src/sheets/sheetsSync.ts` | Modify | `loadFromSheet()` throws on HTTP errors instead of returning `[]`; also remove early-return `[]` for unauthenticated state (let caller handle). Export `stopPolling()` for disconnect/error flows. |
| `src/sheets/sheetsMapper.ts` | Modify | Add `validateHeaders(row: string[]): boolean` |
| `src/state/GanttContext.tsx` | Modify | Empty initialState, dataSource-based gating on auto-save + Yjs + collabDispatch, error classification, beforeunload |
| `src/components/onboarding/WelcomeGate.tsx` | Create | Routing shell: if `dataSource` defined → children; else → placeholder |
| `src/App.tsx` | Modify | Wrap `AppContent` with `WelcomeGate` inside `GanttProvider` |

## Types

```typescript
export type DataSource = 'sandbox' | 'loading' | 'sheet' | 'empty';

export interface SyncError {
  type: 'auth' | 'not_found' | 'forbidden' | 'rate_limit' | 'network' | 'header_mismatch';
  message: string;
  since: number;
}

// Add to GanttState:
dataSource: DataSource | undefined;  // undefined → WelcomeGate renders
syncError: SyncError | null;
sandboxDirty: boolean;
```

## Actions

```typescript
| { type: 'SET_DATA_SOURCE'; dataSource: DataSource }
| { type: 'SET_SYNC_ERROR'; error: SyncError | null }
| { type: 'ENTER_SANDBOX'; tasks: Task[]; changeHistory: ChangeRecord[] }
| { type: 'RESET_STATE' }
```

`ENTER_SANDBOX` is atomic: sets `dataSource='sandbox'` + loads tasks in one dispatch.

## Reducer

- `SET_DATA_SOURCE` → `{ ...state, dataSource, sandboxDirty: false }` (resets dirty flag on any dataSource transition)
- `SET_SYNC_ERROR` → `{ ...state, syncError }`
- `ENTER_SANDBOX` → `{ ...state, dataSource: 'sandbox', tasks, changeHistory }`
- `RESET_STATE` → `{ ...initialState }` (resets to initial state with `dataSource: undefined`)
- Post-processing: if `state.dataSource === 'sandbox'` and action is in
  `TASK_MODIFYING_ACTIONS` → set `sandboxDirty: true`
- Post-processing: if `state.dataSource === 'empty'` and action is in
  `TASK_MODIFYING_ACTIONS` → set `dataSource: 'sheet'` (auto-transition on first edit)

## GanttContext Changes

**initialState:**

```typescript
tasks: [],          // was: fakeTasks
changeHistory: [],  // was: fakeChangeHistory
dataSource: undefined,
syncError: null,
sandboxDirty: false,
```

**Sheets sync useEffect (lines 131-147):** Only runs when `?sheet=` in URL
AND user is signed in (has access token). Sets `dataSource='loading'`, calls
`loadFromSheet()`. On success with data → `dataSource='sheet'`. On success empty
→ `dataSource='empty'`. On throw → `syncError` set via `classifySyncError(err)`.
This is the ONLY place that calls `loadFromSheet` — WelcomeGate does NOT duplicate
this call. If `?sheet=` is present but user is NOT signed in, WelcomeGate renders
CollaboratorWelcome (see Design 3 REQ-WG-3). After sign-in completes, this
useEffect re-fires (token now available) and loads automatically — no intermediate
screen.

**Auto-save useEffect (lines 150-155):** Add guard:
`if (state.dataSource !== 'sheet') return;`

**Yjs useEffect (lines 158-209):** Add guard:
`if (state.dataSource !== 'sheet') return;`
The existing useEffect already checks for `?room=` in the URL and a valid token
before connecting — keep those checks. The `dataSource` guard is additive.
Remove `fakeTasks` fallback in hydration. Add `state.dataSource` to dependency array.

**collabDispatch (lines 118-128):** The existing `collabDispatch` calls
`dispatch(action)` first (local state), then conditionally syncs to Yjs. Add the
dataSource guard **after** `dispatch(action)` but **before** the Yjs sync block:
`if (stateRef.current.dataSource !== 'sheet') return;`
This ensures local state updates still work in sandbox/empty modes while suppressing
Yjs sync.

**New beforeunload useEffect:** Fires when `dataSource === 'sandbox'` and
`sandboxDirty === true`.

## WelcomeGate

Routing component inside `GanttProvider`, wrapping `AppContent`:

```
if dataSource is defined → render children (GanttApp)
if dataSource is undefined:
  if URL has ?sheet= → don't render anything (useEffect will set loading)
  else → render placeholder welcome screen with "Try the demo" button
  "Try the demo" → lazy import templates, dispatch ENTER_SANDBOX
```

NOTE: The existing sheets sync useEffect in GanttContext handles `?sheet=` URL
detection and sets `dataSource='loading'`. WelcomeGate does NOT duplicate this —
it only needs to check if `?sheet=` is present so it knows to render a loading
skeleton instead of a welcome screen. The single-trigger design avoids double
`loadFromSheet()` calls.

## Header Validation Function

Added to `sheetsMapper.ts`:

```typescript
export function validateHeaders(headerRow: string[]): boolean {
  if (headerRow.length < SHEET_COLUMNS.length) return false;
  return SHEET_COLUMNS.every((col, i) =>
    headerRow[i]?.toLowerCase() === col.toLowerCase()
  );
}
```

Case-insensitive, order-sensitive, all 20 required, extra columns after T ignored.
Called by `loadFromSheet()` flow (after reading data, before parsing tasks).

**Empty row 1 bypass:** If row 1 is completely empty (all cells blank or row missing),
skip `validateHeaders` and treat as empty sheet (`dataSource='empty'`), not a mismatch.
This check happens before `validateHeaders` in the `loadFromSheet` flow.

## Error Classification

New file `src/sheets/syncErrors.ts`:

```typescript
export function classifySyncError(err: unknown): SyncError {
  if (err instanceof Response) {
    switch (err.status) {
      case 401: return { type: 'auth', message: 'Session expired', since: Date.now() };
      case 403: return { type: 'forbidden', message: 'Access denied', since: Date.now() };
      case 404: return { type: 'not_found', message: 'Sheet not found', since: Date.now() };
      case 429: return { type: 'rate_limit', message: 'Rate limited', since: Date.now() };
      default:  return { type: 'network', message: `HTTP ${err.status}`, since: Date.now() };
    }
  }
  if (err instanceof TypeError) {
    return { type: 'network', message: 'Network error', since: Date.now() };
  }
  return { type: 'network', message: String(err), since: Date.now() };
}
```

## Tests

1. `src/state/__tests__/dataSource.test.ts` — state machine transitions, sandboxDirty
2. `src/sheets/__tests__/syncErrors.test.ts` — error classification
3. `src/sheets/__tests__/headerValidation.test.ts` — validateHeaders
4. `src/components/__tests__/WelcomeGate.test.tsx` — routing logic
5. Update `makeState()` in existing reducer tests

## Commits

1. `feat: add DataSource, SyncError types to GanttState`
2. `feat: add state machine reducer cases`
3. `refactor: move fakeData to src/data/templates/softwareRelease`
4. `feat: add header validation and error classification`
5. `feat: decouple initialState from fake data`
6. `feat: gate auto-save and Yjs on dataSource`
7. `fix: loadFromSheet throws on HTTP errors`
8. `feat: add WelcomeGate routing shell`
