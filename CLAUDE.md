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

## Phase 6: Gantt Chart UX Improvements (IN PROGRESS)
Ten UX fixes and features, split into three parallel agent groups with zero file overlap.

### Agent Groups & File Ownership
```
Group A (WASM Scheduler)         Group B (State + Sync)           Group C (UI + Visual)
  crates/scheduler/src/*           src/state/actions.ts             src/components/gantt/TaskBar.tsx
  src/utils/schedulerWasm.ts       src/state/ganttReducer.ts        src/components/gantt/GanttChart.tsx
                                   src/state/GanttContext.tsx        src/components/gantt/DependencyLayer.tsx
                                   src/collab/yjsBinding.ts         src/components/gantt/TimelineHeader.tsx
                                   src/types/index.ts               src/components/gantt/GridLines.tsx
                                                                    src/components/gantt/CascadeHighlight.tsx (new)
                                                                    src/components/gantt/SlackIndicator.tsx (new)
                                                                    src/components/table/ColumnHeader.tsx
                                                                    src/components/shared/DependencyEditorModal.tsx
                                                                    src/components/shared/UndoRedoButtons.tsx (new)
                                                                    src/components/layout/Toolbar.tsx
                                                                    src/utils/dateUtils.ts
```

### Interface Contracts
**Contract 1 — WASM functions** (Group A provides, B+C consume):
```typescript
export function computeEarliestStart(tasks: Task[], taskId: string): string | null;
export function cascadeDependentsWithIds(tasks: Task[], movedTaskId: string, daysDelta: number): { tasks: Task[]; changedIds: string[] };
export function computeCriticalPathScoped(tasks: Task[], scope: CriticalPathScope): Set<string>;
```

**Contract 2 — New action types** (Group B defines):
```typescript
| { type: 'UNDO' } | { type: 'REDO' }
| { type: 'SET_LAST_CASCADE_IDS'; taskIds: string[] }
| { type: 'SET_CRITICAL_PATH_SCOPE'; scope: CriticalPathScope }
| { type: 'TOGGLE_COLLAPSE_WEEKENDS' }
```

**Contract 3 — New state fields** (Group B adds to GanttState):
```typescript
undoStack: Task[][]; redoStack: Task[][]; lastCascadeIds: string[];
criticalPathScope: CriticalPathScope; collapseWeekends: boolean;
```

### Execution Order
- Groups A and B run in parallel
- Group C starts after A4 and B2 complete (needs WASM functions + new state fields)
- Within-group parallelism noted in TASKS.md

### Known Bugs Being Fixed
1. `CASCADE_DEPENDENTS` missing from `applyActionToYjs()` switch — cascades don't sync to collab
2. Backward drag past dependency constraint crashes app — no constraint enforcement
3. Critical path marks standalone tasks — should only highlight connected chains
4. Dependency modal click-outside broken — backdrop div intercepts clicks

## Roadmap (Future)
- Resource assignment and leveling
- Baseline tracking
- Export to PDF/PNG/CSV

## Completed Work
Phases 0-5 are done (scaffolding, bug fixes, tests, Google Sheets sync, real-time collab, WASM scheduler).
Details in `docs/completed-phases.md`.
- Phase 5: Rust→WASM scheduling engine — `crates/scheduler/` with CPM, cycle detection, cascade. Cloud Run deployment config in `deploy/cloudrun/`.
- Phase 6: UX improvements — see task list in `TASKS.md` under "Phase 6".
