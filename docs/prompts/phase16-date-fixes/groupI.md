---
phase: 16
group: I
stage: 5
agent_count: 1
scope:
  modify:
    - src/utils/dateUtils.ts
    - crates/scheduler/src/date_utils.rs
    - scripts/pre-commit-hook.sh
    - docs/unplanned-issues.md
    - docs/completed-phases.md
    - .claude/skills/google-sheets-sync/SKILL.md
    - .claude/skills/e2e-testing/SKILL.md
  read_only:
    - docs/plans/date-calc-fixes.md
depends_on: [D, E, F, G]
tasks:
  - id: I1
    summary: "Delete workingDaysBetween from dateUtils.ts"
  - id: I2
    summary: "Remove next_biz_day_on_or_after alias in date_utils.rs"
  - id: I3
    summary: "Remove count_biz_days_to alias in date_utils.rs"
  - id: I4
    summary: "Internalize businessDaysBetween"
  - id: I5
    summary: "Add pre-commit hook: reject workingDaysBetween"
  - id: I6
    summary: "Update docs/unplanned-issues.md"
  - id: I7
    summary: "Update docs/completed-phases.md"
  - id: I8
    summary: "Update google-sheets-sync skill"
  - id: I9
    summary: "Update e2e-testing skill"
---

# Phase 16 Group I — Cleanup + Final Documentation

You are implementing Phase 16 Group I for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

All bug fixes and structural tests are done (Groups D-H). This group removes deprecated
functions, adds pre-commit guard rails, and updates remaining documentation.

## Your files (ONLY modify these):
- `src/utils/dateUtils.ts` — delete/internalize deprecated functions
- `crates/scheduler/src/date_utils.rs` — remove old aliases
- `scripts/pre-commit-hook.sh` — add regression guard
- `docs/unplanned-issues.md` — update reference
- `docs/completed-phases.md` — add Phase 16 entry
- `.claude/skills/google-sheets-sync/SKILL.md` — add convention note
- `.claude/skills/e2e-testing/SKILL.md` — add weekend invariant note

**Read-only:**
- `docs/plans/date-calc-fixes.md` — §Stage 6, §Stage 7

## Tasks — execute in order:

### I1: Delete workingDaysBetween

First, verify zero callers remain:
```bash
grep -rn 'workingDaysBetween' src/ --include='*.ts' --include='*.tsx'
```

If any callers remain, **do NOT delete** — report in `.agent-status.json` and skip.

If zero callers:
- Delete the `workingDaysBetween` function from `dateUtils.ts`
- Remove its export
- Remove any import references in test files

Commit: `"refactor: delete workingDaysBetween — all callers migrated to taskDuration"`

### I2: Remove next_biz_day_on_or_after alias

First, verify zero callers remain:
```bash
grep -rn 'next_biz_day_on_or_after' crates/ --include='*.rs'
```

If any callers remain, **do NOT delete** — report and skip.

If zero callers (all migrated to `ensure_business_day`):
- Delete the `next_biz_day_on_or_after` function from `date_utils.rs`

Commit: `"refactor: delete next_biz_day_on_or_after — replaced by ensure_business_day"`

### I3: Remove count_biz_days_to alias

First, verify zero callers remain:
```bash
grep -rn 'count_biz_days_to' crates/ --include='*.rs'
```

If any callers remain, **do NOT delete** — report and skip.

If zero callers:
- Delete the `count_biz_days_to` function from `date_utils.rs`
- The implementation should now live in `business_day_delta`

Commit: `"refactor: delete count_biz_days_to — replaced by business_day_delta"`

### I4: Internalize businessDaysBetween

`businessDaysBetween` is used for pixel mapping only (GanttChart collapsed-weekend mode).
It should not be used for duration calculation. Make it internal:

- Remove `export` keyword from the function
- Add `/** @internal — pixel mapping only. For duration, use taskDuration. */` JSDoc
- Verify it's only imported within dateUtils.ts or GanttChart.tsx

If it's imported elsewhere, leave the export but add the @internal tag.

Commit: `"refactor: internalize businessDaysBetween — pixel mapping only"`

### I5: Add pre-commit hook guard

In `scripts/pre-commit-hook.sh`, add a check for deprecated function names:

```bash
# Reject deprecated date function names in new code
if git diff --cached --name-only | grep -qE '\.(ts|tsx|rs)$'; then
  if git diff --cached -U0 | grep -E '^\+' | grep -qE 'workingDaysBetween'; then
    echo "ERROR: workingDaysBetween is deprecated. Use taskDuration() instead."
    echo "See docs/plans/date-calc-fixes.md for migration guide."
    exit 1
  fi
fi
```

Read the existing hook first to understand the structure and add the check in the
appropriate place. Only check added lines (`^\+`) to avoid false positives.

Commit: `"feat: pre-commit hook rejects deprecated workingDaysBetween"`

### I6: Update docs/unplanned-issues.md

Find the reference to `workingDaysBetween` at line 29 (or wherever it appears) and update
to `taskDuration`:

```markdown
// BEFORE:
workingDaysBetween
// AFTER:
taskDuration
```

Read the file first to find the exact location and context.

Commit: `"docs: update unplanned-issues.md — workingDaysBetween → taskDuration"`

### I7: Update docs/completed-phases.md

Add a Phase 16 entry at the end:

```markdown
## Phase 16: Date Calculation Bug Fixes

Switched end_date convention from exclusive to inclusive across the entire codebase.

**Key changes:**
- Convention-encoding functions: `taskDuration`, `taskEndDate` (TS), `task_duration`, `task_end_date` (Rust)
- Shared dep-type helpers: `fs_successor_start`, `ss_successor_start`, `ff_successor_start`, `sf_successor_start`
- Migrated 14 `workingDaysBetween` callsites to `taskDuration`
- Fixed cascade FS formula, constraints FNET/FNLT/MFO, find_conflicts FF/SF
- Added WEEKEND_VIOLATION conflict detection
- Fixed bar width for inclusive convention
- Fixed Yjs UPDATE_TASK_FIELD duration sync (Bug 14)
- Renamed `dateToXCollapsed` → `dateToX` (weekend-aware default)
- Structural tests: cascade/recalculate agreement, cross-language consistency
- Pre-commit hook rejects deprecated function names
```

Commit: `"docs: add Phase 16 to completed-phases.md"`

### I8: Update google-sheets-sync skill

In `.claude/skills/google-sheets-sync/SKILL.md`, add a note about the duration convention:

```markdown
## Duration Convention
- Sheets stores `duration` as inclusive business day count: [startDate, endDate] counting both.
- When importing: `duration = taskDuration(startDate, endDate)` (NOT `workingDaysBetween`).
- When exporting: same — `taskDuration` is the source of truth.
- Weekend dates from Sheets are NOT rejected or snapped. They surface as `WEEKEND_VIOLATION`
  conflicts in the UI. The user must fix them.
```

Read the file first to find the best location for this section.

Commit: `"docs: add duration convention to google-sheets-sync skill"`

### I9: Update e2e-testing skill

In `.claude/skills/e2e-testing/SKILL.md`, add a weekend invariant note:

```markdown
## Weekend Invariants
- No task should start or end on a weekend in UI-created tasks.
- E2E tests should verify: after creating a task on a weekend, start snaps to Monday.
- E2E tests should verify: bar width includes the end-date column (inclusive convention).
- The `WEEKEND_VIOLATION` conflict indicator appears for tasks with weekend dates
  (typically from Sheets import).
```

Read the file first to find the best location.

Commit: `"docs: add weekend invariant notes to e2e-testing skill"`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupI saving work"`.
- **Calculations**: NEVER do mental math.
