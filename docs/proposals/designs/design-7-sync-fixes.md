# Design 7: Sync Layer Integrity Fixes

## Summary

Fix data integrity and correctness issues in the Sheets sync layer discovered during
Phase 18 E2E validation. The test sheet accumulated 381 duplicate rows (3 tasks × 128
copies) from an auto-save loop, revealing fundamental issues in save range management,
effect lifecycle, hash completeness, and shared mutable state.

## Context

These issues predate Phase 18 but were invisible because the app never connected to
real Google Sheets in E2E tests before. Phase 18's onboarding flow + cloud-auth E2E
tests exposed them. All issues are in existing code — Phase 18 didn't introduce them.

## Already Implemented (from code review rounds 1-3)

The following fixes were applied during Phase 18 code review and are already in the codebase:

| Fix | Commit | Status |
|---|---|---|
| RESET_SYNC clears `isSyncing: false` | `d251b74` | Done |
| `accessToken` in sheets sync effect deps + guard for sheet/empty | `28de6e6` | Done |
| Online/offline effect uses `stateRef` (no listener churn) | `28de6e6` | Done |
| `removeRecentSheet` wired in ErrorBanner on 404 | `28de6e6` | Done |
| EmptyState passes task name to ADD_TASK | `28de6e6` | Done |
| REPARENT_TASK added to TASK_MODIFYING_ACTIONS | `4107583` | Done |
| pollOnce success clears syncError via SET_SYNC_ERROR(null) | `4107583` | Done |
| WelcomeGate renders ErrorBanner above loading skeleton on error | `4107583` | Done |
| WebSocket URL normalizes localhost→127.0.0.1 | `0e77747` | Done |
| Yjs effect uses getAccessToken() fallback | `0e77747` | Done |

## Requirements

### Tier 1 — Data Integrity (must fix before merge)

| ID | Requirement | File |
|---|---|---|
| T1.1 | Save clears ALL rows below written data — no orphaned rows survive | `sheetsSync.ts` |
| T1.2 | loadFromSheet promise respects effect cancellation — no dispatch after unmount | `GanttContext.tsx` |
| T1.3 | isLocalUpdate flag is scoped per Y.Doc — no cross-doc contamination | `yjsBinding.ts` |

### Tier 2 — Correctness (should fix before merge)

| ID | Requirement | File |
|---|---|---|
| T2.1 | hashTasks covers all persisted fields (20 SHEET_COLUMNS), order-independent | `sheetsSync.ts` |
| T2.2 | Poll skips when save is pending (debounce window + in-flight) | `sheetsSync.ts` |
| T2.3 | writeTimer cleared on effect cleanup — no fire-and-forget saves | `sheetsSync.ts`, `GanttContext.tsx` |
| T2.4 | Auto-save skips Yjs- and poll-originated task updates — no echo write-back | `ganttReducer.ts`, `GanttContext.tsx` |
| T2.5 | E2E signInOnPage uses state assertion, not waitForTimeout | `e2e/helpers/mock-auth.ts` |

### Tier 3 — Scale (deferred)

| ID | Requirement | File |
|---|---|---|
| T3.1 | Auto-save skips during active drag (skip hashTasks O(N) on animation frames) | `GanttContext.tsx` |
| T3.2 | User notified on save failure (SET_SYNC_ERROR, not silent RESET_SYNC) | `sheetsSync.ts` |
| T3.3 | Atomic SET_TASKS + SET_DATA_SOURCE dispatch (single action, no intermediate render) | `actions.ts`, `ganttReducer.ts` |

## Design

### T1.1 — Clear orphaned rows on save

**Current behavior:** `scheduleSave` writes `Sheet1!A1:T{N+1}` (bounded PUT). Rows below
`N+1` from a previous larger write persist. Polling reads entire `Sheet1`, reintroduces
orphaned rows via `MERGE_EXTERNAL_TASKS`, triggering another save — positive feedback loop.

**Fix:** After `updateSheet`, call `clearSheet` on `Sheet1!A{N+2}:T`. Write-first ordering
is safe: if clear fails, orphans persist but new data is intact. Next save retries the clear.

