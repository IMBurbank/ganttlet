# Ganttlet

## Project Overview
Ganttlet is a free, open-source Gantt chart with real-time collaboration and two-way Google Sheets sync — comparable to Microsoft Project or Primavera P6.

## Tech Stack
- **Frontend**: React + TypeScript, Vite, custom SVG rendering
- **Scheduling engine**: Rust → WebAssembly (in-browser) — CPM, cycle detection, cascade
- **Real-time sync**: Yjs (client) + Yrs (server) — CRDT-based
- **Collaboration server**: Rust (axum + tokio-tungstenite) — stateless WebSocket relay
- **Google Sheets**: API v4, client-side via OAuth2 token
- **Auth**: Google OAuth2 — permissions derived from Google Drive sharing
- **Testing**: Vitest + jsdom (unit), Playwright (E2E planned)

## Architecture
Browser client + thin relay server. All business logic (scheduling, rendering, Sheets I/O) runs in the browser. The relay server only forwards CRDT updates over WebSocket.
See `docs/completed-phases.md` for detailed architecture notes (auth, sync, deployment).

## Architecture Principles
- Scheduling engine is a pure Rust→WASM module, separate from UI
- Relay server is stateless and credential-free
- Google Sheets sync layer is its own module, not coupled to UI
- Write tests for scheduling logic first — correctness is critical

## Commands
- `npm run build:wasm` — Build Rust scheduler to WASM
- `npm run dev` — Build WASM + start Vite dev server
- `npm run test` — Run unit tests
- `npm run build` — Build WASM + TypeScript check + production build
- `cd crates/scheduler && cargo test` — Run Rust unit tests
- `docker compose run --service-ports dev` — Enter the dev container
- `docker compose exec dev bash` — Attach to running container
- `claude --dangerously-skip-permissions` — Start Claude without permission checks

## Development Environment
- Docker-based (see `docker-compose.yml`, `Dockerfile`)
- Vite on port 5173, view at localhost:5173
- macOS host, VS Code editor

## Git Workflow
- `main` is always deployable
- Feature branches: `feature/description`
- Commit often, descriptive messages, PRs before merge

## Development Practices
- Multi-agent workflow: split features across parallel agents using git worktree isolation
- Each agent works on non-overlapping files to prevent merge conflicts
- Agents commit and verify (build/test) before finishing
- PostToolUse hook (`scripts/verify.sh`) runs `tsc` + `vitest` after `.ts/.tsx` edits

## Task Queue
See `TASKS.md` for claimable tasks and claiming convention.

## Phase 6: Gantt Chart UX Improvements (DONE)
Ten UX fixes and features, split into three parallel agent groups with zero file overlap.
Details in `TASKS.md` under "Phase 6".

## Phase 7: Hierarchy Enforcement, Task Movement & UX Improvements (IN PROGRESS)
Ten issues addressing hierarchy enforcement, task reparenting, and UX polish.
See `docs/unplanned-issues.md` for the original issue list.

### Agent Groups & File Ownership
```
Group A (Hierarchy + State)              Group B (UI Components)              Group C (WASM + Scheduler)
  src/utils/hierarchyUtils.ts (new)        src/App.tsx                          crates/scheduler/src/cpm.rs
  src/utils/dependencyValidation.ts (new)  src/components/gantt/TaskBar.tsx      crates/scheduler/src/types.rs
  src/state/ganttReducer.ts                src/components/gantt/TaskBarPopover.tsx (new)  crates/scheduler/src/lib.rs
  src/state/actions.ts                     src/components/table/TaskRow.tsx      src/utils/schedulerWasm.ts
  src/types/index.ts                       src/components/table/InlineEdit.tsx
  src/state/GanttContext.tsx               src/components/table/TaskTable.tsx
  src/collab/yjsBinding.ts                src/components/shared/DependencyEditorModal.tsx
  src/data/fakeData.ts                     src/components/shared/ReparentPickerModal.tsx (new)
  src/utils/__tests__/hierarchyUtils.test.ts (new)      src/components/layout/Toolbar.tsx
  src/utils/__tests__/dependencyValidation.test.ts (new)
  src/state/__tests__/ganttReducer.test.ts
```

