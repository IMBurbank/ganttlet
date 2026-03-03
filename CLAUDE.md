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
- `gcloud auth login --no-launch-browser` — Authenticate gcloud inside the container
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
4. Update the config block at the top of `scripts/launch-phase.sh`:
   - `STAGE1_GROUPS`/`STAGE1_BRANCHES`/`STAGE1_MERGE_MESSAGES` for the first parallel set
   - `STAGE2_GROUPS`/`STAGE2_BRANCHES`/`STAGE2_MERGE_MESSAGES` for the second parallel set (leave empty arrays if single-stage)
5. Run `./scripts/launch-phase.sh all` (executes: stage1 → merge1 → stage2 → merge2)

### Single-Agent Issue Work
When working from a GitHub issue (via the `agent-ready` label workflow or manual assignment):
- Branch naming: `agent/issue-{number}`
- Full verification: `npm run build:wasm && npx tsc --noEmit && npm run test && cd crates/scheduler && cargo test`
- Open a PR with `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}` for auto-closing
- Commit often with descriptive messages

## Task Queue
See `TASKS.md` for claimable tasks and claiming convention.

## Completed Work
Phases 0-9 are done. Details in `docs/completed-phases.md`.

## Roadmap (Future)
- Resource assignment and leveling
- Baseline tracking
- Export to PDF/PNG/CSV
