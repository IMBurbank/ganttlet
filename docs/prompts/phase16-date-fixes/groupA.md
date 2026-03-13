---
phase: 16
group: A
stage: 1
agent_count: 1
scope:
  modify:
    - CLAUDE.md
    - src/CLAUDE.md
    - crates/scheduler/CLAUDE.md
    - src/types/index.ts
    - crates/scheduler/src/types.rs
    - .claude/skills/scheduling-engine/SKILL.md
    - .claude/agents/rust-scheduler.md
  read_only:
    - docs/plans/date-calc-fixes.md
    - docs/plans/date-conventions.md
depends_on: []
tasks:
  - id: A1
    summary: "Read docs/plans/date-calc-fixes.md — understand all doc changes needed"
  - id: A2
    summary: "Add date conventions section to root CLAUDE.md"
  - id: A3
    summary: "Update src/types/index.ts Task.duration doc comment"
  - id: A4
    summary: "Add convention doc comments to crates/scheduler/src/types.rs Task struct"
  - id: A5
    summary: "Update crates/scheduler/CLAUDE.md with convention rules"
  - id: A6
    summary: "Update src/CLAUDE.md with convention exception"
  - id: A7
    summary: "Update .claude/skills/scheduling-engine/SKILL.md"
  - id: A8
    summary: "Update .claude/agents/rust-scheduler.md"
---

# Phase 16 Group A — Convention Documentation

You are implementing Phase 16 Group A for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

The codebase uses an **exclusive** end-date convention (`end_date = day after last working day`)
but the intended convention is **inclusive** (`end_date = last working day`). Before any code
changes can happen, all agent-visible documentation must reflect the inclusive convention so
that implementing agents (Groups B-I) don't read stale docs and encode the wrong convention.

**Key convention rules:**
- `end_date` is the **last working day** the task occupies (inclusive)
- `duration` = business days in `[start_date, end_date]`, counting both endpoints
- Formula: `end = addBusinessDays(start, duration - 1)`
- Inverse: `duration = taskDuration(start, end)` = `differenceInBusinessDays(end, start) + 1`
- No task starts or ends on a weekend
- Example: start 2026-03-11 (Wed), end 2026-03-24 (Tue) → duration = 10

## Your files (ONLY modify these):

**Modify:**
- `CLAUDE.md` — root project instructions
- `src/CLAUDE.md` — TS source instructions
- `crates/scheduler/CLAUDE.md` — Rust scheduler instructions
- `src/types/index.ts` — Task type definition
- `crates/scheduler/src/types.rs` — Rust Task struct
- `.claude/skills/scheduling-engine/SKILL.md` — scheduling engine skill
- `.claude/agents/rust-scheduler.md` — Rust scheduler agent

**Read-only:**
- `docs/plans/date-calc-fixes.md` — full plan (§Documentation Updates has exact content)
- `docs/plans/date-conventions.md` — function naming glossary

## Tasks — execute in order:

### A1: Read and understand

Read `docs/plans/date-calc-fixes.md` — focus on:
- §Documentation & Agent Infrastructure Updates — exact content for each file
- §Glossary — function names and categories
- §Convention — the agreed inclusive convention

### A2: Add date conventions section to root CLAUDE.md

Add a `## Date Conventions (Non-Negotiable)` section after the existing `## Architecture Constraints` section. Include:

```markdown
## Date Conventions (Non-Negotiable)
- **end_date is INCLUSIVE** — the last working day the task occupies, not the day after.
- **duration** = business days in [startDate, endDate] counting both endpoints.
  `taskDuration('2026-03-02', '2026-03-06') = 5` (Mon–Fri).
- **End from start+dur:** `taskEndDate(start, duration)` — NEVER `addBusinessDays(start, duration)`.
- **Duration from dates:** `taskDuration(start, end)` — NEVER `workingDaysBetween` or raw `differenceInBusinessDays`.
- **No weekend dates.** Tasks must not start or end on Sat/Sun. Use `ensureBusinessDay()` for starts, `prevBusinessDay()` for ends.
- **Dependency helpers (Rust):** Always use `fs_successor_start`, `ss_successor_start`, `ff_successor_start`, `sf_successor_start` — NEVER hand-write FS/SS/FF/SF formulas.
- **CPM exception:** `cpm.rs` uses a standard exclusive integer model internally. Do NOT apply inclusive convention to CPM — it's an abstract graph algorithm, not a date calculation.
```

Commit: `"docs: add date conventions section to root CLAUDE.md"`

### A3: Update src/types/index.ts Task.duration doc comment

