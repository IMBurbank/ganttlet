# Claude Code Plugin Adoption Plan

**Project:** Ganttlet
**Date:** March 2026
**Status:** Complete
**Last reviewed:** 2026-03-06 (V1-V4 verification passed, review-fix loop validated)

---

## Execution Progress

> **For Claude on restart/compaction:** Read this section first, then check `claude-progress.txt`
> and `git log --oneline -10` to determine where to resume. Each step updates the
> checkbox below when complete. Skip completed steps.

| Step | Owner | Status | Notes |
|------|-------|--------|-------|
| M1. Generate OAuth token | USER | [x] DONE | Generated via `claude setup-token` inside Docker container |
| M2. Add GitHub repo secret | USER | [x] DONE | `CLAUDE_CODE_OAUTH_TOKEN` added to repo settings |
| M3. Confirm manual steps done | USER | [x] SKIPPED | Deferred manual steps; proceeding with file changes only |
| A1. Create `.claude/settings.json` | CLAUDE | [x] DONE | Plugins + PreToolUse hooks. Also added `.gitignore` negation for `.claude/settings.json`. |
| A2. Update `Dockerfile` | CLAUDE | [x] DONE | rust-analyzer (rustup component) + typescript-language-server (npm global) |
| A3. Update `agent-work.yml` | CLAUDE | [x] DONE | Auth migration + plugin install + code-review step (gated >50 lines). Plugin installs use `\|\| true` for resilience. |
| A4. Verify hooks work | CLAUDE | [x] DONE | All 6 test cases pass: blocks wasm/env/lockfile/push-main, allows normal files/feature branches |
| A5. Verify build | CLAUDE | [x] DONE | `npm run build` passes (429 modules, 2.35s) |
| A6. Commit all changes | CLAUDE | [x] DONE | `feature/plugin-adoption` branch, commit `2c12b1b` |
| V1. Docker build test | USER | [x] DONE | `docker compose build dev` succeeds with LSP binaries |
| V2. Container LSP check | USER | [x] DONE | `rust-analyzer --version` + `typescript-language-server --version` confirmed |
| V3. Plugin load check | USER | [x] DONE | All 4 plugins loaded (github, rust-analyzer-lsp, typescript-lsp, code-review) |
| V4. CI workflow test | USER | [x] DONE | Issues #2, #7, #9 triggered agent-work; PRs created, review-fix loop validated |

---

## Manual Steps (Do These First)

These require access outside this container. Complete them before telling Claude to proceed.

### M1. Generate OAuth Token

On your **macOS host** (not inside Docker):

```bash
claude setup-token
```

- Requires an existing OAuth session. Run `claude login` first if needed.
- Copy the token immediately — it won't be shown again.
- Token is valid ~1 year.

### M2. Add GitHub Repo Secret

1. Go to repo **Settings > Secrets and variables > Actions > New repository secret**
2. Name: `CLAUDE_CODE_OAUTH_TOKEN`
3. Value: the token from M1

### M3. Confirm

Tell Claude: **"manual steps done"** (or "skip manual steps" if you want to defer auth setup and proceed with file changes only).

---

## Automated Steps (Claude Executes)

> Claude will execute A1–A6 sequentially after M3 confirmation.
> Each step commits progress to `claude-progress.txt` for compaction resilience.

### A1. Create `.claude/settings.json`

Create the project-scoped settings file with plugin declarations and protective hooks.

**What gets created:**

```json
{
  "enabledPlugins": {
    "rust-analyzer-lsp@claude-plugins-official": true,
    "typescript-lsp@claude-plugins-official": true,
    "github@claude-plugins-official": true,
    "code-review@claude-plugins-official": true
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const f=d.tool_input?.file_path||''; if(/package-lock\\.json|src\\/wasm\\/scheduler\\/|\\.env/.test(f)){console.log(JSON.stringify({decision:'block',reason:'Protected file: '+f}))}\""
        }]
      },
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const c=d.tool_input?.command||''; if(/git\\s+push/.test(c)&&/\\bmain\\b/.test(c)){console.log(JSON.stringify({decision:'block',reason:'Cannot push directly to main. Use a feature branch and PR.'}))}\""
        }]
      }
    ]
  }
}
```

**Relationship to `settings.local.json`:** The existing `.claude/settings.local.json` contains PostToolUse hooks (`verify.sh`) and permissions. It is gitignored and environment-specific. The new `settings.json` is committed and shared. They merge at runtime — local takes precedence for overlapping keys. PreToolUse hooks go in the committed file because they enforce project-wide safety rules.

