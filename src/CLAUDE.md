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
- Transaction origins: `'local'` (undoable, cascades), `'sheets'` (not undoable, no cascade), remote (no origin, batched via RAF)
- No Google SDK — raw `fetch()` for all Google API calls
- Prefer `date-fns` directly over project wrappers for new code

## Commands
- `npm run test` — Vitest unit tests
- `npx tsc --noEmit` — Type checking
- `npm run dev` — WASM build + Vite dev server (port 5173)

## Date Conventions
See scheduling-engine skill. Use `taskDuration`/`taskEndDate` from `dateUtils.ts`.

## Skill
See `.claude/skills/google-sheets-sync/` for Sheets integration details.
