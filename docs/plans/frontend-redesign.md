# Frontend Redesign — Architecture Specification

**Status:** Design complete. Ready for implementation.

---

## 1. Decisions

1. **Scale:** 100 tasks typical, must scale to 1000 without sluggishness.
2. **Multi-sheet:** Users open multiple sheets in different tabs (like Google Workspace).
3. **Source of truth:** Sheet is durable truth. Y.Doc is live session state. Three-way merge on conflict.
4. **Breaking changes:** Full green light. POC → production. No users yet. Get it right now.
5. **Performance:** Architecture first. Performance should flow from solid design, not from hacks.
6. **Dependencies:** Minimal. `useSyncExternalStore` (built-in) over Zustand. Only new dep: `y-indexeddb` (~2KB) for crash recovery.

---

## 2. Architecture Overview

```
                    ┌─────────────────────────┐
                    │      Y.Doc (Yjs)        │
                    │  Live session state      │
                    │  All task mutations here │
                    └───────────┬─────────────┘
                                │
                    ┌───────────┴─────────────┐
                    │                         │
            ┌───────▼──────┐        ┌─────────▼────────┐
            │ Task Store   │        │ Sheets Adapter   │
            │              │        │ (service class)  │
            │ tasks: Map   │        │                  │
            │ taskOrder: []│        │ Y.Doc ↔ Sheets   │
            │ derived:     │        │ three-way merge  │
            │  - summaries │        │ dirty tracking   │
            │  - critPath  │        └──────────────────┘
            │  - conflicts │
            └───────┬──────┘
                    │ per-task O(1) hooks
            ┌───────┴──────┐
            │  Components  │
            │  useTask(id) │
            │  useTaskOrder│
            └──────────────┘

   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ UI Store     │  │ Collab Store │  │ Y.UndoManager│
   │ zoom, theme  │  │ users, aware │  │ scoped undo  │
   │ panels, cols │  │ connection   │  │ per-client   │
   └──────────────┘  └──────────────┘  └──────────────┘
```

### Three mutation sources, one consumption path

```
Local user action ──→ Y.Doc transaction ('local' origin) ──┐
Remote Yjs peer ────→ Y.Doc observation (no origin) ────────┤──→ Task Store ──→ React
External Sheet edit → Adapter injection ('sheets' origin) ──┘
```

From React's perspective, all sources look identical — Y.Doc observations.

### What's kept from current codebase

- WASM scheduling engine (CPM, cascade, constraints) — correct compute/UI boundary
- Date convention (`dateUtils.ts`) — stabilized after Phase 16
- Relay server (stateless WebSocket forwarder) — correct architectural boundary
- Sheets as durable store (browser-first, no app database)
- E2E test infrastructure (just rebuilt)
- Type discipline (strict TS, 3 `as any` total)

### What's replaced

