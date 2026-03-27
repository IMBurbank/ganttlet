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
- Use git worktrees for isolation — see `.claude/worktrees/CLAUDE.md` for procedures. `/workspace` must always stay on `main`.
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
- **Guard binary** required by hooks. Built automatically in Docker; outside Docker: `cargo build --release -p guard`
- **SDK `.claude/skills/` edit patch** required for curation curators. Claude Code v2.1.81 has a bug ([#37157](https://github.com/anthropics/claude-code/issues/37157)) where `.claude/skills/` is missing from the protected-directory exemption list, blocking Edit/Write in SDK mode. Run `python3 scripts/patch-sdk-skills-permission.py` after `npm install`. The patch modifies minified code in the SDK binary — if you encounter unexpected permission behavior (edits to `.claude/settings.json` succeeding when they shouldn't, or new errors after an SDK update), this patch may be the cause. The script is version-sensitive and will warn if the SDK changes, but verify carefully after any `npm install` that updates the SDK. See `docs/sdk-skill-edit-findings.md` for the full investigation.
- When you discover a non-obvious gotcha or debugging insight, write a debrief report (the verify hook will remind you and point to the template at `docs/prompts/curation/debrief-template.md`).

## Architecture Constraints (do not violate)
- **Y.Doc is live session state**: All task mutations flow through Y.Doc transactions. Three mutation sources (local, remote peer, Sheets injection) → one consumption path via Y.Doc observation → TaskStore.
- **Google Sheets is durable truth**: Sheets is the single source of truth for persistence. Y.Doc is the live collaborative session; Sheets survives beyond sessions. Y.Doc is always rebuildable from Sheets.
- **Schema migration system**: `src/schema/migrations.ts` registry + `migrateDoc()` in ydoc.ts. Major/minor versions. `FIELD_REGISTRY` drives serialization. `writeTaskToDoc()` is the only write path. See `src/CLAUDE.md` for details.
- **Structural rules**: `src/__tests__/structuralRules.test.ts` enforces: no RefObject in hook return types, no `.getState()` in JSX render expressions, no raw origin strings in transact(). These tests fail with prescriptive fix messages.
- **Thin server**: Relay forwards CRDT messages + validates OAuth. No business logic, no persistent state, no Sheets access.
- **Browser-first**: All scheduling, rendering, Sheets I/O, and data transformation runs in the browser.
- **Compute-first + atomic transact**: Mutations read current state, compute cascade in WASM (outside transaction), then write all changes in one `doc.transact()` call. One undo step per user action.
- **Commit-on-drop pattern**: During drag, only CSS transforms are applied (zero Y.Doc writes). On mouseup, `moveTask()` writes once atomically.
- **Promotable artifacts**: Images identical across environments. Config injected at deploy time via env vars / Secret Manager.
- **Minimal dependencies**: Keep the dependency tree small on both client and server.

## Reference Docs & Skills
- `docs/architecture.md` — Tech stack, architecture principles/constraints, E2E testing, deployment
- `docs/multi-agent-guide.md` — launch-phase.sh usage, Claude CLI reference, phase setup
- `docs/completed-phases.md` — Detailed notes on phases 0-16, 18, 20 (auth, sync, deployment, agent infra, drag reliability, frontend redesign)
- `docs/cloud-verification-plan.md` — Cloud-based verification stages and GCP layout
- `docs/TASKS.md` — Task queue index; structured data in `docs/tasks/phaseN.yaml`
- `.claude/skills/` — Domain-specific skills (loaded on demand):
  - `scheduling-engine` — CPM, cascade, constraints, WASM build, crates/scheduler/ patterns
  - `e2e-testing` — Playwright, relay server, collab test patterns
  - `multi-agent-orchestration` — launch-phase.sh, prompts, worktrees, CLI reference
  - `google-sheets-sync` — Sheets API, OAuth, sync modules
  - `cloud-deployment` — Cloud Run, GCP, staging/prod environments
  - `issue-workflow` — Single-agent issue procedures, error handling
  - `shell-scripting` — Bash patterns, pipe exit codes, heredoc quoting
  - `hooks` — Guard binary, PreToolUse/PostToolUse hooks, adding new checks
  - `curation` — Skill curation process, debrief reports, prompt templates
- `.claude/agents/` — Subagents (auto-delegated, isolated context windows):
  - `codebase-explorer` — Read-only exploration, returns structured reports (haiku)
  - `rust-scheduler` — Scheduling engine specialist for crates/scheduler/ (sonnet)
  - `verify-and-diagnose` — Runs tsc/vitest/cargo test, diagnoses failures (sonnet)
  - `plan-reviewer` — Pre-launch phase review for scope overlap, dependencies, completeness (haiku)
  - `skill-reviewer` — Reviews skill files from 5 angles for curation (sonnet)

## Task Queue
See `docs/TASKS.md` for the task index. Structured task data lives in `docs/tasks/phaseN.yaml`.

## Project Status
- **Completed**: Phases 0-16, 18, 20. See `docs/completed-phases.md`.
- **Roadmap**: Resource assignment/leveling, baseline tracking, export (PDF/PNG/CSV).
