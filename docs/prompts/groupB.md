You are implementing Phase 8 Group B for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- crates/scheduler/src/cpm.rs
- crates/scheduler/src/types.rs (if needed)
- crates/scheduler/src/lib.rs (if needed)
- src/utils/schedulerWasm.ts
- src/components/gantt/CascadeHighlight.tsx
- src/components/gantt/GanttChart.tsx
- src/state/ganttReducer.ts
- src/types/index.ts
- src/state/GanttContext.tsx
- src/state/actions.ts

## Prerequisites
Ensure Rust toolchain is available:
```bash
source ~/.cargo/env
which wasm-pack  # should exist
```

If WASM build fails, ensure the symlink exists:
```bash
ls -la src/wasm/scheduler  # should point to /workspace/src/wasm/scheduler
```

## Tasks — execute in order:

### B1: Fix critical path highlighting (P1)
The critical path only highlights the last milestone instead of the full chain.

**Root cause:** In `cpm.rs` line 226, the condition `float.abs() < 1 && (has_predecessors || has_successors)` excludes zero-float tasks that don't have dependencies within the scoped subset. When filtering by project/workstream, some critical tasks lose their dependency connections because predecessors/successors are outside the filtered set.

**Fix:**
1. In `cpm.rs` line 226, change:
   ```rust
   if float.abs() < 1 && (has_predecessors || has_successors) {
   ```
   to:
   ```rust
   if float.abs() < 1 {
   ```
2. Update the test `standalone_task_not_critical` — when a single standalone task is the only task, it IS critical (it determines the project end). Change the assertion to `assert!(critical.contains(...))`.
3. The `standalone_task_alongside_chain` test should still pass — the standalone task "c" has float (shorter than the chain) so it remains non-critical.
4. Run `cd crates/scheduler && cargo test` to verify.

### B2: Fix workstream critical path crash (P0)
Selecting workstream critical path crashes the app and tears down the WebSocket.

**Fix:** Wrap ALL WASM wrapper functions in `schedulerWasm.ts` with try-catch:
```typescript
export function computeCriticalPathScoped(tasks: Task[], scope: CriticalPathScope): Set<string> {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  try {
    const result: string[] = wasmModule.compute_critical_path_scoped(mapTasksToWasm(tasks), scope);
    return new Set(result);
  } catch (err) {
    console.error('computeCriticalPathScoped failed:', err, 'scope:', scope);
    return new Set<string>();
  }
}
```

Apply the same try-catch pattern to: `computeCriticalPath`, `computeEarliestStart`, `wouldCreateCycle`, `cascadeDependents`, `cascadeDependentsWithIds`.

Also investigate: the serde attribute `#[serde(tag = "type", rename_all = "camelCase")]` on `CriticalPathScope` maps `Workstream { name }` to `{ type: "workstream", name }` in JSON. Verify the TypeScript side sends exactly this shape. Log the scope object if there's a mismatch.

### B3: Rebuild WASM + verify
After Rust changes in B1:
```bash
npm run build:wasm
cd crates/scheduler && cargo test
```

If you're in a worktree with a symlink, remove the symlink and do a real WASM build:
```bash
rm -f src/wasm/scheduler  # remove symlink
npm run build:wasm         # real build into src/wasm/scheduler/
```

Verify in browser: start dev server (`npx vite --host 0.0.0.0`), enable critical path for project scope, confirm full chain is highlighted.

### B4: Replace cascade highlight with shadow trail (P2)
The current cascade highlight is a static amber rectangle that looks jittery.
Replace it with a shadow trail stretching from original position to current position.

**Step 1 — Types** (`src/types/index.ts`):
```typescript
export interface CascadeShift {
  taskId: string;
  fromStartDate: string;
  fromEndDate: string;
}
```
Add `cascadeShifts: CascadeShift[]` to `GanttState`.

**Step 2 — Actions** (`src/state/actions.ts`):
Add: `| { type: 'SET_CASCADE_SHIFTS'; shifts: CascadeShift[] }`

**Step 3 — Reducer** (`src/state/ganttReducer.ts`):
In `CASCADE_DEPENDENTS` handler, capture pre-cascade dates:
```typescript
case 'CASCADE_DEPENDENTS': {
  const preCascadeDates = new Map(state.tasks.map(t => [t.id, { start: t.startDate, end: t.endDate }]));
  let tasks = cascadeDependents(state.tasks, action.taskId, action.daysDelta);
  const changedIds: string[] = [];
  const shifts: CascadeShift[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const pre = preCascadeDates.get(tasks[i].id);
    if (pre && (tasks[i].startDate !== pre.start || tasks[i].endDate !== pre.end)) {
      changedIds.push(tasks[i].id);
      shifts.push({ taskId: tasks[i].id, fromStartDate: pre.start, fromEndDate: pre.end });
    }
  }
  tasks = recalcSummaryDates(tasks);
  return { ...state, tasks, lastCascadeIds: changedIds, cascadeShifts: shifts };
}
```

Add `SET_CASCADE_SHIFTS` handler:
```typescript
case 'SET_CASCADE_SHIFTS':
  return { ...state, cascadeShifts: action.shifts };
```

**Step 4 — Context** (`src/state/GanttContext.tsx`):
Add `cascadeShifts: []` to initial state.
The existing auto-clear for `lastCascadeIds` in GanttChart.tsx should also clear cascade shifts. Or add a parallel useEffect in GanttChart.

**Step 5 — CascadeHighlight** (`src/components/gantt/CascadeHighlight.tsx`):
Rewrite to accept both original and current positions:
```typescript
interface CascadeHighlightProps {
  originalX: number;
  currentX: number;
  y: number;
  originalWidth: number;
  currentWidth: number;
  height: number;
}
```
Render a gradient-filled rect spanning from min(originalX, currentX) to max(originalX+originalWidth, currentX+currentWidth). Use a linearGradient from amber (opacity 0.4) at the original position to transparent at the current position. Fade out the entire element over 2 seconds using CSS transition on opacity.

**Step 6 — GanttChart** (`src/components/gantt/GanttChart.tsx`):
Read `cascadeShifts` from state (add to the destructured useGanttState call).
For each cascade shift, compute `originalX` via `dateToXCollapsed(shift.fromStartDate, ...)` and pass both original and current positions to CascadeHighlight.
Add auto-clear useEffect for cascadeShifts (dispatch SET_CASCADE_SHIFTS with empty array after 2s).

### B5: Tests
1. Rust tests: verify critical path marks all zero-float tasks in a chain (already covered by existing tests + B1 fix)
2. Vitest tests (add to existing or new file):
   - WASM wrapper returns empty Set (not crash) when called with invalid data
   - CASCADE_DEPENDENTS populates cascadeShifts with correct pre-cascade dates

## Verification
After all tasks, run:
```bash
cd crates/scheduler && cargo test
npx tsc --noEmit && npm run test
```
All must pass. Commit your changes with descriptive messages.
