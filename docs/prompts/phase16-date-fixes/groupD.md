---
phase: 16
group: D
stage: 3
agent_count: 1
scope:
  modify:
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/constraints.rs
    - crates/scheduler/src/lib.rs
    - crates/scheduler/src/cpm.rs
  read_only:
    - docs/plans/date-calc-fixes.md
    - crates/scheduler/src/date_utils.rs
    - crates/scheduler/src/types.rs
depends_on: [C]
tasks:
  - id: D1
    summary: "Read cascade.rs, constraints.rs, lib.rs — understand current formulas"
  - id: D2
    summary: "Fix cascade FS: replace with fs_successor_start"
  - id: D3
    summary: "Fix recalculate_earliest end (line 291): task_end_date"
  - id: D4
    summary: "Fix FNET computed_end (line 241) + start derivation (line 244)"
  - id: D5
    summary: "Fix FNLT computed_end (line 251): task_end_date"
  - id: D6
    summary: "Fix MFO (line 275): -(task.duration - 1)"
  - id: D7
    summary: "Fix find_conflicts FS: use fs_successor_start"
  - id: D8
    summary: "Fix find_conflicts SS: use ss_successor_start"
  - id: D9
    summary: "Add FF/SF conflict detection to find_conflicts (Bug 11)"
  - id: D10
    summary: "Add WEEKEND_VIOLATION conflict type to find_conflicts"
  - id: D11
    summary: "Add CPM doc comment explaining exclusive model (Bug 6)"
  - id: D12
    summary: "Update ALL Rust test data to inclusive convention"
---

# Phase 16 Group D — Rust Scheduler Fixes

You are implementing Phase 16 Group D for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

The Rust scheduler has several formula bugs caused by the exclusive end-date convention.
Group C added convention-encoding functions and dep-type helpers. Now you migrate all
callers to use them.

**Critical:** This group's changes depend on Group E (TS state) shipping together.
Rust formulas now use `task_end_date(start, dur)` = `add_business_days(start, dur - 1)`.
This is correct only with **inclusive** duration values. Group E switches TS from
`workingDaysBetween` (exclusive) to `taskDuration` (inclusive). If this group ships
without Group E, Rust receives old exclusive durations and computes wrong end dates.

**The formulas you're changing:**
- `cascade_dependents` FS: currently uses `next_biz_day_on_or_after(add_business_days(end, lag))` — wrong, should use `fs_successor_start(end, lag)`
- `recalculate_earliest` end: currently `add_business_days(new_start, task.duration)` — wrong, should use `task_end_date(new_start, task.duration)`
- `FNET/FNLT/MFO` in constraints: computed_end and start derivation formulas need `task_end_date` and `-(dur-1)`
- `find_conflicts` FS/SS: same formula divergence as cascade
- `find_conflicts` FF/SF: currently skipped entirely (Bug 11)

## Your files (ONLY modify these):
- `crates/scheduler/src/cascade.rs`
- `crates/scheduler/src/constraints.rs`
- `crates/scheduler/src/lib.rs`
- `crates/scheduler/src/cpm.rs` (doc comment only)

**Read-only:**
- `docs/plans/date-calc-fixes.md` — §Stage 2, §What's Already Correct
- `crates/scheduler/src/date_utils.rs` — convention functions from Group C
- `crates/scheduler/src/types.rs` — types including WEEKEND_VIOLATION

## Tasks — execute in order:

### D1: Read and understand

Read all three files carefully:

1. `cascade.rs` — focus on lines 92-140 (FS/SS/FF/SF cascade)
2. `constraints.rs` — focus on:
   - Lines 20-39: `compute_earliest_start` (FS/SS/FF/SF formulas)
   - Lines 55-68: SNET constraint
   - Lines 226-237: SNLT constraint
   - Lines 241-244: FNET constraint
   - Lines 251: FNLT constraint
   - Lines 275: MFO constraint
   - Line 291: `recalculate_earliest` end computation
3. `lib.rs` — focus on `find_conflicts` (starts line 85; dep-violation match at lines 159-168)