### A2. Update Dockerfile

Add two `RUN` lines to the `dev` stage:

1. **After** `cargo install wasm-pack` line:
   ```dockerfile
   # LSP binary for Claude Code rust-analyzer-lsp plugin
   RUN . "$HOME/.cargo/env" && rustup component add rust-analyzer
   ```

2. **After** `npx playwright@1.58.2 install chromium` line:
   ```dockerfile
   # TypeScript language server for Claude Code typescript-lsp plugin
   RUN npm install -g typescript-language-server typescript
   ```

### A3. Update `agent-work.yml`

Three changes:

1. **Replace** `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}` with `CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` in the "Run Claude Code" step.

2. **Add** after "Install Claude Code" step:
   ```yaml
   - name: Install LSP binaries for Claude Code plugins
     run: |
       npm install -g typescript-language-server typescript
       rustup component add rust-analyzer

   - name: Cache Claude Code plugins
     uses: actions/cache@v4
     with:
       path: ~/.claude/plugins
       key: claude-plugins-v1

   - name: Install Claude Code plugins
     env:
       CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
     run: |
       claude plugin marketplace update claude-plugins-official
       claude plugin install rust-analyzer-lsp@claude-plugins-official --scope local
       claude plugin install typescript-lsp@claude-plugins-official --scope local
       claude plugin install github@claude-plugins-official --scope local
       claude plugin install code-review@claude-plugins-official --scope local
   ```

3. **Add** after "Push and create PR" step:
   ```yaml
   - name: Check PR size for code review
     if: success()
     id: pr-size
     run: |
       DIFF_LINES=$(git diff origin/main...HEAD --stat | tail -1 | grep -oP '\d+(?= insertion)' || echo "0")
       echo "lines=${DIFF_LINES}" >> $GITHUB_OUTPUT

   - name: Run automated code review
     if: success() && steps.pr-size.outputs.lines > 50
     env:
       CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
       GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     run: |
       claude -p "/code-review" \
         --dangerously-skip-permissions \
         --max-turns 15 \
         --max-budget-usd 3.00
   ```

### A4. Verify Hooks Work

Test that PreToolUse hooks correctly block:
- Edits to `src/wasm/scheduler/` files
- Edits to `.env` files
- `git push origin main` commands

### A5. Verify Build

Run `npm run build` to confirm nothing is broken.

### A6. Commit

Create feature branch `feature/plugin-adoption`, commit all changes with:
```
feat: add Claude Code plugins, protective hooks, and CI integration
```

---

## Post-Automation Verification (User)

After Claude completes A1–A6:

- [ ] **V1.** `docker compose build dev` — succeeds with new Dockerfile lines
- [ ] **V2.** Inside container: `rust-analyzer --version` and `typescript-language-server --version` return versions
- [ ] **V3.** Inside container: `claude` shows plugins loaded (`/plugin` > Installed tab)
- [ ] **V4.** Trigger `agent-work.yml` on a test issue — confirm plugin install steps and code-review run

---

## Decision Log

### Selected Plugins (Tier 1)

| Priority | Plugin | Purpose | Binary Dependency |
|----------|--------|---------|-------------------|
| 1 | `github` | Native GitHub MCP for issues, PRs, code search | `gh` CLI (already installed) |
| 2 | `rust-analyzer-lsp` | Real-time Rust diagnostics in `crates/scheduler/` | `rust-analyzer` (rustup component) |
| 3 | `typescript-lsp` | Real-time TS/JS diagnostics for React frontend | `typescript-language-server` (npm global) |
| 4 | `code-review` | Automated multi-agent PR review with confidence scoring | None |

**Priority rationale:** `github` is zero-effort (binary already installed) and immediately useful for the `agent-ready` issue workflow. LSP plugins require Dockerfile changes but provide high value — `verify.sh` runs tsc/cargo check *after* edits with a 30s cooldown, while LSPs give Claude continuous diagnostics *during* edits. `code-review` is last because it requires CI integration and has per-use cost.

### Removed from Plan (Originally Tier 2)

| Plugin | Reason for Removal |
|--------|-------------------|
| `claude-md-management` | CLAUDE.md already well-structured. Audit overhead for marginal gain. |
| `superpowers` | Overlaps with existing `issue-workflow` skill and error handling protocol. |
| `claude-code-setup` | Already completed — audit ran 2026-03-05. |

### Not Adopting

