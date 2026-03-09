# Plan: Tmux-Native Supervisor

## Problem

The current supervisor (`launch-supervisor.sh`) calls `launch-phase.sh stage N` as a
blocking Bash command. During the 15-30 minutes agents run, the supervisor is blind:
it can't monitor progress, intervene on stuck agents, or make real-time decisions.

## Solution

A new supervisor mode where the supervisor agent runs inside tmux and can:
1. Spawn agent windows it can monitor
2. Poll agent output in real-time
3. Kill/restart individual agents
4. Make mid-stage decisions based on agent progress

## Architecture

```
tmux session: phase15-supervisor
├── window 0: supervisor   ← Claude supervisor agent (interactive)
├── window 1: groupA       ← Agent A (claude -p, pipe mode via tee)
├── window 2: groupB       ← Agent B (claude -p, pipe mode via tee)
├── window 3: groupC       ← Agent C (claude -p, pipe mode via tee)
└── (merge uses existing merge worktree infrastructure)
```

The supervisor doesn't call `launch-phase.sh stage N`. Instead, it:
1. Sets up worktrees (reuses existing `setup_worktree()` or calls manually)
2. Launches each agent in its own tmux window via `tmux_launch_agent`
3. Polls agent output via `tmux_poll_log` or `tmux_poll_agent`
4. Detects completion via `.status` files
5. Intervenes by killing/restarting individual agents
6. Still uses `launch-phase.sh merge N` for merge operations (no change)

## Implementation: `scripts/lib/tmux-supervisor.sh`

A library of bash functions the supervisor agent calls via Bash tool. Source it
with `source scripts/lib/tmux-supervisor.sh` before calling any function.

### Function: `tmux_create_session`

```bash
# Usage: tmux_create_session <session_name>
# Creates a tmux session with 10000-line history for better scrollback.
```

Tested: Creates session, sets history-limit. Verified with `tmux list-sessions`.

### Function: `tmux_launch_agent`

```bash
# Usage: tmux_launch_agent <session> <group> <worktree> <prompt_file> <log_file> [max_turns] [max_budget] [model]
```

Steps:
1. Validate inputs (session exists, prompt file exists, worktree exists)
2. Create tmux window named `<group>`
3. Sleep 0.5s (let window initialize)
4. Build command: `unset CLAUDECODE && cd <worktree> && cat <prompt_file> | claude --dangerously-skip-permissions --max-turns N --max-budget-usd B -p - 2>&1 | tee <log_file>; echo "EXIT:$?" > <log_file>.status`
5. Send command via `tmux send-keys`, sleep 0.5s, then send Enter

Tested with:
- Mock agent (echo prompt): completed in <5s, log captured, status=succeeded
- Real claude agent in /workspace: ran but file not found (correctly — file only in worktree)
- Real claude agent in worktree: found all 8 functions, status=succeeded, log captured

**Note on tee + pipe exit code**: The pipeline is `cat | claude | tee`, so
`PIPESTATUS[1]` captures claude's exit code (index 0=cat, 1=claude, 2=tee).
The `set -o pipefail` ensures the pipeline returns the first non-zero exit code,
but `PIPESTATUS[1]` explicitly targets claude regardless. This requires bash (not sh)
in the tmux window, which is the default.

### Function: `tmux_poll_agent`

```bash
# Usage: tmux_poll_agent <session> <group> [scroll_lines]
# Returns last N lines of pane output (default 30, including scrollback).
```

Tested: captured mid-execution output from a 5-step loop, including partial results.

### Function: `tmux_poll_log`

```bash
# Usage: tmux_poll_log <log_file> [lines]
# Returns tail of log file. More reliable than pane capture for long output.
```

Tested: returned correct output from completed agent logs.

### Function: `tmux_agent_status`

```bash
# Usage: tmux_agent_status <session> <group> <log_file>
# Returns: running | succeeded | failed | not_started
```

Logic:
1. If `<log_file>.status` exists → parse `EXIT:<code>` → "succeeded" (0) or "failed" (non-0)
2. Else if tmux window named `<group>` exists → "running"
3. Else → "not_started"

Tested: correctly returned "succeeded" for completed agents, "running" for in-progress,
"not_started" for never-launched, "failed" for killed agents.

### Function: `tmux_stage_status`

```bash
# Usage: tmux_stage_status <session> <log_dir> <groups...>
# Prints a formatted status table.
```

Output format (tested):
```
GROUP        | STATUS     | LAST_ACTIVITY  | LOG_SIZE
-------------+------------+----------------+---------
mockA        | succeeded  | 1m ago         | 4.0K
realB        | succeeded  | 45s ago        | 4.0K
slowC        | failed     | 32s ago        | 0
```

Note: plan originally included TASKS_DONE column reading `.agent-status.json`.
Implementation uses LOG_SIZE instead — simpler and always available. Task tracking
is better done by reading the status file directly when needed, not in every poll.

### Function: `tmux_kill_agent`

```bash
# Usage: tmux_kill_agent <session> <group> <log_file>
# Sends C-c, waits, escalates to kill-window.
```

Tested: C-c alone didn't stop `claude -p` (pipe mode ignores SIGINT in the pipeline).
Escalated to `tmux kill-window` which works reliably. Writes "KILLED" to `.status` file.

**Lesson learned**: claude in pipe mode (`-p -`) through a `tee` pipeline doesn't
respond to C-c cleanly. The `kill-window` escalation is the reliable path. The 3s
C-c attempts are kept for graceful shutdown of non-claude processes.

### Function: `tmux_wait_stage`