### Interface Contracts
**Contract 1 — Hierarchy utilities** (Group A provides, Groups B+C consume):
```typescript
// src/utils/hierarchyUtils.ts
export type HierarchyRole = 'project' | 'workstream' | 'task';
export function getHierarchyRole(task: Task, taskMap: Map<string, Task>): HierarchyRole;
export function findProjectAncestor(task: Task, taskMap: Map<string, Task>): Task | null;
export function findWorkstreamAncestor(task: Task, taskMap: Map<string, Task>): Task | null;
export function getAllDescendantIds(taskId: string, taskMap: Map<string, Task>): Set<string>;
export function isDescendantOf(taskId: string, ancestorId: string, taskMap: Map<string, Task>): boolean;
export function generatePrefixedId(parent: Task, existingTasks: Task[]): string;
export function computeInheritedFields(parentId: string | null, taskMap: Map<string, Task>): { project: string; workStream: string; okrs: string[] };
```

**Contract 2 — Dependency validation** (Group A provides, Group B consumes):
```typescript
// src/utils/dependencyValidation.ts
export interface DepValidationError { code: string; message: string; }
export function validateDependencyHierarchy(tasks: Task[], successorId: string, predecessorId: string): DepValidationError | null;
export function checkMoveConflicts(tasks: Task[], taskId: string, newParentId: string): { dep: Dependency; reason: string }[];
```

**Contract 3 — New action types** (Group A defines, Group B consumes):
```typescript
| { type: 'REPARENT_TASK'; taskId: string; newParentId: string | null; newId?: string }
| { type: 'SET_REPARENT_PICKER'; picker: { taskId: string } | null }
| { type: 'TOGGLE_LEFT_PANE' }
| { type: 'CLEAR_FOCUS_NEW_TASK' }
```

**Contract 4 — New state fields** (Group A adds to GanttState):
```typescript
focusNewTaskId: string | null;    // set by ADD_TASK, cleared by CLEAR_FOCUS_NEW_TASK
isLeftPaneCollapsed: boolean;     // toggled by TOGGLE_LEFT_PANE
reparentPicker: { taskId: string } | null;
```

**Contract 5 — CriticalPathScope change** (Group C modifies, Group A updates type):
```typescript
// Remove 'all' variant, add 'workstream':
export type CriticalPathScope =
  | { type: 'project'; name: string }
  | { type: 'workstream'; name: string }
  | { type: 'milestone'; id: string };
```

### Execution Order
- Groups A and C run in parallel
- Group B starts after A7 completes (needs types, hierarchy utils, and dep validation)
- Within-group order: A1 → A2 → A3+A4+A5 → A6 → A7 → A8 → A9
- Within-group order: C1 → C2 → C3 → C4
- Within-group order: B1+B2+B3 → B4+B5+B6 → B7

### Issues Addressed
1. Workstream added within project auto-assigns to that project
2. Task created within workstream inherits workStream + okrs
3. New task IDs use workstream prefix (e.g. `pe-10`)
4. Tasks can move between workstreams; ID + deps updated
5. Add Task button focuses the new task for immediate editing
6. Tasks editable from Gantt chart task bars (popover on double-click)
7. Shortcut to collapse/expand the left table pane (Ctrl+B)
8. Enforce project > workstream > task hierarchy + field consistency
9. Block moves that would create dependency on own project/workstream
10. Critical path scoped to projects/workstreams only (remove "All")

## Roadmap (Future)
- Resource assignment and leveling
- Baseline tracking
- Export to PDF/PNG/CSV

## Completed Work
Phases 0-6 are done (scaffolding, bug fixes, tests, Google Sheets sync, real-time collab, WASM scheduler, UX improvements).
Details in `docs/completed-phases.md`.
- Phase 5: Rust→WASM scheduling engine — `crates/scheduler/` with CPM, cycle detection, cascade. Cloud Run deployment config in `deploy/cloudrun/`.
- Phase 6: UX improvements — undo/redo, cascade highlights, weekend collapse, critical path scoping, drag constraints, collab sync fix, column close buttons.
- Phase 7: Hierarchy enforcement, task movement & UX — see task list in `TASKS.md` under "Phase 7".
