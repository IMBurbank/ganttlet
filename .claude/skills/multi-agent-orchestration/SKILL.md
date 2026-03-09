---
name: multi-agent-orchestration
description: "Use when modifying launch-phase.sh, creating phase prompts, debugging orchestration, or setting up multi-agent workflows. Covers launch architecture, CLI flags, WATCH mode, and lessons learned."
---

# Multi-Agent Orchestration Guide

## launch-phase.sh Architecture
- **Stages**: Sequential groups of parallel agents (stage1 → merge1 → stage2 → merge2 → ...)
- **Merge gating**: Each stage's branches must merge cleanly before the next stage starts
- **Per-branch verification**: After each branch merge, tsc/vitest/cargo test run in parallel
- **Stage timeouts**: `MAX_STAGE_DURATION` (default 1800s) kills stalled agents
- **Retry-on-crash**: Agents that crash are restarted automatically
- **Validation**: Post-merge validation agent runs fix-and-retry cycles
- **Cleanup command**: `./scripts/launch-phase.sh <config> cleanup` removes all phase worktrees/branches

See `docs/multi-agent-guide.md` for full command reference and usage examples.

## Supervisor Mode
A Claude agent can orchestrate the full pipeline autonomously using `scripts/launch-supervisor.sh`.
- The supervisor runs interactively and calls `launch-phase.sh` subcommands step-by-step
- It monitors output/logs, makes retry decisions, and handles the code review loop
- Usage: `./scripts/launch-supervisor.sh docs/prompts/phase15/launch-config.yaml`
- Prompt: `docs/prompts/supervisor.md` (shared across phases)
- No tmux needed for the supervisor itself — it runs in the foreground terminal
- Worker agents spawned by `launch-phase.sh stage N` still run in parallel as usual

## Prompt File Structure
Prompts live in `docs/prompts/<phaseN>/` (one file per group). Each prompt must:
- Use YAML frontmatter for structured metadata (scope, tasks, dependencies)
- List the exact files the agent may modify (zero overlap between groups)
- Instruct the agent to skip plan mode and execute without confirmation
- Include retry context so restarted agents resume where they left off

Phase launch configuration is defined in `docs/prompts/<phaseN>/launch-config.yaml`
(stages, groups, branches, merge messages) rather than hardcoded in `launch-phase.sh`.

## Worktree Isolation (Critical)
Each agent MUST run in its own git worktree. `/workspace` stays on `main` always.
- **Agent worktrees**: `setup_worktree()` creates per-group worktrees at `/workspace/.claude/worktrees/<phase>-<group>`
- **Merge worktree**: `setup_merge_worktree()` creates a long-lived worktree at `/workspace/.claude/worktrees/<phase>-merge` for all merge/validate/PR operations. It persists across stages and is cleaned up after PR creation.
- Manually-launched agents must create their own: `git worktree add /workspace/.claude/worktrees/<name> -b <branch>`
- NEVER `git checkout` or `git switch` in `/workspace` — this breaks every other agent sharing the filesystem
- All git operations (commit, push, diff) must happen inside the worktree directory
- Common failure: agent does `git checkout feature-branch` in `/workspace`, another agent commits to the wrong branch
- **Cleanup is mandatory**: when work is complete (PR created, or task done), remove the worktree. Stale worktrees prevent branch deletion and waste disk. The merge worktree is cleaned up automatically by `create-pr`; agent worktrees are cleaned up by `do_merge()`. For manual cleanup: `cd /workspace` (standalone), then `git worktree remove <path>` (standalone), then `git worktree prune`.

## WATCH Mode
`WATCH=1` runs agents in tmux windows with visible output.
- Retry loop and log capture via `tee`
- Attach: `tmux attach -t <phase>-agents`
- Navigate: `Ctrl-B N`/`P`, detach: `Ctrl-B D`

## Claude CLI Reference
- `--prompt-file` does NOT exist — never use it
- `--print` is NOT a valid flag — use `-p`
- `-p` (pipe/print mode): auto-exits after completion, sparse text output
- Interactive mode (no `-p`): full TUI, does NOT auto-exit — stalls pipelines
- `--dangerously-skip-permissions`: required for automated runs
- Other flags: `-c` (continue), `-r` (resume), `--system-prompt`, `--model`, `--max-budget-usd`

