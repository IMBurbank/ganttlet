# Ganttlet

Ganttlet is a free, open-source Gantt chart with real-time collaboration and two-way
Google Sheets sync. Scheduling engine runs as Rust→WASM in the browser. Real-time sync
via Yjs/Yrs CRDTs. Relay server is a stateless WebSocket forwarder.

## Code Navigation (LSP-First)
TypeScript and Rust LSP servers are available via the `LSP` tool. **Prefer LSP over Grep/Read for navigating code:**
- **goToDefinition** — jump to where a function, type, or variable is defined (instead of grepping for `function foo`)
- **findReferences** — find all callsites of a symbol with zero false positives (instead of grepping for `foo(`)
- **hover** — get type info and docs without reading surrounding code
- **documentSymbol** — list all exports/functions/types in a file (instead of reading the whole file)
- **workspaceSymbol** — search for a symbol by name across the entire codebase
- **goToImplementation** — find concrete implementations of interfaces/traits
- **incomingCalls / outgoingCalls** — trace call chains without reading every file in the chain

Use Grep/Glob/Read for: string literals, config keys, file discovery, understanding overall structure, and cross-language searches (TS↔Rust/WASM boundary). LSP is for precise, type-aware navigation — use it to avoid pulling full source files into context when you only need to trace a symbol.

## Agent Behavioral Rules (Non-Negotiable)
- Read relevant files BEFORE editing. Understand existing code before modifying it.
- Do NOT create files unless absolutely necessary. Prefer editing existing files.
- Do NOT modify files outside your assigned scope in multi-agent phases.
- Do NOT push directly to main. Always use feature branches and PRs.
- Do NOT run `git checkout` or `git switch` in `/workspace` when other agents may be running. Use git worktrees for isolation:
  - Create: `git worktree add /workspace/.claude/worktrees/<name> -b <branch>`
  - Work entirely within that directory — all git operations (commit, push) happen there
  - `/workspace` must always stay on `main` — it is the shared base for all worktrees
  - **Only clean up worktrees you created.** Never remove or modify another agent's worktree — it may be in active use. Only the user can authorize removal of worktrees you did not create. (`git worktree prune` is always safe — it only cleans stale references to already-deleted directories.)
  - **Clean up your own worktree only after its PR is merged** (mandatory): verify merge succeeded first — see `.claude/worktrees/CLAUDE.md` for the exact procedure. Premature deletion loses your ability to fix a failed merge.
- Do NOT add features, refactoring, or "improvements" beyond what was requested.
- Write failing tests before implementation when feasible (unit, integration). Let the test define the expected behavior, then make it pass. After implementation, write E2E tests for any new user-facing feature or bug fix — E2E coverage is required, not optional. E2E tests require the dev server and relay — see `docs/architecture.md` § E2E Testing & Relay for setup.
- Rebase on main regularly during development (`git fetch origin && git rebase origin/main`). Always rebase and re-verify before creating a PR — the branch must pass against current HEAD, not a stale base.
- Do NOT skip verification. Run `./scripts/full-verify.sh` before declaring work done.
- Do NOT enter plan mode or ask for confirmation when executing from a prompt file.
- Commit after each logical change, not just at the end.
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- **When fixing a pattern bug**, use LSP `findReferences` on the affected symbol to find
  all code callsites before committing. Fix all callsites atomically in one commit. Then
  use Grep for the same pattern in comments, docs, prompts, and cross-language boundaries
  (TS↔Rust/WASM) where LSP cannot reach.
- If you encounter test-specific code paths in production builds, remove them.
- Keep dependencies minimal — every added dependency is attack surface.
- NEVER ask the user to paste secrets, tokens, or credentials into the conversation. Instead, tell them where to put it (e.g., GitHub Secrets UI, `.env` file, `gh secret set`).
- NEVER compute arithmetic or dates mentally — use tools (see scheduling-engine skill for full conventions and shell functions). NEVER use `addBusinessDays` directly for end dates — use `taskEndDate`.
- When you discover a non-obvious gotcha or debugging insight, append it to the relevant skill's "Lessons Learned" section (`.claude/skills/<skill>/SKILL.md`). Only append if you've confirmed the behavior by reading the relevant source or running a test — do not write speculative lessons.