Uses existing `clearSheet` from `sheetsClient.ts` (already has `retryWithBackoff`).
Uses `values.clear` (blanks content without structural change) — correct vs `DeleteRange`
which would shift cells.

```typescript
// In scheduleSave, after updateSheet succeeds:
const endCol = columnLetter(SHEET_COLUMNS.length);
const dataEndRow = rows.length;  // header + tasks
const clearRange = `Sheet1!A${dataEndRow + 1}:${endCol}`;
await clearSheet(currentSpreadsheetId!, clearRange).catch(() => {
  console.warn('Failed to clear orphaned rows');
});
// Update lastWriteHash AFTER both write and clear complete
lastWriteHash = hashTasks(tasks);
```

**Note:** `clearSheet` uses `retryWithBackoff` internally (up to 5 attempts). The
`.catch()` wrapper makes it non-fatal regardless — if all retries fail, orphans persist
until the next save. Under rate limiting, the retry window (~60s) keeps `saveDirty`
(T2.2) true for that duration, which is acceptable (polls skip during saves).

**Cost:** One extra API call per debounced save (2s debounce). Negligible.

**Tests:**
- Unit: mock `clearSheet`, verify it's called with correct range after `updateSheet`
- Unit: verify save succeeds even if `clearSheet` throws
- E2E: load sheet, delete a task, verify deleted task doesn't reappear on next poll

### T1.2 — Cancellable loadFromSheet effect + startPolling ordering

**Current behavior:** `loadFromSheet()` is fire-and-forget in a useEffect. If the user
navigates away or the effect re-runs (token refresh), the `.then()` dispatches against
a stale/unmounted component. Also, `startPolling()` runs before `loadFromSheet` resolves,
so a poll can read the sheet before `lastWriteHash` is initialized — causing a spurious
`MERGE_EXTERNAL_TASKS` on the first poll.

**Fix:** Standard React cancellation pattern + move `startPolling` into `.then()`.

```typescript
useEffect(() => {
  let cancelled = false;
  const spreadsheetId = new URLSearchParams(window.location.search).get('sheet');
  if (!spreadsheetId || !isSignedIn()) return;

  const current = stateRef.current.dataSource;
  if (current === 'sheet' || current === 'empty') return;

  dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'loading' });
  initSync(spreadsheetId, dispatch);

  loadFromSheet()
    .then((tasks) => {
      if (cancelled) return;
      if (tasks.length > 0) {
        dispatch({ type: 'SET_TASKS', tasks });
        dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'sheet' });
        loadedSheetTasksRef.current = tasks;
      } else {
        dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'empty' });
      }
      addRecentSheet({ sheetId: spreadsheetId, title: spreadsheetId, lastOpened: Date.now() });
      // Start polling AFTER lastWriteHash is set by loadFromSheet
      startPolling();
    })
    .catch((err) => {
      if (cancelled) return;
      dispatch({ type: 'RESET_SYNC' });
      const classified = classifySyncError(err);
      dispatch({ type: 'SET_SYNC_ERROR', error: classified });
      if (classified.type === 'not_found' || classified.type === 'forbidden') {
        stopPolling();
      }
    });

  return () => {
    cancelled = true;
    stopPolling();
    cancelPendingSave();  // T2.3
  };
}, [dispatch, accessToken]);
```

**Note:** `cancelPendingSave` (T2.3) must be implemented atomically with this fix.

**Tests:**
- Unit: mock loadFromSheet to resolve after delay, verify dispatch NOT called after cleanup
- Unit: verify `startPolling` is NOT called before `loadFromSheet` resolves

### T1.3 — Scoped isLocalUpdate per Y.Doc

**Current behavior:** Module-level `let isLocalUpdate = false` singleton in `yjsBinding.ts`.
If two Y.Doc instances exist simultaneously (effect cleanup/reconnect, React StrictMode),
one doc's flag suppresses the other doc's observer.

**Fix:** Replace singleton with `WeakSet<Y.Doc>`. Entries are added before local writes
and deleted after. `WeakSet` = automatic GC when doc is destroyed. Yjs transactions are
synchronous, so the try/finally pattern guarantees cleanup (no async escape).

