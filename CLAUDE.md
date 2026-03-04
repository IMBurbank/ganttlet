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

## Architecture Constraints (do not violate these)
- **Thin server**: The relay server forwards CRDT messages and validates OAuth tokens. It must not contain business logic, store persistent state, or access Google Sheets data.
- **Google Sheets as durable store**: Google Sheets is the single source of truth for project data. There is no application database.
- **Minimal dependencies, high security posture**: Keep the dependency tree small on both client and server — every added dependency is attack surface.
- **Browser-first business logic**: All scheduling, rendering, Sheets I/O, and data transformation runs in the browser.

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
# Full pipeline: parallel groups → merge → validate
./scripts/launch-phase.sh all

# Same pipeline with live interactive agent output in tmux panes
WATCH=1 ./scripts/launch-phase.sh all

# Or run stages individually:
./scripts/launch-phase.sh stage1    # launch parallel groups in worktrees
./scripts/launch-phase.sh merge1    # merge Stage 1 branches to main + verify
./scripts/launch-phase.sh stage2    # launch Stage 2 groups (if any)
./scripts/launch-phase.sh merge2    # merge Stage 2 branches to main + verify
./scripts/launch-phase.sh stage3    # launch Stage 3 groups (if any)
./scripts/launch-phase.sh merge3    # merge Stage 3 branches to main + verify
./scripts/launch-phase.sh validate  # run validation agent (fix-and-retry)
./scripts/launch-phase.sh status    # show worktree/branch status
```

**WATCH mode** (`WATCH=1`): Runs each agent in its own tmux window with full interactive
output (tool calls, diffs, thinking — the same as running `claude` directly in a terminal).
The orchestrator still handles worktree setup, merge gating, and validation automatically.
Attach with `tmux attach -t <phase>-agents`, switch windows with `Ctrl-B N`/`P`, detach
with `Ctrl-B D`.

**Agent prompts** live in `docs/prompts/` as standalone files (one per group). Each prompt:
- Lists the exact files the agent may modify (zero overlap between parallel groups)
- Instructs the agent to skip plan mode and execute without confirmation
- Includes retry context so restarted agents resume where they left off

**Validation prompt** (`docs/prompts/validate.md`) runs after merge. It:
- Executes all test suites (Rust, TypeScript, Vitest, Playwright E2E)
- If anything fails, diagnoses and fixes the issue, then re-runs
- Retries up to `VALIDATE_MAX_ATTEMPTS` (default 3) fix-and-retry cycles
- Prints a final pass/fail report table

**Unplanned issues** are triaged in `docs/unplanned-issues.md` using a Backlog → Claimed → Planned
workflow. Planning agents claim up to 3 items, plan them into `TASKS.md`, then mark them planned.

### Pre-Phase Checklist
Before launching any phase, **always commit all planning work** so there is a safe point to
revert to if something goes wrong:
1. Track any new untracked files (`git add` prompt files, TASKS.md, config files, etc.)
2. Commit with a descriptive message (e.g., "prep: phase 12 planning — prompts, tasks, launch config")
3. Verify `git status` is clean before running `launch-phase.sh`

This prevents `git reset --hard` from destroying planning work if a phase run needs to be reverted.

### Adding a New Phase
1. Create prompt files in `docs/prompts/` (e.g., `groupA.md`, `groupB.md`, `groupC.md`)
2. Define file ownership, interface contracts, and execution order in this file
3. Add tasks to `TASKS.md`
4. Update the config block at the top of `scripts/launch-phase.sh`:
   - `STAGE1_GROUPS`/`STAGE1_BRANCHES`/`STAGE1_MERGE_MESSAGES` for the first parallel set
   - `STAGE2_GROUPS`/`STAGE2_BRANCHES`/`STAGE2_MERGE_MESSAGES` for the second parallel set (leave empty arrays if single-stage)
   - `STAGE3_GROUPS`/`STAGE3_BRANCHES`/`STAGE3_MERGE_MESSAGES` for a third parallel set (leave empty arrays if not needed)
5. Optionally create `docs/prompts/validate.md` for post-merge validation
6. Run `./scripts/launch-phase.sh all` (executes: stage1 → merge1 → ... → merge3 → validate)

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
Phases 0-11 are done. Details in `docs/completed-phases.md`.

## Roadmap (Future)
- Resource assignment and leveling
- Baseline tracking
- Export to PDF/PNG/CSV
