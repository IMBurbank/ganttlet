# Ganttlet

Ganttlet is a free, open-source Gantt chart with real-time collaboration and two-way
Google Sheets sync. Scheduling engine runs as Rust→WASM in the browser. Real-time sync
via Yjs/Yrs CRDTs. Relay server is a stateless WebSocket forwarder.

## Agent Behavioral Rules (Non-Negotiable)
- Read relevant files BEFORE editing. Understand existing code before modifying it.
- Do NOT create files unless absolutely necessary. Prefer editing existing files.
- Do NOT modify files outside your assigned scope in multi-agent phases.
- Do NOT push directly to main. Always use feature branches and PRs.
- Do NOT add features, refactoring, or "improvements" beyond what was requested.
- Do NOT skip verification. Run `./scripts/full-verify.sh` before declaring work done.
- Do NOT enter plan mode or ask for confirmation when executing from a prompt file.
- Commit after each logical change, not just at the end.
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- If you encounter test-specific code paths in production builds, remove them.
- Keep dependencies minimal — every added dependency is attack surface.

## Error Handling Protocol
- **Level 1** (fixable): Read the error, fix the code, re-run. Try up to 3 distinct approaches.
- **Level 2** (stuck): Commit WIP with an honest message explaining what's broken and why. Move to the NEXT task — do NOT stop all work.
- **Level 3** (blocked): Commit WIP, write `BLOCKED` in `claude-progress.txt` with details, skip dependent tasks and continue with independent ones.
- **Emergency** (out of context/crashing): `git add -A && git commit -m "emergency: saving work"`

After each major task, append status to `claude-progress.txt` in the worktree root.

## Commands Quick Reference
| Command | Purpose |
|---------|---------|
| `npm run dev` | Build WASM + start Vite dev server (port 5173) |
| `npm run build` | WASM + tsc + production build |
| `npm run build:wasm` | Build Rust scheduler to WASM only |
| `npm run test` | Unit tests (Vitest) |
| `npm run e2e:collab` | E2E tests with relay server |
| `./scripts/full-verify.sh` | **Full verification** (tsc + vitest + cargo test + E2E) |
| `cd crates/scheduler && cargo test` | Rust unit tests |
| `docker compose run --service-ports dev` | Enter dev container |
| `docker compose up --build relay` | Build + run relay server locally |
| `claude --dangerously-skip-permissions` | Start Claude without permission checks |

## Architecture Constraints (do not violate)
- **Thin server**: Relay forwards CRDT messages + validates OAuth. No business logic, no persistent state, no Sheets access.
- **Google Sheets as durable store**: Sheets is the single source of truth. No application database.
- **Browser-first**: All scheduling, rendering, Sheets I/O, and data transformation runs in the browser.
- **Promotable artifacts**: Images identical across environments. Config injected at deploy time via env vars / Secret Manager.
- **Minimal dependencies**: Keep the dependency tree small on both client and server.

## Development Environment
- Docker-based: `docker compose run --service-ports dev` to enter container
- Vite on port 5173 (localhost:5173)
- PostToolUse hook (`scripts/verify.sh`) auto-runs `tsc` + `vitest` after `.ts/.tsx` edits
- Git workflow: `main` always deployable, feature branches, PRs before merge

## Single-Agent Issue Workflow

When working from a GitHub issue (via `agent-ready` label or manual assignment):

**Setup:**
- Branch: `agent/issue-{number}`
- Read the issue carefully. Identify acceptance criteria and scope boundaries.
- If the issue lacks acceptance criteria, write your own based on the description.

**Implementation:**
- Read relevant files BEFORE editing. Understand current behavior first.
- Write/update tests FIRST, then implement.
- Commit after each logical change (not just at the end).

**Verification:**
- Run `./scripts/full-verify.sh` before declaring done.
- If E2E tests fail but unit tests pass, note this in your summary.

**PR Creation:**
- `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}`
- Write a summary: what changed, what tests added, what couldn't be done

**If Stuck:**
- Follow the Error Handling Protocol above.
- Commit WIP with clear status message.
- Write `.agent-summary.md` explaining where you got stuck.
- The PR will be created even with partial work — human reviewers can help.

## Context Conservation
- Commit early and often — progress survives crashes and context loss.
- On restart, read `claude-progress.txt` first and check `git log --oneline -10`.
- Use subagents (Agent tool) for expensive file investigation to preserve main context.
- Load `.claude/skills/` on demand — only read skills relevant to the current task.
- If context is getting large, summarize findings and commit before continuing.

## Reference Docs & Skills
- `docs/architecture.md` — Tech stack, architecture principles/constraints, E2E testing, deployment
- `docs/multi-agent-guide.md` — launch-phase.sh usage, Claude CLI reference, phase setup
- `docs/completed-phases.md` — Detailed notes on phases 0-12 (auth, sync, deployment)
- `docs/cloud-verification-plan.md` — Cloud-based verification stages and GCP layout
- `docs/TASKS.md` — Claimable task queue and claiming convention
- `.claude/skills/` — Domain-specific skills (loaded on demand):
  - `scheduling-engine` — CPM, cascade, constraints, crates/scheduler/ patterns
  - `e2e-testing` — Playwright, relay server, collab test patterns
  - `multi-agent-orchestration` — launch-phase.sh, prompts, worktrees, CLI reference
  - `google-sheets-sync` — Sheets API, OAuth, sync modules
  - `cloud-deployment` — Cloud Run, GCP, staging/prod environments
  - `issue-workflow` — Single-agent issue procedures, error handling
  - `rust-wasm` — WASM build, wasm-pack, Rust→JS bindings
  - `shell-scripting` — Bash patterns, pipe exit codes, heredoc quoting

## Task Queue
See `docs/TASKS.md` for claimable tasks and claiming convention.

## Project Status
- **Completed**: Phases 0-12. See `docs/completed-phases.md`.
- **Roadmap**: Resource assignment/leveling, baseline tracking, export (PDF/PNG/CSV).
