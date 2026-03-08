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
./scripts/launch-phase.sh <config> status     # show worktree/branch status
```

Where `<config>` is a path to a `launch-config.yaml` file (e.g., `docs/prompts/phase15/launch-config.yaml`).
The config file defines phase name, stages, groups, branches, merge messages, and PR metadata.

## Preflight Checks

Before launching any parallel stage, `launch-phase.sh` runs `preflight_check()` which verifies:
- **Clean git state** — uncommitted changes cause an immediate abort
- **Prompt files exist** — all groups in the stage must have a matching `.md` file
- **WASM builds** — runs `npm run build:wasm` to catch broken builds before agents start

Preflight runs automatically at the start of every `run_parallel_stage()` call.

## Partial Stage Success

If some agents in a parallel stage succeed and others fail, the pipeline continues:
- Each agent's result is tracked in `succeeded_groups` / `failed_groups` arrays
- Results are written to `${LOG_DIR}/stage-succeeded.txt` and `stage-failed.txt`
- The merge stage reads these files and **skips merging branches from failed groups**
- The pipeline only aborts if ALL groups in a stage fail; partial success continues

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
| `MODEL` | (unset) | Override Claude model (`opus`, `sonnet`, `haiku`) |

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