Find the `duration` field in the Task interface (around line 15) and change the doc comment from:
```typescript
/** Number of business days (Mon-Fri) from startDate to endDate, inclusive of start, exclusive of end. Always derived — never edit directly. */
```
to:
```typescript
/** Business days in [startDate, endDate] inclusive of both. Always derived via taskDuration() — never edit directly. */
```

Commit: `"docs: update Task.duration doc comment to inclusive convention"`

### A4: Add convention doc comments to crates/scheduler/src/types.rs

Find the Task struct and add doc comments to the date fields:

```rust
/// First working day of the task (inclusive). Must be Mon-Fri.
pub start_date: String,
/// Last working day of the task (inclusive). Must be Mon-Fri.
/// Derived: task_end_date(start_date, duration).
pub end_date: String,
/// Business days in [start_date, end_date] counting both endpoints.
/// A 1-day task has duration=1 and start_date == end_date.
pub duration: i32,
```

Commit: `"docs: add inclusive convention comments to Rust Task struct"`

### A5: Update crates/scheduler/CLAUDE.md

Add a `## Date Convention` section:

```markdown
## Date Convention
- `end_date` is INCLUSIVE — last working day of the task.
- `duration` = business days in [start_date, end_date] counting both.
- End from start+dur: `task_end_date(start, duration)` = `add_business_days(start, duration - 1)`.
- Duration from dates: `task_duration(start, end)`.
- Dep-type helpers: `fs_successor_start`, `ss_successor_start`, `ff_successor_start`, `sf_successor_start`.
  NEVER hand-write FS/SS/FF/SF arithmetic.
- CPM uses exclusive integer model internally — do NOT apply inclusive convention to cpm.rs.
```

Commit: `"docs: add date convention to crates/scheduler/CLAUDE.md"`

### A6: Update src/CLAUDE.md

Add a convention exception note. Find the relevant section and add:

```markdown
## Date Conventions
- Use `taskDuration(start, end)` and `taskEndDate(start, duration)` from `dateUtils.ts`.
- NEVER use `workingDaysBetween` (deprecated) or raw `differenceInBusinessDays` for duration.
- NEVER use `addBusinessDays(start, duration)` for end dates — use `taskEndDate` which handles the inclusive convention.
- `ensureBusinessDay(date)` snaps forward to Monday. `prevBusinessDay(date)` snaps backward to Friday.
```

Commit: `"docs: add date convention to src/CLAUDE.md"`

### A7: Update .claude/skills/scheduling-engine/SKILL.md

Add to the "Known Gotchas" section (create if it doesn't exist):

```markdown
## Known Gotchas
- **end_date is inclusive** — the last working day, not the day after. duration = business days in [start, end].
- **taskEndDate ≠ addBusinessDays(start, dur)** — it's `addBusinessDays(start, dur - 1)`. Off-by-one if you use the wrong one.
- **Cascade preserves date gap, not duration field.** If duration is stale (not recomputed from dates), cascade and recalculate will disagree.
- **FF/SF formulas use `-(duration-1)` not `-(duration)`.** This is correct for inclusive convention. The minus sign derives start from end, and inclusive duration is 1 larger than the gap.
- **CPM is exclusive internally.** The integer model in cpm.rs uses exclusive convention — this is standard and intentional. Don't "fix" it.
```

Add to "Lessons Learned" section:

```markdown
## Lessons Learned
- Three FS formulas diverged (compute_earliest_start, cascade_dependents, find_conflicts) because there was no shared helper. Use `fs_successor_start` etc. to prevent divergence.
- `workingDaysBetween` counted [start, end) exclusive, causing duration to be 1 too low. Replaced by `taskDuration` which counts [start, end] inclusive.
```

Commit: `"docs: add convention gotchas and lessons to scheduling-engine skill"`

### A8: Update .claude/agents/rust-scheduler.md

Add to the agent's context section:

```markdown
## Date Convention Functions (date_utils.rs)
- `task_duration(start, end)` — inclusive business day count
- `task_end_date(start, dur)` — `add_business_days(start, dur - 1)`
- `ensure_business_day(date)` — snap forward to Monday (replaces `next_biz_day_on_or_after`)
- `prev_business_day(date)` — snap backward to Friday
- `fs_successor_start(pred_end, lag)` — `add_business_days(pred_end, 1 + lag)`
- `ss_successor_start(pred_start, lag)` — `add_business_days(pred_start, lag)`
- `ff_successor_start(pred_end, lag, succ_dur)` — end-constrained: derives start from finish
- `sf_successor_start(pred_start, lag, succ_dur)` — start-to-finish: derives start from finish
- `business_day_delta(from, to)` — signed difference (replaces `count_biz_days_to`)
```

Also fix the MFO description if it references exclusive convention.

Commit: `"docs: add convention functions to rust-scheduler agent"`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupA saving work"`.
- **Calculations**: NEVER do mental math.
