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
  - **Clean up when done** (mandatory): see `.claude/worktrees/CLAUDE.md` for the exact cleanup procedure — stale worktrees leak disk and block branch deletion
- Do NOT add features, refactoring, or "improvements" beyond what was requested.
- Write failing tests before implementation when feasible (unit, integration — not E2E requiring deployment). Let the test define the expected behavior, then make it pass.
- Rebase on main regularly during development (`git fetch origin && git rebase origin/main`). Always rebase and re-verify before creating a PR — the branch must pass against current HEAD, not a stale base.
- Do NOT skip verification. Run `./scripts/full-verify.sh` before declaring work done.
- Do NOT enter plan mode or ask for confirmation when executing from a prompt file.
- Commit after each logical change, not just at the end.
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- If you encounter test-specific code paths in production builds, remove them.
- Keep dependencies minimal — every added dependency is attack surface.
- NEVER ask the user to paste secrets, tokens, or credentials into the conversation. Instead, tell them where to put it (e.g., GitHub Secrets UI, `.env` file, `gh secret set`).
- NEVER do any arithmetic, date/time calculation, or duration math in your head — even for "simple" operations. LLMs get these wrong routinely. Always use a tool:
  - **Any arithmetic**: `python3 -c "print(17 * 3 + 42)"` or `node -e "console.log(...)"`
  - **Date/time math**: `date -d '2026-03-06 + 17 days' +%Y-%m-%d` or `node -e "..."` with `date-fns`
  - **Business days / weekends**: `node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('2026-03-20'), d.parseISO('2026-03-06')))"` — prefer `date-fns` functions (`differenceInBusinessDays`, `addBusinessDays`, `isWeekend`) over project wrappers
  - **In code**: prefer `date-fns` directly (`differenceInCalendarDays`, `addDays`, `addBusinessDays`, `format`, `parseISO`) — project helpers in `src/utils/dateUtils.ts` and `crates/scheduler/src/date_utils.rs` exist but are thin wrappers; use the standard library when writing new code to minimize bug surface

## Error Handling Protocol
- **Level 1** (fixable): Read the error, fix the code, re-run. Try up to 3 distinct approaches.
- **Level 2** (stuck): Commit WIP with an honest message explaining what's broken and why. Move to the NEXT task — do NOT stop all work.
- **Level 3** (blocked): Commit WIP, update `.agent-status.json` with `"status": "blocked"` and a `"blocker"` message, skip dependent tasks and continue with independent ones.
- **Emergency** (out of context/crashing): `git add -A && git commit -m "emergency: saving work"`

After each major task, update `.agent-status.json` in the worktree root.

## Progress Tracking Format

Agents maintain `.agent-status.json` in the worktree root. Update it after each major task.

**Multi-agent (phase work):**
```json
{
  "group": "A",
  "phase": 14,
  "tasks": {
    "A1": { "status": "done", "tests_passing": 4, "tests_failing": 0 },
    "A2": { "status": "in_progress", "tests_passing": 2, "tests_failing": 1,
             "blocker": "cross-scope dependency not propagating" },
    "A3": { "status": "pending" }
  },
  "last_updated": "2026-03-06T14:30:00Z"
}
```

**Single-agent (issue work):**
```json
{
  "issue": 42,
  "branch": "agent/issue-42",
  "status": "in_progress",
  "tasks": {
    "read-and-understand": { "status": "done" },
    "write-tests": { "status": "in_progress" },
    "implement": { "status": "pending" },
    "verify": { "status": "pending" }
  },
  "last_updated": "2026-03-08T10:00:00Z"
}
```

**Status values:** `done`, `in_progress`, `blocked`, `pending`, `skipped`

**Updating:** JSON cannot be appended — read, parse, modify, write:
```bash
node -e "const fs=require('fs'),f='.agent-status.json',d=JSON.parse(fs.readFileSync(f,'utf8'));d.tasks['A1']={status:'done',tests_passing:3,tests_failing:0};d.last_updated=new Date().toISOString();fs.writeFileSync(f,JSON.stringify(d,null,2))"
```

On restart, read `.agent-status.json` (fall back to `claude-progress.txt` if it exists) and `git log --oneline -10` first. Skip completed tasks.

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
| `./scripts/launch-supervisor.sh <config>` | Supervisor agent drives phase pipeline |
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
- Pre-commit hook: `ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit` (rejects todo!(), stubs, commented-out tests)
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

**Creating Issues:**
- When asked to create a GitHub issue, use the template in `.github/ISSUE_TEMPLATE/agent-task.yml` via `gh issue create --template agent-task.yml`.
- Fill in all required fields: Task Summary, Acceptance Criteria, Scope Boundaries, and Estimated Complexity.

## Context Conservation
- Commit early and often — progress survives crashes and context loss.
- On restart, read `.agent-status.json` (fall back to `claude-progress.txt`) and check `git log --oneline -10`.
- Use subagents (Agent tool) for expensive file investigation to preserve main context.
- Load `.claude/skills/` on demand — only read skills relevant to the current task.
- If context is getting large, summarize findings and commit before continuing.

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

## Task Queue
See `docs/TASKS.md` for the task index. Structured task data lives in `docs/tasks/phaseN.yaml`.

## Project Status
- **Completed**: Phases 0-14. See `docs/completed-phases.md`.
- **Roadmap**: Resource assignment/leveling, baseline tracking, export (PDF/PNG/CSV).