## Commands Quick Reference
| Command | Purpose |
|---------|---------|
| `npm run dev` | Build WASM + start Vite dev server (port 5173) |
| `npm run build` | WASM + tsc + production build |
| `npm run build:wasm` | Build Rust scheduler to WASM only |
| `npm run test` | Unit tests (Vitest) |
| `npm run e2e:collab` | E2E tests with relay server |
| `./scripts/full-verify.sh` | **Full verification** (tsc + vitest + cargo test + E2E) |
| `ATTEST_E2E=1 ./scripts/full-verify.sh` | Full verify + post E2E attestation (skips CI re-run) |
| `./scripts/attest-e2e.sh` | Post E2E attestation for HEAD (after verify passes) |
| `cd crates/scheduler && cargo test` | Rust unit tests |
| `docker compose run --service-ports dev` | Enter dev container |
| `docker compose up --build relay` | Build + run relay server locally |
| `claude --dangerously-skip-permissions` | Start Claude without permission checks |
| `./scripts/launch-supervisor.sh <config>` | Supervisor agent drives phase pipeline |
| `./scripts/launch-supervisor.sh --tmux <config>` | Supervisor with direct tmux agent control |
| `./scripts/launch-phase.sh <config> <cmd>` | Run pipeline step (stage/merge/validate/create-pr) |

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
- Pre-commit hook: `ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit` (auto-formats staged files, rejects todo!(), stubs, commented-out tests)
- Git workflow: `main` always deployable, feature branches, PRs before merge
- **Guard binary** (required by `.claude/settings.json` hooks): built automatically by `docker-entrypoint.sh` on container start. Outside Docker, run: `cargo build --release -p guard`

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
- E2E tests run automatically as part of full-verify (sets `E2E_RELAY=1`).
- After pushing, run `./scripts/attest-e2e.sh` to post the `e2e-verified` commit status. This satisfies the merge requirement without waiting for CI to re-run E2E. Or use `ATTEST_E2E=1 ./scripts/full-verify.sh` to auto-attest on success.
- If E2E tests fail due to infrastructure (relay build, Chromium), note this in your summary — but never skip writing E2E tests for new features.

**PR Creation:**
- `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}`
- Write a summary: what changed, what tests added, what couldn't be done

**If Stuck:**
- Follow the Error Handling Protocol above.
- Commit WIP with clear status message.
- Write `.agent-summary.md` explaining where you got stuck.
- The PR will be created even with partial work — human reviewers can help.

**Creating Issues:**
- When asked to create a GitHub issue, use the template in `.github/ISSUE_TEMPLATE/agent-task.yml` via `gh issue create --template agent-task.yml`.
- Fill in all required fields: Task Summary, Acceptance Criteria, Scope Boundaries, and Estimated Complexity.

## Context Conservation
- Commit early and often — progress survives crashes and context loss.
- On restart, read `.agent-status.json` (fall back to `claude-progress.txt`) and check `git log --oneline -10`.
- Use subagents (Agent tool) for expensive file investigation to preserve main context.
- Load `.claude/skills/` on demand — only read skills relevant to the current task.
- If context is getting large, summarize findings and commit before continuing.
- **Maintain agent structure maps**: If you add, rename, or delete directories, update the project structure map in `.claude/agents/codebase-explorer.md` to match. Do this before context compaction, not at the end of a session. Run `./scripts/lint-agent-paths.sh` to verify.

## Reference Docs & Skills
- `docs/architecture.md` — Tech stack, architecture principles/constraints, E2E testing, deployment
- `docs/multi-agent-guide.md` — launch-phase.sh usage, Claude CLI reference, phase setup
- `docs/completed-phases.md` — Detailed notes on phases 0-14 (auth, sync, deployment, agent infra, drag reliability)
- `docs/cloud-verification-plan.md` — Cloud-based verification stages and GCP layout
- `docs/TASKS.md` — Task queue index; structured data in `docs/tasks/phaseN.yaml`
- `.claude/skills/` — Domain-specific skills (loaded on demand):
  - `scheduling-engine` — CPM, cascade, constraints, crates/scheduler/ patterns
  - `e2e-testing` — Playwright, relay server, collab test patterns
  - `multi-agent-orchestration` — launch-phase.sh, prompts, worktrees, CLI reference
  - `google-sheets-sync` — Sheets API, OAuth, sync modules
  - `cloud-deployment` — Cloud Run, GCP, staging/prod environments
  - `issue-workflow` — Single-agent issue procedures, error handling
  - `rust-wasm` — WASM build, wasm-pack, Rust→JS bindings
  - `shell-scripting` — Bash patterns, pipe exit codes, heredoc quoting
  - `hooks` — Guard binary, PreToolUse/PostToolUse hooks, adding new checks
- `.claude/agents/` — Subagents (auto-delegated, isolated context windows):
  - `codebase-explorer` — Read-only exploration, returns structured reports (haiku)
  - `rust-scheduler` — Scheduling engine specialist for crates/scheduler/ (sonnet)
  - `verify-and-diagnose` — Runs tsc/vitest/cargo test, diagnoses failures (sonnet)
  - `plan-reviewer` — Pre-launch phase review for scope overlap, dependencies, completeness (haiku)

## Task Queue
See `docs/TASKS.md` for the task index. Structured task data lives in `docs/tasks/phaseN.yaml`.

## Project Status
- **Completed**: Phases 0-15. See `docs/completed-phases.md`.
- **Roadmap**: Resource assignment/leveling, baseline tracking, export (PDF/PNG/CSV).
