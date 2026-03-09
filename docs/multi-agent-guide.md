# Multi-Agent Orchestration Guide

## Overview
Ganttlet uses a multi-agent workflow where features are split across parallel agents using
git worktree isolation. Each agent works on non-overlapping files to prevent merge conflicts.
Agents commit and verify (build/test) before finishing.

## launch-phase.sh

Phases are executed via `scripts/launch-phase.sh`, which handles worktree setup, parallel agent
launch, retry-on-crash, merge verification, and sequential stage gating.

```bash
# Full pipeline: parallel groups → merge → validate → create-pr
./scripts/launch-phase.sh docs/prompts/phase15/launch-config.yaml all

# Same pipeline with live interactive agent output in tmux panes
WATCH=1 ./scripts/launch-phase.sh docs/prompts/phase15/launch-config.yaml all

# Or run stages individually:
./scripts/launch-phase.sh <config> stage 1    # launch Stage 1 parallel groups in worktrees
./scripts/launch-phase.sh <config> merge 1    # merge Stage 1 branches to implementation branch + verify
./scripts/launch-phase.sh <config> stage 2    # launch Stage 2 groups (if any)
./scripts/launch-phase.sh <config> merge 2    # merge Stage 2 branches + verify
./scripts/launch-phase.sh <config> validate   # run validation agent (fix-and-retry)
./scripts/launch-phase.sh <config> create-pr  # create PR + trigger code review
./scripts/launch-phase.sh <config> resume stage:2  # resume pipeline from a specific step
./scripts/launch-phase.sh <config> cleanup    # remove all phase worktrees and branches
./scripts/launch-phase.sh <config> status     # show worktree/branch status
```

Where `<config>` is a path to a `launch-config.yaml` file (e.g., `docs/prompts/phase15/launch-config.yaml`).
The config file defines phase name, stages, groups, branches, merge messages, and PR metadata.

## Preflight Checks

Before launching any parallel stage, `launch-phase.sh` runs `preflight_check()` which verifies:
- **claude CLI available** — checks `command -v claude` and logs version
- **tmux available** (if `WATCH=1`) — fails fast instead of silently breaking
- **Clean git state** — uncommitted changes cause an immediate abort
- **Prompt files exist** — all groups in the stage must have a matching `.md` file
- **Merge target viable** — verifies the implementation branch exists or can be created from main
- **WASM builds** — runs `npm run build:wasm` to catch broken builds before agents start

Preflight runs automatically at the start of every `run_parallel_stage()` call.

## Partial Stage Success

If some agents in a parallel stage succeed and others fail, the pipeline continues:
- Each agent's result is tracked in `succeeded_groups` / `failed_groups` arrays
- Results are written to `${LOG_DIR}/stage-succeeded.txt` and `stage-failed.txt`
- The merge stage reads these files and **skips merging branches from failed groups**
- The pipeline only aborts if ALL groups in a stage fail; partial success continues

## Per-Branch Merge Verification

The merge step verifies the build **after each branch merge**, not just after all branches are merged.
This catches breakage early — before merging more branches on top of broken code.

After each successful branch merge, the pipeline:
1. Rebuilds WASM (Rust source may have changed)
2. Commits `Cargo.lock` if modified
3. Runs tsc, vitest, and cargo test **in parallel** (with `&` + `wait`)
4. If verification fails, launches a merge-fix agent to resolve issues

This means a merge with 3 branches runs verification 3 times, but each run is faster because
tsc/vitest/cargo test execute concurrently. The tradeoff is worth it: catching a type error after
the first merge is far cheaper than debugging a compound failure after merging all 3 branches.

## Stage Timeouts

Stages have a configurable timeout (`MAX_STAGE_DURATION`, default 1800 seconds / 30 minutes).
If agents in a stage exceed the timeout, they are killed (SIGTERM → SIGKILL after 5 seconds)
and treated as failures. Set `MAX_STAGE_DURATION=0` to disable the timeout.

## Cleanup Command

Remove all worktrees and branches for a phase:
```bash
./scripts/launch-phase.sh <config> cleanup
```

