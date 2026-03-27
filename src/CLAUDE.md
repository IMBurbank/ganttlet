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

## Adding a Task Field

The field registry in `src/schema/ydoc.ts` drives Y.Doc serialization. `setKnownFields` and `yMapToTask` are generated from it — do NOT edit them manually.

**Steps (in order):**
1. `src/types/index.ts` — add the field to the `Task` interface
2. `src/schema/ydoc.ts` — add an entry to `FIELD_REGISTRY` with the correct type (`'string'`, `'boolean'`, `'json-string-array'`, `'json-dep-array'`, `'nullable-string'`, `'optional-string'`)
3. `src/sheets/sheetsMapper.ts` — add to `SHEET_COLUMNS`, add to `taskToRow()`, add to `REQUIRED_COLUMNS` if required
4. `src/schema/migrations.ts` — if existing docs need a default, add a migration and bump `CURRENT_MINOR` (additive) or `CURRENT_MAJOR` (breaking)
5. Run `npx vitest run` — cross-system coverage tests will catch anything you missed

**What you do NOT need to touch:** `setKnownFields`, `yMapToTask`, `TASK_FIELDS` — these are derived from the registry.

**What the tests catch:**
- Field in Task but not in `FIELD_REGISTRY` → `TASK_FIELDS ↔ Task type` test fails
- Field in `TASK_FIELDS` but not in `SHEET_COLUMNS` → cross-system coverage test fails
- Field missing from `taskToRow`/`rowToTask` → Sheets round-trip test fails
- Full pipeline (Y.Doc → Sheets → Y.Doc) data loss → pipeline round-trip test fails

## Schema Versioning & Migration
- **Field registry** in `src/schema/ydoc.ts` `FIELD_REGISTRY` — single source of truth for Task ↔ Y.Doc serialization
- **Migration registry** in `src/schema/migrations.ts` — ordered array of idempotent migrations
- **Major/minor versions**: major = breaking (hard lock-out), minor = additive (soft warning, no lock-out)
- **`migrateDoc(doc)`** — runs pending migrations, gates on future major versions
- **`writeTaskToDoc(ytasks, id, task)`** — the ONLY way to write tasks to Y.Doc. Preserves unknown fields on existing tasks (forward compat). Never call `new Y.Map()` + set fields directly.
- **Component-split gate**: TaskStoreProvider outer handles migration; inner mounts hooks only after migration succeeds. Unmigrated docs structurally cannot reach hooks.
- **Header-based column lookup**: `rowToTask` reads by column name via `HeaderMap`, not positional index. Column reordering doesn't break reads. `COLUMN_ALIASES` in sheetsMapper.ts supports renamed columns.
- **hashTask**: three-way merge hashes by canonical Task object, not raw row position.
- **Structural rules** (`src/__tests__/structuralRules.test.ts`): Source-scanning tests that catch common mistakes with prescriptive fix messages. Enforces: no RefObject in hook returns, no `.getState()` in JSX render, no raw origin strings.
- v1: Original Y.Map schema (19 fields, 20 sheet columns)
- v2: Phase 20 — strip `isExpanded`/`isHidden`, centralized origins, optional attribution columns

## Commands
- `npm run test` — Vitest unit tests
- `npx tsc --noEmit` — Type checking
- `npm run dev` — WASM build + Vite dev server (port 5173)

## Date Conventions
See scheduling-engine skill. Use `taskDuration`/`taskEndDate` from `dateUtils.ts`.

## Skill
See `.claude/skills/google-sheets-sync/` for Sheets integration details.
