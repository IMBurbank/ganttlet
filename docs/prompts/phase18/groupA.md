---
phase: 18
group: A
stage: 1
agent_count: 1
scope:
  modify:
    - src/types/index.ts
    - src/state/actions.ts
    - src/state/ganttReducer.ts
    - src/state/GanttContext.tsx
    - src/data/fakeData.ts
    - src/sheets/sheetsSync.ts
    - src/sheets/sheetsMapper.ts
    - src/App.tsx
  create:
    - src/data/defaultColumns.ts
    - src/data/templates/softwareRelease.ts
    - src/sheets/syncErrors.ts
    - src/components/onboarding/WelcomeGate.tsx
  test:
    - src/state/__tests__/dataSource.test.ts
    - src/sheets/__tests__/syncErrors.test.ts
    - src/sheets/__tests__/headerValidation.test.ts
    - src/components/onboarding/__tests__/WelcomeGate.test.tsx
  read_only:
    - src/sheets/sheetsClient.ts
    - src/sheets/oauth.ts
depends_on: []
tasks:
  - id: A1
    summary: "Read types.ts, actions.ts, ganttReducer.ts, GanttContext.tsx, fakeData.ts — understand current state model"
  - id: A2
    summary: "Add DataSource, SyncError types to types/index.ts; add dataSource, syncError, sandboxDirty to GanttState"
  - id: A3
    summary: "Add SET_DATA_SOURCE, SET_SYNC_ERROR, ENTER_SANDBOX, RESET_STATE actions; move TASK_MODIFYING_ACTIONS"
  - id: A4
    summary: "Add 4 reducer cases + sandboxDirty + empty→sheet auto-transition"
  - id: A5
    summary: "Move fakeData → templates/softwareRelease; create defaultColumns"
  - id: A6
    summary: "Create syncErrors.ts + add validateHeaders to sheetsMapper"
  - id: A7
    summary: "Update GanttContext: empty initialState, dataSource gating, sheet-loading orchestration, beforeunload"
  - id: A8
    summary: "Change loadFromSheet to throw; export stopPolling"
  - id: A9
    summary: "Create WelcomeGate.tsx routing shell; wrap AppContent in App.tsx"
  - id: A10
    summary: "Update makeState() in existing reducer tests"
---

# Phase 18 Group A — State Machine + WelcomeGate + Fake Data Decoupling

You are implementing Phase 18 Group A for the Ganttlet project.
Read `CLAUDE.md` for full project context. Read `docs/proposals/designs/design-1.md` for the
detailed design specification.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart with real-time Google Sheets sync. The scheduling
engine runs as Rust→WASM in the browser. Real-time sync via Yjs/Yrs CRDTs.

## Your files (ONLY modify these):
- `src/types/index.ts` — Add DataSource, SyncError types to GanttState
- `src/state/actions.ts` — Add new actions, move TASK_MODIFYING_ACTIONS here
- `src/state/ganttReducer.ts` — Add 4 action cases + post-processing
- `src/state/GanttContext.tsx` — Empty initialState, dataSource gating, sheet-loading orchestration
- `src/data/fakeData.ts` — Move to templates/softwareRelease.ts (delete original)
- `src/sheets/sheetsSync.ts` — loadFromSheet throws on HTTP errors, export stopPolling
- `src/sheets/sheetsMapper.ts` — Add validateHeaders function
- `src/App.tsx` — Wrap AppContent with WelcomeGate

Create these new files:
- `src/data/defaultColumns.ts` — Extract defaultColumns from fakeData
- `src/data/templates/softwareRelease.ts` — Moved fakeData (lazy-importable)
- `src/sheets/syncErrors.ts` — classifySyncError function
- `src/components/onboarding/WelcomeGate.tsx` — Routing shell component

Read-only (understand but do NOT modify):
- `src/sheets/sheetsClient.ts` — Understand retry/throw pattern
- `src/sheets/oauth.ts` — Understand getAccessToken/isSignedIn

## Tasks — execute in order

### A1: Read and understand current state model
Read all files in scope. Understand: how GanttState is structured, how actions flow through
the reducer, how GanttContext orchestrates sheets sync/auto-save/Yjs, how fakeData is loaded,
how loadFromSheet works (catches errors, returns []).

### A2: Add DataSource, SyncError types to GanttState
In `src/types/index.ts`:
```typescript
export type DataSource = 'sandbox' | 'loading' | 'sheet' | 'empty';

export interface SyncError {
  type: 'auth' | 'not_found' | 'forbidden' | 'rate_limit' | 'network' | 'header_mismatch';
  message: string;
  since: number;
}
```
Add to GanttState: `dataSource: DataSource | undefined`, `syncError: SyncError | null`,
`sandboxDirty: boolean`.

### A3: Add actions and move TASK_MODIFYING_ACTIONS
In `src/state/actions.ts`, add 4 new action types:
- `SET_DATA_SOURCE` with `dataSource: DataSource`
- `SET_SYNC_ERROR` with `error: SyncError | null`
- `ENTER_SANDBOX` with `tasks: Task[]` and `changeHistory: ChangeRecord[]`
- `RESET_STATE` (no payload)

Move `TASK_MODIFYING_ACTIONS` from GanttContext.tsx to actions.ts as an exported constant.
Update GanttContext.tsx import.

### A4: Add reducer cases
In `src/state/ganttReducer.ts`:
- `SET_DATA_SOURCE` → `{ ...state, dataSource, sandboxDirty: false }`
- `SET_SYNC_ERROR` → `{ ...state, syncError }`
- `ENTER_SANDBOX` → `{ ...state, dataSource: 'sandbox', tasks, changeHistory }`
- `RESET_STATE` → `{ ...initialState }`
- Post-processing: if `state.dataSource === 'sandbox'` and action in TASK_MODIFYING_ACTIONS → `sandboxDirty: true`
- Post-processing: if `state.dataSource === 'empty'` and action in TASK_MODIFYING_ACTIONS → `dataSource: 'sheet'`