This is useful after a failed pipeline run or when you want to start fresh. It removes:
- The merge worktree (`<phase>-merge`)
- All agent worktrees (`<phase>-<group>`)
- All branches matching the phase name

## Stall Detection

A watchdog process (`monitor_agent()`) runs alongside each agent in non-WATCH mode:
- Checks the agent's log file size every 60 seconds
- If no log output for `STALL_TIMEOUT` minutes (default: 30), emits a warning
- Does not kill the agent — only warns so a human can investigate

## Model Selection

Set the `MODEL` env var to override the default Claude model for all agents:
```bash
MODEL=sonnet ./scripts/launch-phase.sh docs/prompts/phase15/launch-config.yaml all
```
Options: `opus`, `sonnet`, `haiku`. Passed as `--model $MODEL` to the `claude` CLI.

## Resume Command

Resume a pipeline from any step without re-running earlier stages:
```bash
./scripts/launch-phase.sh <config> resume <step>
```
Steps: `stage:1`, `merge:1`, `stage:2`, `merge:2`, ..., `validate`, `create-pr`. The pipeline
executes from the given step through the end. Also supports space-separated syntax: `resume stage 2`.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `WATCH` | `0` | Live agent output in tmux panes |
| `MAX_RETRIES` | `3` | Retries per agent on crash |
| `RETRY_DELAY` | `5` | Seconds between retries |
| `VALIDATE_MAX_ATTEMPTS` | `3` | Max fix-and-retry cycles for validation |
| `MERGE_FIX_RETRIES` | `3` | Retries for merge conflict resolution |
| `DEFAULT_MAX_TURNS` | `80` | Max conversation turns per agent |
| `DEFAULT_MAX_BUDGET` | `10.00` | Max USD budget per agent |
| `STALL_TIMEOUT` | `30` | Minutes of inactivity before stall warning |
| `MAX_STAGE_DURATION` | `1800` | Max seconds per stage before killing agents (0=disabled) |
| `MODEL` | (unset) | Override Claude model (`opus`, `sonnet`, `haiku`) |

## Supervisor Mode

A Claude agent can orchestrate the full phase pipeline autonomously:
```bash
./scripts/launch-supervisor.sh docs/prompts/phase15/launch-config.yaml
```

The supervisor replaces the `all` command with intelligent step-by-step orchestration:
- Reads the config to understand phase structure
- Runs each `stage N` → `merge N` step sequentially via `launch-phase.sh`
- Monitors output and logs between steps, makes judgment calls on retries
- Drives validation and PR creation
- Handles the code review loop: reads review comments, fixes issues, re-triggers review

**Worktree isolation:** All merge, validation, and PR operations happen in a dedicated merge
worktree (`/workspace/.claude/worktrees/<phase>-merge`). Agent work happens in per-group
worktrees. `/workspace` stays on `main` throughout the entire pipeline.

**When to use supervisor vs `all`:**
- Use `all` for simple phases where automated retry logic is sufficient
- Use supervisor for complex phases, risky merges, or when you want intelligent failure handling

**Environment variables:**
| Variable | Default | Purpose |
|----------|---------|---------|
| `MODEL` | (unset) | Override Claude model for the supervisor |

Note: `--max-budget-usd` only works in pipe mode (`-p`). The supervisor runs interactively,
so budget is not capped by the CLI. Monitor usage manually during long-running phases.

The supervisor prompt lives at `docs/prompts/supervisor.md` and is shared across all phases.

## Tmux-Native Supervisor Mode

`--tmux` mode gives the supervisor agent direct control over agent windows in tmux.
Unlike standard mode (where `launch-phase.sh stage N` blocks), the supervisor can
monitor, intervene, and make real-time decisions during agent execution.

```bash
./scripts/launch-supervisor.sh --tmux docs/prompts/phase16/launch-config.yaml
```

This creates a tmux session (`<phase>-supervisor`), launches the supervisor in
window 0, and attaches. The supervisor then uses `scripts/lib/tmux-supervisor.sh`
functions to manage agent windows:

| Function | Purpose |
|----------|---------|
| `tmux_create_session` | Create session (auto-done by `--tmux` flag) |
| `tmux_launch_agent` | Spawn agent in tmux window with worktree CWD |
| `tmux_poll_log` | Tail agent log file |
| `tmux_poll_agent` | Capture pane output |
| `tmux_agent_status` | Check running/succeeded/failed/not_started |
| `tmux_stage_status` | Status table for all agents |
| `tmux_kill_agent` | Stop agent (C-c → kill-window escalation) |
| `tmux_wait_stage` | Block until all agents finish or timeout |

**Critical rules:**
- Always pass the agent's worktree path as CWD (not `/workspace`)
- `tmux_launch_agent` automatically unsets `CLAUDECODE` for nested sessions
- Sleep 0.5s between `tmux send-keys` text and Enter to prevent race conditions
- `claude -p` in a tee pipeline ignores C-c — `tmux_kill_agent` escalates to `kill-window`
- Merge/validate/PR still use `launch-phase.sh` subcommands (unchanged)

See `docs/plans/tmux-supervisor.md` for the full design and test results.

## WATCH Mode

`WATCH=1` runs each agent in its own tmux window with streaming text output (not the full
rich TUI — no thinking blocks or tool-use panels). Agents use `-p` mode, which is required
for auto-exit and `--max-budget-usd` support. The orchestrator still handles worktree setup,
merge gating, and validation automatically.

- Attach: `tmux attach -t <phase>-agents`
- Switch windows: `Ctrl-B N` / `Ctrl-B P`
- Detach: `Ctrl-B D`

## Agent Prompts

Prompts live in `docs/prompts/<phaseN>/` as standalone files (one per group). Each prompt:
- Uses YAML frontmatter for structured metadata (scope, tasks, dependencies)
- Lists the exact files the agent may modify (zero overlap between parallel groups)
- Instructs the agent to skip plan mode and execute without confirmation
- Includes retry context so restarted agents resume where they left off

## Subagent Delegation

Orchestrated agents are full Claude Code sessions and can use the **Agent tool** to delegate
work to subagents defined in `.claude/agents/`. Subagent definitions are visible from worktrees
because worktrees share the repo's file content.

**Available subagents:**
| Subagent | Model | Turns | Best for | Can modify files? |
|----------|-------|-------|----------|-------------------|
| `codebase-explorer` | haiku | 20 | Initial file investigation before editing | No (read-only) |
| `rust-scheduler` | sonnet | 40 | Scheduling engine work in `crates/scheduler/` | Yes |
| `verify-and-diagnose` | sonnet | 30 | Running tsc/vitest/cargo test with structured diagnosis | Default no; yes with "fix" in prompt |

**When to use:**
- Use `codebase-explorer` before editing unfamiliar code — saves ~40K tokens of context
  vs reading files directly in the main agent.
- Use `verify-and-diagnose` instead of running test suites inline — gets structured
  pass/fail reports without raw test output in the agent's context.
- Use `rust-scheduler` when the group's tasks include `crates/scheduler/` changes.

**Budget considerations:**
Subagent turns/tokens count against the parent agent's `--max-budget-usd` (default $10).
If prompts will delegate heavily, increase the budget:
```bash
DEFAULT_MAX_BUDGET=15 ./scripts/launch-phase.sh <config> stage N
```

**Constraints:**
- Subagents have `disallowedTools: Agent` — no recursive delegation.
- Subagents inherit the worktree's working directory; all paths resolve correctly.
- File scope rules still apply: subagents should only modify files listed in the
  parent prompt's `scope.modify` section.

## Validation Prompt

The validation prompt (e.g., `docs/prompts/phase12/validate.md`) runs after merge. It:
- Executes all test suites (Rust, TypeScript, Vitest, Playwright E2E)
- If anything fails, diagnoses and fixes the issue, then re-runs
- Retries up to `VALIDATE_MAX_ATTEMPTS` (default 3) fix-and-retry cycles
- Prints a final pass/fail report table