| Plugin | Reason |
|--------|--------|
| `ralph-loop` | Orchestrator retry logic is more sophisticated (crash context, structured errors) |
| `playwright` (plugin) | Existing Playwright integration more tailored (relay auto-start, custom webServer config) |
| `hookify` | Phase 13 hooks are version-controlled shell scripts, more robust for multi-agent orchestration |
| `serena` | Overlaps with LSP plugins; community-managed risk; evaluate later if needed |
| `context7` | Niche libraries (Yjs, Yrs, wasm-bindgen) unlikely indexed; custom skills serve better |
| `frontend-design` | Custom SVG-rendered Gantt UI, not standard component-based |
| `anthropic-agent-skills` | Existing CLAUDE.md conventions and skills cover the same ground |
| Platform integrations (`linear`, `slack`, `figma`, `vercel`, etc.) | Not part of toolchain |

### Protective Hooks Added

| Hook | Purpose |
|------|---------|
| Block protected file edits | Prevents edits to `package-lock.json`, `src/wasm/scheduler/`, `.env` |
| Block direct push to main | Enforces feature branch + PR workflow mechanically |

---

## Technical Notes

### Settings File Relationship

| File | Scope | Committed | Contains |
|------|-------|-----------|----------|
| `.claude/settings.json` | Project-wide | Yes | `enabledPlugins`, PreToolUse hooks |
| `.claude/settings.local.json` | Environment-specific | No (gitignored) | PostToolUse hooks (`verify.sh`), permissions |

They merge at runtime. Local takes precedence for overlapping keys.

### Multi-Agent Memory

With 4 parallel agents, that's potentially 4 instances each of `rust-analyzer` (~200-500MB) and `typescript-language-server` (~100-300MB). On memory-constrained machines, create per-agent `.claude/settings.local.json` overrides in the worktree setup to disable irrelevant LSPs based on `AGENT_SCOPE`.

### CI Plugin Caching

Plugin cache lives at `~/.claude/plugins`. The `actions/cache@v4` step persists it across workflow runs. Bump `claude-plugins-v1` key when adding/updating plugins.

### Docker Credentials

Do NOT persist via named volume. Sharing `.claude/` across container rebuilds causes stale state. Re-auth on rebuild is acceptable.

### Auth Summary

| Environment | Auth Method | Status |
|-------------|-------------|--------|
| Docker dev container | Interactive OAuth login | Working |
| `launch-phase.sh` | Inherits container credentials | Working |
| GitHub Actions | OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) | Needs M1+M2 |

### Rollback

1. Disable: `claude plugin disable <name>@claude-plugins-official --scope project`
2. Commit the updated `.claude/settings.json`
3. To fully remove: `plugin uninstall` + remove Dockerfile/workflow lines

### Cost

| Plugin | Per-Use Cost | Notes |
|--------|-------------|-------|
| `rust-analyzer-lsp` | Zero | Memory only |
| `typescript-lsp` | Zero | Memory only |
| `github` | Zero | GitHub API rate limits |
| `code-review` | ~$0.50-2.00/PR | Gated on PR size > 10 insertions |

---

## Notes

_Space for tracking issues, observations, and follow-ups as implementation proceeds._

| Date | Note |
|------|------|
| 2026-03-05 | Plan created. Codebase audit completed via `claude-code-setup` skill. |
| 2026-03-05 | Tier 2 removed, protective hooks added, Docker volume rejected. |
| 2026-03-05 | M1/M2 deferred: no Claude Code on laptop. Will extract token from Docker `~/.claude/.credentials.json` next session. |
| 2026-03-05 | `.claude/` was fully gitignored. Fixed with `.claude/*` + `!.claude/settings.json` negation pattern. |
| 2026-03-05 | Plugin install steps in CI use `\|\| true` to avoid blocking agent work if plugin marketplace is unreachable. |
| 2026-03-05 | A1-A6 complete. Committed on `feature/plugin-adoption` (2c12b1b). Awaiting user V1-V4 verification + M1/M2. |
| 2026-03-05 | M1/M2 complete. Token generated and GitHub secret added. Added CLAUDE.md rule: never ask users to paste secrets. |
| 2026-03-06 | V1-V4 complete. Docker build, LSP binaries, plugin loading, and CI workflow all verified. |
| 2026-03-06 | Review-fix loop added to agent-work.yml (max 3 iterations). PR progress comments with workflow links. |
| 2026-03-06 | pr-review.yml added for non-agent PRs. Code review threshold lowered to 10 insertions. |
| | |