Write unit tests in `src/state/__tests__/dataSource.test.ts`:
- Test each action case
- Test sandboxDirty tracking (set on edit, reset on SET_DATA_SOURCE)
- Test empty→sheet auto-transition on task-modifying action

### A5: Move fakeData to templates
- Create `src/data/templates/` directory
- Move `src/data/fakeData.ts` → `src/data/templates/softwareRelease.ts`
- Extract `defaultColumns` to `src/data/defaultColumns.ts`
- Update ALL imports throughout the codebase (GanttContext.tsx imports defaultColumns from new path)
- softwareRelease.ts must NOT be imported at app startup — only lazily via ENTER_SANDBOX

### A6: Create syncErrors.ts and validateHeaders
Create `src/sheets/syncErrors.ts`:
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

Add `validateHeaders` to `src/sheets/sheetsMapper.ts`:
- Case-insensitive, order-sensitive comparison against SHEET_COLUMNS
- All 20 required; extra columns after T ignored
- `if (headerRow.length < SHEET_COLUMNS.length) return false`

Write unit tests for both.

### A7: Update GanttContext
This is the biggest task. Changes to `src/state/GanttContext.tsx`:

**initialState:** `tasks: [], changeHistory: [], dataSource: undefined, syncError: null, sandboxDirty: false`

**Sheets sync useEffect (lines 131-147):**
- Only runs when `?sheet=` in URL AND user is signed in (has access token)
- Sets `dataSource='loading'` via dispatch
- Calls `loadFromSheet()`. On success with data → dispatch `SET_DATA_SOURCE('sheet')`.
  On success with [] → dispatch `SET_DATA_SOURCE('empty')`.
  On throw → dispatch `SET_SYNC_ERROR(classifySyncError(err))`, dataSource stays 'loading'.
- If row 1 is empty → skip validateHeaders, treat as `dataSource='empty'`
- On success, call `addRecentSheet()` (import from `src/utils/recentSheets.ts` — this file
  won't exist until Group B creates it in Stage 2. Add a TODO comment with the import and
  call site; Group B or the merge-fix agent will wire it. Do NOT add a broken import.)

**Auto-save useEffect (lines 150-155):** Add guard: `if (state.dataSource !== 'sheet') return;`

**Yjs useEffect (lines 158-209):** Add guard: `if (state.dataSource !== 'sheet') return;`
Keep existing `?room=` and token checks. Remove `fakeTasks` fallback. Add `state.dataSource`
to dependency array.

**collabDispatch (lines 118-128):** Add guard after `dispatch(action)` but before Yjs sync:
`if (stateRef.current.dataSource !== 'sheet') return;`

**New beforeunload useEffect:** Register `beforeunload` when `dataSource === 'sandbox'`
and `sandboxDirty === true`. Clean up when conditions change.

### A8: Change loadFromSheet and export stopPolling
In `src/sheets/sheetsSync.ts`:
- `loadFromSheet()`: Remove the try/catch that returns `[]`. Let errors propagate (throw).
  Also remove the early-return `[]` for unauthenticated state — caller checks auth.
  Add `validateHeaders(headerRow)` call after reading sheet data but before parsing tasks
  (import from `sheetsMapper.ts`). If row 1 is empty, skip validation and return `[]`.
  If validation fails, throw with a recognizable error so GanttContext can set
  `syncError.type = 'header_mismatch'`.
- Export `stopPolling()` as a named export (currently module-private). This clears the
  poll timer for disconnect and error flows.

### A9: Create WelcomeGate routing shell
Create `src/components/onboarding/WelcomeGate.tsx`:
```
if dataSource is defined → render children (GanttApp)
if dataSource is undefined:
  if URL has ?sheet= or ?room= → render nothing (GanttContext useEffect handles loading)
  else → render placeholder: "Try the demo" button → lazy import templates, dispatch ENTER_SANDBOX
```
This is a placeholder — Design 3 (Group D, Stage 3) will replace the routing with real screens.

In `src/App.tsx`: Wrap `AppContent` with `<WelcomeGate>` inside `GanttProvider`.

Write component test in `src/components/onboarding/__tests__/WelcomeGate.test.tsx`.

### A10: Update existing reducer tests
Update `makeState()` helper in `src/state/__tests__/ganttReducer.test.ts` to include new
GanttState fields: `dataSource: 'sheet', syncError: null, sandboxDirty: false`.
Run all tests, fix any failures.

## Error Handling
- NEVER compute dates mentally — use `taskEndDate`/`taskDuration` shell functions
- If a task fails after 3 approaches, commit WIP and move to the next task
- Commit after each logical change with conventional commits (feat:, fix:, refactor:, test:)

## Success Criteria (you're done when ALL of these are true):
1. `DataSource` and `SyncError` types added to GanttState
2. 4 new actions defined, TASK_MODIFYING_ACTIONS moved to actions.ts
3. Reducer handles all 4 actions + sandboxDirty + empty→sheet transition
4. fakeData.ts moved to templates/softwareRelease.ts, defaultColumns extracted
5. syncErrors.ts classifies all HTTP status codes correctly
6. validateHeaders checks 20 columns case-insensitively with empty-row bypass
7. GanttContext: empty initialState, dataSource gating on auto-save/Yjs/collabDispatch
8. loadFromSheet throws on errors, stopPolling exported
9. WelcomeGate routing shell works, App.tsx wraps with it
10. All existing tests pass, new tests pass
11. All changes committed
