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
| T2.1 | hashTasks covers ALL 20 task fields, order-independent | `sheetsSync.ts` |
| T2.2 | Poll skips when save is in-flight — no stale-read reintroduction | `sheetsSync.ts` |
| T2.3 | writeTimer cleared on effect cleanup — no fire-and-forget saves | `sheetsSync.ts`, `GanttContext.tsx` |
| T2.4 | Auto-save skips Yjs-originated SET_TASKS — no write-back echo | `GanttContext.tsx` |
| T2.5 | E2E signInOnPage uses state assertion, not waitForTimeout | `e2e/helpers/mock-auth.ts` |

### Tier 3 — Scale (deferred)

| ID | Requirement | File |
|---|---|---|
| T3.1 | Auto-save skips during active drag (skip hashTasks O(N) on animation frames) | `GanttContext.tsx` |
| T3.2 | User notified on save failure (SET_SYNC_ERROR, not silent RESET_SYNC) | `sheetsSync.ts` |
| T3.3 | Atomic SET_TASKS + SET_DATA_SOURCE dispatch (single action, no intermediate render) | `actions.ts`, `ganttReducer.ts` |

## Design

### T1.1 — Clear orphaned rows on save

**Current behavior:** `scheduleSave` writes `Sheet1!A1:T{N+1}` (bounded range). Rows below
`N+1` from a previous larger write persist. Polling reads entire `Sheet1`, reintroduces
orphaned rows, triggers another save — positive feedback loop.

**Fix:** After `updateSheet`, call `clearSheet` on `Sheet1!A{N+2}:T`. Write-first ordering
is safe: if clear fails, orphans persist but new data is intact. Next save retries the clear.

```typescript
// In scheduleSave, after updateSheet:
const endCol = columnLetter(SHEET_COLUMNS.length);
const dataEndRow = rows.length;  // header + tasks
const clearRange = `Sheet1!A${dataEndRow + 1}:${endCol}`;
await clearSheet(currentSpreadsheetId!, clearRange).catch(() => {
  // Clear failure is non-fatal — orphans persist until next save
  console.warn('Failed to clear orphaned rows');
});
```

**Cost:** One extra API call per debounced save (2s debounce). Negligible.

**Tests:**
- Unit: mock `clearSheet`, verify it's called with correct range after `updateSheet`
- Unit: verify save succeeds even if clearSheet throws
- E2E: load sheet, delete a task, verify deleted task doesn't reappear on next poll

### T1.2 — Cancellable loadFromSheet effect

**Current behavior:** `loadFromSheet()` starts as fire-and-forget in a useEffect. If the
user navigates away or the effect re-runs (token refresh), the `.then()` dispatches
against a potentially stale or unmounted component.

**Fix:** Standard React cancellation pattern.

```typescript
useEffect(() => {
  let cancelled = false;
  // ... setup ...
  loadFromSheet()
    .then((tasks) => {
      if (cancelled) return;
      // ... dispatch ...
    })
    .catch((err) => {
      if (cancelled) return;
      // ... dispatch error ...
    });
  startPolling();
  return () => {
    cancelled = true;
    stopPolling();
    cancelPendingSave();
  };
}, [dispatch, accessToken]);
```

**Tests:**
- Unit: mock loadFromSheet to resolve after a delay, verify dispatch is NOT called
  when the effect cleanup runs before the promise resolves

### T1.3 — Scoped isLocalUpdate per Y.Doc

**Current behavior:** Module-level `let isLocalUpdate = false` singleton. If two Y.Doc
instances exist simultaneously (effect cleanup/reconnect race, React StrictMode),
one doc's flag suppresses the other doc's observer.

**Fix:** Replace singleton with `WeakSet<Y.Doc>`. Entries are added before local writes
and deleted after. `WeakSet` = automatic GC when doc is destroyed.

```typescript
const localUpdateDocs = new WeakSet<Y.Doc>();

export function applyTasksToYjs(doc: Y.Doc, tasks: Task[]): void {
  localUpdateDocs.add(doc);
  try {
    // ... write to Yjs ...
  } finally {
    localUpdateDocs.delete(doc);
  }
}

export function bindYjsToDispatch(doc: Y.Doc, dispatch: Dispatch<GanttAction>) {
  const observer = () => {
    if (localUpdateDocs.has(doc)) return;  // skip local echo
    // ... dispatch SET_TASKS ...
  };
  // ...
}
```