## Unplanned Issues

Triaged in `docs/unplanned-issues.md` using a Backlog → Claimed → Planned workflow.
Planning agents claim up to 3 items, plan them into `docs/tasks/phaseN.yaml`, then mark them planned.

## Claude CLI Reference (for launch scripts)

The `claude` binary in the dev container has specific constraints. When writing or modifying
`launch-phase.sh` or any script that invokes claude programmatically, follow these rules:

- **`--prompt-file` does not exist.** Never use it. It will cause `error: unknown option`.
- **WATCH mode** (tmux, auto-exit with streaming output): Use `-p` with a positional argument:
  ```bash
  claude --dangerously-skip-permissions -p "$(cat '/path/to/prompt.md')"
  ```
  The `-p` flag ensures claude exits after completing the prompt. The tmux window
  captures the streaming text output and stays open (via `; read`) for scrollback review.
  Note: `-p` mode shows streaming text, not the full rich TUI (no thinking blocks or
  tool-use panels), but the agent output is still visible.
- **Headless/pipe mode** (non-WATCH, logging to file): Pipe via stdin with `-p`:
  ```bash
  cat prompt.md | claude --dangerously-skip-permissions -p -
  ```
- **Pure interactive mode** (manual use only): Pass prompt as positional arg without `-p`:
  ```bash
  claude --dangerously-skip-permissions "$(cat '/path/to/prompt.md')"
  ```
  Shows full rich TUI but does NOT auto-exit — claude waits for more input. Do NOT use
  this in orchestrated pipelines because the exit code file is never written until the
  user manually types `exit`.
- **Validation log parsing**: The `script` command logs the entire command (including the
  prompt text) as its first line. Any `grep` checks on validation logs must exclude the
  `COMMAND=` header line, otherwise prompt template strings like `OVERALL.*FAIL` will
  cause false positive failure detection. Use: `grep -v "COMMAND=" "$logfile" | grep -q "PATTERN"`
- **`setup_worktree()` stdout isolation**: The function returns the worktree path via stdout
  (`echo "$worktree"`). ALL other output inside the function (log messages, git commands, npm
  install) MUST be redirected to `/dev/null` or `>&2`. Use `>/dev/null 2>&1` on git and npm
  commands. If stdout is contaminated, `build_claude_cmd()` generates a broken `cd` path and
  the agent exits immediately with code 1.
- **Key flags**: `--dangerously-skip-permissions`, `-p` (print/pipe mode), `-c` (continue),
  `-r` (resume session), `--system-prompt`, `--model`, `--max-turns`, `--max-budget-usd`

## Pre-Phase Checklist

Before launching any phase, **always commit all planning work** so there is a safe point to
revert to if something goes wrong:
1. Track any new untracked files (`git add` prompt files, docs/TASKS.md, config files, etc.)
2. Commit with a descriptive message (e.g., "prep: phase 12 planning — prompts, tasks, launch config")
3. Verify `git status` is clean before running `launch-phase.sh <config> all`

This prevents `git reset --hard` from destroying planning work if a phase run needs to be reverted.

## Adding a New Phase

1. Create a phase subdirectory `docs/prompts/phase<N>/` with prompt files (e.g., `groupA.md`, `groupB.md`, `groupC.md`)
2. Define file ownership, interface contracts, and execution order in prompt files
3. Add tasks to `docs/tasks/phase<N>.yaml`
4. Create `docs/prompts/phase<N>/launch-config.yaml` with:
   - `phase:` — phase identifier (e.g., `phase15`)
   - `merge_target:` — implementation branch (e.g., `feature/phase15`)
   - `stages:` — ordered list of stages, each with groups (id, branch, merge_message)
   - `pr:` — PR metadata (title, summary, test_plan)
5. Optionally create `docs/prompts/phase<N>/validate.md` for post-merge validation
6. Run `./scripts/launch-phase.sh docs/prompts/phase<N>/launch-config.yaml all`

See `docs/prompts/phase15/launch-config.yaml` for a complete example.
