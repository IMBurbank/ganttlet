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
| `src/state/ganttReducer.ts` | Modify | Add 3 action cases + `sandboxDirty` auto-tracking |
| `src/data/fakeData.ts` | Move | → `src/data/templates/softwareRelease.ts` |
| `src/data/defaultColumns.ts` | Create | Extract `defaultColumns` (needed at init regardless of mode) |
| `src/sheets/syncErrors.ts` | Create | `classifySyncError(err) → SyncError` |
| `src/sheets/sheetsSync.ts` | Modify | `loadFromSheet()` throws instead of returning `[]` |
| `src/sheets/sheetsMapper.ts` | Modify | Add `validateHeaders(row: string[]): boolean` |
| `src/state/GanttContext.tsx` | Modify | Empty initialState, dataSource-based gating on auto-save + Yjs + collabDispatch, error classification, beforeunload |
| `src/components/WelcomeGate.tsx` | Create | Routing shell: if `dataSource` defined → children; else → placeholder |
| `src/App.tsx` | Modify | Wrap `AppContent` with `WelcomeGate` inside `GanttProvider` |

## Types

```typescript
export type DataSource = 'sandbox' | 'loading' | 'sheet' | 'empty';

export interface SyncError {
  type: 'auth' | 'not_found' | 'forbidden' | 'rate_limit' | 'network';
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
```

`ENTER_SANDBOX` is atomic: sets `dataSource='sandbox'` + loads tasks in one dispatch.

## Reducer

- `SET_DATA_SOURCE` → `{ ...state, dataSource }`
- `SET_SYNC_ERROR` → `{ ...state, syncError }`
- `ENTER_SANDBOX` → `{ ...state, dataSource: 'sandbox', tasks, changeHistory }`
- Post-processing: if `state.dataSource === 'sandbox'` and action is in
  `TASK_MODIFYING_ACTIONS` → set `sandboxDirty: true`

## GanttContext Changes

**initialState:**

```typescript
tasks: [],          // was: fakeTasks
changeHistory: [],  // was: fakeChangeHistory
dataSource: undefined,
syncError: null,
sandboxDirty: false,
```

**Sheets sync useEffect (lines 131-147):** Only runs when `?sheet=` in URL.
Sets `dataSource='loading'`, calls `loadFromSheet()`. On success with data →
`dataSource='sheet'`. On success empty → `dataSource='empty'`. On throw →
`syncError` set via `classifySyncError(err)`. This is the ONLY place that calls
`loadFromSheet` — WelcomeGate does NOT duplicate this call. WelcomeGate just
checks if `?sheet=` is present and skips rendering (the useEffect handles loading).

**Auto-save useEffect (lines 150-155):** Add guard:
`if (state.dataSource !== 'sheet') return;`

**Yjs useEffect (lines 158-209):** Add guard:
`if (state.dataSource !== 'sheet') return;`
Remove `fakeTasks` fallback in hydration. Add `state.dataSource` to dependency array.

**collabDispatch (lines 118-128):** Add guard:
`if (stateRef.current.dataSource !== 'sheet') return;` (after base dispatch)

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