**IMPORTANT:** ALL handlers must be migrated, not just `applyTasksToYjs`. There are 10+
handlers in `applyActionToYjs` that set `isLocalUpdate = true`:
- MOVE_TASK, RESIZE_TASK, UPDATE_TASK_FIELD, SET_CONSTRAINT, TOGGLE_EXPAND,
  HIDE_TASK, SHOW_ALL_TASKS, CASCADE_DEPENDENTS, COMPLETE_DRAG, ADD/UPDATE/REMOVE_DEPENDENCY

Each must be updated to use `localUpdateDocs.add(doc)` / `localUpdateDocs.delete(doc)`.
Best approach: extract a helper:

```typescript
const localUpdateDocs = new WeakSet<Y.Doc>();

function withLocalUpdate<T>(doc: Y.Doc, fn: () => T): T {
  localUpdateDocs.add(doc);
  try {
    return fn();
  } finally {
    localUpdateDocs.delete(doc);
  }
}

// Usage in every handler:
export function applyActionToYjs(doc: Y.Doc, action: GanttAction): void {
  switch (action.type) {
    case 'MOVE_TASK':
      withLocalUpdate(doc, () => { /* ... */ });
      break;
    // ...
  }
}

export function applyTasksToYjs(doc: Y.Doc, tasks: Task[]): void {
  withLocalUpdate(doc, () => { /* ... */ });
}

export function bindYjsToDispatch(doc: Y.Doc, dispatch: Dispatch<GanttAction>) {
  const observer = () => {
    if (localUpdateDocs.has(doc)) return;  // skip local echo
    // ... dispatch SET_TASKS
  };
  // ...
}
```

**Tests:**
- Unit: two Y.Doc instances, apply tasks to doc A, verify doc B's observer fires
- Unit: call MOVE_TASK on doc A, verify doc B's observer fires (not suppressed)

### T2.1 — Hash persisted fields only, order-independent

**Current behavior:** `hashTasks` hashes 12 of 24 Task fields. Missing 8 persisted fields
(`workStream`, `project`, `functionalArea`, `description`, `notes`, `okrs`, `isMilestone`,
`isSummary`) — changes to these are silently lost. Hash is also order-sensitive.

**IMPORTANT:** Must NOT include `isExpanded` or `isHidden` — these are UI-only fields
that `sheetsMapper.ts` hardcodes to `isExpanded: true, isHidden: false` on every read.
Including them would cause permanent hash mismatch on every poll (local user may have
collapsed a row → `isExpanded: false`, but poll always reads `true`).

**Fix:** Hash the exact set of fields persisted to the sheet (the 20 `SHEET_COLUMNS`),
sorted by ID for order-independence.

```typescript
function hashTasks(tasks: Task[]): string {
  // Sort by ID for order-independence
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  // Hash only the 20 fields that round-trip through the sheet
  return JSON.stringify(sorted.map(t => ({
    id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate,
    duration: t.duration, owner: t.owner, workStream: t.workStream,
    project: t.project, functionalArea: t.functionalArea, done: t.done,
    description: t.description, isMilestone: t.isMilestone, isSummary: t.isSummary,
    parentId: t.parentId, childIds: t.childIds, dependencies: t.dependencies,
    notes: t.notes, okrs: t.okrs, constraintType: t.constraintType,
    constraintDate: t.constraintDate,
  })));
}
```

**Performance:** For 500 tasks × ~400 bytes/task = ~200KB stringify. V8's `JSON.stringify`
handles this in <1ms. Same O(N) as current hash, just more bytes. Acceptable.

