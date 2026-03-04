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
- **Testing**: Vitest + jsdom (unit), Playwright + Chromium (E2E, including collaboration)

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
- `npm run e2e` — Run E2E tests (collab tests skip if relay not running)
- `npm run e2e:collab` — Run E2E tests with relay (builds relay if needed, starts it automatically)
- `./scripts/full-verify.sh` — **Full verification suite for agents** (tsc + vitest + cargo test + E2E with relay). Run this before declaring work done.
- `cd crates/scheduler && cargo test` — Run Rust unit tests
- `docker compose run --service-ports dev` — Enter the dev container
- `docker compose exec dev bash` — Attach to running container
- `docker compose up --build relay` — Build and run relay server locally (logs to stdout)
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
./scripts/launch-phase.sh resume stage2  # resume pipeline from a specific step
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

### Claude CLI Reference (for launch scripts)
The `claude` binary in the dev container has specific constraints. When writing or modifying
`launch-phase.sh` or any script that invokes claude programmatically, follow these rules:

- **`--prompt-file` does not exist.** Never use it. It will cause `error: unknown option`.
- **WATCH mode** (tmux, auto-exit with streaming output): Use `-p` with a positional argument:
  ```bash
  claude --dangerously-skip-permissions -p "$(cat '/path/to/prompt.md')"
  ```
  The `-p` flag ensures claude exits after completing the prompt. The tmux window
  captures the streaming text output and stays open (via `; read`) for scrollback review.
  Note: `-p` mode shows streaming text, not the full rich TUI (no thinking blocks or
  tool-use panels), but the agent output is still visible.
- **Headless/pipe mode** (non-WATCH, logging to file): Pipe via stdin with `-p`:
  ```bash
  cat prompt.md | claude --dangerously-skip-permissions -p -
  ```
- **Pure interactive mode** (manual use only): Pass prompt as positional arg without `-p`:
  ```bash
  claude --dangerously-skip-permissions "$(cat '/path/to/prompt.md')"
  ```
  Shows full rich TUI but does NOT auto-exit — claude waits for more input. Do NOT use
  this in orchestrated pipelines because the exit code file is never written until the
  user manually types `exit`.
- **Validation log parsing**: The `script` command logs the entire command (including the
  prompt text) as its first line. Any `grep` checks on validation logs must exclude the
  `COMMAND=` header line, otherwise prompt template strings like `OVERALL.*FAIL` will
  cause false positive failure detection. Use: `grep -v "COMMAND=" "$logfile" | grep -q "PATTERN"`
- **`setup_worktree()` stdout isolation**: The function returns the worktree path via stdout
  (`echo "$worktree"`). ALL other output inside the function (log messages, git commands, npm
  install) MUST be redirected to `/dev/null` or `>&2`. Use `>/dev/null 2>&1` on git and npm
  commands. If stdout is contaminated, `build_claude_cmd()` generates a broken `cd` path and
  the agent exits immediately with code 1.
- **Key flags**: `--dangerously-skip-permissions`, `-p` (print/pipe mode), `-c` (continue),
  `-r` (resume session), `--system-prompt`, `--model`, `--max-budget-usd`

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
- Full verification: `./scripts/full-verify.sh` (runs tsc, vitest, cargo test, and E2E with relay)
- Open a PR with `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}` for auto-closing
- Commit often with descriptive messages

## E2E Testing & Relay
Playwright E2E tests live in `e2e/`. The collaboration tests (`e2e/collab.spec.ts`) require the
relay server to be running — without it, they silently skip via `test.skip()`.

**How the relay starts:** Setting `E2E_RELAY=1` tells `playwright.config.ts` to add the relay
as a second `webServer`. Playwright runs `cargo build --release` in `server/` (a no-op if nothing
changed — Cargo caches aggressively) then starts the binary and waits for port 4000 before
running tests.

**For agents:** Always use `./scripts/full-verify.sh` for final verification. It sets `E2E_RELAY=1`
automatically, so collab tests (presence indicators, cross-tab sync) actually run instead of
skipping. Never use bare `npm run e2e` as the final check — that skips collab tests silently.

**In CI:** The `e2e.yml` GitHub Actions workflow sets `E2E_RELAY=1` and builds the relay binary
before running Playwright. This is the safety net if an agent forgets locally.

**Docker container requirements:** The Dockerfile includes Playwright's Chromium system libraries
and pre-installs the Chromium browser binary. The relay server source (`server/`) is volume-mounted,
so `cargo build --release` uses the host-persisted `server/target/` cache across container restarts.

## Task Queue
See `TASKS.md` for claimable tasks and claiming convention.

## Completed Work
Phases 0-11 are done. Details in `docs/completed-phases.md`.

## Roadmap (Future)
- Resource assignment and leveling
- Baseline tracking
- Export to PDF/PNG/CSV
