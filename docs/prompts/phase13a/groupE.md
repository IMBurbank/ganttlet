# Phase 13a Group E — Documentation Alignment

You are implementing Phase 13a Group E for the Ganttlet project.
Read `docs/phase13-review.md` for the full review context. Read `scripts/launch-phase.sh`
to understand the current features before updating the documentation.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Success Criteria (you're done when ALL of these are true):
1. `docs/multi-agent-guide.md` documents all current launch-phase.sh features (preflight, partial success, stall detection, model selection, resume command, new env vars)
2. The WATCH mode description is internally consistent (no contradiction between overview and CLI reference sections)
3. `--max-turns` is listed in the CLI reference key flags
4. `CLAUDE.md` mentions the pre-commit hook with install instructions
5. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- multi-agent-guide.md still says "full interactive output" for WATCH mode
- Any new launch-phase.sh feature is missing from the guide
- CLAUDE.md doesn't mention pre-commit hook
- Uncommitted changes

## Your files (ONLY modify these):
- `docs/multi-agent-guide.md`
- `CLAUDE.md`

Do NOT modify `scripts/`, `.github/`, `.claude/skills/`, or any source code files.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.

## Tasks — execute in order:

### E1: Update multi-agent-guide.md with new launch-phase.sh features

1. Read `scripts/launch-phase.sh` to understand all current features.
2. Read `docs/multi-agent-guide.md` to see what's currently documented.
3. Add a new section **"Orchestrator Features"** (or extend the existing launch-phase.sh section) covering:

   **Preflight Checks:**
   - `preflight_check()` runs before each stage
   - Verifies: clean git state, prompt files exist, WASM builds
   - Fails fast with clear error messages

   **Partial Stage Success:**
   - If some groups fail in a parallel stage, successful groups still merge
   - Result files written to `${LOG_DIR}/stage-succeeded.txt` and `stage-failed.txt`
   - `do_merge_stage()` skips groups that failed

   **Stall Detection:**
   - `monitor_agent()` runs alongside each agent as a background watchdog
   - Monitors log file size; warns if no activity for `STALL_TIMEOUT` minutes (default: 30)
   - Does not kill agents — only warns

   **Model Selection:**
   - Set `MODEL` env var to override the Claude model per agent
   - Example: `MODEL=sonnet ./scripts/launch-phase.sh all`
   - Passed through as `--model` flag to all claude invocations

   **Resume:**
   - `./scripts/launch-phase.sh resume <step>` resumes from any pipeline step
   - Steps: stage1, merge1, stage2, merge2, stage3, merge3, validate

4. Add the new environment variables to the launch-phase.sh commands section or a new
   "Environment Variables" subsection:
   - `DEFAULT_MAX_TURNS` (default: 80) — max agentic turns per invocation
   - `DEFAULT_MAX_BUDGET` (default: 10.00) — max spend in USD per invocation
   - `STALL_TIMEOUT` (default: 30) — minutes before stall warning
   - `MODEL` — override Claude model (opus, sonnet, haiku)
   - `MAX_TURNS` / `MAX_BUDGET` — per-run overrides of the defaults

5. Add `--max-turns` to the CLI reference key flags list (line ~97).

6. Commit: `"docs: update multi-agent-guide.md with preflight, partial success, stall detection, model selection, resume"`

### E2: Fix WATCH mode description contradiction

1. In `docs/multi-agent-guide.md`, the WATCH Mode section (~line 34) says:
   > `WATCH=1` runs each agent in its own tmux window with full interactive output (tool calls, diffs, thinking — the same as running `claude` directly in a terminal).

   This is incorrect. WATCH mode uses `-p` (pipe mode), which produces streaming text output,
   NOT the full rich TUI.

2. Replace the WATCH Mode section description with something like:
   > `WATCH=1` runs each agent in its own tmux window with streaming text output visible in
   > real-time. The orchestrator still handles worktree setup, merge gating, and validation
   > automatically. Note: agents run in `-p` (pipe) mode for auto-exit and budget control,
   > so the output is streaming text rather than the full rich TUI (no thinking blocks or
   > tool-use panels).

3. Verify the CLI reference section (~line 68-75) is consistent with the updated description.
   It should already be correct (it describes `-p` mode accurately).

4. Commit: `"docs: fix WATCH mode description — streaming text, not full TUI"`

### E3: Add pre-commit hook reference to CLAUDE.md

1. Read current `CLAUDE.md`.
2. In the **Development Environment** section, add a line about the pre-commit hook:
   ```
   - Pre-commit hook: `ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit` (rejects todo!(), stubs, commented-out tests)
   ```
3. Keep CLAUDE.md under 120 lines — this adds only 1 line.
4. Commit: `"docs: add pre-commit hook reference to CLAUDE.md"`

### E4: Final verification

1. `git status` — everything committed
2. `git diff --stat HEAD~3..HEAD` — review all your changes
3. Verify no files outside your scope were modified
4. Update `claude-progress.txt` with final status