**Tests:**
- Unit: verify hash changes when `description` is modified (currently doesn't)
- Unit: verify hash is stable across different array orderings of same tasks
- Unit: verify hash does NOT change when `isExpanded` changes

### T2.2 — Save-dirty + save-in-flight poll guard

**Current behavior:** `pollOnce` and `scheduleSave` can run concurrently. If a poll reads
stale data after a save is scheduled but before it completes, `MERGE_EXTERNAL_TASKS`
reintroduces the pre-save state.

**Gap in original plan:** A simple `saveInFlight` flag only covers the ~500ms API call
window. The 2000ms debounce window is unprotected — a poll can read stale data while
the debounce timer is ticking.

**Fix:** Track both "dirty" (debounce pending) and "in-flight" (API call active).

```typescript
let saveDirty = false;    // set when scheduleSave is called, cleared after write+clear
let saveInFlight = false; // set during actual API call

export function scheduleSave(tasks: Task[]): void {
  if (!currentSpreadsheetId || !isSignedIn()) return;
  const newHash = hashTasks(tasks);
  if (newHash === lastWriteHash) return;

  saveDirty = true;  // Mark dirty immediately
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    saveInFlight = true;
    try {
      // ... updateSheet + clearSheet ...
      lastWriteHash = hashTasks(tasks);
    } finally {
      saveInFlight = false;
      saveDirty = false;
    }
  }, WRITE_DEBOUNCE_MS);
}

async function pollOnce(): Promise<void> {
  // Skip poll when save is pending or in-flight
  if (saveDirty || saveInFlight) {
    schedulePoll();
    return;
  }
  // ... existing poll logic ...
}
```

**Tests:**
- Unit: verify pollOnce reschedules when `saveDirty` is true (debounce pending)
- Unit: verify pollOnce reschedules when `saveInFlight` is true (API call active)
- Unit: verify `saveDirty` and `saveInFlight` reset to false even when updateSheet throws

### T2.3 — cancelPendingSave on cleanup

**Fix:** Export `cancelPendingSave()` and call in effect cleanup (T1.2).

```typescript
export function cancelPendingSave(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  saveDirty = false;  // Also clear dirty flag (T2.2)
}
```

**Tests:**
- Unit: verify cancelPendingSave clears timer and resets saveDirty

### T2.4 — Skip auto-save for Yjs- and poll-originated task updates

**Current behavior:** When a remote Yjs change arrives, `bindYjsToDispatch` dispatches
`SET_TASKS`. This triggers the auto-save effect, which writes back to Sheets — even though
the originating client already saved. Same issue with `MERGE_EXTERNAL_TASKS` from polling.

**IMPORTANT:** The original plan used `queueMicrotask` to reset a ref — this is WRONG.
React 18 effects run after the commit phase (a macrotask). Microtasks drain before
macrotasks, so the ref would already be reset by the time the auto-save effect reads it.

**Fix:** Use reducer state, not a ref. Add `lastTaskSource` to GanttState. The reducer
sets it on task-modifying actions. The auto-save effect reads it from state.

```typescript
// In types/index.ts:
export type TaskUpdateSource = 'local' | 'yjs' | 'sheets';

// Add to GanttState (optional — avoids breaking existing makeState helpers):
lastTaskSource?: TaskUpdateSource;

// In initialState.ts:
lastTaskSource: 'local',

// In actions.ts — extend SET_TASKS:
| { type: 'SET_TASKS'; tasks: Task[]; source?: TaskUpdateSource }
| { type: 'MERGE_EXTERNAL_TASKS'; externalTasks: Task[] }  // source always 'sheets'

// In ganttReducer.ts:
case 'SET_TASKS':
  return { ...state, tasks: action.tasks, lastTaskSource: action.source || 'local' };
case 'MERGE_EXTERNAL_TASKS':
  return { ...state, tasks: merged, lastTaskSource: 'sheets' };

// In postProcess — reset to 'local' for task-modifying actions:
if (TASK_MODIFYING_ACTIONS.has(action.type) && action.type !== 'SET_TASKS') {
  newState = { ...newState, lastTaskSource: 'local' };
}

// In GanttContext.tsx auto-save effect — do NOT add lastTaskSource to deps:
useEffect(() => {
  if (state.dataSource !== 'sheet') return;
  if (state.lastTaskSource !== 'local') return;  // skip Yjs and poll echoes
  // ... scheduleSave ...
}, [state.tasks, state.dataSource]);
// NOTE: lastTaskSource intentionally NOT in deps — it changes on TOGGLE_EXPAND
// etc. without a tasks change, which would cause spurious saves.
```

**IMPORTANT — SET_TASKS callsites that need `source`:**

| File | Callsite | Required `source` |
|---|---|---|
| `src/collab/yjsBinding.ts:115` | Yjs observer dispatch | `'yjs'` |
| `src/state/GanttContext.tsx:138` | Initial `loadFromSheet` | `'sheets'` |
| `src/components/onboarding/ErrorBanner.tsx:39` | Retry load | `'sheets'` |
| `src/sheets/sheetCreation.ts:74` | New project creation | omit (defaults to `'local'`) |
| `src/state/GanttContext.tsx:92` | Drag guard re-dispatch | inherits; stripped to undefined = `'local'` ✓ |

**Coordination with T1.3:** When implementing T1.3 (`bindYjsToDispatch` WeakSet change),
the same observer must also be updated to pass `source: 'yjs'` in the SET_TASKS dispatch.
These changes should be applied atomically.

This is fully deterministic — no timing dependency, no ref, no microtask.
The reducer produces the source as part of the state transition, and the effect
reads it in the same render cycle.

**Tests:**
- Unit: verify reducer sets `lastTaskSource: 'yjs'` for SET_TASKS with source='yjs'
- Unit: verify reducer sets `lastTaskSource: 'sheets'` for MERGE_EXTERNAL_TASKS
- Unit: verify reducer sets `lastTaskSource: 'local'` for MOVE_TASK and other actions
- Unit: verify postProcess resets to 'local' for TASK_MODIFYING_ACTIONS
- Integration: verify auto-save does NOT call scheduleSave when lastTaskSource is 'yjs'
- Verify: changing lastTaskSource without changing tasks does NOT fire auto-save

### T2.5 — E2E signInOnPage: state assertion instead of timeout

**Fix:**
```typescript
export async function signInOnPage(page: Page): Promise<void> {
  await ensureClientId(page);
  const collabBtn = page.getByTestId('collaborator-sign-in-button');
  const firstVisitBtn = page.getByTestId('sign-in-button');

  if (await collabBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await collabBtn.click();
  } else if (await firstVisitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstVisitBtn.click();
  }

  // Wait for sign-in to complete by asserting buttons disappear
  await page.waitForFunction(() =>
    !document.querySelector('[data-testid="sign-in-button"]') &&
    !document.querySelector('[data-testid="collaborator-sign-in-button"]')
  , { timeout: 10_000 });
}
```

## Skill / Documentation Updates

### google-sheets-sync SKILL.md

1. **Fix write range**: `Sheet1!A1:R{rowCount}` → `Sheet1!A1:T{rowCount}` (20 columns, not 18)
2. **Fix constant name**: `POLL_INTERVAL_MS` → `BASE_POLL_INTERVAL_MS`
3. **Fix gotcha #4**: field count from "10" to "RESOLVED — hash now covers all 20 persisted fields"
4. **Add data mapping indices 18-19**: constraintType, constraintDate
5. **Add sync mechanism details**: write+clear pattern, saveDirty/saveInFlight guards
6. **Add gotcha #8**: MERGE_EXTERNAL_TASKS always keeps local version of existing tasks —
   external edits to existing tasks are silently discarded. This is a known limitation.
7. **Document polling backoff**: 30s base → doubles after 3 errors → max 300s

### e2e-testing SKILL.md

Add new sections:
- **Mock Auth Pattern**: `setupMockAuth` + `ensureClientId` + `signInOnPage`
- **Cloud Auth Pattern**: SA key exchange via `cloud-auth.ts` + `gisInitScript`
- **GIS Library Handling**: Why `context.route('**/accounts.google.com/**')` is needed
- **Test Sheet Maintenance**: TEST_SHEET_ID_DEV needs valid headers, clean data (no dupes)
- **WebSocket in Docker**: localhost may not resolve for WS; use 127.0.0.1 normalize pattern

### src/sheets/CLAUDE.md

Add constraints:
- **Saves must be total**: Every save clears orphaned rows below the data range
- **Poll skips during save**: saveDirty/saveInFlight guards prevent stale reads

### src/CLAUDE.md

Add constraint:
- **Effects must be cancellable**: Any useEffect starting an async operation must use a
  `cancelled` flag and check before dispatching

## Test Plan

### Unit Tests (new)

| Test | File | What it verifies |
|---|---|---|
| scheduleSave calls clearSheet after write | `sheets/__tests__/sheetsSync.test.ts` | T1.1 |
| scheduleSave succeeds when clearSheet fails | `sheets/__tests__/sheetsSync.test.ts` | T1.1 |
| hashTasks changes on description edit | `sheets/__tests__/sheetsSync.test.ts` | T2.1 |
| hashTasks stable across orderings | `sheets/__tests__/sheetsSync.test.ts` | T2.1 |
| hashTasks unchanged when isExpanded changes | `sheets/__tests__/sheetsSync.test.ts` | T2.1 |
| pollOnce skips when saveDirty | `sheets/__tests__/sheetsSync.test.ts` | T2.2 |
| pollOnce skips when saveInFlight | `sheets/__tests__/sheetsSync.test.ts` | T2.2 |
| saveDirty/saveInFlight reset on error | `sheets/__tests__/sheetsSync.test.ts` | T2.2 |
| cancelPendingSave clears timer + dirty flag | `sheets/__tests__/sheetsSync.test.ts` | T2.3 |
| isLocalUpdate scoped per doc (applyTasksToYjs) | `collab/__tests__/yjsBinding.test.ts` | T1.3 |
| isLocalUpdate scoped per doc (MOVE_TASK) | `collab/__tests__/yjsBinding.test.ts` | T1.3 |
| lastTaskSource set to 'yjs' for SET_TASKS | `state/__tests__/dataSource.test.ts` | T2.4 |
| lastTaskSource set to 'sheets' for MERGE | `state/__tests__/dataSource.test.ts` | T2.4 |
| lastTaskSource set to 'local' for edits | `state/__tests__/dataSource.test.ts` | T2.4 |

### E2E Tests (new or updated)

| Test | File | What it verifies |
|---|---|---|
| deleted task doesn't reappear after poll | `e2e/onboarding-cloud.spec.ts` | T1.1 |
| signInOnPage uses state assertion | `e2e/helpers/mock-auth.ts` | T2.5 |

### Existing Tests (verify still pass)

- All 433 unit tests
- All 35 E2E tests (including 5 collab + 7 cloud-auth)

## Implementation Order

### Remaining implementation (7 steps)

Items already done (from code review rounds) are listed in "Already Implemented" above.
The following items are NOT yet implemented:

1. **T2.3** (cancelPendingSave) — prerequisite for T1.2
2. **T1.1** (clear orphaned rows) — most critical data integrity fix
3. **T2.1** (total hash) — closely related, fixes the hash gap that compounds T1.1
4. **T2.2** (saveDirty + saveInFlight guard) — prevents poll from undoing save.
   Note: pollOnce success already clears syncError (done in round 3).
5. **T1.2** (cancellable effect + startPolling in .then) — uses T2.3's cancelPendingSave
6. **T1.3 + T2.4** (scoped isLocalUpdate + lastTaskSource) — implement TOGETHER because
   both touch `bindYjsToDispatch`: T1.3 changes the observer guard to WeakSet,
   T2.4 adds `source: 'yjs'` to the dispatch. Also update all SET_TASKS callsites,
   add lastTaskSource to GanttState/initialState, add postProcess reset.
   Note: REPARENT_TASK is already in TASK_MODIFYING_ACTIONS (done in round 3) —
   no need to add it during T2.4 postProcess implementation.
7. **T2.5** (E2E timeout fix) — independent, quick
8. **Skill/doc updates** — after all code changes, update SKILL.md files

Each fix is self-contained and testable independently. Commit after each with
conventional commit prefix (`fix:` for T1, `fix:` for T2, `docs:` for skills).

## Risks

- **T1.1**: Extra `clearSheet` API call adds ~200ms to saves. Mitigated: pass maxAttempts=1
  to avoid retry stalling. Fire-and-forget on failure — orphans persist until next save.
- **T2.1**: Full hash is heavier (~200KB for 500 tasks vs ~75KB before). Still <1ms for
  JSON.stringify on V8. Acceptable.
- **T2.2**: `saveDirty` flag is module-level singleton. Acceptable given single-sheet
  architecture constraint. If multi-sheet support is added, this needs refactoring.
- **T2.4**: Adding `lastTaskSource` to GanttState increases state size by one string field.
  Negligible. The reducer approach is fully deterministic — no timing sensitivity.
