# Phase 14 Recommendations: Drag Interaction Reliability & Sync Integrity

**Status:** Working Document
**Date:** 2026-03-06
**Scope:** Fast-drag data corruption, arrow offset bugs, CRDT sync under rapid mutation, missing structural sync (add/delete/dependencies), reproduction strategies, and state-of-the-art patterns from Google Docs/Sheets/Slides

---

## 1. Problem Statement

During fast click-and-drag operations on deployed Cloud Run instances, three classes of bugs have been observed:

1. **Duration corruption** — A task's duration changes when it should remain constant (move) or changes incorrectly (resize)
2. **Dependency mutation** — Dependencies are altered or lost during rapid drag sequences
3. **Arrow offset** — Dependency arrows render at incorrect positions, disconnected from task bar edges

These bugs are intermittent, latency-sensitive, and worsen under real network conditions (vs. localhost).

Additionally, investigation revealed a **structural sync gap**: task add/delete and dependency add/update/remove operations are not synced via Yjs at all. These actions update local React state but never write to the CRDT document, meaning collaborators only see these changes after the 30-second Sheets poll (if connected to the same sheet) or not at all (if using room-only collaboration without Sheets).

---

## 2. Root Cause Analysis

### 2.1 No Throttling on Mousemove Dispatch

**File:** `src/components/gantt/TaskBar.tsx:66-101`

Every `mousemove` event during a drag fires a full dispatch cycle:

```
mousemove -> xToDateCollapsed() -> daysBetween() -> dispatch(MOVE_TASK) -> reducer -> React re-render -> Yjs transaction -> WebSocket broadcast
```

At 60-120Hz mouse event frequency, this generates 60-120 state updates per second. Each update:
- Creates a new tasks array (immutable reducer)
- Triggers React reconciliation of the entire Gantt SVG
- Opens a Yjs transaction and broadcasts a CRDT update to all peers

**Impact:** Under load (many tasks, slow device, network latency), React re-renders can't keep up. The `startDate`/`endDate` props flowing into `TaskBar` may lag behind `dragRef.current`, causing the next `dx` calculation to use stale position data. The `dateToXCollapsed(origStartDate) + dx` pattern is resilient to this (it's absolute from origin), but the Yjs broadcast and remote application are not.

### 2.2 Duration Calculated from Calendar Days, Applied as Calendar Days

**File:** `src/components/gantt/TaskBar.tsx:83-86`

```typescript
const duration = daysBetween(origStartDate, origEndDate);  // calendar days
const newEnd = new Date(newStart);
newEnd.setDate(newEnd.getDate() + duration);  // calendar day addition
```

This is internally consistent for move operations. However, the `duration` field on the Task model represents **business days** in some contexts (Sheets column, WASM scheduler) but **calendar days** in others (drag calculation). This semantic mismatch is a latent bug vector — if `collapseWeekends` is on, moving a task from a weekday span onto a weekend boundary can shift the end date differently than expected.

### 2.3 Drag State Captured in Closure, Props Lag Behind

**File:** `src/components/gantt/TaskBar.tsx:61-125`

The `handleMouseDown` callback closes over `startDate` and `endDate` props at click time (line 64). The inner `onMouseMove` and `onMouseUp` functions use `dragRef.current` (mutable ref), which is correct for tracking accumulated drag state. However:

- `onMouseUp` dispatches `CASCADE_DEPENDENTS` using `daysBetween(origStartDate, lastStartDate)` — if any intermediate `MOVE_TASK` dispatch was lost or reordered (due to React batching or Yjs transaction timing), `lastStartDate` may not match what the reducer actually applied.
- The cascade delta is computed client-side, but the reducer re-reads `state.tasks` to find the current task — if a remote Yjs update arrived between the last `MOVE_TASK` and the `CASCADE_DEPENDENTS`, the task's dates in state may differ from `lastStartDate`.

### 2.4 CRDT Granularity: Field-Level, Not Operation-Level

**File:** `src/collab/yjsBinding.ts:148-162`

Each `MOVE_TASK` sets two Y.Map fields (`startDate`, `endDate`) in a single transaction. This is correct for atomicity within one client. But consider two concurrent drags on the same task:

