---
phase: 20
group: F
stage: 4
agent_count: 1
scope:
  create:
    - src/sheets/SheetsAdapter.ts
    - src/sheets/__tests__/SheetsAdapter.test.ts
    - src/components/onboarding/ConflictResolutionModal.tsx
  modify:
    - src/state/TaskStoreProvider.tsx
    - src/store/UIStore.ts
    - src/types/index.ts
    - src/sheets/sheetsMapper.ts
    - src/sheets/sheetsClient.ts
  delete:
    - src/sheets/sheetsSync.ts
    - src/sheets/__tests__/sheetsSync.test.ts
    - src/sheets/__tests__/syncErrorRecovery.test.ts
    - src/sheets/__tests__/pollingBackoff.test.ts
  read_only:
    - src/schema/ydoc.ts
    - src/store/TaskStore.ts
    - src/collab/observer.ts
    - docs/plans/frontend-redesign.md
depends_on: [A, B, C, D, E]
tasks:
  - id: F1
    summary: "Read architecture spec §7 (Sheets Adapter) and current sheetsSync.ts"
  - id: F2
    summary: "Create SheetsAdapter class: bidirectional Y.Doc ↔ Sheets, debounced write, polling"
  - id: F3
    summary: "Implement three-way merge: base values in IndexedDB, conflict detection"
  - id: F4
    summary: "Add lastModifiedBy + lastModifiedAt columns to Sheet schema (sheetsMapper)"
  - id: F5
    summary: "Create ConflictResolutionModal: show local vs external values, resolve per-field"
  - id: F6
    summary: "Wire SheetsAdapter into TaskStoreProvider (init on sheet mode, cleanup on disconnect)"
  - id: F7
    summary: "Add syncError, isSyncing, syncComplete to UIStore (replace stubs from Phase 1)"
  - id: F8
    summary: "Un-skip the 2 E2E error-state tests (HeaderMismatch, ErrorBanner)"
  - id: F9
    summary: "Delete old sheetsSync.ts and its tests. Write SheetsAdapter tests."
---

# Phase 20 Group F — Sheets Adapter

You are implementing the bidirectional Google Sheets sync layer.
Read `docs/plans/frontend-redesign.md` sections 7 (Sheets Adapter + Conflict Resolution).

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

Stages 1-3 built the new state architecture (Y.Doc, stores, mutations, components).
This group adds Sheets persistence: reading from and writing to Google Sheets,
three-way merge conflict resolution, and attribution columns.

## Key Requirements

### SheetsAdapter class (src/sheets/SheetsAdapter.ts)

Replaces the module-level state in `sheetsSync.ts`. Encapsulated, testable, multi-instance.

```typescript
class SheetsAdapter {
  constructor(
    doc: Y.Doc,
    spreadsheetId: string,
    onConflict: (conflicts: ConflictRecord[]) => void,
    getToken: () => string,
  )

  start(): void          // begin polling + observe Y.Doc for writes
  stop(): void           // cleanup timers, observers
  isSavePending(): boolean
}
```

**Also recreate these GanttContext effects (lost when GanttContext was deleted in Stage 3):**

- **Online/offline detection:** Listen to `window.addEventListener('online'/'offline')`.
  On offline: set `syncError` to network error via UIStore. On online: trigger immediate
  save via SheetsAdapter. This restores the "You are offline" banner.

- **Auth token refresh:** Listen for OAuth token changes (via the existing `setAuthChangeCallback`
  pattern in `oauth.ts`). When token refreshes, reconnect the Yjs WebSocket provider and
  restart SheetsAdapter polling. Without this, an expired token causes silent sync failure.

**Write path:** Observe Y.Doc changes → debounce 2s → write dirty rows to Sheets
(using user's OAuth token). Include `lastModifiedBy` + `lastModifiedAt` per row.
Only clear saveDirty on SUCCESS (fix the current bug).

**Read path:** Poll Sheets every 30s → three-way merge per row → inject external
changes into Y.Doc with `'sheets'` origin (not undoable, no cascade).

**Three-way merge (per row):**
```
sheet_value vs base_value vs ydoc_value:
  sheet == base → no external edit → write ydoc to Sheet
  ydoc == base → no local edit → inject sheet into Y.Doc
  all differ → CONFLICT → call onConflict()
  no base (first sync) → write ydoc to Sheet, record as base
```

**Base values:** Store in IndexedDB (`ganttlet-sync-base-{sheetId}`). Key = taskId,
value = hash of row at last successful sync. Written after every successful write.

### ConflictResolutionModal

Shows when `pendingConflicts` is set on UIStore. For each conflicting row:
- Local value vs external value vs base value
- "Keep mine" / "Accept external" / field-by-field merge
- Resolution writes to Y.Doc → triggers SheetsAdapter write

### Attribution columns

Add `lastModifiedBy` and `lastModifiedAt` to SHEET_COLUMNS in sheetsMapper.
Position: columns 21-22 (after constraintDate). Write on every save. Read but
don't use for logic (informational only).

## Verification

1. `npx tsc --noEmit`
2. `npx vitest run src/sheets/` — SheetsAdapter tests pass
3. `npx playwright test` — all 29 E2E tests pass (un-skip error-state tests)
4. Commit with conventional commit message