| Current | Redesign | Why |
|---------|----------|-----|
| useReducer + Context | TaskStore + UIStore + useSyncExternalStore | O(1) vs O(N) subscriptions at 1000 tasks |
| ganttReducer (668 lines, 30+ cases) | Y.Doc mutation functions + observation handler | Task state in Y.Doc, UI state in UIStore |
| applyActionToYjs (419 lines) | Direct Y.Doc mutations (actions go TO Y.Doc first) | One mutation path, not two |
| guardedDispatch + collabDispatch | Single `mutate()` path | No dispatch variants |
| Snapshot undo (global, 50 entries) | Y.UndoManager (per-client, scoped) | Current undo is broken for collab (undoes ALL users' changes) |
| Module-level sheetsSync state | SheetsAdapter class | Testable, multi-sheet capable |
| Mouse events + document listeners | Pointer Events + setPointerCapture | Touch support, no listener cleanup |
| No SVG virtualization | Viewport-based virtualization | 1000 tasks at 60fps |

---

## 3. Y.Doc Schema

```
doc.getMap('tasks')       → Y.Map<string, Y.Map>   // taskId → task fields (O(1) lookup)
doc.getArray('taskOrder') → Y.Array<string>          // display order (task IDs)
doc.getMap('meta')        → Y.Map                    // { schemaVersion: number }
```

### Task Y.Map fields (collaborative)
```
id, name, startDate, endDate, owner, workStream, project, functionalArea,
done, description, isMilestone, isSummary, parentId,
childIds (JSON string), dependencies (JSON string), notes, okrs (JSON string),
constraintType?, constraintDate?
```

### NOT in Y.Doc
- `duration` → computed from startDate/endDate (eliminates consistency bugs)
- `isExpanded`, `isHidden` → per-user UI state (UIStore + localStorage)
- Summary task dates → computed from children

**Behavioral change:** `isExpanded`/`isHidden` move from shared (Y.Doc) to per-user.
Currently if User A collapses a summary, User B sees it collapsed. In the redesign,
view state is personal. Collaborative "hide" (archiving) would be a separate
`archived: boolean` field if needed later.

### Key schema decisions

**Y.Map of Y.Maps** — O(1) lookup by task ID. Current Y.Array requires O(N) scan via
`findTaskIndex`. At 1000 tasks with 50-task cascade: 50 lookups vs 50,000.

**Stable UUIDs** — `crypto.randomUUID()`, never change. Current prefix-based IDs (`pe-1`)
change on reparent, requiring 7 rewiring steps (130 lines). With stable IDs, reparent is
2 field updates (~10 lines). Display prefixes ("PE-1") are derived from hierarchy position.

**JSON strings for arrays** — dependencies, childIds, okrs. Atomic updates, minimal CRDT
overhead. Nested Y.Types would add ~200-300KB at 1000 tasks.

**Schema versioning** — `meta.schemaVersion` field. Migrations are idempotent Yjs transactions.

**No migration needed** — no users yet. Fresh schema from scratch. Demo data regenerated.

---

## 4. Task Store (per-task O(1) subscriptions)

```typescript
class TaskStore {
  private tasks = new Map<string, Task>();
  private listeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();

  subscribe(taskId: string, listener: () => void): () => void {
    if (!this.listeners.has(taskId)) this.listeners.set(taskId, new Set());
    this.listeners.get(taskId)!.add(listener);
    return () => this.listeners.get(taskId)?.delete(listener);
  }

  getTask(taskId: string): Task | undefined { return this.tasks.get(taskId); }

  batchUpdate(changed: Map<string, Task>, deleted: Set<string>) {
    for (const [id, task] of changed) this.tasks.set(id, task);
    for (const id of deleted) this.tasks.delete(id);
    // Notify ONLY changed/deleted — O(changed), not O(N)
    for (const id of [...changed.keys(), ...deleted]) {
      this.listeners.get(id)?.forEach(l => l());
    }
    this.globalListeners.forEach(l => l());
  }
}

function useTask(taskId: string): Task | undefined {
  const store = useContext(TaskStoreContext);
  return useSyncExternalStore(
    (cb) => store.subscribe(taskId, cb),
    () => store.getTask(taskId),
  );
}
```

When 3 tasks change out of 1000, only 3 hooks fire. True O(1). Built on `useSyncExternalStore` — zero dependencies.

### Derived state (critical path, conflicts)

Stored in TaskStore alongside task data. Updated asynchronously via `requestIdleCallback`.

```typescript
// In TaskStore:
private criticalPath = new Set<string>();
private conflicts = new Map<string, string>();

setDerived(cp: Set<string>, cf: Map<string, string>) {
  this.criticalPath = cp;
  this.conflicts = cf;
  this.globalListeners.forEach(l => l());  // notify subscribers
}

// Hooks:
function useCriticalPath(): Set<string> {
  const store = useContext(TaskStoreContext);
  return useSyncExternalStore(
    (cb) => store.subscribeGlobal(cb),
    () => store.getCriticalPath(),
  );
}
function useConflicts(): Map<string, string> { /* same pattern */ }
```

### UIStore

Separate store for low-frequency, local-only state. Changes don't trigger task re-renders.
Same `useSyncExternalStore` pattern as TaskStore but with a single global subscription
(no per-field granularity needed — UIStore changes are infrequent).

```typescript
function useUIStore<T>(selector: (s: UIState) => T): T {
  const store = useContext(UIStoreContext);
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => selector(store.getState()),
  );
}
```

```typescript
interface UIState {
  zoomLevel: 'day' | 'week' | 'month';
  colorBy: ColorByField;
  showCriticalPath: boolean;
  criticalPathScope: { type: 'all' } | { type: 'project' | 'workstream'; name: string };
  theme: 'light' | 'dark';
  columns: ColumnConfig[];
  searchQuery: string;
  dataSource: 'sandbox' | 'loading' | 'sheet' | 'empty' | undefined;
  expandedTasks: Set<string>;     // per-user, persisted to localStorage
  isLeftPaneCollapsed: boolean;
  showOwnerOnBar: boolean;
  showAreaOnBar: boolean;
  showOkrsOnBar: boolean;
  collapseWeekends: boolean;
  contextMenu: { x: number; y: number; taskId: string } | null;
  dependencyEditor: { taskId: string; highlightFromId?: string } | null;
  reparentPicker: { taskId: string } | null;
  focusNewTaskId: string | null;
}
```

---

## 5. Mutation API

### Component API: action-based dispatch

```typescript
type MutateAction =
  | { type: 'MOVE_TASK'; taskId: string; newStart: string; newEnd: string }
  | { type: 'RESIZE_TASK'; taskId: string; newEnd: string }
  | { type: 'UPDATE_FIELD'; taskId: string; field: string; value: unknown }
  | { type: 'SET_CONSTRAINT'; taskId: string; constraintType: string; constraintDate?: string }
  | { type: 'ADD_TASK'; task: Partial<Task>; afterTaskId?: string }
  | { type: 'DELETE_TASK'; taskId: string }
  | { type: 'REPARENT_TASK'; taskId: string; newParentId: string }
  | { type: 'ADD_DEPENDENCY'; taskId: string; dep: Dependency }
  | { type: 'UPDATE_DEPENDENCY'; taskId: string; fromId: string; update: Partial<Dependency> }
  | { type: 'REMOVE_DEPENDENCY'; taskId: string; fromId: string }

// Components: const mutate = useMutate();
// Routes to standalone functions: moveTask(doc, ...), deleteTask(doc, ...), etc.
```

### Compute first, write atomically

```
1. Read current state from Y.Doc (O(1) per task)
2. Compute cascade in WASM (outside transaction — if WASM panics, nothing written)
3. Write all changes in one doc.transact(() => {}, 'local')
```

`'local'` origin → tracked by Y.UndoManager. `'sheets'` origin → not undoable.

### Mutation function contracts

Each function runs inside one `doc.transact(() => {}, 'local')`:

- **moveTask / resizeTask / setConstraint**: read task → compute cascade in WASM → write task + all cascaded tasks
- **updateTaskField**: read task → write single field
- **addTask**: generate UUID → create Y.Map → set in ytasks → append to taskOrder → update parent's childIds JSON
- **deleteTask**: BFS collect descendants → remove from ytasks → remove from taskOrder → remove from parent's childIds → clean dependency references in all tasks
- **reparentTask**: update task's parentId → remove from OLD parent's childIds JSON → add to NEW parent's childIds JSON → update taskOrder position. Three Y.Map writes in one transaction.
- **addDependency / updateDependency / removeDependency**: read deps JSON → modify → write back

### Drag: commit-on-drop (Google Sheets pattern)

```
During drag:  CSS transform translateX() on <g>. Zero Y.Doc writes. Zero React re-renders.
              Remote peers see drag intent via Yjs awareness (ephemeral).
              Table row shows pre-drag dates (edit hasn't committed).
On mouseup:   moveTask(doc, taskId, finalPos) + cascade → single Y.Doc transaction.
              Clear CSS transform. TaskBar resumes reading from store.
```

One drag = one transaction = one undo step. Always.

---

## 6. Observation Handler

### Event extraction (corrected for Y.Map<Y.Map>)

```typescript
ytasks.observeDeep((events, txn) => {
  const changes = extractChanges(events, ytasks);
  const origin = txn.origin as string | null;

  if (origin === 'local') {
    processBatch(changes, store, { scheduleColdDerivations: true });
  } else if (origin === 'sheets') {
    // Sheets Adapter injection — update store but do NOT schedule cascade/critpath.
    // External edits are manual overrides, not cascading mutations.
    processBatch(changes, store, { scheduleColdDerivations: false });
  } else {
    // Remote Yjs peer — batch via RAF
    pendingRemote.push(...changes);
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        processBatch(pendingRemote, store, { scheduleColdDerivations: true });
        pendingRemote = [];
      });
    }
  }
});

function extractChanges(events: Y.YEvent[], ytasks: Y.Map<Y.Map<unknown>>): TaskChange[] {
  const changes: TaskChange[] = [];
  for (const event of events) {
    if (event.target === ytasks) {
      // Root map: task added/deleted. Keys in event.changes.keys ARE task IDs.
      for (const [taskId, change] of event.changes.keys) {
        changes.push({ taskId, type: change.action === 'delete' ? 'deleted' : 'upserted' });
      }
    } else if (event.target instanceof Y.Map && event.target.parent === ytasks) {
      // Inner Y.Map: field changed. Read taskId from the live map.
      // Note: deletions are always root-map events (ytasks.delete(taskId)),
      // never inner-map mutations. Invariant enforced by mutation functions.
      const taskId = event.target.get('id') as string;
      if (taskId) changes.push({ taskId, type: 'upserted' });
    }
  }
  return changes;
}
```

**Invariant:** Task deletion is always `ytasks.delete(taskId)` at the root map, never
by clearing fields on the inner Y.Map. All mutation functions enforce this. This ensures
`event.target.get('id')` is always valid for inner-map events.

**SSR:** Explicitly out of scope. WASM is browser-only. `useSyncExternalStore` called
with two arguments (subscribe + getSnapshot). No server snapshot needed.

### Processing pipeline

```
1. Extract changed/deleted task IDs from events
2. Read ONLY changed tasks from Y.Doc (O(changed))
3. Merge into current store state (so summary recalc sees new values)
4. Incremental summary recalc — walk UP from changed tasks to summary ancestors
   O(changed × depth) vs O(N × depth) for full recalc
5. Batch update store (per-task notifications, O(1) per changed task)
6. If scheduleColdDerivations:
   Schedule via requestIdleCallback (fallback: setTimeout(16)):
   - computeCriticalPathScoped via WASM
   - detectConflicts via WASM
   (Skipped for 'sheets' origin — external edits don't cascade)
```

### Error resilience (layered)

```
Per-task:     try/catch around yMapToTask() — skip malformed, continue
Summary:      try/catch — fall back to full recalcSummaryDates()
Cold derive:  try/catch — show degraded mode indicator
Full handler: top-level try/catch — fall back to full Y.Doc re-read
```

### Edit guards

**InlineEdit (safe):** `useState(value)` doesn't re-sync from props during edit.

**Popover (needs touched-field tracking):** Untouched fields sync from store (accept external changes). Touched fields keep user's value. On save, only write touched fields.

---

## 7. Sheets Adapter + Conflict Resolution

### Three-way merge (AppSheet model)

```
On sync cycle, for each task row:
  sheet_value  = current Sheet value
  base_value   = Sheet value at last successful sync (stored in IndexedDB)
  ydoc_value   = current Y.Doc value

  If sheet_value == base_value → no external edit → write ydoc_value to Sheet
  If ydoc_value == base_value → no local edit → accept sheet_value into Y.Doc
  If all three differ → CONFLICT → surface to user
  If no base_value exists (first sync) → treat as no-external-edit → write ydoc_value
```

**Base value storage:** Separate IndexedDB object store `ganttlet-sync-base-{sheetId}`.
Key = taskId, value = JSON hash of the row at last successful sync. Written after every
successful Sheets write. Read on startup (alongside y-indexeddb Y.Doc restore) to
bootstrap three-way merge state. Cleared on disconnect/sheet switch.

**Conflict UI:** Adapter calls `conflictCallback(conflicts: ConflictRecord[])` → UIStore
holds pending conflicts → ConflictResolutionModal renders → user resolves per-field.

### Sheet schema (22 columns)

Current 20 columns + 2 new:
```
lastModifiedBy: string   (email of user who last edited this task)
lastModifiedAt: string   (ISO timestamp)
```

Written by Adapter on every save. Visible in the spreadsheet. `duration` written to Sheet
for human readability but computed locally (never read back from Sheet).

### Attribution and revision history

Writes use the user's OAuth token → Sheets revision history shows actual user email.
Batching caveat: collaborative edits flushed in one API call are attributed to one user
in Sheets revision history. `lastModifiedBy` column provides correct per-row attribution.

### External edits and cascade

External Sheet edits injected into Y.Doc do NOT trigger cascade. Correct — manual overrides
shouldn't auto-cascade. "Recalculate All" toolbar action triggers cascade explicitly.

### Sandbox → Sheet promotion

Sandbox uses local Y.Doc (no WebSocket). On promotion:
1. SheetsAdapter writes current Y.Doc to Sheet
2. WebSocket provider added to SAME Y.Doc (Yjs supports this — no data copy)
3. Y.UndoManager cleared (`undoManager.clear()` — sandbox undo history should not
   carry into sheet mode, as undoing past promotion would create divergence)
4. UIStore.setDataSource('sheet')

---

## 8. Undo / Error Recovery / Crash Safety

### Y.UndoManager

Per-client scoped. Tracks only `'local'` origin transactions. Remote Yjs changes and
Sheets Adapter injections (`'sheets'` origin) are not undoable. `captureTimeout: 500ms`
groups rapid edits. Drag is one transaction (commit-on-drop) = one undo step.

### y-indexeddb

Persists Y.Doc to IndexedDB automatically. Crash recovery: restore from IndexedDB → write
pending dirty rows to Sheet → read Sheet → three-way merge reconcile.

### Error boundaries

Outer boundary: keeps sync provider mounted. Inner boundaries per panel (table, chart).
Failed panel shows retry button. Sync continues regardless.

### Graceful degradation

| Failure | User sees | Recovery |
|---------|-----------|----------|
| WASM panic | "Scheduling offline" indicator. Editing works, cascade disabled. | Page reload reinitializes WASM. |
| Sheets write fail | "Unable to save, retrying..." | Retry with backoff. saveDirty NOT cleared on failure. |
| Yjs disconnect | "Offline" indicator. Local edits continue. | Yjs auto-reconnects. CRDT merge. |
| Browser crash | Nothing. | IndexedDB restores Y.Doc. Three-way merge with Sheet. |

---

## 9. Performance

### SVG viewport virtualization

Fixed-height rows (ROW_HEIGHT = 44px). Render only visible task bars + dependency arrows.
Dependency arrows: visible tasks + one level of off-screen connected tasks; truncate to
viewport edge with indicator.

### UX sync safety

Compute-then-write is synchronous on main thread. No intermediate states visible. Local
mutations: zero latency (same frame). Remote changes: max 1 frame delay (RAF batched).
During drag: CSS transform (GPU composited). WASM cascade: ~1-5ms at 1000 tasks.

---

## 10. SOTA Comparison

| Dimension | Our Plan | Industry (Sheets/Figma/Monday/Smartsheet) | Verdict |
|-----------|----------|------------------------------------------|---------|
| Collab protocol | Yjs CRDT | Server-authoritative | **Ahead** — offline-capable, stateless relay |
| Rendering | SVG + viewport virtualization | Canvas (Smartsheet/Asana) | **Adequate** to ~2-3k tasks |
| Drag | CSS transform, commit-on-drop | Same pattern | **Aligned** |
| Conflict resolution | Three-way merge | Three-way merge minimum | **Aligned** |
| Undo | Y.UndoManager (per-client) | Per-user undo | **Aligned** |
| Crash recovery | y-indexeddb | Server-side persistence | **Aligned** |

Future work (not blocking): semantic zoom (different rendering at day/week/month), task
grouping/filtering (group-by assignee, status, phase).

---

## 11. Implementation Phases

**No migration needed.** No users. Fresh schema. Demo data regenerated.

### Phase 1: Y.Doc + Store + Mutations
- New Y.Doc schema (Y.Map<Y.Map>, taskOrder, meta)
- TaskStore class with per-task event emitter
- UIStore for display/panel state
- Mutation functions (moveTask, addTask, deleteTask, etc.)
- Observation handler (corrected event model, incremental summaries)
- Stable UUIDs for task IDs
- Remove: GanttContext reducer for tasks, applyActionToYjs, guardedDispatch,
  collabDispatch, withLocalUpdate, pendingFullSyncRef

### Phase 2: Sheets Adapter
- SheetsAdapter class (bidirectional Y.Doc ↔ Sheets)
- Three-way merge with base values in IndexedDB
- Conflict UI (ConflictResolutionModal)
- `lastModifiedBy` + `lastModifiedAt` columns
- Fix: saveDirty only cleared on success. beforeunload for sheet mode.

### Phase 3: Rendering Performance
- SVG viewport virtualization (task bars + dependency arrows)
- Pointer Events for drag (commit-on-drop)
- CSS transforms during drag
- React Compiler

### Phase 4: Undo + Error Recovery + Polish
- Y.UndoManager (per-client, 'local' origin)
- y-indexeddb for crash recovery
- Error boundaries per panel
- Pre-write validation
- Remove: changeHistory, ADD_CHANGE_RECORD, ChangeHistoryPanel

### Phase exit criteria

Each phase has clear deliverables and must pass before the next begins.

**Phase 1 exit (sandbox mode — Sheets sync deferred to Phase 2):**
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` — all new store/mutation/handler unit tests pass
- [ ] `npx playwright test` — 27 local E2E tests pass (2 Sheets-error tests skipped)
- [ ] Demo: open sandbox, edit tasks, verify Y.Doc is the state source
- [ ] Zero references to `GanttContext` useReducer for task data in production code
- [ ] `guardedDispatch`, `collabDispatch`, `applyActionToYjs`, `withLocalUpdate` deleted

**Phase 2 exit:**
- [ ] `npx vitest run` — SheetsAdapter unit/integration tests pass
- [ ] E2E cloud tests pass (`gh workflow run e2e.yml -f force=true`)
- [ ] Demo: edit task in app → appears in Sheet within 2s
- [ ] Demo: edit task directly in Sheet → appears in app on next poll
- [ ] Demo: edit same task in both → conflict UI surfaces, user resolves
- [ ] `lastModifiedBy` / `lastModifiedAt` columns populated in Sheet
- [ ] Module-level `sheetsSync.ts` state deleted

**Phase 3 exit:**
- [ ] Load 1000 demo tasks → scroll at 60fps (Chrome DevTools performance audit)
- [ ] Drag task at 1000 tasks → no jank (CSS transform, zero React re-renders)
- [ ] Dependency arrows virtualized (off-screen arrows not in DOM)
- [ ] Pointer Events used for all drag interactions
- [ ] React Compiler enabled in Vite config

**Phase 4 exit:**
- [ ] Ctrl+Z undoes ONLY the current user's last action (not collaborator's)
- [ ] Browser crash → reload → IndexedDB restores Y.Doc → reconciles with Sheet
- [ ] WASM panic → degraded mode indicator shown → editing continues
- [ ] Error boundary: break a component → panel shows retry button → other panels unaffected
- [ ] `changeHistory`, `ADD_CHANGE_RECORD`, `ChangeHistoryPanel` deleted

**Phase 5 exit:**
- [ ] All CLAUDE.md files accurate for new architecture
- [ ] All skills accurate for new architecture
- [ ] `docs/architecture.md` rewritten
- [ ] `docs/completed-phases.md` updated
- [ ] `docs/TASKS.md` backlog cleaned (addressed items removed)
- [ ] Zero stale comments referencing old architecture
- [ ] `./scripts/full-verify.sh` passes
- [ ] Code review clean (run `/code-review`)

### Phase 5: Documentation + Infrastructure Update

Every artifact that references the old architecture must be updated:

**CLAUDE.md files:**
- `CLAUDE.md` (root) — update architecture constraints (Y.Doc as live state, three-way merge)
- `src/CLAUDE.md` — replace reducer/context constraints with Y.Doc/store patterns
- `src/sheets/CLAUDE.md` — update for SheetsAdapter class, three-way merge
- `e2e/CLAUDE.md` — verify fixture/model layer still accurate (should be, tests hit DOM)

**Skills (`.claude/skills/`):**
- `google-sheets-sync/SKILL.md` — rewrite for SheetsAdapter, three-way merge, attribution columns
- `e2e-testing/SKILL.md` — verify E2E patterns still valid, update any internal references
- `scheduling-engine/SKILL.md` — verify WASM integration section (compute-then-write pattern)

**Agents (`.claude/agents/`):**
- `codebase-explorer.md` — update file map (new files: TaskStore, UIStore, SheetsAdapter, mutation functions)
- `rust-scheduler.md` — verify WASM boundary description still accurate

**Docs:**
- `docs/architecture.md` — rewrite frontend architecture section for Y.Doc + stores
- `docs/completed-phases.md` — add this redesign phase
- `docs/TASKS.md` — update backlog (many items addressed: memoization, sync, undo)

**Inline comments:**
- Remove all references to: `GanttContext`, `useGanttState`, `useGanttDispatch`,
  `collabDispatch`, `guardedDispatch`, `applyActionToYjs`, `withLocalUpdate`,
  `lastTaskSource`, `pendingFullSyncRef`
- Update component docstrings: "reads from TaskStore" not "reads from Context"
- Update E2E test comments that reference internal architecture

**Package/config:**
- `package.json` — add `y-indexeddb` dependency
- `tsconfig.json` — verify `noUncheckedIndexedAccess` and other strict flags
- `.github/workflows/e2e.yml` — no changes needed (tests hit DOM, not internals)

**Tests:**
- Unit tests for removed reducer cases → delete or rewrite for mutation functions
- Unit tests for new: TaskStore, UIStore, SheetsAdapter, mutation functions, observation handler
- Integration tests for: Y.Doc → observation → store pipeline
- E2E tests: unchanged (test user behavior, not internal state management)
- Verify: `npx vitest run` passes after each phase

---

## 12. Testing Strategy

| Layer | Approach |
|-------|----------|
| Mutation functions | Unit: create Y.Doc → call function → assert Y.Doc state |
| Observation handler | Integration: write to Y.Doc → verify TaskStore updates |
| TaskStore | Unit: call batchUpdate → verify per-task notifications |
| Sheets Adapter | Integration: mock Sheets API → verify sync + conflict detection |
| UIStore | Unit: dispatch → verify state |
| Components | E2E tests (already rebuilt). Test DOM behavior, compatible with new architecture. |
