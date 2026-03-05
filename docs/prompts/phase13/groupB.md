# Phase 13 Group B — Orchestrator Improvements (launch-phase.sh)

You are implementing Phase 13 Group B for the Ganttlet project.
Read CLAUDE.md and `docs/agent-orchestration-recommendations.md` (Sections 1, 3, 4, 6, 9, 10) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

## Success Criteria (you're done when ALL of these are true):
1. `run_agent()` retry context includes: recent commits, last 80 lines of previous log, and contents of `claude-progress.txt`
2. All `claude` invocations include `--max-turns` and `--max-budget-usd` flags
3. `resolve_merge_conflicts()` injects conflict diffs and branch summaries into the prompt
4. Failed groups in a parallel stage don't block successful groups from merging
5. A `preflight_check()` function exists and runs before each stage
6. `run_agent()` accepts a `MODEL` env var and passes `--model` to claude
7. A `monitor_agent()` watchdog function exists for stall detection
8. `bash -n scripts/launch-phase.sh` exits 0 (no syntax errors)
9. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- `bash -n scripts/launch-phase.sh` fails (syntax error)
- Any of the above features are missing
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool. The multi-agent orchestrator
(`scripts/launch-phase.sh`) manages parallel Claude Code agents running in git worktrees.
This script is ~867 lines and handles worktree setup, agent launch with retry, merge gating,
conflict resolution, and validation.

## Your files (ONLY modify these):
- `scripts/launch-phase.sh`

Do NOT modify `CLAUDE.md`, `.claude/`, `.github/`, `scripts/verify.sh`, or any source code files.
Other agents own those files.

## Progress Tracking

After completing each major task (B1, B2, etc.), append a status line to `claude-progress.txt`
in the worktree root:

```
B1: DONE — rich retry context with log tails + progress file
B2: IN PROGRESS — adding --max-turns flag
```

On restart, read `claude-progress.txt` FIRST to understand where you left off.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK (not "stop all work").
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.
- Emergency: If running out of context, `git add -A && git commit -m "emergency: groupB saving work"`.

## Tasks — execute in order:

### B1: Enrich retry context in run_agent()

Read the current `run_agent()` function (lines ~90-149). Currently it only injects `git log --oneline -5` on retry. Improve it:

1. Capture the last 80 lines of the previous attempt's log:
```bash
prev_log_tail=$(tail -100 "$logfile" 2>/dev/null | head -80 || echo "(no previous output)")
```

2. Read the progress file if it exists:
```bash
progress=""
if [[ -f "${workdir}/claude-progress.txt" ]]; then
  progress=$(cat "${workdir}/claude-progress.txt")
fi
```

3. Inject both into the retry prompt alongside the existing commit context:
```
Last output from your previous attempt (may contain the error that caused the crash):
\`\`\`
${prev_log_tail}
\`\`\`

Your progress file (tasks completed so far):
${progress}

Review what has already been done. Do NOT redo completed work. If the output above shows a specific error, fix that error first.
```

4. Also inject progress file and error context into the validation retry (in `validate()` and `watch_validate()`). Replace the current `grep -A2 'FAIL'` extraction with:
```bash
prev_report=$(sed -n '/║.*CHECK/,/║.*OVERALL/p' "$prev_log" 2>/dev/null || echo "")
prev_errors=$(grep -E '(error\[|FAILED|panicked|assertion.*failed)' "$prev_log" 2>/dev/null | tail -20 || echo "")
```

5. Verify: `bash -n scripts/launch-phase.sh` — no syntax errors
6. Commit: `"feat(orchestrator): enrich retry context with log tails and progress file"`

### B2: Add --max-turns and --max-budget-usd to agent invocations

1. Add default config variables near the top of the file (in the Config section):
```bash
DEFAULT_MAX_TURNS="${DEFAULT_MAX_TURNS:-80}"
DEFAULT_MAX_BUDGET="${DEFAULT_MAX_BUDGET:-10.00}"
```

2. In `run_agent()`, add these flags to the claude invocation:
```bash
local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
echo "$full_prompt" | claude --dangerously-skip-permissions --max-turns "$max_turns" --max-budget-usd "$max_budget" -p -
```

3. In `build_claude_cmd()` (WATCH mode), add the same flags.

4. In the validation agent invocations (both `validate()` and `watch_validate()`), add the flags.

5. Verify: `bash -n scripts/launch-phase.sh` — no syntax errors
6. Commit: `"feat(orchestrator): add --max-turns and --max-budget-usd to all agent invocations"`

### B3: Enrich merge conflict context

Read the current `resolve_merge_conflicts()` function. It only passes the file list. Improve it:

1. For each conflicted file, capture the first 200 lines (which will contain conflict markers):
```bash
local conflict_diffs=""
while IFS= read -r f; do
  conflict_diffs+="
=== $f ===
$(head -200 "$f")
"
done <<< "$conflicts"
```

2. Get branch commit summary:
```bash
local branch_summary
branch_summary=$(git log --oneline main.."$branch" | head -10)
```

3. Inject both into the merge fix prompt. Add before the "Instructions:" section:
```
What the branch did (recent commits):
${branch_summary}

Conflicted files and their current state (showing conflict markers):
${conflict_diffs}
```

4. Update the instruction text to say: "Keep BOTH sides of the changes — the goal is to combine the work from both branches."

5. Verify: `bash -n scripts/launch-phase.sh` — no syntax errors
6. Commit: `"feat(orchestrator): inject diffs and branch summary into merge conflict context"`

### B4: Implement partial stage success

Currently `run_parallel_stage()` fails entirely if any group fails. Change it so successful groups can still merge:

1. In `run_parallel_stage()`, track which groups succeeded and which failed:
```bash
local succeeded_groups=()
local failed_groups=()

for i in "${!pids[@]}"; do
  local pid="${pids[$i]}"
  local group="${groups_list[$i]}"
  set +e
  wait "$pid"
  local rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    err "${group} (PID ${pid}) failed with exit code ${rc}"
    failed_groups+=("$group")
  else
    ok "${group} (PID ${pid}) finished"
    succeeded_groups+=("$group")
  fi
done
```

2. Write a result file so the merge stage knows which groups to skip:
```bash
echo "${succeeded_groups[*]}" > "${LOG_DIR}/stage-succeeded.txt"
echo "${failed_groups[*]}" > "${LOG_DIR}/stage-failed.txt"
```

3. In `do_merge_stage()`, check if each group succeeded before attempting to merge it:
```bash
local succeeded=""
[[ -f "${LOG_DIR}/stage-succeeded.txt" ]] && succeeded=$(cat "${LOG_DIR}/stage-succeeded.txt")

for i in "${!m_branches_ref[@]}"; do
  local group="${m_groups_ref[$i]}"
  if [[ -n "$succeeded" ]] && ! echo " $succeeded " | grep -q " $group "; then
    warn "Skipping merge of ${group} (failed in parallel stage)"
    continue
  fi
  # ... existing merge logic
done
```

4. Adjust the return code logic: return 0 if at least one group succeeded, return 1 only if ALL groups failed.

5. Do the same for `watch_parallel_stage()`.

6. Verify: `bash -n scripts/launch-phase.sh` — no syntax errors
7. Commit: `"feat(orchestrator): partial stage success — merge successful groups, skip failed"`

### B5: Add preflight checks

1. Create a `preflight_check()` function that runs before any stage:
```bash
preflight_check() {
  log "=== Preflight check ==="

  # Clean git state
  if [[ -n "$(git status --porcelain)" ]]; then
    err "Dirty git state — commit or stash changes before launching agents"
    return 1
  fi

  # Check that prompt files exist
  local prompts_exist=true
  for group in "$@"; do
    if [[ ! -f "${WORKSPACE}/${PROMPTS_DIR}/${group}.md" ]]; then
      err "Missing prompt file: ${PROMPTS_DIR}/${group}.md"
      prompts_exist=false
    fi
  done
  $prompts_exist || return 1

  # Quick build check — verify WASM builds and basic compilation
  log "Checking WASM build..."
  if ! npm run build:wasm > /dev/null 2>&1; then
    err "WASM build broken — fix before launching agents"
    return 1
  fi

  ok "Preflight check passed"
}
```

2. Call `preflight_check` at the start of `run_parallel_stage()` with the group names as arguments.

3. Verify: `bash -n scripts/launch-phase.sh` — no syntax errors
4. Commit: `"feat(orchestrator): add preflight check before launching agent stages"`

### B6: Add model selection per task complexity

1. In `run_agent()`, support a `MODEL` env var:
```bash
local model_flag=""
if [[ -n "${MODEL:-}" ]]; then
  model_flag="--model $MODEL"
fi
```

2. Add the flag to all claude invocations in `run_agent()` and `build_claude_cmd()`.

3. Add a comment in the config section showing how to use it:
```bash
# Per-agent model override: MODEL=sonnet run_agent groupH "$workdir"
# Default: uses Claude's default model. Options: opus, sonnet, haiku
```

4. Verify: `bash -n scripts/launch-phase.sh` — no syntax errors
5. Commit: `"feat(orchestrator): support MODEL env var for per-agent model selection"`

### B7: Add stall detection watchdog

1. Create a `monitor_agent()` function:
```bash
monitor_agent() {
  local agent_pid="$1"
  local workdir="$2"
  local group="$3"
  local timeout_minutes="${STALL_TIMEOUT:-30}"
  local status_file="${workdir}/claude-progress.txt"
  local logfile="${LOG_DIR}/${group}.log"
  local last_size=0

  while kill -0 "$agent_pid" 2>/dev/null; do
    sleep 60

    # Check if the log file is growing
    local current_size=0
    [[ -f "$logfile" ]] && current_size=$(stat -c %s "$logfile" 2>/dev/null || echo 0)

    if [[ "$current_size" == "$last_size" ]]; then
      local elapsed_since_activity
      elapsed_since_activity=$(( ($(date +%s) - $(stat -c %Y "$logfile" 2>/dev/null || date +%s)) / 60 ))
      if [[ $elapsed_since_activity -ge $timeout_minutes ]]; then
        warn "${group}: no log activity in ${elapsed_since_activity} minutes — may be stuck"
      fi
    fi
    last_size=$current_size
  done
}
```

2. In `run_parallel_stage()`, launch `monitor_agent` as a background process alongside each agent.

3. Kill monitor processes when agents finish.

4. Add a config variable:
```bash
STALL_TIMEOUT="${STALL_TIMEOUT:-30}"  # minutes before warning about stalled agent
```

5. Verify: `bash -n scripts/launch-phase.sh` — no syntax errors
6. Commit: `"feat(orchestrator): add stall detection watchdog for long-running agents"`

### B8: Final verification

1. Run `bash -n scripts/launch-phase.sh` — must exit 0 (no syntax errors)
2. Run `shellcheck scripts/launch-phase.sh 2>/dev/null || true` — fix any critical warnings if shellcheck is available
3. `git status` — everything committed
4. `git diff --stat HEAD~8..HEAD` — review all your changes
5. Update `claude-progress.txt` with final status