## Prompt Boilerplate Patterns
Every group prompt should include in its Error Handling section:
- The calculation rule from CLAUDE.md: agents must NEVER do mental math or date arithmetic — use `node -e`, `python3 -c`, `date -d` with standard libraries (`date-fns`, Python stdlib). Prefer standard library functions over project wrappers.
- Progress tracking in pipe-delimited format: `TASK_ID | STATUS | ISO_TIMESTAMP | MESSAGE`

## Subagent Delegation in Orchestrated Agents
Orchestrated agents (spawned by `launch-phase.sh`) are full Claude Code sessions and **can use the Agent tool** to delegate to subagents defined in `.claude/agents/`. The agent definitions are visible from worktrees because worktrees share the repo's file content.

### Available subagents
- **codebase-explorer** (haiku, 20 turns): Delegate initial file investigation before editing. Preserves the orchestrated agent's context window. Read-only — cannot modify files.
- **rust-scheduler** (sonnet, 40 turns): Delegate Rust scheduling engine work in `crates/scheduler/`. Can read, edit, write, and run cargo tests.
- **verify-and-diagnose** (sonnet, 30 turns): Delegate verification (tsc, vitest, cargo test, lint-agent-paths). Returns a structured pass/fail report. Default is verify-only; include "fix" in the prompt for verify-and-fix mode.

### When to delegate
- **Exploration**: Use `codebase-explorer` before editing unfamiliar code. Saves ~40K tokens of context vs reading files directly.
- **Verification**: Use `verify-and-diagnose` instead of running tsc/vitest/cargo inline. Gets structured diagnosis without polluting the agent's context with raw test output.
- **Rust work**: Use `rust-scheduler` when the group's tasks include scheduling engine changes.

### Constraints
- Subagents have `disallowedTools: Agent` — they cannot spawn further subagents (no recursion).
- Subagent turns/tokens count against the parent agent's `--max-budget-usd`. If a group prompt will use subagents heavily, increase the budget: `DEFAULT_MAX_BUDGET=15 ./scripts/launch-phase.sh <config> stage N`
- Subagents inherit the worktree's working directory. All relative paths in structure maps resolve correctly.

## Lessons Learned
- **Claude output modes matter**: `-p` produces sparse text-only output (no thinking blocks, no tool-use panels). Interactive mode (no `-p`) produces full rich TUI but does NOT auto-exit — claude waits for more input. Solution: WATCH mode runs claude interactively in tmux, and the prompt instructs claude to exit when done.
- **WATCH mode requires tmux**: Script must check `command -v tmux` and fail fast. Without this guard, tmux commands silently fail and the polling loop hangs forever.
- **`PIPESTATUS[1]`** is required to capture claude's exit code through a `tee` pipe (`$?` gives tee's exit code).
- **Heredoc quoting**: WATCH mode wrapper scripts must use single-quoted heredoc (`<<'DELIM'`) with sed placeholder substitution to avoid premature variable expansion.
- **`setup_worktree()` stdout isolation**: Returns path via stdout — all other output must go to `>/dev/null` or `>&2`, otherwise downstream `cd` commands break.
- **`script -q -c` is fragile**: Prefer `tee -a` for simultaneous terminal + file capture.
- **Validation log parsing**: Must exclude the `COMMAND=` header line to avoid false positive failure detection from prompt template strings.
- **Container dependencies**: tmux must be in the Dockerfile's `apt-get install` line. If missing, WATCH mode is completely broken with no useful error.
- **`CLAUDECODE` env var blocks nested sessions**: When `launch-phase.sh` is run from a supervisor agent (Claude Code), child `claude` processes refuse to start. Fixed by `unset CLAUDECODE` at the top of `launch-phase.sh`.
- **Merge worktree isolation**: Merge/validate/PR steps must never `git checkout` in `/workspace`. The `do_merge()`, `validate()`, and `create_pr()` functions operate in a dedicated merge worktree (`MERGE_WORKTREE`). This prevents dirty state, Cargo.lock conflicts, and pre-commit hook issues.
- **Per-branch verification**: Verifying after ALL branches are merged makes failures harder to diagnose (compound errors). `do_merge()` now runs `run_parallel_verification()` after each branch, catching breakage before the next branch is merged on top.
- **Parallel verification is faster**: Running tsc, vitest, and cargo test with `&` + `wait` instead of sequentially saves significant time during merge verification.
- **Code review rounds should be capped**: Without a cap, the review-fix-review loop can cycle indefinitely. The supervisor prompt caps at 3 rounds; beyond that, add `needs-human-review` label.
