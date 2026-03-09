---
phase: 15b-recs
group: A
stage: 1
agent_count: 1
scope:
  modify:
    - scripts/lib/watch.sh
    - scripts/lib/validate.sh
  read_only:
    - scripts/lib/agent.sh
    - scripts/lib/stage.sh
    - scripts/lib/tmux-supervisor.sh
depends_on: []
tasks:
  - id: A1
    summary: "Read watch.sh and validate.sh — understand validation flow"
  - id: A2
    summary: "Switch watch_validate to pipe mode"
  - id: A3
    summary: "Add wall-clock timeout to watch_validate"
  - id: A4
    summary: "Add wall-clock timeout to pipe-mode validate"
  - id: A5
    summary: "Verify syntax with bash -n"
---

# Phase 15b-recs Group A — Validation Pipe Mode + Timeout

You are implementing Phase 15b-recs Group A for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

During Phase 15b, the WATCH-mode validation agent stalled for 29 minutes because:
1. It ran in interactive mode, which let it push `full-verify.sh` to background
2. The idle detection (120s threshold) didn't trigger because the agent was still generating output (thinking/computing)
3. There was no wall-clock timeout to cap the total run time

The non-WATCH validation in `validate.sh` already uses pipe mode (`-p`), which prevents background task issues. We need to align WATCH mode validation with this approach, and add a wall-clock timeout to both.

## Your files (ONLY modify these):
- `scripts/lib/watch.sh` — `watch_validate()` function (lines 303-460)
- `scripts/lib/validate.sh` — `validate()` function (lines 7-92)

Read-only:
- `scripts/lib/agent.sh` — reference for stall patterns
- `scripts/lib/tmux-supervisor.sh` — reference for timeout patterns in `tmux_wait_stage`

## Tasks — execute in order:

### A1: Read and understand

1. Read `scripts/lib/watch.sh` — focus on `watch_validate()` (lines 303-460)
2. Read `scripts/lib/validate.sh` — focus on `validate()` (lines 7-92)
3. Read `scripts/lib/tmux-supervisor.sh` — note timeout pattern in `tmux_wait_stage` (lines 220-267)

Note the key difference: `validate.sh` runs claude with `-p -` (pipe mode), but `watch.sh`'s `watch_validate` runs claude **interactively** on line 406:
```bash
claude --dangerously-skip-permissions --max-turns ... "$(cat '${prompt_to_use}')"
```

### A2: Switch watch_validate to pipe mode

In `scripts/lib/watch.sh`, modify the `watch_validate()` function to use pipe mode.

**Current (line 406):**
```bash
claude --dangerously-skip-permissions --max-turns "${max_turns_val}" --max-budget-usd "${max_budget_val}" ${model_flag_val} "\$(cat '${prompt_to_use}')"
```

**Replace with:**
```bash
cat '${prompt_to_use}' | claude --dangerously-skip-permissions --max-turns "${max_turns_val}" --max-budget-usd "${max_budget_val}" ${model_flag_val} -p - 2>&1 | tee -a '${logfile}'
```

Also:
- Remove the `tmux pipe-pane` lines (360, 416) since we're now piping directly to tee
- Update the exit code capture to use `PIPESTATUS[1]` (claude is the 2nd command in the pipe)
- The idle monitor (lines 374-403) can be simplified or removed since pipe mode auto-exits. But keep it as a safety net — change the threshold to something longer (300s) since pipe mode shouldn't stall normally.

**Important**: The wrapper script uses heredoc with variable escaping. Make sure all `$` signs in the new pipe command are properly escaped (`\$`) since the wrapper is generated via `cat > "$wrapper" <<VALIDATE_WRAPPER`.

Commit: `"fix: switch watch_validate to pipe mode — prevents background task stalls"`

### A3: Add wall-clock timeout to watch_validate

Add a `VALIDATE_TIMEOUT` variable (default 600 seconds = 10 minutes) that caps how long each validation attempt can run.

In the polling loop of `watch_validate` (lines 428-430):
```bash
while [[ ! -f "$exitcode_file" ]]; do
  sleep 5
done
```

Replace with a timeout-aware loop:
```bash
local validate_timeout="${VALIDATE_TIMEOUT:-600}"
local validate_start
validate_start=$(date +%s)
while [[ ! -f "$exitcode_file" ]]; do
  sleep 5
  local now
  now=$(date +%s)
  local elapsed=$(( now - validate_start ))
  if [[ $elapsed -ge $validate_timeout ]]; then
    warn "Validation attempt ${attempt} timed out after ${validate_timeout}s"
    tmux kill-session -t "${tmux_session}" 2>/dev/null || true
    echo "1" > "$exitcode_file"
    break
  fi
done
```

Also add `VALIDATE_TIMEOUT` to the defaults section at the top of `watch.sh` (around line 13-16) alongside the existing threshold variables.

Commit: `"fix: add wall-clock timeout to WATCH validation (default 600s)"`

### A4: Add wall-clock timeout to pipe-mode validate

In `scripts/lib/validate.sh`, add a timeout to the pipe-mode claude invocation (line 56-59).

**Current:**
```bash
(
  cd "$MERGE_WORKTREE"
  echo "$prompt" | claude --dangerously-skip-permissions --max-turns "$max_turns" --max-budget-usd "$max_budget" -p - > "$logfile" 2>&1
)
local exit_code=$?
```

**Replace with:**
```bash
local validate_timeout="${VALIDATE_TIMEOUT:-600}"
(
  cd "$MERGE_WORKTREE"
  timeout "$validate_timeout" bash -c 'echo "$1" | claude --dangerously-skip-permissions --max-turns "$2" --max-budget-usd "$3" -p -' _ "$prompt" "$max_turns" "$max_budget" > "$logfile" 2>&1
)
local exit_code=$?
if [[ $exit_code -eq 124 ]]; then
  warn "Validation attempt ${attempt} timed out after ${validate_timeout}s"
fi
```

Note: `timeout` returns exit code 124 on timeout. The `bash -c` wrapper is needed because `timeout` can't handle pipes directly.

Commit: `"fix: add wall-clock timeout to pipe-mode validation (default 600s)"`

### A5: Verify syntax

Run bash syntax checks on both modified files:
```bash
bash -n scripts/lib/watch.sh && echo "watch.sh OK" || echo "watch.sh FAILED"
bash -n scripts/lib/validate.sh && echo "validate.sh OK" || echo "validate.sh FAILED"
```

Fix any syntax errors found.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupA saving work"`.
- **Calculations**: NEVER do mental math.
