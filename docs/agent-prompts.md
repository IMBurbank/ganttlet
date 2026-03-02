# Phase 8 Agent Prompts

Three self-contained prompts for parallel Claude CLI sessions.
Each session runs in its own git worktree and can spawn subagents for subtasks.

## Setup

Claude Code runs in Docker with the project root mounted at `/workspace/`.

### Prerequisite: Rust Toolchain (Group B only)

Group B modifies Rust code and must rebuild WASM. Verify toolchain before starting:
```bash
source ~/.cargo/env
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
npm run build:wasm  # verify it works
```

### Execution flow

Groups A and B run in parallel in worktrees (no shared files). After both finish,
merge A and B into main, then Group C starts from the merged main.

```
  A (worktree) ──┐
                  ├── merge A+B to main ── C (from merged main)
  B (worktree) ──┘
```

### Terminal commands

```bash
# From the host, attach terminals to the running dev container:
docker compose exec dev bash

# ── Stage 1: Run A and B in parallel ──

# Terminal 1 — Group A (starts immediately)
cd /workspace
git worktree add /workspace/.claude/worktrees/phase8-groupA -b feature/phase8-table-okr
cd /workspace/.claude/worktrees/phase8-groupA
npm install
claude --dangerously-skip-permissions

# Terminal 2 — Group B (starts immediately — parallel with A)
cd /workspace
git worktree add /workspace/.claude/worktrees/phase8-groupB -b feature/phase8-critpath-cascade
cd /workspace/.claude/worktrees/phase8-groupB
# Symlink WASM artifacts from main repo (needed until rebuild)
rm -rf src/wasm/scheduler && ln -s /workspace/src/wasm/scheduler src/wasm/scheduler
npm install
source ~/.cargo/env
claude --dangerously-skip-permissions

# ── Stage 2: After A and B finish, merge to main ──

# Terminal 3 — Merge A+B, then start Group C
cd /workspace
git merge feature/phase8-table-okr --no-ff -m "Merge feature/phase8-table-okr: fix cell editability, OKR picker, seed data"
git merge feature/phase8-critpath-cascade --no-ff -m "Merge feature/phase8-critpath-cascade: critical path fixes, cascade shadow trail"
npx tsc --noEmit && npm run test  # verify merge
claude --dangerously-skip-permissions  # paste Group C prompt

# ── Cleanup ──
git worktree remove /workspace/.claude/worktrees/phase8-groupA
git worktree remove /workspace/.claude/worktrees/phase8-groupB
git branch -d feature/phase8-table-okr feature/phase8-critpath-cascade
```

---

## Group A Prompt — Table Editing Fix + OKR Enhancement

```
You are implementing Phase 8 Group A for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

## Your files (ONLY modify these):
- src/components/table/InlineEdit.tsx
- src/components/table/TaskRow.tsx
- src/components/table/TaskTable.tsx
- src/data/fakeData.ts
- src/components/shared/OKRPickerModal.tsx (new)

## Tasks — execute in order:

### A1: Fix cell editability bug (P0)
Most table cells are no longer editable. This is a Phase 7 regression.

**Investigation steps:**
1. Start the dev server: `npx vite --host 0.0.0.0`
2. Open the app and try double-clicking various cells (name, owner, description, notes, start/end dates, duration)
3. Check which cells work and which don't

**Likely root causes (investigate all):**
1. In `InlineEdit.tsx` (line 19-24): the `autoEdit` effect runs whenever `autoEdit` prop changes. If TaskTable rapidly cycles `autoFocusName` (true→false via CLEAR_FOCUS_NEW_TASK), the effect may interfere with editing state on other InlineEdit instances. Fix: guard the effect to only act on `autoEdit === true` transitions, and use a ref to track previous value.
2. In `TaskTable.tsx` (line 28-33): `CLEAR_FOCUS_NEW_TASK` fires in `requestAnimationFrame`, which triggers a re-render before InlineEdit can settle. Fix: use two nested `requestAnimationFrame` calls or a short `setTimeout` (50ms).
3. In `TaskRow.tsx` (line 208-228): verify `readOnly` is ONLY applied to:
   - `workStream` when role === 'task' (correct)
   - `project` when role === 'task' || role === 'workstream' (correct)
   - NO other cells should have `readOnly`
4. Check if the `PresenceCell` wrapper's `onClick` handler is capturing events before `onDoubleClick` on InlineEdit.

**Deliverable:** All non-inherited cells are double-click editable. Summary task dates and milestones are read-only (existing behavior). inherited project/workStream cells remain read-only.

### A2: Populate OKR seed data
In `fakeData.ts`, add OKRs to workstream summary tasks (currently `okrs: []`):
- `pe` (Platform Engineering): `["KR: API p99 latency < 200ms", "KR: Zero-downtime migration", "KR: 99.9% uptime SLA"]`
- `ux` (User Experience): `["KR: User satisfaction > 4.5/5", "KR: Ship design system v2", "KR: WCAG 2.1 AA compliance"]`
- `gtm` (Go-to-Market): `["KR: 20% market share increase", "KR: 3x website conversion rate", "KR: 50 published content pieces"]`

Verify every leaf task already has at least one OKR from its parent workstream's set. The seed data already has OKRs on leaf tasks; just add them to the three workstream summary tasks.

### A3: Create OKR picker modal + wire into TaskRow
Create `src/components/shared/OKRPickerModal.tsx`:
- Multi-select checkbox list showing parent workstream's OKRs
- Uses `findWorkstreamAncestor()` from `src/utils/hierarchyUtils.ts` to get available OKRs
- Props: `{ taskId, currentOkrs, availableOkrs, onSave, onClose }`
- Renders as a portal-based modal (consistent with ReparentPickerModal style)
- Save button dispatches `UPDATE_TASK_FIELD` with `field: 'okrs'`

In `TaskRow.tsx`:
- Replace the OKR cell's `InlineEdit` (line 232-247) with a clickable display + modal trigger
- On click, open OKRPickerModal with the task's current OKRs and the workstream's available OKRs
- Use local state in TaskRow to manage modal open/close

### A4: Tests
Add tests in existing test files or new test files:
1. Editability regression test: create a test that renders TaskRow for each hierarchy role (project, workstream, task) and verifies which cells are editable vs read-only
2. OKR inheritance test: verify new tasks created under a workstream inherit the workstream's OKRs

## Verification
After all tasks, run:
```bash
npx tsc --noEmit && npm run test
```
Both must pass. Commit your changes with descriptive messages.
```