- Client A moves task right: sets `startDate=Mar10, endDate=Mar15`
- Client B resizes task shorter: sets `endDate=Mar12, duration=2`
- CRDT merge: Y.Map uses last-writer-wins per field. Final state could be `startDate=Mar10, endDate=Mar12` (from B) but `duration=5` (stale from before A's move).

The `duration` field is a derived value (endDate - startDate), but it's stored and synced as an independent field. When CRDT merges produce an inconsistent `{startDate, endDate, duration}` tuple, downstream code (Sheets sync, WASM scheduler) may use the wrong value.

### 2.5 SET_TASKS Overwrites During Active Drag

**File:** `src/collab/yjsBinding.ts:101-104`

When a remote Yjs update arrives, the observer calls `dispatch({ type: 'SET_TASKS', tasks })` with ALL tasks read from the Yjs doc. This replaces the entire task array in React state. If the local user is mid-drag:

1. User drags task, `MOVE_TASK` updates React state
2. Remote user edits a different task, Yjs observer fires
3. `SET_TASKS` replaces all tasks — including the dragged task — with Yjs doc state
4. The Yjs doc may have the dragged task at its previous position (the local `MOVE_TASK` Yjs write may not have round-tripped yet)
5. Task bar snaps back, then the next `mousemove` calculates delta from the original position again (using `origStartDate`), so the task jumps back to the correct drag position
6. This creates visual jitter and, in edge cases, can leave the task at an intermediate position if mouseup fires during the snap-back frame

### 2.6 Arrow Offsets from Render-Cycle Mismatch

**File:** `src/utils/dependencyUtils.ts:24-27`

Arrow start/end points are computed from `dateToXCollapsed(fromTask.endDate, ...)`. If the task's `endDate` in state was updated by `MOVE_TASK` but the arrow component re-renders with a stale task reference (due to React batching or memo boundary), the arrow will point to the old position while the bar has moved. This is transient (resolves on next render) but visible during fast drags.

Additionally, the `taskYPositions` map is rebuilt from visible task order. If a `SET_TASKS` from remote changes the task array (adding/removing tasks) while arrows are rendering, Y positions shift and arrows point to wrong rows.

### 2.7 Add/Delete/Dependency Operations Not Synced via CRDT

**Files:** `src/state/GanttContext.tsx:57-66`, `src/collab/yjsBinding.ts:144-283`

The `TASK_MODIFYING_ACTIONS` set in `GanttContext.tsx` determines which actions are forwarded to `applyActionToYjs()`. This set includes: `MOVE_TASK`, `RESIZE_TASK`, `UPDATE_TASK_FIELD`, `TOGGLE_EXPAND`, `HIDE_TASK`, `SHOW_ALL_TASKS`, `CASCADE_DEPENDENTS`.

**Missing entirely:**
- `ADD_TASK` — not in `TASK_MODIFYING_ACTIONS`, no case in `applyActionToYjs`
- `DELETE_TASK` — not in `TASK_MODIFYING_ACTIONS`, no case in `applyActionToYjs`
- `ADD_DEPENDENCY` — not in `TASK_MODIFYING_ACTIONS`, no case in `applyActionToYjs`
- `UPDATE_DEPENDENCY` — not in `TASK_MODIFYING_ACTIONS`, no case in `applyActionToYjs`
- `REMOVE_DEPENDENCY` — not in `TASK_MODIFYING_ACTIONS`, no case in `applyActionToYjs`

When User A adds a task, the reducer updates local React state, but nothing is written to the Yjs document. User B never sees the new task until either:
- The 30-second Sheets poll picks up the change (only if both users are connected to the same spreadsheet AND Sheets sync has written the change), or
- One of the users performs UNDO/REDO/REPARENT, which triggers a `pendingFullSync` that calls `applyTasksToYjs()` with the entire task array

The same applies to delete and all dependency operations. This means the real-time collaboration experience is incomplete — field edits and moves sync instantly, but structural changes (the most important operations for project planning) are effectively invisible to collaborators.

**Impact:** This is arguably a more severe issue than the drag bugs. A user could add tasks, wire up dependencies, and reorganize a schedule — and their collaborator sitting next to them would see none of it for 30+ seconds, or never if they're using room-only collaboration without Sheets.

---

## 3. State-of-the-Art: How Google Does It

### 3.1 Google Docs / Slides — Operational Transform + Intent Preservation

Google Docs uses OT (Operational Transformation) with a central server that serializes operations. Key patterns relevant to Ganttlet:

- **Operations, not state snapshots**: Each edit is an operation ("move task X by +3 days") rather than a state snapshot ("task X is now at Mar 15"). This preserves intent under concurrent edits.
- **Transform functions**: When concurrent ops conflict, both are transformed against each other. The server is the arbiter. CRDTs (Yjs) skip this by guaranteeing convergence, but at the cost of semantic awareness — Yjs doesn't know that `startDate` and `endDate` must move together.
- **Batching**: Docs batches keystrokes into larger operations before sending. Ganttlet should batch mousemove events similarly.

### 3.2 Google Sheets — Cell-Level Conflict Resolution

- **Granularity**: Each cell is an independent unit. Concurrent edits to different cells in the same row merge cleanly. This maps well to Yjs Y.Map fields.
- **Same-cell conflict**: Last-writer-wins with undo support. The losing edit appears in version history.
- **Derived values**: Sheets recalculates formulas after every edit, ensuring derived values are always consistent. Ganttlet should treat `duration` as derived (= endDate - startDate) and never sync it as an independent field.

### 3.3 Google Draw / Slides — Drag Interaction Patterns

- **Throttled broadcast**: During drag, position updates are sent at ~10-15fps to peers, not at mouse event rate. The final position is sent on mouseup with an authoritative "drag complete" message.
- **Local-only rendering during drag**: The dragging user sees immediate feedback from local state only. Remote users see throttled position updates. On mouseup, both converge to the authoritative final position.
- **No derived state in transport**: Only the primary values (position, size) are sent. Derived values (connections, layout) are recomputed locally by each client.

### 3.4 Figma — CRDT with Multiplayer Drag

Figma uses a custom CRDT with these relevant patterns:

- **Drag operations are local until commit**: During drag, changes are not synced. On mouseup, a single "move" operation is committed to the CRDT and broadcast.
- **Presence shows drag intent**: Other users see a "ghost" of the dragging element at the in-progress position via awareness/presence, but the authoritative document isn't updated until commit.
- **Consistent derived state**: Connections/arrows are recomputed from primary geometry, never synced independently.

---

## 4. Recommendations

### R1: Throttle Drag Dispatch and CRDT Broadcast

**Priority:** P0 — directly addresses the primary bug
**Effort:** Small (1-2 days)

**Current behavior:** Every mousemove dispatches `MOVE_TASK` + Yjs transaction.

**Proposed behavior:**
- **Local rendering**: Use `requestAnimationFrame` to throttle state dispatch to ~60fps max. Only dispatch if the computed date actually changed from the previous dispatch.
- **CRDT broadcast**: Decouple Yjs writes from React dispatch. Throttle Yjs writes to ~10fps (100ms intervals) during drag. Send a final authoritative write on mouseup.
- **Intermediate state**: During drag, update a transient `dragState` ref (not React state) for rendering. Only dispatch to reducer on RAF boundaries.

**Implementation sketch:**

The CRDT broadcast throttle requires separating "dispatch to reducer" from "write to Yjs." Currently, `collabDispatch` in `GanttContext.tsx` does both synchronously. For R1, we need two dispatch paths:
- `localDispatch(action)` — updates React state only (used during drag at RAF rate)
- `collabDispatch(action)` — updates React state AND writes to Yjs (used at 100ms throttle and on mouseup)

Expose both from `GanttContext` so `TaskBar` can choose which to call.

```typescript
// In TaskBar.tsx handleMouseDown:
let rafId: number | null = null;
let lastBroadcast = 0;

function onMouseMove(ev: MouseEvent) {
  const newDates = computeDragDates(ev.clientX);
  dragRef.current.pending = newDates;

  // Throttle local render via RAF
  if (!rafId) {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      localDispatch({ type: 'MOVE_TASK', ...dragRef.current.pending });
    });
  }

  // Throttle CRDT broadcast to ~10fps
  const now = performance.now();
  if (now - lastBroadcast > 100) {
    lastBroadcast = now;
    collabDispatch({ type: 'MOVE_TASK', ...dragRef.current.pending });
  }
}

function onMouseUp() {
  if (rafId) cancelAnimationFrame(rafId);
  // Final authoritative dispatch + CRDT write
  collabDispatch({ type: 'MOVE_TASK', ...dragRef.current.pending });
  // Then cascade via COMPLETE_DRAG (R4)...
}
```

**Key files to modify:**
- `src/state/GanttContext.tsx`: Split `collabDispatch` into `localDispatch` + `collabDispatch`, expose both via context
- `src/components/gantt/TaskBar.tsx`: Use `localDispatch` for RAF-throttled moves, `collabDispatch` for 100ms-throttled broadcasts and mouseup

**Tradeoffs:**
- (+) Dramatically reduces dispatch/render/broadcast volume during drag
- (+) Remote users see smoother, less jittery updates
- (-) Remote users see position updates with ~100ms delay (acceptable — matches Google Slides behavior)
- (-) Slightly more complex drag code

### R2: Derive Duration, Never Sync It Independently

**Priority:** P0 — eliminates a class of corruption
**Effort:** Small (1 day)

**Current behavior:** `duration` is stored as an independent field on Task, synced via Yjs, written to Sheets.

**Proposed behavior:**
- `duration` is always computed: `daysBetween(startDate, endDate)` (or `businessDaysBetween` when relevant)
- Remove `duration` from Yjs Y.Map writes (or keep for display but always recompute on read)
- In the reducer, after any `MOVE_TASK` or `RESIZE_TASK`, recompute duration from dates
- In Sheets mapper, compute duration on write, don't rely on the stored field

**Why this matters:** CRDT last-writer-wins on independent fields can produce `{startDate: Mar10, endDate: Mar15, duration: 2}` — an impossible state. If duration is always derived, this class of bug is eliminated.

**Tradeoffs:**
- (+) Eliminates duration/date inconsistency permanently
- (+) Simplifies reasoning about task state
- (-) Sheets column still shows duration — resolved by R9 (computed-on-write, ignored-on-read)
- (-) Business days vs calendar days semantic must be resolved project-wide (see R7)

### R3: Guard Against SET_TASKS During Active Drag

**Priority:** P1 — prevents snap-back jitter
**Effort:** Small (1 day)

**Current behavior:** Remote Yjs updates trigger `SET_TASKS` which replaces the entire task array, including any task being actively dragged.

**Proposed behavior:**
- Track which task ID is currently being dragged (e.g., `activeDragTaskId` ref in GanttContext)
- In the Yjs observer, when `SET_TASKS` fires during an active drag:
  - Option A: Skip the update entirely (simple, may miss remote changes to other tasks)
  - Option B (recommended): Merge — apply SET_TASKS but preserve the local dragged task's dates from `dragRef.current.pending`
  - Option C: Queue the update and apply after drag completes

**Implementation sketch (Option B):**
```typescript
// In yjsBinding observer:
const observer = () => {
  if (isLocalUpdate) return;
  let tasks = readTasksFromYjs(doc);

  // Preserve active drag state
  const dragTaskId = getActiveDragTaskId(); // exposed from GanttContext
  if (dragTaskId) {
    const dragState = getDragState(); // { startDate, endDate }
    tasks = tasks.map(t =>
      t.id === dragTaskId
        ? { ...t, startDate: dragState.startDate, endDate: dragState.endDate }
        : t
    );
  }

  dispatch({ type: 'SET_TASKS', tasks });
};
```

**Tradeoffs:**
- (+) Eliminates drag snap-back / jitter during concurrent edits
- (+) Other tasks still update in real-time during drag
- (-) The dragged task's intermediate position won't reflect remote changes (acceptable — drag is a local intent operation)

### R4: Atomic Drag Completion with Cascade

**Priority:** P1 — prevents cascade delta mismatch
**Effort:** Medium (2-3 days)

**Current behavior:** `MOVE_TASK` and `CASCADE_DEPENDENTS` are separate dispatches (and separate Yjs transactions). Race conditions can produce mismatched cascade deltas.

**Proposed behavior:** Introduce a `COMPLETE_DRAG` action that atomically:
1. Sets the final task dates
2. Computes cascade delta from the original position (stored in dragRef)
3. Applies cascade to dependents
4. Writes all changes to Yjs in a single transaction

```typescript
case 'COMPLETE_DRAG': {
  // 1. Apply final position
  let tasks = state.tasks.map(t =>
    t.id === action.taskId
      ? { ...t, startDate: action.finalStartDate, endDate: action.finalEndDate }
      : t
  );
  // 2. Cascade from original position
  const delta = daysBetween(action.origStartDate, action.finalStartDate);
  if (delta !== 0) {
    tasks = cascadeDependents(tasks, action.taskId, delta);
  }
  // 3. Recalc summaries
  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks };
}
```

The Yjs write for `COMPLETE_DRAG` would update all affected tasks in a single `doc.transact()`.

**Implementation notes:**
- Add `COMPLETE_DRAG` to `UNDOABLE_ACTIONS` set in `ganttReducer.ts` (replaces `MOVE_TASK`/`RESIZE_TASK`/`CASCADE_DEPENDENTS` as the undoable drag action)
- Add `COMPLETE_DRAG` to `TASK_MODIFYING_ACTIONS` set in `GanttContext.tsx`
- Add `COMPLETE_DRAG` case in `applyActionToYjs` in `yjsBinding.ts` — updates moved task + all cascaded tasks in one `doc.transact()`
- Add `COMPLETE_DRAG` to action types in `actions.ts` with payload: `{ taskId, origStartDate, origEndDate, finalStartDate, finalEndDate, mode: 'move' | 'resize' }`
- Remove `CASCADE_DEPENDENTS` dispatch from `TaskBar.tsx` mouseup — folded into `COMPLETE_DRAG`

**Tradeoffs:**
- (+) Eliminates race between move and cascade
- (+) Remote users receive a single atomic update instead of move + cascade
- (+) Simplifies undo — one undo step reverts the entire drag operation
- (-) Remote users don't see cascade animation (they see final state)
- (-) Intermediate move positions during drag still need separate (throttled) Yjs writes via R1

### R5: Dependency Arrows — Render from Same State Snapshot

**Priority:** P2 — addresses arrow offset
**Effort:** Small (1 day)

**Current behavior:** `DependencyLayer` reads task data and `taskYPositions` independently. If they come from different render cycles, arrows can be offset.

**Proposed behavior:**
- Compute `taskYPositions` and dependency arrow paths in the same `useMemo` pass
- Ensure `DependencyLayer` receives `tasks` and `taskYPositions` as a consistent pair (same reference/version)
- Consider memoizing `getDependencyPoints` results keyed on `{fromTask.endDate, toTask.startDate, fromY, toY}` to avoid unnecessary path recalculation

**Tradeoffs:**
- (+) Eliminates arrow/bar mismatch from stale renders
- (+) Performance improvement from memoization
- (-) Minimal code change, low risk

### R6: Show Drag Intent via Awareness (Remote Users)

**Priority:** P2 — completes drag interaction story for multi-user UX
**Effort:** Medium (2-3 days)

Inspired by Figma's approach. The awareness infrastructure already exists (`src/collab/awareness.ts`), so this builds on proven code rather than introducing new protocols.

- During drag, broadcast drag intent via Yjs awareness (not document state): `{ dragging: { taskId, currentStartDate, currentEndDate } }`
- Remote clients render a "ghost bar" at the in-progress position with reduced opacity
- On drag complete, awareness clears and the document update provides the authoritative position
- If a dragger disconnects mid-drag, the awareness state expires automatically (Yjs awareness handles this natively via timeout)

Without this, remote users see jerky throttled position updates (R1's 100ms throttle) instead of a smooth ghost bar. R6 is the natural capstone for the drag work — R1-R5 fix data integrity, R6 fixes the remote user experience.

**Tradeoffs:**
- (+) Remote users see what's happening in real-time without document churn
- (+) Separates transient interaction state from persistent document state
- (+) Addresses concurrent-drag-on-same-task: user sees another user dragging and can wait
- (-) Slightly more complex awareness payload (adding `dragging` field to existing awareness state)
- (-) Ghost bar rendering adds a new SVG element per active drag — negligible performance cost

### R7: Standardize Duration Semantics (Calendar vs Business Days)

**Priority:** P2 — prevents a class of latent bugs
**Effort:** Medium (2-3 days)

Currently, `duration` is ambiguous:
- `daysBetween()` returns calendar days
- `collapseWeekends` affects visual positioning but not duration calculation
- The WASM scheduler has its own duration concept
- Sheets shows duration as a number without specifying calendar vs business

**Proposed behavior:**
- Define `duration` as **calendar days** everywhere (simplest, most predictable)
- Add a separate `businessDuration` computed field for display when weekends are collapsed
- Document the convention in `src/types/index.ts` with a comment on the `duration` field
- Audit all uses of `daysBetween()` and `businessDaysBetween()` for consistency

**Tradeoffs:**
- (+) Eliminates ambiguity
- (+) Calendar days are simpler and universal
- (-) "Duration = 5" for a Mon-Fri task looks wrong if user expects business days
- (-) May need a "duration mode" preference toggle in future

### R8: Cascade Adjacency List Optimization + Latency Instrumentation

**Priority:** P1 — prevents frame drops on drag completion at scale
**Effort:** Small-Medium (1-2 days)

**Current behavior:** `cascade_dependents` in `crates/scheduler/src/cascade.rs` scans all tasks at each cascade level to find successors — O(n * d) where n = total tasks and d = dependency chain depth. No latency instrumentation exists.

**Proposed behavior:**
1. **Rust optimization:** Build a predecessor-to-successors adjacency map at the start of `cascade_dependents()`. Each cascade level then only visits direct successors — O(e * d) where e = total edges (much smaller than n * d for sparse graphs).
2. **JS instrumentation:** Wrap the WASM `cascade_dependents` call in `schedulerWasm.ts` with `performance.mark/measure`. Log a warning if execution exceeds 16ms. Keep instrumentation active in all builds (dev, E2E, cloud).

**Performance profile (see Section 7 Analysis for full table):**
- 200 tasks: <1ms with adjacency list (currently ~2-5ms)
- 500 tasks: ~2-5ms with adjacency list (currently ~10-30ms)
- 1000+ tasks: ~5-15ms with adjacency list (currently ~50-200ms)

**Testing:**
- Existing `cargo test` cases must produce identical results after the adjacency list change
- E2E tests against Cloud Run must assert cascade latency stays below 16ms
- Future staging smoke suite inherits the same assertion
- If latency threshold is violated in any test environment, the test must fail visibly — not just log a warning

**Tradeoffs:**
- (+) Keeps cascade well under 16ms for schedules up to 1000 tasks
- (+) Low-risk refactor — same algorithm, better data structure
- (+) Instrumentation gives early warning before users experience frame drops
- (-) Adjacency list adds a HashMap allocation per cascade call (negligible cost)

### R9: Sheets Duration Column Write-Back Behavior

**Priority:** P2 — resolves ambiguity while touching the same code as R2/R7
**Effort:** Small (1 day)

With R2 making duration a derived value and R7 standardizing its semantics, we need to decide how the Sheets `duration` column behaves. This is best resolved now while the duration code is being reworked rather than left as tech debt.

**Decision:** Treat `duration` in Sheets as **computed on write, ignored on read**.
- On write (`sheetsMapper.ts:taskToRow`): Compute `duration = daysBetween(startDate, endDate)` and write it to the Sheets column. The column always reflects the authoritative derived value.
- On read (`sheetsMapper.ts:rowToTask`): Ignore the Sheets `duration` value. Recompute from `startDate` and `endDate`. If a user manually edits duration in Sheets, it will be overwritten on the next sync write.
- The Sheets column is effectively read-only from the Sheets side — it exists for human readability, not as a data input.

**Why not write-back (editing duration adjusts endDate)?** Write-back creates a bidirectional dependency: changing duration in Sheets would need to adjust endDate, which triggers cascade, which changes other tasks' dates. This is complex to implement correctly in the polling-based sync model (30-second intervals), risks silent data corruption if the poll reads a partially-edited row, and conflates two edit surfaces (Sheets and Ganttlet UI) in a way that's hard to reason about. Simpler to make duration output-only and let users edit dates directly if they want to change task spans.

**Implementation:**
- `sheetsMapper.ts:taskToRow`: Replace stored `task.duration` with `daysBetween(task.startDate, task.endDate)`
- `sheetsMapper.ts:rowToTask`: Compute duration from dates instead of reading from the row
- Add a comment in both locations documenting the convention

**Tradeoffs:**
- (+) Eliminates impossible states from manual Sheets edits
- (+) Duration column is always consistent with dates — never stale
- (+) Simple to implement alongside R2/R7
- (-) Users who edit duration in Sheets will see their edits overwritten (acceptable — document in Sheets header row or cell note)

### R10: Sync Add/Delete Task and Dependency Operations via CRDT

**Priority:** P0 — structural operations don't sync at all
**Effort:** Medium (2-3 days)

**Current behavior:** `ADD_TASK`, `DELETE_TASK`, `ADD_DEPENDENCY`, `UPDATE_DEPENDENCY`, and `REMOVE_DEPENDENCY` are not in the `TASK_MODIFYING_ACTIONS` set and have no case in `applyActionToYjs()`. These operations update local React state only. Collaborators don't see them until the 30-second Sheets poll (if using Sheets sync) or never (room-only collaboration).

**Proposed behavior:** Add all five operations to both `TASK_MODIFYING_ACTIONS` and `applyActionToYjs()`.

**ADD_TASK implementation:**
- In `applyActionToYjs`: After the reducer runs, read the newly created task from React state (or reconstruct from the action payload), create a `Y.Map` via `taskToYMap()`, and push it to the Yjs array in a `doc.transact()`.
- Challenge: `ADD_TASK` in the reducer generates the task ID, computes inherited fields, and determines array position. The Yjs binding needs the final task, not just the action payload.
- Approach: Use the `pendingFullSync` pattern (already used for UNDO/REDO/REPARENT) — after `ADD_TASK` dispatch, flag for full sync. This is simple and correct but replaces the entire Yjs array, which is heavier than a targeted insert.
- Better approach: Add the new task's final state to the action (or return it from the reducer) so `applyActionToYjs` can do a targeted `yarray.push([taskToYMap(newTask)])`.

**DELETE_TASK implementation:**
- In `applyActionToYjs`: Find the task index in the Yjs array by ID, delete it with `yarray.delete(idx, 1)`. Also delete any descendant tasks (the reducer deletes all descendants).
- Must handle the cascade of `childIds` cleanup on the parent task.

**Dependency operations:**
- `ADD_DEPENDENCY`, `UPDATE_DEPENDENCY`, `REMOVE_DEPENDENCY` all modify the `dependencies` field (a JSON-stringified array) on an existing task.
- In `applyActionToYjs`: Find the task by ID, read its current `dependencies` from the Y.Map, apply the add/update/remove, and write back the modified JSON string.
- This is field-level update on an existing Y.Map entry — same pattern as `UPDATE_TASK_FIELD`.

**Implementation options (tradeoff):**

| Approach | Complexity | Network cost | Correctness risk |
|----------|-----------|--------------|-----------------|
| A: `pendingFullSync` for all five | Low — reuse existing path | High — replaces entire Yjs array on every add/delete | Low — full replacement is always correct |
| B: Targeted Yjs mutations per action | Medium — new cases in `applyActionToYjs` | Low — only changed tasks sent | Medium — must match reducer logic exactly |
| C: Hybrid — targeted for deps, full sync for add/delete | Medium | Medium | Low |

**Recommendation:** Hybrid approach — targeted mutations for dependency ops (same-task field update, simple), `useEffect` diff for add/delete (needs reducer output).

**Dependency operations (targeted, in `applyActionToYjs`):**
- `ADD_DEPENDENCY`: Find target task Y.Map by `action.taskId`, JSON-parse its `dependencies` field, push the new dep, JSON-stringify back. Same pattern as existing `UPDATE_TASK_FIELD`.
- `UPDATE_DEPENDENCY`: Find task, parse deps, find and replace the matching dep, stringify back.
- `REMOVE_DEPENDENCY`: Find task, parse deps, filter out the matching dep, stringify back.
- Add all three to `TASK_MODIFYING_ACTIONS` set in `GanttContext.tsx`.

**Add/delete task (`useEffect` diff in `GanttContext.tsx`):**
- The reducer generates task IDs (via `generatePrefixedId()` in `hierarchyUtils.ts`), computes inherited fields, and updates parent `childIds`. The Yjs binding needs the final task with all computed fields — not just the action payload.
- Add a `useEffect` in `GanttContext.tsx` that tracks previous `state.tasks` via ref and diffs against current on each change:
  - **New tasks** (in current but not previous): Create Y.Map via `taskToYMap()`, push to Yjs array, update parent's `childIds` in Yjs.
  - **Deleted tasks** (in previous but not current): Find by index in Yjs array, delete. Update former parent's `childIds` in Yjs.
- Wrap all mutations in a single `doc.transact()` for atomicity.
- Set `isLocalUpdate = true` to prevent the observer from echoing changes back.
- The async delay (next React commit) is negligible and invisible to users.
- This approach avoids coupling the Yjs binding to reducer internals — it reacts to state changes regardless of which action produced them.

**Why not `pendingFullSync` (Option A)?** It replaces the entire Yjs array on every add/delete, which is expensive for large schedules and creates unnecessary CRDT churn. Each full-array replacement sends O(n) data over WebSocket instead of O(1).

**Testing:**
- E2E (collab harness): User A adds a task, verify User B sees it within 2 seconds (not 30)
- E2E (collab harness): User A deletes a task, verify it disappears from User B
- E2E (collab harness): User A adds a dependency, verify the arrow appears for User B
- Unit (Vitest): Round-trip test — add task to Yjs, read back, verify all fields match
- Unit (Vitest): Delete task from Yjs array, verify array length and remaining task IDs

**Tradeoffs:**
- (+) Completes the real-time collaboration story — all operations sync, not just field edits
- (+) Eliminates the 30-second sync gap for structural changes
- (+) Room-only collaboration (no Sheets) becomes fully functional
- (-) More cases in `applyActionToYjs` to maintain
- (-) ADD_TASK needs careful handling of ID generation and inherited fields
- (-) Concurrent add+delete on the same task is a new conflict scenario (Yjs array operations handle this, but the `observeDeep` callback must handle the case where a deleted task's Y.Map no longer exists)

---

## 5. Reproduction Strategies

### 5.1 Fast-Drag Duration Corruption

**Manual reproduction:**
1. Open the app with a sheet that has tasks with dependencies (FS type)
2. At `day` zoom level, click a task bar and drag it rapidly (>500px in <200ms) to the right
3. Release. Check if the task's duration changed (compare before/after in the table panel)
4. Repeat with `collapseWeekends` enabled — drag across a Fri/Mon boundary

**Automated E2E test:**
```typescript
test('fast drag preserves task duration', async ({ page }) => {
  const bar = page.locator('[data-testid="task-bar-T1"]');
  const before = await getTaskDuration(page, 'T1');

  // Simulate fast drag: mousedown, rapid mousemoves, mouseup
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  // Fast sweep: 20 moves over 100ms
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(box.x + box.width / 2 + (i * 25), box.y + box.height / 2);
    await page.waitForTimeout(5); // 5ms between moves = very fast drag
  }
  await page.mouse.up();

  const after = await getTaskDuration(page, 'T1');
  expect(after).toBe(before);
});
```

### 5.2 Concurrent Drag + Remote Edit

**Manual reproduction (requires two browsers):**
1. Open the same sheet in two browser windows (different Google accounts)
2. In window A, start dragging a task slowly
3. While A is dragging, edit a different task's name in window B
4. Observe if A's task snaps back momentarily
5. Release drag in A. Verify final position and duration are correct

**Automated E2E test (uses collab harness):**
```typescript
test('drag resilient to concurrent remote edit', async () => {
  const [writerA, writerB] = await createCollabPair(sheetId);

  // A starts dragging
  const bar = writerA.page.locator('[data-testid="task-bar-T1"]');
  await startDrag(writerA.page, bar, { dx: 100 });

  // B edits a different task while A is mid-drag
  await writerB.page.fill('[data-testid="task-name-T2"]', 'Renamed Task');
  await writerB.page.keyboard.press('Enter');

  // Wait for sync to propagate
  await writerA.page.waitForTimeout(500);

  // A completes drag
  await completeDrag(writerA.page);

  // Verify T1's position is where A dragged it (not snapped back)
  const finalStart = await getTaskField(writerA.page, 'T1', 'startDate');
  expect(finalStart).toBe(expectedDraggedStartDate);
});
```

### 5.3 Arrow Offset After Fast Drag

**Manual reproduction:**
1. Create tasks A -> B (FS dependency) where B starts right after A ends
2. Rapidly drag A to the right (past B's start)
3. Release. Verify the arrow connects to A's new end and B's (possibly shifted) start
4. If the arrow is offset, check if it corrects on the next interaction (hover, click, scroll)

**Automated E2E test:**
```typescript
test('arrow endpoints match task bar edges after fast drag', async ({ page }) => {
  await fastDragTask(page, 'A', { dx: 200 });

  // Read arrow path and task positions
  const arrowPath = await page.locator('.dep-stroke').first().getAttribute('d');
  const taskABox = await page.locator('[data-testid="task-bar-A"]').boundingBox();
  const taskBBox = await page.locator('[data-testid="task-bar-B"]').boundingBox();

  // Arrow start should be near A's right edge
  const arrowStart = parsePathStart(arrowPath);
  expect(Math.abs(arrowStart.x - (taskABox.x + taskABox.width))).toBeLessThan(20);

  // Arrow end should be near B's left edge
  const arrowEnd = parsePathEnd(arrowPath);
  expect(Math.abs(arrowEnd.x - taskBBox.x)).toBeLessThan(20);
});
```

### 5.4 Network Latency Simulation

For reproducing issues that only appear on deployed instances:

```bash
# Chrome DevTools: Network tab > Throttling > Add custom profile
# Latency: 100ms, Download: 1Mbps, Upload: 512kbps

# Or via Playwright:
const context = await browser.newContext();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 100,
  downloadThroughput: 1_000_000 / 8,
  uploadThroughput: 512_000 / 8,
});
```

### 5.5 Stress Test: Many Tasks + Fast Operations

```typescript
test('drag performance with 200 tasks', async ({ page }) => {
  // Load a sheet with 200 tasks and complex dependency chains
  await loadTestSheet(page, 'stress-200-tasks');

  const bar = page.locator('[data-testid="task-bar-T50"]');
  const start = performance.now();

  await startDrag(page, bar, { dx: 300, steps: 50, intervalMs: 5 });
  await completeDrag(page);

  const elapsed = performance.now() - start;

  // Verify no data corruption
  await verifyAllTaskDurations(page);
  await verifyAllDependenciesIntact(page);

  // Performance budget: drag should complete in <2s even with 200 tasks
  expect(elapsed).toBeLessThan(2000);
});
```

### 5.6 Add/Delete Task Not Syncing

**Manual reproduction (requires two browsers):**
1. Open the same room in two browser windows (with or without a shared sheet)
2. In window A, add a new task (click "Add Task" or use the table)
3. Observe window B — the task should NOT appear (current broken behavior)
4. Wait 30+ seconds — if using Sheets sync, the task may eventually appear via polling
5. Repeat with delete: delete a task in window A, observe it persists in window B

**Automated E2E test (uses collab harness):**
```typescript
test('added task syncs to collaborator via CRDT', async () => {
  const [writerA, writerB] = await createCollabPair(sheetId);

  // A adds a task
  await writerA.page.click('[data-testid="add-task-button"]');
  await writerA.page.fill('[data-testid="task-name-input"]', 'New Task From A');
  await writerA.page.keyboard.press('Enter');

  // B should see it within 2 seconds (CRDT sync, not Sheets poll)
  await expect(
    writerB.page.locator('text=New Task From A')
  ).toBeVisible({ timeout: 2000 });
});

test('deleted task syncs to collaborator via CRDT', async () => {
  const [writerA, writerB] = await createCollabPair(sheetId);

  // Both should see existing task T1
  await expect(writerB.page.locator('[data-testid="task-bar-T1"]')).toBeVisible();

  // A deletes T1
  await writerA.page.click('[data-testid="task-row-T1"]', { button: 'right' });
  await writerA.page.click('text=Delete Task');

  // B should see it disappear within 2 seconds
  await expect(
    writerB.page.locator('[data-testid="task-bar-T1"]')
  ).not.toBeVisible({ timeout: 2000 });
});

test('added dependency syncs to collaborator via CRDT', async () => {
  const [writerA, writerB] = await createCollabPair(sheetId);

  // A adds a dependency T1 -> T2
  await addDependency(writerA.page, 'T1', 'T2', 'FS');

  // B should see the arrow within 2 seconds
  await expect(
    writerB.page.locator('.dep-stroke')
  ).toBeVisible({ timeout: 2000 });
});
```

---

## 6. Implementation Plan

### Stage 1: Core Fixes (P0)
| # | Recommendation | Effort | Files |
|---|---------------|--------|-------|
| R1 | Throttle drag dispatch + CRDT broadcast | 1-2 days | TaskBar.tsx, GanttContext.tsx |
| R2 | Derive duration from dates | 1 day | ganttReducer.ts, yjsBinding.ts, sheetsMapper.ts |
| R10 | Sync add/delete task + dependency ops via CRDT | 2-3 days | yjsBinding.ts, GanttContext.tsx |

### Stage 2: Sync Resilience (P1)
| # | Recommendation | Effort | Files |
|---|---------------|--------|-------|
| R3 | Guard SET_TASKS during active drag | 1 day | yjsBinding.ts, GanttContext.tsx |
| R4 | Atomic COMPLETE_DRAG action | 2-3 days | ganttReducer.ts, actions.ts, TaskBar.tsx, yjsBinding.ts |

### Stage 3: Performance & Rendering (P1-P2)
| # | Recommendation | Effort | Files |
|---|---------------|--------|-------|
| R5 | Arrow render consistency | 1 day | DependencyLayer.tsx, GanttChart.tsx |
| R7 | Duration semantics standardization | 2-3 days | types/index.ts, dateUtils.ts, schedulerWasm.ts |
| R8 | Cascade adjacency list optimization + latency instrumentation | 1-2 days | cascade.rs, schedulerWasm.ts |
| R9 | Sheets duration column write-back behavior | 1 day | sheetsMapper.ts |

### Stage 4: Multi-User UX (P2)
| # | Recommendation | Effort | Files |
|---|---------------|--------|-------|
| R6 | Drag intent via awareness (ghost bar) | 2-3 days | awareness.ts, TaskBar.tsx, GanttChart.tsx |

### Testing Stage (Parallel with each stage)
| Test | Type | Coverage |
|------|------|----------|
| Fast-drag duration preservation | E2E (Playwright) | R1, R2 |
| Concurrent drag + remote edit | E2E (collab harness) | R3, R4 |
| Arrow offset after drag | E2E (visual) | R5 |
| Network latency simulation | E2E (CDP throttling) | R1, R3, R4 |
| 200-task stress test | E2E (performance) | R1, R8 |
| Cascade latency threshold (16ms) | E2E (dev + cloud) | R8 |
| Duration field consistency | Unit (Vitest) | R2, R7, R9 |
| Reducer atomicity | Unit (Vitest) | R4 |
| Cascade adjacency list correctness | Unit (cargo test) | R8 |
| Ghost bar rendering for remote drag | E2E (collab harness) | R6 |
| Sheets duration round-trip | Unit (Vitest) | R9 |
| Add task syncs to collaborator | E2E (collab harness) | R10 |
| Delete task syncs to collaborator | E2E (collab harness) | R10 |
| Add/remove dependency syncs to collaborator | E2E (collab harness) | R10 |
| Yjs task add/delete round-trip | Unit (Vitest) | R10 |

---

## 7. Risks & Decisions

### Resolved

1. **Throttled broadcast vs real-time feel**: Go with 100ms throttle. This matches Google Slides behavior (~10fps to remote users during drag). If user testing reveals it feels sluggish, we can drop to 50ms — but 100ms is the safe starting point since it cuts broadcast volume by 6-12x.

2. **Duration semantics migration**: Not needed now. We're early enough that no production Sheets data depends on the stored `duration` field. Resolved by R9 — duration is computed-on-write, ignored-on-read.

3. **COMPLETE_DRAG undo granularity**: Go with single-snapshot-per-drag. This is strictly better UX — "undo" reverts the entire drag operation rather than one pixel of movement. The current behavior of 60-120 undo snapshots per drag is accidental, not intentional.

4. **Concurrent drag on same task**: Document last-releaser-wins as expected behavior. R6 (awareness-based drag intent, in Stage 4) addresses this — when User B sees User A is dragging a task via the ghost bar, B can wait. Add a brief note to user-facing docs that concurrent drag on the same task follows last-writer-wins.

5. **WASM cascade performance**: Implement adjacency list optimization in this phase (R8). The current O(n * d) inner loop is replaced with O(e * d) using a predecessor-to-successors HashMap. Add `performance.mark/measure` instrumentation around the WASM call and assert cascade stays under 16ms in E2E tests against Cloud Run and later in staging. If latency still exceeds threshold after this optimization, a Web Worker approach is documented as future work — but adjacency list should be sufficient for schedules up to 1000 tasks. See R8 for full details.

6. **Mobile/touch support**: Excluded from Phase 14. This is a feature (~2-3 days), not a bug fix. R1-R5 fix the shared data pipeline that touch would reuse, so touch drag benefits automatically from this phase's work. Tracked as future work in Section 8.

7. **Sheets duration write-back**: Resolved — treat duration as computed-on-write, ignored-on-read (R9). Editing duration in Sheets will be overwritten on next sync. This is simpler and safer than bidirectional write-back, which would risk silent data corruption through the polling-based sync. Implemented alongside R2/R7 while the duration code is being reworked.

8. **Concurrent add + delete on same task**: Two users could add tasks with the same generated ID, or one could delete a task while another edits it. Yjs Y.Array handles concurrent inserts correctly (both items are preserved). For delete-while-editing: the Yjs observer's `SET_TASKS` dispatch will remove the task from the non-deleting user's state. This is correct behavior — the delete wins, which matches Google Sheets semantics. The `observeDeep` callback in `yjsBinding.ts` must handle the case where a Y.Map referenced in an event no longer exists in the array. Test this explicitly in E2E.

9. **ADD_TASK ID generation timing**: The reducer generates task IDs synchronously. The recommended Option 3 (`useEffect` diff approach) reads the final state after the reducer runs, so IDs are stable. The slight async delay (next React commit) is invisible to users. If this proves problematic, fall back to Option 1 (pass reducer output to `applyActionToYjs`).

### Analysis: WASM cascade performance (R8 background)

The current `cascade_dependents` algorithm in `crates/scheduler/src/cascade.rs` has an O(n * d) inner loop. The adjacency list optimization (R8) reduces this to O(e * d). Estimated performance impact:

| Tasks | Deps | Chain depth | Current | With adjacency list |
|-------|------|-------------|---------|---------------------|
| 50 | ~30 | 3-5 | <1ms | <1ms |
| 200 | ~120 | 5-8 | ~2-5ms | <1ms |
| 500 | ~300 | 8-12 | ~10-30ms | ~2-5ms |
| 1000+ | ~600+ | 10-20 | ~50-200ms | ~5-15ms |

Implementation details, testing requirements, and the adjacency list code sketch are in R8 (Section 4). If latency still exceeds 32ms after R8, a Web Worker approach is documented in Section 8.2.

---

## 8. Future Work (Out of Phase 14 Scope)

Items identified during Phase 14 analysis that are explicitly deferred. These are not blockers for Phase 14 and should be prioritized independently.

### 8.1 Mobile/Touch Drag Support
**Effort:** 2-3 days | **Depends on:** R1 (throttling)

Add `touchstart/touchmove/touchend` handlers parallel to mouse handlers. Requires `touch-action: none` CSS on the SVG canvas and single-touch tracking (ignore multi-touch pinch). Reuses the same drag logic, date calculation, dispatch, and CRDT broadcast pipeline. Phase 14 fixes (R1-R10) apply equally to touch input since they fix the shared data flow.

### 8.2 Web Worker for WASM Cascade (if needed)
**Effort:** 3-5 days | **Depends on:** R8 adjacency list + latency data from dev/staging E2E

Only pursue if cascade latency routinely exceeds 32ms after the R8 adjacency list optimization. The R8 latency instrumentation (16ms threshold assertion in E2E tests against Cloud Run and staging) will provide the data to make this call. Requires loading the WASM module in a dedicated Web Worker, serializing tasks across `postMessage` (~1-3ms overhead for 500 tasks), making drag completion asynchronous (mouseup queues cascade, result applies on worker response), and more complex error handling and state reconciliation. The async drag completion changes the UX contract — cascade shifts would appear with a slight delay after mouseup rather than synchronously. Avoid unless proven necessary by latency instrumentation data.

---

## 9. Key File Reference

Files that must be read and understood before implementing each recommendation. Line numbers are approximate (as of 2026-03-06) and should be verified before editing.

### Frontend — Drag Interaction
| File | Purpose | Relevant to |
|------|---------|-------------|
| `src/components/gantt/TaskBar.tsx` | Drag handlers (mousedown/move/up), bar rendering | R1, R3, R4, R6 |
| `src/components/gantt/TaskBarPopover.tsx` | Double-click date editor, cascades on date change | R4 |
| `src/components/gantt/GanttChart.tsx` | Main SVG canvas, critical path computation, cascade highlight timer | R5, R6 |
| `src/components/gantt/DependencyLayer.tsx` | Arrow container, filters visible deps, critical edge detection | R5 |
| `src/components/gantt/DependencyArrow.tsx` | Individual arrow SVG rendering (path + arrowhead) | R5 |
| `src/components/gantt/CascadeHighlight.tsx` | Visual feedback for cascaded tasks | R4 |

### Frontend — State Management
| File | Purpose | Relevant to |
|------|---------|-------------|
| `src/state/GanttContext.tsx` | React context, `collabDispatch`, `TASK_MODIFYING_ACTIONS` set, Yjs connection, Sheets sync, undo/redo keyboard shortcuts | R1, R3, R4, R10 |
| `src/state/ganttReducer.ts` | All action handlers (MOVE_TASK, RESIZE_TASK, ADD_TASK, DELETE_TASK, CASCADE_DEPENDENTS, etc.), undo stack, summary recalc | R2, R4, R7, R10 |
| `src/state/actions.ts` | Action type definitions and payloads | R4, R10 |
| `src/types/index.ts` | Task, Dependency, GanttState, CollabUser interfaces | R2, R7 |

### Frontend — CRDT Sync
| File | Purpose | Relevant to |
|------|---------|-------------|
| `src/collab/yjsBinding.ts` | `applyActionToYjs()`, `bindYjsToDispatch()`, `taskToYMap()`/`yMapToTask()`, `readTasksFromYjs()`, `isLocalUpdate` flag | R1, R2, R3, R4, R10 |
| `src/collab/yjsProvider.ts` | WebSocket connection to relay, auth handshake, `connectCollab()`/`disconnectCollab()` | R6 |
| `src/collab/awareness.ts` | `setLocalAwareness()`, awareness state shape (name, email, color) | R6 |

### Frontend — Utilities
| File | Purpose | Relevant to |
|------|---------|-------------|
| `src/utils/dateUtils.ts` | `daysBetween()`, `dateToXCollapsed()`, `xToDateCollapsed()`, `businessDaysBetween()`, `formatDate()` | R1, R2, R7 |
| `src/utils/dependencyUtils.ts` | `getDependencyPoints()`, `createBezierPath()`, `createArrowHead()` — arrow geometry | R5 |
| `src/utils/layoutUtils.ts` | `buildTaskYPositions()` — Y coordinate mapping | R5 |
| `src/utils/schedulerWasm.ts` | WASM module wrapper, `cascadeDependents()`, `computeCriticalPath()` | R4, R8 |
| `src/utils/summaryUtils.ts` | `recalcSummaryDates()` — parent task date aggregation | R4 |
| `src/utils/hierarchyUtils.ts` | `generatePrefixedId()`, `getAllDescendantIds()`, `computeInheritedFields()` | R10 |
| `src/utils/dependencyValidation.ts` | `validateDependencyHierarchy()`, `checkMoveConflicts()` | R10 |

### Frontend — Sheets Sync
| File | Purpose | Relevant to |
|------|---------|-------------|
| `src/sheets/sheetsMapper.ts` | `taskToRow()`, `rowToTask()` — Task <-> Sheets row serialization | R2, R7, R9 |
| `src/sheets/sheetsSync.ts` | `scheduleSave()` (2s debounce), `startPolling()` (30s), `MERGE_EXTERNAL_TASKS` dispatch | R9 |
| `src/sheets/sheetsClient.ts` | Google Sheets API calls with exponential backoff | (reference only) |

### Backend — Scheduling Engine (Rust/WASM)
| File | Purpose | Relevant to |
|------|---------|-------------|
| `crates/scheduler/src/cascade.rs` | `cascade_dependents()` — dependency cascade algorithm (current O(n*d), needs adjacency list) | R8 |
| `crates/scheduler/src/lib.rs` | WASM entry points, `#[wasm_bindgen]` exports | R8 |
| `crates/scheduler/src/types.rs` | `Task`, `Dependency`, `CascadeResult` Rust types | R8 |
| `crates/scheduler/src/date_utils.rs` | `add_days()`, `parse_date()` | R8 |

### Backend — Relay Server (reference only, no changes in Phase 14)
| File | Purpose |
|------|---------|
| `server/src/room.rs` | Room management, Yrs doc, sync protocol, broadcast |
| `server/src/ws.rs` | WebSocket handler, auth handshake, pre-auth buffering |
| `server/src/auth.rs` | OAuth validation, Drive permission check |

### Tests
| File | Purpose | Relevant to |
|------|---------|-------------|
| `e2e/collab.spec.ts` | Existing E2E collab tests (presence, edit propagation) | R6, R10 |
| `e2e/helpers/collab-harness.ts` | `createCollabPair()`, test utilities | R3, R4, R6, R10 |
| `src/utils/__tests__/dependencyUtils.test.ts` | Existing dependency util unit tests | R5 |
| `crates/scheduler/src/cascade.rs` (tests module) | 8 existing cascade tests (linear, diamond, backward, duration preservation) | R8 |

### Configuration & Scripts
| File | Purpose |
|------|---------|
| `scripts/full-verify.sh` | Full verification: tsc + vitest + cargo test + E2E |
| `scripts/verify.sh` | Post-edit hook: scope-aware tsc + vitest |
| `package.json` | npm scripts: `dev`, `build`, `test`, `build:wasm`, `e2e:collab` |
