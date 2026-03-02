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

### Multi-Agent Orchestration
Phases are executed via `scripts/launch-phase.sh`, which handles worktree setup, parallel agent
launch, retry-on-crash, merge verification, and sequential stage gating.

```bash
# Full pipeline: parallel groups → merge → sequential group
./scripts/launch-phase.sh all

# Or run stages individually:
./scripts/launch-phase.sh stage1    # launch parallel groups in worktrees
./scripts/launch-phase.sh merge     # merge to main + verify
./scripts/launch-phase.sh stage2    # launch sequential group on main
./scripts/launch-phase.sh status    # show worktree/branch status
```

**Agent prompts** live in `docs/prompts/` as standalone files (one per group). Each prompt:
- Lists the exact files the agent may modify (zero overlap between parallel groups)
- Instructs the agent to skip plan mode and execute without confirmation
- Includes retry context so restarted agents resume where they left off

**Unplanned issues** are triaged in `docs/unplanned-issues.md` using a Backlog → Claimed → Planned
workflow. Planning agents claim up to 3 items, plan them into `TASKS.md`, then mark them planned.

### Adding a New Phase
1. Create prompt files in `docs/prompts/` (e.g., `groupA.md`, `groupB.md`, `groupC.md`)
2. Define file ownership, interface contracts, and execution order in this file
3. Add tasks to `TASKS.md`
4. Update the config block at the top of `scripts/launch-phase.sh` (phase name, group→branch map, merge order)
5. Run `./scripts/launch-phase.sh all`

## Task Queue
See `TASKS.md` for claimable tasks and claiming convention.

## Phase 6: Gantt Chart UX Improvements (DONE)
Ten UX fixes and features, split into three parallel agent groups with zero file overlap.
Details in `TASKS.md` under "Phase 6".

## Phase 7: Hierarchy Enforcement, Task Movement & UX Improvements (DONE)
Ten issues addressing hierarchy enforcement, task reparenting, and UX polish.
Completed across three parallel agent groups (A, B, C). All merged to main.

## Phase 8: Bug Fixes, OKR Enhancement, Cascade UX & Deployment (IN PROGRESS)
Fixes Phase 7 regressions, adds OKR picker, improves cascade visuals, sets up E2E testing, and deploys to Google Cloud.
See `docs/unplanned-issues.md` for the original issue list.

### Agent Groups & File Ownership
```
Group A (Table Editing + OKR)            Group B (Critical Path + Cascade)       Group C (Testing + Deployment)
  src/components/table/InlineEdit.tsx      crates/scheduler/src/cpm.rs             playwright.config.ts (new)
  src/components/table/TaskRow.tsx         crates/scheduler/src/types.rs           e2e/ (new directory)
  src/components/table/TaskTable.tsx       crates/scheduler/src/lib.rs             deploy/frontend/ (new directory)
  src/data/fakeData.ts                     src/utils/schedulerWasm.ts              package.json (Playwright dep only)
  src/components/shared/OKRPickerModal.tsx (new)  src/components/gantt/CascadeHighlight.tsx
                                           src/components/gantt/GanttChart.tsx
                                           src/state/ganttReducer.ts
                                           src/types/index.ts
                                           src/state/GanttContext.tsx
                                           src/state/actions.ts
```

### Interface Contracts

**Contract 1 — CascadeShift state** (Group B adds to types + reducer):
```typescript
// Added to GanttState in src/types/index.ts:
interface CascadeShift { taskId: string; fromStartDate: string; fromEndDate: string; }
// cascadeShifts: CascadeShift[]  — populated by CASCADE_DEPENDENTS, cleared after 2s

// Added to GanttAction in src/state/actions.ts:
| { type: 'SET_CASCADE_SHIFTS'; shifts: CascadeShift[] }
```

**Contract 2 — OKR picker modal** (Group A creates, standalone component):
```typescript
// src/components/shared/OKRPickerModal.tsx
interface OKRPickerModalProps {
  taskId: string;
  currentOkrs: string[];
  availableOkrs: string[];
  onSave: (okrs: string[]) => void;
  onClose: () => void;
}
```

### Execution Order
- Groups A and B run in parallel (zero file overlap)
- Group C starts after A+B merge to main
- Within Group A: A1 → A2 → A3 → A4
- Within Group B: B1 → B2 → B3 (rebuild WASM) → B4 → B5

### Issues Addressed
| # | Issue | Priority | Group |
|---|-------|----------|-------|
| 1 | Major bug: most cells no longer editable | P0 | A |
| 2 | Major bug: workstream critical path crashes app | P0 | B |
| 3 | Bug: critical path not highlighting full chain | P1 | B |
| 4 | OKR selection for tasks + seed data | P2 | A |
| 5 | Cascade highlighting jittery → shadow trail | P2 | B |
| 6 | Automatic UI verification (E2E/visual tests) | P3 | C |
| 7 | Deploy to Google Cloud | P4 | C |

## Roadmap (Future)
- Resource assignment and leveling
- Baseline tracking
- Export to PDF/PNG/CSV

## Completed Work
Phases 0-7 are done (scaffolding, bug fixes, tests, Google Sheets sync, real-time collab, WASM scheduler, UX improvements, hierarchy enforcement).
Details in `docs/completed-phases.md`.
- Phase 5: Rust→WASM scheduling engine — `crates/scheduler/` with CPM, cycle detection, cascade. Cloud Run deployment config in `deploy/cloudrun/`.
- Phase 6: UX improvements — undo/redo, cascade highlights, weekend collapse, critical path scoping, drag constraints, collab sync fix, column close buttons.
- Phase 7: Hierarchy enforcement, task reparenting, dependency validation, auto-focus, pane collapse, task bar popover, workstream critical path scope.
