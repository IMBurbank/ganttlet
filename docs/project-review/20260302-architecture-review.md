# Ganttlet Architecture & Workflow Review

**Date:** March 2, 2026
**Scope:** Design choices, security posture, deployment pipeline, multi-agent workflow, and comparison to industry best practices.

---

## Executive Summary

Ganttlet's core architecture is well-conceived: a browser-first app with Rust/WASM scheduling, CRDT-based collaboration, and Google Drive as the ACL layer. The multi-agent development workflow is ahead of most teams. The main areas to address before sharing publicly are: hardening the Sheets sync layer (the project's core value prop), fixing a few concrete security gaps, and adding CI/CD automation.

This review covers six areas, each with specific findings and recommendations.

---

## 1. Architecture & Design Choices

### What's Working Well

**Browser-first with a thin relay server** is the right call. All business logic (CPM scheduling, rendering, Sheets I/O) runs client-side, which means the server is simple, stateless, and cheap to operate. The relay only forwards CRDT updates — it holds no business state and can crash without data loss.

**Rust to WASM for the scheduling engine** is a strong choice. It gives you near-native performance for CPM and cycle detection while keeping the deployment model purely browser-based. The separation as a standalone crate (`crates/scheduler/`) with its own test suite is clean.

**Google Drive as the ACL layer** avoids building a custom auth/permissions system entirely. Users share a Google Sheet, and Ganttlet derives read/write permissions from Drive sharing. This is elegant and dramatically reduces attack surface compared to a bespoke permissions system.

**Yjs/Yrs for real-time collaboration** is the industry standard for CRDT-based sync. Using Yrs (the Rust port) on the server and Yjs on the client keeps the stack consistent.

### Google Sheets Sync: Strengthening the Core

Google Sheets is central to Ganttlet's value proposition, so the question isn't whether to use it — it's how to make the sync layer more robust. After reading the implementation in `sheetsSync.ts`, `sheetsClient.ts`, and the state flow through `GanttContext.tsx`, here are the specific issues and fixes:

**No retry or backoff on API failures.** When a Sheets read fails (`loadFromSheet`), it catches the error, logs it, and returns an empty array. When a write fails (`scheduleSave`), it logs and dispatches `RESET_SYNC`. Neither retries. Since the Sheets API returns 429 when rate-limited, the sync should implement exponential backoff with jitter — start at 1s, double up to 60s, add random jitter to avoid thundering herd when multiple users hit the same sheet.

**Atomic full-sheet replacement on every write.** Each save calls `clearSheet()` then `writeSheet()` with every row. This is a two-step operation: if the app crashes between clear and write, the sheet is empty. And for a 500-row project, you're writing 500 rows on every 2-second debounce even if one cell changed. Switching to `batchUpdate` with targeted range updates (only changed rows) would reduce API calls and eliminate the clear-then-write race condition.

**Sheets polling can overwrite local edits.** When the 30-second poll detects a hash mismatch, it dispatches `SET_TASKS` which replaces React state entirely. If a user was mid-edit, their changes are lost until the next write debounce fires. The fix is to merge incoming Sheets data with local state rather than replacing it — compare by task ID, keep locally-modified tasks, and only update tasks that changed externally.

**Sheets and Yjs can diverge.** Sheets polling updates React state but does NOT update the Yjs document. If User A is connected via collab and an external Sheets edit arrives, User A's React state updates but their Yjs doc still has the old data. User B (connected via Yjs) never sees the Sheets change at all. The Sheets sync should write changes into the Yjs document so they propagate to all collaborators.

**No incremental change detection.** The hash-based dedup (`lastWriteHash`) prevents unnecessary writes, which is good. But on the read side, there's no row-level diffing — every poll that finds a change replaces all tasks. Adding per-task checksums would let you identify which tasks actually changed externally and merge only those.

### In-Memory Room State: What Actually Happens on Restart

After reading `room.rs`, `ws.rs`, and `yjsProvider.ts`, the relay server restart scenario plays out like this:

1. Cloud Run restarts the relay (or scales to zero and back). All in-memory Yjs `Doc` instances are lost.
2. The `y-websocket` client detects the connection drop and automatically reconnects (built-in behavior).
3. On reconnect, the server creates a fresh empty room. It sends `SyncStep2` with an empty document.
4. The Yjs CRDT merge runs: the client has a full document, the server has nothing. **The client's state wins** — its full document is sent to the server as an update.
5. The server now has the document again. Other clients reconnecting go through the same process — they either contribute their state or receive what's already been rebuilt.