**Tests:**
- Unit: create two Y.Doc instances, apply tasks to doc A, verify doc B's observer
  still fires (not suppressed by doc A's flag)

### T2.1 — Total hash via sorted full-field stringify

**Current behavior:** `hashTasks` hashes 10 of 20 fields. Changes to `workStream`,
`project`, `functionalArea`, `description`, `notes`, `okrs`, `isMilestone`, `isSummary`
are silently lost. Hash is also order-sensitive.

**Fix:** Hash ALL fields, sorted by ID for order-independence.

```typescript
function hashTasks(tasks: Task[]): string {
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(sorted);
}
```

This includes every field on the Task type. If a field changes, the hash changes,
a save triggers. Same O(N) complexity, just more bytes per task in the stringify.

**Tests:**
- Unit: verify hash changes when `description` is modified (currently doesn't)
- Unit: verify hash is stable across different array orderings of same tasks

### T2.2 — Save-in-flight poll guard

**Current behavior:** `pollOnce` and `scheduleSave` can run concurrently. If a poll reads
stale data after a save starts but before it completes, `MERGE_EXTERNAL_TASKS` reintroduces
the pre-save state (including deleted tasks).

**Fix:** Module-level `saveInFlight` flag.

```typescript
let saveInFlight = false;

// In scheduleSave's debounced callback:
saveInFlight = true;
try {
  await updateSheet(...);
  await clearSheet(...);
  lastWriteHash = ...;
} finally {
  saveInFlight = false;
}

// In pollOnce:
if (saveInFlight) {
  schedulePoll();  // Skip this cycle, try again later
  return;
}
```

**Tests:**
- Unit: verify pollOnce reschedules (doesn't read sheet) when saveInFlight is true
- Unit: verify saveInFlight resets to false even when updateSheet throws

### T2.3 — cancelPendingSave on cleanup

**Current behavior:** `writeTimer` is never cleared when the component unmounts.
A pending debounced save fires after unmount, dispatching against stale state.

**Fix:** Export `cancelPendingSave()` and call it in effect cleanup.

```typescript
export function cancelPendingSave(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}
```

**Tests:**
- Unit: verify cancelPendingSave clears the timer
- Unit: verify no save fires after cancelPendingSave is called

### T2.4 — Skip auto-save for Yjs-originated SET_TASKS

**Current behavior:** When a remote Yjs change arrives, `bindYjsToDispatch` dispatches
`SET_TASKS`. This triggers the auto-save effect, which writes back to Sheets — even though
the originating client already saved. Creates unnecessary API calls and race conditions.

**Fix:** Track the source of the last task update via a ref in GanttProvider.

```typescript
const taskUpdateSourceRef = useRef<'local' | 'yjs' | 'sheets'>('local');

// In bindYjsToDispatch callback (via a wrapper):
taskUpdateSourceRef.current = 'yjs';
guardedDispatch({ type: 'SET_TASKS', tasks });
// Reset after a microtask to allow the auto-save effect to read it
queueMicrotask(() => { taskUpdateSourceRef.current = 'local'; });

// In auto-save effect:
if (taskUpdateSourceRef.current === 'yjs') return;
```

**Tests:**
- Unit: verify auto-save does NOT call scheduleSave when source is 'yjs'
- Unit: verify auto-save DOES call scheduleSave when source is 'local'

### T2.5 — E2E signInOnPage: state assertion instead of timeout

**Current behavior:** `await page.waitForTimeout(1000)` — fixed sleep.

**Fix:**
```typescript
await page.waitForFunction(() =>
  !document.querySelector('[data-testid="sign-in-button"]') &&
  !document.querySelector('[data-testid="collaborator-sign-in-button"]')
, { timeout: 10_000 });
```

**Tests:**
- E2E: existing auth tests validate this implicitly (they'd fail if sign-in didn't complete)

## Skill / Documentation Updates

### google-sheets-sync SKILL.md

Update these sections:
- **Sync Mechanism**: Document write+clear pattern, save-in-flight guard, total hash
- **Gotchas #4**: Mark as RESOLVED (hash now covers all fields)
- Add new gotcha: **Save-in-flight guard** — polls skip while saves are pending
- **Write range**: Update from `Sheet1!A1:R{rowCount}` to `Sheet1!A1:T{rowCount}` + clear

### e2e-testing SKILL.md

Add new sections:
- **Mock Auth Pattern**: Document `setupMockAuth` + `ensureClientId` + `signInOnPage`
- **Cloud Auth Pattern**: Document SA key exchange via `cloud-auth.ts` + `gisInitScript`
- **GIS Library Handling**: Document why `context.route('**/accounts.google.com/**')` is needed
- **Test Sheet Maintenance**: Document that TEST_SHEET_ID_DEV needs valid Ganttlet headers
  and clean data (no duplicate rows)

### src/sheets/CLAUDE.md

Add constraint:
- **Saves must be total**: Every `scheduleSave` must clear orphaned rows below the data range.
  Never write a bounded range without clearing what's below.

### src/CLAUDE.md

Add constraint:
- **Effects must be cancellable**: Any useEffect that starts an async operation must use a
  `cancelled` flag or `AbortController` and check it before dispatching.

## Test Plan

### Unit Tests (new)

| Test | File | What it verifies |
|---|---|---|
| `scheduleSave calls clearSheet after write` | `sheets/__tests__/sheetsSync.test.ts` | T1.1 |
| `scheduleSave succeeds when clearSheet fails` | `sheets/__tests__/sheetsSync.test.ts` | T1.1 |
| `hashTasks changes on description edit` | `sheets/__tests__/sheetsSync.test.ts` | T2.1 |
| `hashTasks is order-independent` | `sheets/__tests__/sheetsSync.test.ts` | T2.1 |
| `pollOnce skips when saveInFlight` | `sheets/__tests__/sheetsSync.test.ts` | T2.2 |
| `saveInFlight resets on error` | `sheets/__tests__/sheetsSync.test.ts` | T2.2 |
| `cancelPendingSave clears timer` | `sheets/__tests__/sheetsSync.test.ts` | T2.3 |
| `isLocalUpdate scoped per doc` | `collab/__tests__/yjsBinding.test.ts` | T1.3 |

### E2E Tests (new or updated)

| Test | File | What it verifies |
|---|---|---|
| `deleted task doesn't reappear after poll` | `e2e/onboarding-cloud.spec.ts` | T1.1 |
| `sign-in uses state assertion not timeout` | `e2e/helpers/mock-auth.ts` | T2.5 |

### Existing Tests (verify still pass)

- All 433 unit tests
- All 35 E2E tests (including 5 collab + 7 cloud-auth)

## Implementation Order

1. T1.1 (clear orphaned rows) — most critical, fixes the duplicate row bug
2. T2.1 (total hash) — closely related, fixes the hash gap that compounds T1.1
3. T2.2 (save-in-flight guard) — prevents poll from undoing save
4. T1.2 (cancellable effect) — independent, straightforward React pattern
5. T1.3 (scoped isLocalUpdate) — independent, straightforward refactor
6. T2.3 (cancelPendingSave) — quick, depends on T1.2 for cleanup wiring
7. T2.4 (skip Yjs auto-save) — depends on understanding bindYjsToDispatch flow
8. T2.5 (E2E timeout fix) — independent, quick

Each fix is self-contained and testable independently. Commit after each with
conventional commit prefix (`fix:` for T1, `fix:` for T2).

## Risks

- **T1.1**: The extra `clearSheet` API call adds latency (~200ms) to every save.
  Mitigated by: saves are already debounced at 2s. 200ms added to a 2s debounce is <10%.
- **T2.1**: Total hash is heavier (more bytes per stringify). For 100 tasks, the hash
  goes from ~5KB to ~15KB. Still sub-millisecond for `JSON.stringify`.
- **T2.4**: The `queueMicrotask` pattern for resetting the source ref is timing-sensitive.
  If React batches the SET_TASKS dispatch with other state changes and the auto-save effect
  fires in the same batch, the ref might already be reset. Mitigation: the auto-save effect
  checks the ref synchronously during the render that follows SET_TASKS — at that point the
  ref is still 'yjs' because queueMicrotask hasn't fired yet.