---

## Group B Prompt — Critical Path Fixes + Cascade UX

```
You are implementing Phase 8 Group B for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

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
  // Capture pre-cascade dates for affected tasks
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
cd /path/to/worktree  # back to worktree root
npx tsc --noEmit && npm run test
```
All must pass. Commit your changes with descriptive messages.
```

---

## Group C Prompt — Testing + Deployment

```
You are implementing Phase 8 Group C for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

**IMPORTANT**: Group C runs AFTER Groups A and B have been merged to main.
You should be working directly on the main branch, not in a worktree.

## Your files (ONLY modify these):
- playwright.config.ts (new)
- e2e/ (new directory)
- deploy/frontend/ (new directory)
- deploy/README.md (new)
- package.json (add Playwright dependency and e2e script)

## Tasks — execute in order:

### C1: Playwright setup
```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

Create `playwright.config.ts`:
- Base URL: `http://localhost:5173`
- Only chromium (speed over coverage at this stage)
- Test dir: `e2e/`
- Web server command: `npx vite --host 0.0.0.0` with port 5173
- Timeout: 30s per test

Add to `package.json` scripts: `"e2e": "playwright test"`

### C2: Critical E2E tests
Create `e2e/gantt.spec.ts` with these tests:

1. **Cell editing works**: navigate to app, double-click a task name cell, type a new name, blur, verify the name changed
2. **Critical path highlights**: enable critical path (find the toggle in toolbar), verify multiple task bars have the critical-path visual indicator (CSS class or style)
3. **Workstream scope doesn't crash**: open scope selector, choose a workstream, verify app is still responsive (page doesn't show error boundary)
4. **Dependency arrows connected**: verify SVG path elements exist in DependencyLayer, check they have reasonable coordinates (not 0,0)

### C3: Frontend deployment (Firebase Hosting)
Create `firebase.json`:
```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

Create `deploy/frontend/deploy.sh`:
```bash
#!/bin/bash
set -euo pipefail
npm run build
firebase deploy --only hosting
```

Add environment variable support:
- `VITE_COLLAB_URL`: WebSocket URL for the Cloud Run relay server
- Create `.env.production` with placeholder: `VITE_COLLAB_URL=wss://your-relay-server.run.app`

### C4: Production environment config
Update `deploy/cloudrun/deploy.sh` to set `ALLOWED_ORIGINS` with the Firebase Hosting URL.

Create `deploy/README.md` documenting:
1. Prerequisites (Firebase CLI, gcloud CLI, Google Cloud project)
2. Frontend deployment steps (Firebase Hosting)
3. Relay server deployment steps (Cloud Run — already configured)
4. Environment variables needed
5. OAuth redirect URI configuration (manual step in Google Cloud Console)
6. Full end-to-end deployment pipeline

## Verification
```bash
npx playwright test  # E2E tests pass
npm run build        # production build succeeds
```

Commit your changes with descriptive messages.
```

---

## Merge Agent Prompt (runs after A+B, before C)

```
You are merging Phase 8 Groups A and B into main for the Ganttlet project.

Steps:
1. From /workspace (main branch):
   git merge feature/phase8-table-okr --no-ff -m "Merge feature/phase8-table-okr: fix cell editability, OKR picker, seed data"
   git merge feature/phase8-critpath-cascade --no-ff -m "Merge feature/phase8-critpath-cascade: critical path fixes, cascade shadow trail"

2. Resolve any merge conflicts (there should be none — groups have zero file overlap).

3. Verify:
   npx tsc --noEmit
   npm run test
   cd crates/scheduler && cargo test

4. If all pass, clean up worktrees:
   git worktree remove /workspace/.claude/worktrees/phase8-groupA
   git worktree remove /workspace/.claude/worktrees/phase8-groupB
   git branch -d feature/phase8-table-okr feature/phase8-critpath-cascade

5. Report results.
```
