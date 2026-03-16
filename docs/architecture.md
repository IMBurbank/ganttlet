# Ganttlet Architecture

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

## Architecture Overview
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
- **Promotable artifacts**: Frontend and relay images must be identical across environments (dev → staging → prod). Environment-specific config (OAuth client IDs, relay URLs, allowed origins) is injected at deploy time via Cloud Run env vars or Secret Manager — never baked into the build. Test-specific code paths (e.g., `__ganttlet_setTestAuth`) must not exist in production builds. E2E tests against cloud environments inject auth externally via Playwright's `page.addInitScript()`, not via compile-time flags. See `docs/cloud-verification-plan.md` Step 3 for details.

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

**In CI:** The `e2e.yml` GitHub Actions workflow runs on pushes to main, PRs targeting main, and
manual dispatch. It sets `E2E_RELAY=1` and builds the relay binary before running Playwright.
Rust build artifacts (Cargo registry + target dirs) are cached across runs via `actions/cache`,
cutting the relay build step from ~90s to ~5s on cache hits. Artifacts (report + traces) are only
uploaded on failure. This is the safety net if an agent forgets to verify locally.

**Docker container requirements:** The Dockerfile includes Playwright's Chromium system libraries
and pre-installs the Chromium browser binary. The relay server source (`server/`) is volume-mounted,
so `cargo build --release` uses the host-persisted `server/target/` cache across container restarts.

## Cloud Verification Plan
See `docs/cloud-verification-plan.md` for the full plan to add cloud-based verification in
stages: health checks → service account smoke tests → E2E against live Cloud Run → staging
project with Secret Manager → visual regression baselines. The plan documents motivations,
GCP project layout, auth strategy, and what's done vs not yet done.

## CI/CD Pipeline

### Agent Work (`agent-work.yml`)
Triggered by `agent-ready` label on issues. Full pipeline: checkout → build → Claude Code agent → PR creation → review-fix loop → status comments. The review-fix loop runs `/code-review` (multi-agent plugin), and if issues are found, runs a fix agent to address them, then re-reviews. Max 3 iterations. Progress comments are posted on both the issue and the PR with links to the workflow run.

### PR Review (`pr-review.yml`)
Triggered on `pull_request: [opened, synchronize]`. Runs `/code-review` on non-agent, non-draft PRs with >10 insertions. Agent branches are excluded (they have their own review-fix loop).

### Code Review Plugin
Uses confidence-based scoring (threshold: 80) with 5 parallel review agents (CLAUDE.md compliance, bug scan, git history, previous PR comments, code comment compliance). See `docs/plugin-adoption-plan.md` for full plugin details.

## Hook Infrastructure

Agent guardrails are enforced via Claude Code's **PreToolUse** hooks. A compiled Rust
binary (`crates/guard/`) replaces the original `node -e` hook scripts for reliability
and performance.

**`settings.json` structure:** The `.claude/settings.json` file registers hooks by tool
matcher (e.g., `"Edit|Write"` or `"Bash"`). Each hook entry specifies a command that
receives the tool invocation as JSON on stdin.

**How checks are enforced:** PreToolUse hooks run *before* the tool executes. The guard
binary parses stdin, runs the relevant checks (protected files, workspace isolation,
push-to-main, checkout/switch, worktree removal, bash file modification), and prints a
`{"decision": "block", "reason": "..."}` JSON object to stdout to block the operation.
Empty stdout means allow.

**Fail-open on infrastructure errors:** When stdin is unavailable (ENXIO/EAGAIN/ENOENT —
common in subagent contexts), the guard exits cleanly to avoid bricking the session.

See `.claude/skills/hooks/SKILL.md` for full details: adding new checks, stdin JSON
schema, testing locally, and ENXIO history.

## Completed Work
Phases 0-14 are done, plus plugin adoption. Details in `docs/completed-phases.md`.

## Roadmap (Future)
- Resource assignment and leveling
- Baseline tracking
- Export to PDF/PNG/CSV
