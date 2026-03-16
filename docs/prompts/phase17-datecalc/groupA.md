---
phase: 17
group: A
stage: 1
agent_count: 1
scope:
  modify:
    - scripts/datecalc-functions.sh
    - Dockerfile
    - CLAUDE.md
    - crates/scheduler/CLAUDE.md
  read_only:
    - docs/plans/datecalc-tool.md
    - crates/scheduler/src/date_utils.rs
    - src/utils/dateUtils.ts
depends_on: []
tasks:
  - id: A1
    summary: "Shell function aliases"
  - id: A2
    summary: "Update CLAUDE.md date math examples"
---

# Phase 17 Group A — Shell Functions + Docs

You are implementing Phase 17 Group A for the Ganttlet project.
Read `CLAUDE.md` for full project context.
Read `docs/plans/datecalc-tool.md` for the detailed plan.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Worktree Rules (Non-Negotiable)

You are working in a **git worktree** — NOT in `/workspace`.
All file paths below are **relative to your worktree root** (your CWD).
**NEVER** modify, read from, or `cd` into `/workspace` — that is `main` and must not be touched.
All git operations (commit, push) happen in this worktree directory.

## Context

Phase 16 established the inclusive end-date convention with `task_end_date`/`task_duration`
as the only public API and `shift_date` as `pub(crate)`. This group adds agent-facing
shell functions that match the code function names agents already write, and updates
CLAUDE.md to reference them.

## Your files (ONLY modify these):

**Modify (paths relative to worktree root):**
- `scripts/datecalc-functions.sh` (CREATE)
- `Dockerfile`
- `CLAUDE.md`
- `crates/scheduler/CLAUDE.md`

**Read-only:**
- `docs/plans/datecalc-tool.md`
- `crates/scheduler/src/date_utils.rs`
- `src/utils/dateUtils.ts`

## Tasks — execute in order:

### A1: Shell function aliases

Create `scripts/datecalc-functions.sh`:

```bash
#!/usr/bin/env bash
# Shell function aliases for bizday — matches code function names.
# Usage: source this file or add to .bashrc.
# Agents call taskEndDate/task_end_date/taskDuration/task_duration directly.

taskEndDate()    { bizday "$1" "$2"; }
task_end_date()  { bizday "$1" "$2"; }
taskDuration()   { bizday "$1" "$2"; }
task_duration()  { bizday "$1" "$2"; }
```

Add to `Dockerfile` — find the section that sets up the dev environment and add:

```bash
# Date math shell functions — same names as code functions
RUN echo 'source /workspace/scripts/datecalc-functions.sh' >> /root/.bashrc
```

Also ensure `bizday` binary is on PATH:
```bash
ENV PATH="/workspace/target/release:${PATH}"
```

Note: The shell functions will fail gracefully until the `bizday` binary is built
(Group B). That's expected — they'll work after `cargo build --release -p bizday`.

Commit: `"feat: add shell function aliases for bizday (taskEndDate, task_end_date, etc.)"`

### A2: Update CLAUDE.md date math examples

In `CLAUDE.md` (in your worktree root), find the date math section (starts with
`NEVER do any arithmetic, date/time calculation, or duration math in your head`).

Replace the current examples:
```markdown
  - **Any arithmetic**: `python3 -c "print(17 * 3 + 42)"` or `node -e "console.log(...)"`
  - **Date/time math**: `date -d '2026-03-06 + 17 days' +%Y-%m-%d` or `node -e "..."` with `date-fns`
  - **Business days / weekends**: `node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('2026-03-20'), d.parseISO('2026-03-06')))"` — prefer `date-fns` functions (`differenceInBusinessDays`, `addBusinessDays`, `isWeekend`) over project wrappers
  - **In code**: prefer `date-fns` directly (`differenceInCalendarDays`, `addDays`, `addBusinessDays`, `format`, `parseISO`) — project helpers in `src/utils/dateUtils.ts` and `crates/scheduler/src/date_utils.rs` exist but are thin wrappers; use the standard library when writing new code to minimize bug surface
```

With:
```markdown
  - **Any arithmetic**: `python3 -c "print(17 * 3 + 42)"` or `node -e "console.log(...)"`
  - **Date/time math**: NEVER compute dates mentally. Use the shell functions — same names as the code you're writing:
    - `taskEndDate 2026-03-11 10` → `2026-03-24` (end date for 10-day task = `taskEndDate` in code)
    - `taskDuration 2026-03-11 2026-03-24` → `10` (inclusive duration = `taskDuration` in code)
    - Also available as `task_end_date`, `task_duration`, `bizday`
    - `bizday 2026-03-07` → Saturday — next business day: `2026-03-09`
    - `bizday verify 2026-03-11 10 2026-03-24` → OK (assert in scripts)
  - **In code**: use `taskEndDate`/`taskDuration` (TS) or `task_end_date`/`task_duration` (Rust). NEVER use `addBusinessDays` directly for end dates — `taskEndDate` handles the inclusive convention.
```

In `crates/scheduler/CLAUDE.md` (in your worktree root), find:
```
- Do arithmetic in your head — use `node -e` or `python3 -c`
```
Replace with:
```
- Do arithmetic in your head — use `taskEndDate`/`taskDuration` shell functions or `bizday` CLI
```

Commit: `"docs: update CLAUDE.md date math examples to use shell functions"`

### Final verification

```bash
cat scripts/datecalc-functions.sh
grep -n "datecalc-functions" Dockerfile
grep -n "taskEndDate\|bizday" CLAUDE.md | head -10
grep -n "taskEndDate\|bizday" crates/scheduler/CLAUDE.md | head -5
```

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches)
- Level 2: Commit WIP, move to next task
- Level 3: Commit, mark blocked
- **Calculations**: NEVER do mental math — use `taskEndDate`/`taskDuration` shell functions for dates, `python3 -c` for arithmetic
