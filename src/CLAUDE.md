# Frontend

## State Architecture
- **Y.Doc** is the live session state for all task data — all mutations go through Y.Doc transactions
- **TaskStore** (`src/store/TaskStore.ts`) — O(1) per-task subscriptions from Y.Doc observations
- **UIStore** (`src/store/UIStore.ts`) — per-user display state (zoom, theme, expanded tasks) persisted to localStorage
- **Mutation functions** (`src/mutations/`) — compute-first + atomic `doc.transact()` for all task changes
- **Observer** (`src/collab/observer.ts`) — converts Y.Doc mutations into TaskStore updates
- **TaskStoreProvider** (`src/state/TaskStoreProvider.tsx`) — root provider managing Y.Doc, stores, undo, collab, SheetsAdapter lifecycle
- **UIStoreProvider** (`src/state/UIStoreProvider.tsx`) — per-user state with localStorage persistence

## Constraints
- Mutations use compute-first + atomic transact — read state, compute cascade in WASM, write all in one `doc.transact()`
- Commit-on-drop pattern — during drag, only CSS transforms applied (zero Y.Doc writes until mouseup)
- **Transaction origins** defined in `src/collab/origins.ts`. Use `ORIGIN.LOCAL`, `ORIGIN.SHEETS`, `ORIGIN.INIT` — never raw strings. Classification: `classifyOrigin()`, `triggersWriteback()`, `isUndoable()`.
- **Never read from TaskStore directly during render** — always use hooks (`useAllTasks`, `useTask`, `useTaskOrder`, `useCriticalPath`, `useConflicts`). Direct `taskStore.getX()` calls bypass `useSyncExternalStore` and are invisible to the React Compiler.
- No Google SDK — raw `fetch()` for all Google API calls
- Prefer `date-fns` directly over project wrappers for new code

## Schema Versioning
- `schemaVersion` in Y.Doc meta tracks breaking schema changes
- v1: Original Y.Map schema (19 fields per task, 20 required sheet columns)
- v2: Phase 20 — centralized origins, attribution columns (21-22) optional, `isExpanded`/`isHidden` removed from Task type
- Bump `schemaVersion` when: adding required Y.Doc fields, changing field semantics, or altering sheet column layout
- `REQUIRED_COLUMNS` (sheetsMapper.ts) = 20 core columns. Attribution columns added on first write but not required on read.

## Commands
- `npm run test` — Vitest unit tests
- `npx tsc --noEmit` — Type checking
- `npm run dev` — WASM build + Vite dev server (port 5173)

## Date Conventions
See scheduling-engine skill. Use `taskDuration`/`taskEndDate` from `dateUtils.ts`.

## Skill
See `.claude/skills/google-sheets-sync/` for Sheets integration details.