```bash
# Usage: tmux_wait_stage <session> <log_dir> <timeout_seconds> <groups...>
# Polls every 10s. Returns 0 if all succeeded, 1 if any failed or timeout.
```

Tested: correctly waited for a quick agent, returned 0 on success.

## Supervisor Prompt Changes

`docs/prompts/supervisor.md` gets a new section for tmux-native mode:

**Detection**: Supervisor checks `echo $TMUX` — if set, use tmux functions.

**Launching agents**: Source the library, call `tmux_launch_agent` per group.
The supervisor must provide the worktree path — either by calling `setup_worktree`
from `scripts/lib/worktree.sh` or creating worktrees manually.

**Monitoring**: Poll with `tmux_stage_status` every 2-5 minutes. Use `tmux_poll_log`
for deeper inspection. Delegate log analysis to `codebase-explorer` subagent to
preserve supervisor context.

**Intervention**: Kill with `tmux_kill_agent`, then restart with retry context
(same pattern as `build_retry_context` in `agent.sh`).

**Merge/validate/PR**: Still use `launch-phase.sh merge N`, `launch-phase.sh validate`,
`launch-phase.sh create-pr`. These don't need tmux — they run in the merge worktree.

**Critical timing rule**: Always sleep 0.5s between `send-keys` text and Enter:
```bash
tmux send-keys -t <target> '<command>'
sleep 0.5
tmux send-keys -t <target> Enter
```

## Changes Required

| File | Change | Status |
|------|--------|--------|
| `scripts/lib/tmux-supervisor.sh` | New file — 8 functions | **Done, tested** |
| `docs/plans/tmux-supervisor.md` | This plan document | **Done** |
| `scripts/launch-supervisor.sh` | Add `--tmux` flag | **Done** |
| `docs/prompts/supervisor.md` | Add tmux-native mode section | **Done** |
| `.claude/skills/multi-agent-orchestration/SKILL.md` | Add tmux-supervisor ref | **Done** |
| `docs/multi-agent-guide.md` | Add tmux-supervisor section | **Done** |

## What Does NOT Change

- `launch-phase.sh` — still works as-is for non-tmux usage
- `scripts/lib/agent.sh` — pipe mode still the default
- `scripts/lib/watch.sh` — WATCH mode still works independently
- Agent prompts — agents don't know they're being monitored
- Worktree setup — reuses existing infrastructure
- Merge/validate/PR — still uses `launch-phase.sh` subcommands

## Primitive Verification Results

| # | Primitive | Command | Result |
|---|-----------|---------|--------|
| 1 | Create session | `tmux new-session -d -s test -n w1` | PASS |
| 2 | Send keys | `tmux send-keys -t test:w1 'echo hi' Enter` | PASS |
| 3 | Capture output | `tmux capture-pane -t test:w1 -p` | PASS |
| 4 | Scrollback | `capture-pane -p -S -100` | PASS (60 vs 24 lines) |
| 5 | Kill process | `tmux send-keys C-c` / `kill-window` | PASS (kill-window reliable) |
| 6 | Nested claude | `unset CLAUDECODE && echo "hi" \| claude -p -` | PASS |
| 7 | Poll mid-exec | capture-pane during loop | PASS |
| 8 | Sleep timing | 0.5s between send-keys and Enter | PASS |

## Function Test Results

| # | Function | Test | Result |
|---|----------|------|--------|
| 1 | `tmux_create_session` | Create + list | PASS |
| 2 | `tmux_launch_agent` (mock) | Echo prompt → log + status | PASS |
| 3 | `tmux_launch_agent` (real, wrong CWD) | Agent in /workspace, file in worktree | PASS (correctly failed to find file) |
| 4 | `tmux_launch_agent` (real, correct CWD) | Agent in worktree, found 8 functions | PASS |
| 5 | `tmux_agent_status` | Check succeeded/running/not_started/failed | PASS (all 4 states) |
| 6 | `tmux_stage_status` | Table with mixed statuses | PASS |
| 7 | `tmux_kill_agent` | Kill running claude agent | PASS (via kill-window) |
| 8 | `tmux_poll_agent` | Capture mid-execution | PASS |
| 9 | `tmux_poll_log` | Tail of completed log | PASS |
| 10 | `tmux_wait_stage` | Wait for quick agent | PASS (returned in 5s) |

## Risks and Mitigations

1. **CLAUDECODE env var**: Must `unset CLAUDECODE` in each window. Handled
   automatically by `tmux_launch_agent`.

2. **Pipe exit code via tee**: `$?` after `cmd | tee log` returns tee's exit code.
   Mitigation: tee rarely fails; for precise claude exit codes, use `${PIPESTATUS[1]}`
   (pipeline: cat=0, claude=1, tee=2). Current implementation uses `PIPESTATUS[1]`.

3. **Pane buffer size**: Default is 2000 lines. Mitigated by: (a) `history-limit 10000`
   in `tmux_create_session`, (b) primary monitoring via log files, not pane capture.

4. **Supervisor context consumption**: Each poll brings agent output into context.
   Mitigations: poll sparingly (every 2-5 min), use `tail -20`, delegate analysis
   to `codebase-explorer` subagent.

5. **C-c doesn't stop claude in pipe mode**: Confirmed during testing. `kill-window`
   is the reliable fallback. The 3s C-c attempts are kept for non-claude processes.

6. **tmux not available**: `tmux_launch_agent` checks `command -v tmux` and fails with
   a clear error message. Other functions call tmux directly and rely on the shell's
   "command not found" error. Fallback: use existing `launch-phase.sh stage` approach.

7. **Worktree coordination**: The supervisor must set up worktrees before launching.
   This is explicit — no magic. The supervisor prompt documents the exact steps.
