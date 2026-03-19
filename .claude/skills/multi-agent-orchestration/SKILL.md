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
- **Cleanup is mandatory**: when work is complete (PR created, or task done), remove the worktree. Stale worktrees prevent branch deletion and waste disk. The merge worktree is cleaned up automatically by `create-pr`; agent worktrees are cleaned up by `do_merge()`. For manual cleanup: `cd /workspace` (standalone), then `rm -rf <worktree-path>` (standalone), then `git worktree prune`.

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
- The calculation rule from CLAUDE.md: agents must NEVER do mental math or date arithmetic — use `taskEndDate`/`taskDuration` shell functions (or `bizday` CLI) for dates, `python3 -c` for general arithmetic. Example: `taskEndDate 2026-03-11 10` → `2026-03-24`.
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

## Tmux-Native Supervisor
A supervisor agent running inside tmux can launch, monitor, and control agent windows
directly using `scripts/lib/tmux-supervisor.sh`. Source the library, then call:
- `tmux_create_session <name>` — create the session
- `tmux_launch_agent <session> <group> <worktree> <prompt> <log> [turns] [budget] [model]`
- `tmux_poll_agent <session> <group> [lines]` — capture pane output (useful if log hasn't flushed)
- `tmux_poll_log <log_file> [lines]` — tail agent log
- `tmux_agent_status <session> <group> <log_file>` — running/succeeded/failed/not_started
- `tmux_stage_status <session> <log_dir> <groups...>` — status table
- `tmux_kill_agent <session> <group> <log_file>` — stop an agent
- `tmux_wait_stage <session> <log_dir> <timeout> <groups...>` — block until done

**Critical rules:**
- **Worktree CWD**: Always pass the agent's worktree path (not `/workspace`) as the `<worktree>` argument. The agent's CWD determines which files it sees. Tested: an agent launched in `/workspace` cannot see files that only exist in a worktree branch.
- **CLAUDECODE env var**: `tmux_launch_agent` automatically unsets this. If launching claude manually in a tmux window, you must `unset CLAUDECODE` first or claude refuses to start.
- **Send-keys timing**: Always sleep 0.5s between `tmux send-keys` text and Enter to prevent race conditions.
- **C-c doesn't stop claude -p in a pipe**: `tmux_kill_agent` escalates to `tmux kill-window` as the reliable fallback.
- **Merge/validate/PR**: Still use `launch-phase.sh merge N` / `validate` / `create-pr`. Only agent launching is replaced.

See `docs/plans/tmux-supervisor.md` for the full design and test results.

## Context Conservation
<!-- Moved from root CLAUDE.md -->
- Commit early and often — progress survives crashes and context loss.
- On restart, read `.agent-status.json` (fall back to `claude-progress.txt`) and check `git log --oneline -10`.
- Use subagents (Agent tool) for expensive file investigation to preserve main context.
- Load `.claude/skills/` on demand — only read skills relevant to the current task.
- If context is getting large, summarize findings and commit before continuing.
- **Maintain agent structure maps**: If you add, rename, or delete directories, update the project structure map in `.claude/agents/codebase-explorer.md` to match. Do this before context compaction, not at the end of a session. Run `./scripts/lint-agent-paths.sh` to verify.

## Progress Tracking Format
<!-- Moved from root CLAUDE.md — curator cleanup pending in step 12 -->

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

**Status values:** `done`, `in_progress`, `blocked`, `pending`, `skipped`

**Updating:** JSON cannot be appended — read, parse, modify, write:
```bash
node -e "const fs=require('fs'),f='.agent-status.json',d=JSON.parse(fs.readFileSync(f,'utf8'));d.tasks['A1']={status:'done',tests_passing:3,tests_failing:0};d.last_updated=new Date().toISOString();fs.writeFileSync(f,JSON.stringify(d,null,2))"
```

On restart, read `.agent-status.json` (fall back to `claude-progress.txt` if it exists) and `git log --oneline -10` first. Skip completed tasks.

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
- **SIGPIPE kills pipelines**: Never pipe `launch-phase.sh` output through `head` or `less`. The reader closing early sends SIGPIPE to the writer, killing the entire orchestration process silently. Use `tee` or redirect to a file instead.
- **YAML frontmatter `---` parsed as CLI flags**: When passing prompt content as a CLI positional argument (`claude ... "$(cat prompt.md)"`), YAML frontmatter `---` lines are parsed as unknown options. Fix: use pipe mode (`cat prompt.md | claude -p -`) which passes content via stdin.
- **Validation must use pipe mode**: Validation agents in WATCH mode were running interactively (no `-p`), which allowed agents to push processes to background and evade idle detection. Fixed: validation now uses `cat | claude -p - | tee` with `PIPESTATUS[1]` for exit code capture.
- **Wall-clock timeout prevents runaway validation**: `VALIDATE_TIMEOUT` (default 600s) kills validation attempts that exceed the time limit, regardless of whether the agent appears active.
- **Stall detection in tmux mode**: `tmux_wait_stage()` tracks log file size growth. If unchanged for `AGENT_STALL_THRESHOLD` seconds (default 300), the agent is killed. This catches agents that are generating thinking tokens but not producing useful output.
- **Conditional WASM rebuild**: `do_merge()` checks `git diff HEAD~1 --name-only | grep '^crates/'` before rebuilding WASM. Skipping unnecessary WASM rebuilds saves ~30s per non-Rust merge.
- **Check agent output early**: Always verify agents started correctly within 2 minutes of launch. Use `tmux_poll_agent` or `tmux attach` to check for CLI errors, prompt parsing failures, or stuck loops. An 8-hour stalled agent produces zero work — catching failures early saves entire phase runs.