Note which formulas are correct and which need changing (see §What's Already Correct in the plan).

### D2: Fix cascade FS

In `cascade.rs`, lines 92-103 — the FS cascade currently uses:
```rust
next_biz_day_on_or_after(&add_business_days(&pred.end_date, lag))
```

Replace with:
```rust
fs_successor_start(&pred.end_date, dep.lag)
```

Import `fs_successor_start` from `date_utils`. The `next_biz_day_on_or_after` wrapper is
unnecessary — `fs_successor_start` = `add_business_days(pred_end, 1 + lag)` which always
returns a business day (since `add_business_days` skips weekends).

**Do NOT change SS/FF/SF cascade formulas** — they are already correct (see §What's Already
Correct). Optionally remove their `next_biz_day_on_or_after` wrappers since the inner
`add_business_days` already returns business days, but the formulas themselves stay the same.

Commit: `"fix: cascade FS — use fs_successor_start, remove incorrect formula"`

### D3: Fix recalculate_earliest end computation

In `constraints.rs`, line 291 — currently:
```rust
let new_end = add_business_days(&new_start, task.duration);
```

This is wrong under inclusive convention. `add_business_days(start, duration)` gives a day
PAST the task's last day. Fix:
```rust
let new_end = task_end_date(&new_start, task.duration);
```

Import `task_end_date` from `date_utils`.

Commit: `"fix: recalculate_earliest end — use task_end_date for inclusive convention"`

### D4: Fix FNET computed_end and start derivation

In `constraints.rs`:

**Line 241** — FNET computed_end:
```rust
// BEFORE:
let computed_end = add_business_days(&new_start, task.duration);
// AFTER:
let computed_end = task_end_date(&new_start, task.duration);
```

**Line 244** — FNET start derivation from constraint:
```rust
// BEFORE:
let new_start = add_business_days(&constraint_date, -(task.duration));
// AFTER:
let new_start = add_business_days(&constraint_date, -(task.duration - 1));
```

**Why `-(duration - 1)` not `-(duration)`:** Under inclusive convention, duration=5 means
the task spans 5 days including start. To go from end to start: `start = end - (dur-1) biz days`.
Example: end=Fri 3/6, dur=5 → start = Fri - 4 biz days = Mon 3/2. ✓

Commit: `"fix: FNET — task_end_date for computed_end, -(dur-1) for start derivation"`

### D5: Fix FNLT computed_end

In `constraints.rs`, line 251:
```rust
// BEFORE:
let computed_end = add_business_days(&new_start, task.duration);
// AFTER:
let computed_end = task_end_date(&new_start, task.duration);
```

Commit: `"fix: FNLT — task_end_date for computed_end"`

### D6: Fix MFO start derivation

In `constraints.rs`, line 275:
```rust
// BEFORE:
let new_start = add_business_days(&constraint_date, -(task.duration));
// AFTER:
let new_start = add_business_days(&constraint_date, -(task.duration - 1));
```

Same reasoning as FNET (D4).

Commit: `"fix: MFO — -(task.duration - 1) for inclusive start derivation"`

### D7: Fix find_conflicts FS

In `lib.rs`, lines 160-163 — the FS conflict check currently uses a formula that diverges
from `compute_earliest_start` FS. Replace with:
```rust
let required_start = fs_successor_start(&pred.end_date, dep.lag);
```

Import `fs_successor_start` from `date_utils`.

Commit: `"fix: find_conflicts FS — use fs_successor_start, align with cascade"`

### D8: Fix find_conflicts SS

In `lib.rs`, lines 164-167 — replace with:
```rust
let required_start = ss_successor_start(&pred.start_date, dep.lag);
```

This is functionally unchanged but uses the shared helper for consistency.

Commit: `"fix: find_conflicts SS — use ss_successor_start helper"`

### D9: Add FF/SF conflict detection (Bug 11)

In `lib.rs`, line 168 — currently:
```rust
_ => continue, // FF and SF constrain end, skip for start check
```

Replace with actual FF/SF conflict detection:

```rust
DependencyType::FF => {
    let required_start = ff_successor_start(&pred.end_date, dep.lag, task.duration);
    if task.start_date < required_start {
        // Task finishes too early — FF constraint violated
        conflicts.push(ConflictResult {
            task_id: task.id.clone(),
            dep_type: "FF".to_string(),
            predecessor_id: pred.id.clone(),
            constraint_date: required_start,
            // ... fill other fields matching existing pattern
        });
    }
}
DependencyType::SF => {
    let required_start = sf_successor_start(&pred.start_date, dep.lag, task.duration);
    if task.start_date < required_start {
        conflicts.push(ConflictResult {
            task_id: task.id.clone(),
            dep_type: "SF".to_string(),
            predecessor_id: pred.id.clone(),
            constraint_date: required_start,
            // ... fill other fields matching existing pattern
        });
    }
}
```

Match the existing `ConflictResult` struct fields from the FS/SS branches above.

Commit: `"feat: add FF/SF conflict detection to find_conflicts (Bug 11)"`

### D10: Add WEEKEND_VIOLATION conflict detection

Add a new check in `find_conflicts` that detects tasks with weekend start or end dates:

```rust
// After dependency checks, check for weekend violations
fn is_weekend_date(date_str: &str) -> bool {
    let (y, m, d) = parse_ymd(date_str);
    is_weekend(y, m, d)
}

if is_weekend_date(&task.start_date) || is_weekend_date(&task.end_date) {
    conflicts.push(ConflictResult {
        task_id: task.id.clone(),
        dep_type: "WEEKEND".to_string(),
        // ... appropriate fields for weekend violation
    });
}
```

Use the `WEEKEND_VIOLATION` type added by Group C in types.rs.

Commit: `"feat: add WEEKEND_VIOLATION detection to find_conflicts"`

### D11: Add CPM doc comment

In `cpm.rs`, add a module-level doc comment:

```rust
//! Critical Path Method (CPM) implementation.
//!
//! This module uses a standard exclusive integer model where:
//! - early_start and late_start are inclusive
//! - early_finish and late_finish are exclusive (day AFTER the task)
//! - duration = finish - start (integer arithmetic)
//!
//! This is the standard CPM convention used in scheduling literature.
//! Do NOT apply the project's inclusive end-date convention here —
//! CPM is an abstract graph algorithm, not a date calculation.
//! The conversion between CPM integers and calendar dates happens
//! at the boundaries (input: date→int, output: int→date).
```

Commit: `"docs: add CPM exclusive integer model comment (Bug 6)"`

### D12: Update ALL Rust test data

Update every test in cascade.rs, constraints.rs, and lib.rs to use inclusive end dates.

**Key changes:**
- All test task end dates must be the last working day (inclusive), not the day after
- All expected cascade result end dates change similarly
- Duration values change: `taskDuration(start, newEnd) = oldDuration + 1` for most tasks
- Use `node -e` or `cargo test` to verify expected values — NEVER compute by hand

Example transformations:
- Task Mon 3/2 → Fri 3/6 (exclusive) becomes Mon 3/2 → Thu 3/5 (inclusive), duration 4→4
  Wait — **verify this with tools!** The end date doesn't change the same way for all cases.

**IMPORTANT:** Read each test carefully. The old exclusive end date `3/7` (Sat) means the task
ends on `3/6` (Fri). So the inclusive end date is `3/6` — same calendar day, just different
semantics. But the duration changes from `differenceInBusinessDays(3/7, 3/2)` = 5 to
`taskDuration(3/2, 3/6)` = 5. In this case duration doesn't change!

**The key insight:** End dates that were "day after last working day" in exclusive convention
are often already the correct inclusive end date minus one day. But weekend dates as exclusive
ends (like Saturday) need to become the previous Friday. VERIFY EACH CASE WITH TOOLS.

Run `cargo test` after all changes to verify.

Commit: `"fix: update all Rust test data to inclusive convention"`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupD saving work"`.
- **Calculations**: NEVER do mental math. Use `node -e` or `cargo test` for ALL date arithmetic.