**So the actual user experience is: a brief connection drop (a few seconds) followed by automatic recovery.** As long as at least one client reconnects with its local Yjs state intact, no data is lost. The CRDT merge handles the rest.

The real risk isn't data loss — it's the window where new clients join the fresh room before any existing client reconnects. That client would get an empty document. This is an edge case (Cloud Run restarts are fast, and the first reconnecting client restores state almost immediately), but it could be eliminated by having the Sheets sync also hydrate the Yjs document on initialization. That way, even if Yjs state is empty, the app loads from Sheets as the fallback.

**Bottom line:** This is less severe than it first appeared. The stateless relay design actually works because clients hold the authoritative CRDT state and re-seed the server on reconnect. Adding Sheets-to-Yjs hydration on startup would close the remaining gap.

### Offline Support: Not a Priority Given the Sheets-First Design

If Google Sheets is the persistence layer and the source of truth for durability, offline support creates more problems than it solves. An offline user editing tasks would accumulate local changes that can't sync to Sheets. When they come back online, you'd need to reconcile potentially conflicting offline edits with whatever happened in the Sheet while they were away — and Sheets has no CRDT merge, so you're back to last-write-wins at the row level.

Yjs does support IndexedDB persistence, so the CRDT side of offline would be straightforward. But the Sheets side would require building a conflict resolution layer that doesn't exist today. Unless users are asking for offline access, this isn't worth the complexity. **Dropped from recommendations.**

---

## 2. Security Posture

### Critical Issues

**CORS configuration defaults to permissive.** In `server/src/main.rs`, when `RELAY_ALLOWED_ORIGINS` is empty or contains `"*"`, the server falls back to `CorsLayer::permissive()`, allowing any website to make requests. The deployment script (`deploy/cloudrun/deploy.sh`) sets `ALLOWED_ORIGINS=""` by default, meaning production deploys start wide open. This should be an explicit allowlist with no permissive fallback.

**OAuth tokens passed as URL query parameters.** In `ws.rs`, the access token is extracted from `?token=<value>` on the WebSocket URL. Query parameters appear in server logs, browser history, HTTP Referer headers, and proxy caches. The token should be passed via the `Authorization` header or during the WebSocket handshake as a subprotocol.

**Both Cloud Run services are publicly accessible.** The deploy scripts use `--allow-unauthenticated`. IAP setup exists but is manual and optional. For a production app handling Google OAuth tokens, IAP should be enforced by default.

### Medium-Severity Issues

**No rate limiting on WebSocket connections.** Each connection triggers two Google API calls (userinfo + Drive permissions). Without rate limiting, an attacker could burn through Google API quotas or cause excessive cost.

**No token refresh handling.** The relay server validates access tokens but doesn't support refresh tokens. When tokens expire mid-session, users lose access abruptly. Client-side token refresh with reconnection logic would improve reliability.

**Verbose error messages leak information.** Auth errors include Google API response bodies (`"Google userinfo returned 401: invalid_token"`). These should be generic to clients with detailed logging server-side only.

### What's Good

The CSP headers on the Go static file server are well-configured (restrictive `default-src`, specific allowances for Google APIs). Token validation per WebSocket connection (never persisted) is the right pattern. The use of `hyper-rustls` with webpki roots ensures proper TLS certificate verification.

### Google OAuth Verification Requirements

To get out of the "unverified app" warning, you'll need: a verified domain with a public homepage, terms of service and privacy policy links, and a completed OAuth consent screen. Since the app requests Google Sheets and Drive scopes (both restricted), you'll need to go through Google's CASA security assessment, which involves a third-party audit (Tier 2 costs around $500-1000/year). The security issues above would likely fail this audit.

---

## 3. Deployment Pipeline

### Current State

Deployment is a series of shell scripts (`deploy/setup.sh`, `deploy/cloudrun/deploy.sh`, `deploy/frontend/deploy.sh`) that build images and deploy to Cloud Run using `gcloud` commands. There is no CI/CD pipeline — no `.github/workflows/` directory exists.

### Should You Pre-Build Images?

**Yes, absolutely.** The current approach rebuilds everything on every deploy, which is slow and means there's no artifact you can inspect, scan, or roll back to. The recommended pattern is:

1. **Build** on git push: run tests, build container image, push to Artifact Registry with an immutable tag (git SHA or semver).
2. **Scan** the image for vulnerabilities (Artifact Registry has built-in scanning).
3. **Deploy** by pointing Cloud Run at the pre-built image tag.
4. **Rollback** by redeploying a previous tag — instant, no rebuild required.

This gives you reproducible builds, vulnerability scanning before deployment, instant rollbacks, and a clear audit trail of what's running in production.

### Specific Recommendations

**Set up Artifact Registry** in your GCP project. Push images there instead of building directly on Cloud Run.

**Add a GitHub Actions workflow** for CI/CD. A minimal pipeline would: run `cargo test` and `npm test` on every PR, build and push Docker images on merge to `main`, deploy to a staging environment automatically, and require manual approval for production deploys.

**Pin your base images.** The Dockerfiles use `node:20-slim` and `rust:1.85` without SHA pinning. Use digest-pinned images (`node:20-slim@sha256:...`) for reproducible builds.

**Add container scanning.** Artifact Registry supports automatic vulnerability scanning. Enable it.

**The Go static file server is a nice touch** — it's a single binary with no runtime dependencies, serves SPA routes correctly, and adds security headers. This is better than using nginx or a Node server.

---

## 4. Multi-Agent Development Workflow

### How It Compares to Best Practices

Your `launch-phase.sh` orchestration is more sophisticated than what most teams are doing. The key elements — worktree isolation, non-overlapping file ownership, retry logic, merge verification — align well with Anthropic's published recommendations for multi-agent development.

**Anthropic's recommended pattern** (from their engineering blog and documentation) is: one lead session that coordinates work and assigns tasks, with 3-5 teammate sessions working independently in separate context windows. Your approach maps to this: the phase config acts as the lead (defining groups, file ownership, and execution order), and each agent group is a teammate.

### What's Working

**Worktree isolation** prevents agents from stepping on each other. This is essential and something many teams skip.

**Non-overlapping file ownership** (defined in prompt files) is the single most important constraint for parallel agent work. Your prompts explicitly list which files each agent may modify.

**PostToolUse verification** via `scripts/verify.sh` is the right hook pattern. Running `tsc` and `vitest` after every edit catches errors immediately rather than at merge time.

**Retry logic** (3 attempts with 5s delays) handles the reality that agents sometimes fail or produce invalid output.

### Areas for Improvement

**`verify.sh` always exits 0.** This means verification failures don't actually block the agent — they're logged but ignored. Consider making the hook exit non-zero on failure so the agent knows it needs to fix something.

**No automated issue-to-agent pipeline.** You're currently writing prompt files manually and running `launch-phase.sh` to kick off work. This is the gap between "good multi-agent workflow" and "autonomous development pipeline."

**CLAUDE.md is well-structured but could be leaner.** Anthropic recommends keeping it under 150 lines. Yours is comprehensive but includes orchestration instructions that agents don't need to see on every invocation. Consider splitting into `CLAUDE.md` (core context, under 150 lines) and separate docs for orchestration.

**No test coverage gate.** Agents can produce code that passes `tsc` and existing tests but doesn't add tests for new functionality. Consider adding a coverage threshold or requiring test files for new modules.

---

## 5. Getting Agents to Pick Up Issues Automatically

The goal is a workflow where you label a GitHub issue `agent-ready` and an agent picks it up, creates a branch, does the work, and opens a PR — no manual prompt writing or `launch-phase.sh` invocation required.

### How It Works

A GitHub Actions workflow triggers on the `issues.labeled` event, filters for the `agent-ready` label, installs Claude Code on the runner, and passes the issue title and body as a prompt. The agent reads `CLAUDE.md` for project context, creates a feature branch, makes changes, runs verification (tsc + vitest + cargo test), and opens a PR that references the original issue.

### Workflow Design

The workflow file (`.github/workflows/agent-work.yml`) would:

1. **Trigger** on `issues.labeled` where `github.event.label.name == 'agent-ready'`.
2. **Check out** the repo, install Rust/wasm-pack, and run `npm install`.
3. **Install Claude Code** via `npm install -g @anthropic-ai/claude-code`.
4. **Run Claude Code** in non-interactive mode with the issue as the prompt. The prompt should include: the issue title and body, instruction to create a branch named `agent/issue-{number}`, instruction to commit, push, and open a PR with `gh pr create`, and instruction to reference the issue number in the PR body for auto-closing.
5. **Post a comment** on the issue with a link to the PR (or an error summary if the agent failed).

