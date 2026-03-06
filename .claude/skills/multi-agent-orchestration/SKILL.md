---
name: multi-agent-orchestration
description: "Use when modifying launch-phase.sh, creating phase prompts, debugging orchestration, or setting up multi-agent workflows. Covers launch architecture, CLI flags, WATCH mode, and lessons learned."
---

# Multi-Agent Orchestration Guide

## launch-phase.sh Architecture
- **Stages**: Sequential groups of parallel agents (stage1 → merge1 → stage2 → merge2 → ...)
- **Merge gating**: Each stage's branches must merge cleanly before the next stage starts
- **Retry-on-crash**: Agents that crash are restarted automatically
- **Validation**: Post-merge validation agent runs fix-and-retry cycles

See `docs/multi-agent-guide.md` for full command reference and usage examples.

## Prompt File Structure
Prompts live in `docs/prompts/<phaseN>/` (one file per group). Each prompt must:
- Use YAML frontmatter for structured metadata (scope, tasks, dependencies)
- List the exact files the agent may modify (zero overlap between groups)
- Instruct the agent to skip plan mode and execute without confirmation
- Include retry context so restarted agents resume where they left off

Phase launch configuration is defined in `docs/prompts/<phaseN>/launch-config.yaml`
(stages, groups, branches, merge messages) rather than hardcoded in `launch-phase.sh`.

## Worktree Isolation
Each agent runs in its own git worktree branched from main. This prevents
file conflicts between parallel agents. The `setup_worktree()` function
creates and initializes worktrees.

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

## Lessons Learned
- **Claude output modes matter**: `-p` produces sparse text-only output (no thinking blocks, no tool-use panels). Interactive mode (no `-p`) produces full rich TUI but does NOT auto-exit — claude waits for more input. Solution: WATCH mode runs claude interactively in tmux, and the prompt instructs claude to exit when done.
- **WATCH mode requires tmux**: Script must check `command -v tmux` and fail fast. Without this guard, tmux commands silently fail and the polling loop hangs forever.
- **`PIPESTATUS[1]`** is required to capture claude's exit code through a `tee` pipe (`$?` gives tee's exit code).
- **Heredoc quoting**: WATCH mode wrapper scripts must use single-quoted heredoc (`<<'DELIM'`) with sed placeholder substitution to avoid premature variable expansion.
- **`setup_worktree()` stdout isolation**: Returns path via stdout — all other output must go to `>/dev/null` or `>&2`, otherwise downstream `cd` commands break.
- **`script -q -c` is fragile**: Prefer `tee -a` for simultaneous terminal + file capture.
- **Validation log parsing**: Must exclude the `COMMAND=` header line to avoid false positive failure detection from prompt template strings.
- **Container dependencies**: tmux must be in the Dockerfile's `apt-get install` line. If missing, WATCH mode is completely broken with no useful error.
