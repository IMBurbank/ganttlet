# Extractable Patterns

Infrastructure components from Ganttlet that are project-agnostic and can
be reused in other Claude Code multi-agent projects.

## Universal (extractable)

| Component | Location | Adaptation needed |
|-----------|----------|-------------------|
| Multi-agent orchestration skill | `.claude/skills/multi-agent-orchestration/` | None |
| Shell scripting skill | `.claude/skills/shell-scripting/` | None |
| Issue workflow skill | `.claude/skills/issue-workflow/` | None |
| Phase orchestrator | `scripts/launch-phase.sh` + `scripts/lib/` | Config paths |
| Supervisor launcher | `scripts/launch-supervisor.sh` | System prompt path |
| Codebase explorer agent | `.claude/agents/codebase-explorer.md` | Project structure map |
| Verify-and-diagnose agent | `.claude/agents/verify-and-diagnose.md` | Verify commands |
| Plan-reviewer agent | `.claude/agents/plan-reviewer.md` | None |
| Worktree CLAUDE.md | `.claude/worktrees/CLAUDE.md` | None |
| PreToolUse safety hooks | `.claude/settings.json` hooks section | None |
| Agent status format | `.agent-status.json` schema | Task names |
| Pre-commit hook | `scripts/pre-commit-hook.sh` | Language-specific checks |

## Project-specific (not extractable)

| Component | Location | Why project-specific |
|-----------|----------|---------------------|
| Scheduling engine skill | `.claude/skills/scheduling-engine/` | CPM/cascade domain |
| Rust-WASM skill | `.claude/skills/rust-wasm/` | WASM build specifics |
| Google Sheets sync skill | `.claude/skills/google-sheets-sync/` | Sheets API patterns |
| Cloud deployment skill | `.claude/skills/cloud-deployment/` | GCP/Cloud Run specifics |
| E2E testing skill | `.claude/skills/e2e-testing/` | Relay + Playwright setup |
| Rust scheduler agent | `.claude/agents/rust-scheduler.md` | crates/scheduler/ domain |
| Root CLAUDE.md | `CLAUDE.md` | Architecture constraints |
| Scoped CLAUDE.md files | `crates/scheduler/CLAUDE.md`, etc. | Subsystem constraints |

## Setup checklist for new projects

When starting a new Claude Code multi-agent project, copy and adapt:
1. Root CLAUDE.md — keep behavioral rules, replace architecture constraints
2. `.claude/worktrees/CLAUDE.md` — use as-is
3. `.claude/settings.json` — use hooks as-is, update plugin list
4. `scripts/launch-phase.sh` + `scripts/lib/` — update config paths
5. `scripts/pre-commit-hook.sh` — update language-specific checks
6. `.claude/agents/codebase-explorer.md` — update project structure map
7. `.claude/agents/verify-and-diagnose.md` — update verify commands
8. `.agent-status.json` schema — update task names