### Key Design Decisions

**Label-gated, not automatic.** Using `agent-ready` as a manual gate means you review the issue description before an agent touches it. This prevents wasted compute on vague or duplicate issues. You can also add an `agent-complex` label later for issues that need the multi-agent `launch-phase.sh` workflow instead of a single agent.

**Issue quality matters.** The agent's output is only as good as the issue description. Issues should include: what the expected behavior is, what files are likely involved (if known), and any constraints or edge cases. A GitHub issue template with these fields would improve agent success rates significantly.

**CI validates the output.** The PR opened by the agent should trigger your normal CI pipeline (once you have one — see section 3). This means type checking, unit tests, and build verification all run before you review. The agent doesn't merge anything; it opens a PR for human review.

**Cost control.** Each agent run consumes API tokens. At roughly 15x the token cost of a chat interaction, you want to avoid triggering on every issue. The label gate handles this, but you could also add a budget cap by limiting the `max_turns` parameter in the Claude Code invocation or setting a timeout on the GitHub Actions job.

### What Your CLAUDE.md Needs for This

Your current `CLAUDE.md` has good project context but is oriented toward the multi-agent phase workflow. For single-agent issue work, it should also include: how to run the full verification suite in one command (e.g., `npm run build && npm test && cd crates/scheduler && cargo test`), the branch naming convention (`agent/issue-{number}`), and a note that the agent should open a PR rather than push to `main`. These additions keep it under 150 lines while making it self-contained for autonomous agent work.

---

## 6. Comparison to Expert Practices

### What You're Doing Better Than Most

**Rust/WASM for compute-heavy logic** is a pattern that very few teams execute well. Most would reach for a server-side API. Running scheduling in the browser via WASM is both faster for users and cheaper to operate.

**CRDT-based collaboration** instead of OT (Operational Transformation) is the modern choice. OT requires a central server to resolve conflicts; CRDTs resolve locally. This aligns with your stateless relay architecture.

**The multi-agent workflow with file ownership contracts** is ahead of most teams. Anthropic's own engineering teams use a similar pattern, and your implementation with `launch-phase.sh` is more automated than most.

### Where Expert Teams Are Ahead

**CI/CD maturity.** Production-grade projects have automated pipelines that build, test, scan, and deploy on every merge. The absence of GitHub Actions workflows is the single biggest operational gap.

**Observability.** The relay server has structured logging via `tracing`, which is good. But there's no mention of metrics (request latency, active connections, error rates), distributed tracing, or alerting. For a real-time collaboration service, you want to know when the relay is degraded before users report it.

**E2E testing.** Playwright is configured but the test suite is sparse. For a tool comparable to MS Project, end-to-end tests covering the critical flows (create project, add tasks, set dependencies, collaborate in real-time, sync to Sheets) are essential for confidence in deployments.

**Secrets management.** The `.env` file is checked into the repo (with the API key redacted, but the Google Client ID is present). Use GCP Secret Manager for production secrets and ensure `.env` is in `.gitignore`.

---

## Priority Action Items

### Do First (Security & Deployment Blockers)

1. Fix CORS: remove the permissive fallback; require an explicit origin allowlist
2. Move OAuth tokens from query parameters to headers
3. Set up Artifact Registry and a basic CI/CD pipeline with GitHub Actions
4. Add `.env` to `.gitignore`; use Secret Manager for production

### Do Next (Sheets Sync Hardening & Production Readiness)

5. Add exponential backoff with jitter to Sheets API calls (read, write, and poll)
6. Replace clear-then-write with targeted `batchUpdate` for changed rows only
7. Merge incoming Sheets data with local state by task ID instead of full replacement
8. Hydrate Yjs document from Sheets on initialization (closes the relay restart gap too)
9. Make `verify.sh` exit non-zero on failure so agents are forced to fix errors
10. Set up Claude Code GitHub Actions for automated issue handling

### Do Later (Scale & Polish)

11. Add rate limiting to the relay server's WebSocket endpoint
12. Build out E2E test coverage for critical user flows
13. Add observability (metrics, tracing, alerting) to the relay server
14. Prepare for Google OAuth CASA security assessment

---

*This review is based on analysis of the full codebase, deployment scripts, server source code, and comparison against Anthropic's published multi-agent engineering practices, Google Cloud security documentation, and industry CI/CD standards.*
