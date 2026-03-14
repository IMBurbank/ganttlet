---
phase: 16
group: C
stage: 2
agent_count: 1
scope:
  modify:
    - crates/scheduler/src/date_utils.rs
  read_only:
    - docs/plans/date-calc-fixes.md
    - docs/plans/date-conventions.md
    - crates/scheduler/src/constraints.rs
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/lib.rs
depends_on: [A]
tasks:
  - id: C1
    summary: "Read date_utils.rs — understand existing functions"
  - id: C2
    summary: "Add task_duration(start, end)"
  - id: C3
    summary: "Add task_end_date(start, duration)"
  - id: C4
    summary: "Add ensure_business_day(date) as rename of next_biz_day_on_or_after"
  - id: C5
    summary: "Add prev_business_day(date)"
  - id: C6
    summary: "Add fs/ss/ff/sf_successor_start helpers"
  - id: C7
    summary: "Add WEEKEND_VIOLATION to ConflictResult types"
  - id: C8
    summary: "Rename count_biz_days_to → business_day_delta"
  - id: C9
    summary: "Write comprehensive Rust tests"
---

# Phase 16 Group C — Rust Convention Functions

You are implementing Phase 16 Group C for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

The Rust scheduler needs the same convention-encoding functions as TypeScript, plus shared
dependency-type helpers that cascade, constraints, and find_conflicts will all use. These are
purely **additive** — no existing callers change. Group D will migrate callers.

**Inclusive convention:**
- `end_date` = last working day (inclusive)
- `duration` = business days in [start, end] counting both
- `end = add_business_days(start, duration - 1)`

## Your files (ONLY modify these):
- `crates/scheduler/src/date_utils.rs` — add new public functions
- `crates/scheduler/src/types.rs` — add WEEKEND_VIOLATION variant

**Read-only:**
- `docs/plans/date-calc-fixes.md` — §Stage 1 (Rust items 6-15)
- `docs/plans/date-conventions.md` — function naming glossary
- `crates/scheduler/src/constraints.rs` — understand how FF/SF formulas work (read lines 29-39)
- `crates/scheduler/src/cascade.rs` — understand cascade FS/SS/FF/SF (read lines 92-140)
- `crates/scheduler/src/lib.rs` — understand find_conflicts (starts at line 85; dep-violation match at lines 159-168)

## Tasks — execute in order:

### C1: Read and understand

Read `crates/scheduler/src/date_utils.rs`. Note:
- `add_business_days(date_str, delta)` — shifts by N business days
- `next_biz_day_on_or_after(date_str)` — snaps forward to Monday
- `count_biz_days_to(from, to)` — signed business day count (exclusive)
- `is_weekend(y, m, d)` — weekend check on (year, month, day)
- `add_days(date_str, delta)` — calendar day shift

Also read `constraints.rs` lines 20-39 to understand:
- FS: `add_business_days(pred_end, 1 + lag)` — skips past inclusive end
- SS: `add_business_days(pred_start, lag)` — start-to-start
- FF: `add_business_days(finish, -(duration - 1))` — derive start from finish
- SF: `add_business_days(finish, -(duration - 1))` — same pattern

### C2: Add task_duration(start, end)

```rust
/// Inclusive business day count: [start, end] counting both endpoints.
/// A same-day task returns 1.
pub fn task_duration(start: &str, end: &str) -> i32 {
    // count_biz_days_to counts (start, end] — add 1 to make [start, end]
    // Alternatively: implement from scratch using is_weekend iteration
    // Choose whichever approach matches the existing codebase style.
}
```

**Implementation note:** `count_biz_days_to(from, to)` counts `(from, to]` (start-exclusive,
end-inclusive). To get `[start, end]` inclusive, you need `count_biz_days_to(start, end) + 1`
IF start is a business day (which it should be). Verify this with a test.

Alternatively, implement independently:
```rust
pub fn task_duration(start: &str, end: &str) -> i32 {
    let mut count = 0;
    let mut current = start.to_string();
    while current <= end.to_string() {
        // parse current, check if weekday, increment count
        current = add_days(&current, 1);
    }
    count
}
```

**Test cases (use `cargo test` to verify):**
- `task_duration("2026-03-02", "2026-03-06")` → 5 (Mon-Fri)
- `task_duration("2026-03-02", "2026-03-02")` → 1 (same day)
- `task_duration("2026-03-06", "2026-03-10")` → 3 (Fri, Mon, Tue)
- `task_duration("2026-03-11", "2026-03-24")` → 10

Commit: `"feat: add task_duration — inclusive business day count (Rust)"`

### C3: Add task_end_date(start, duration)

```rust
/// Derive end date from start + duration using inclusive convention.
/// task_end_date(start, 1) returns start (same-day task).
pub fn task_end_date(start: &str, duration: i32) -> String {
    add_business_days(start, duration - 1)
}
```

**Test cases:**
- `task_end_date("2026-03-02", 5)` → `"2026-03-06"` (Mon + 4 biz days = Fri)
- `task_end_date("2026-03-02", 1)` → `"2026-03-02"` (same day)

**Roundtrip:** `task_duration(start, &task_end_date(start, dur)) == dur`

Commit: `"feat: add task_end_date — derive end from start + inclusive duration (Rust)"`

### C4: Add ensure_business_day(date)

```rust
/// Snap forward to next Monday if date falls on a weekend. No-op if already a weekday.
/// Replaces next_biz_day_on_or_after — same logic, aligned name with TS.
pub fn ensure_business_day(date: &str) -> String {
    next_biz_day_on_or_after(date)  // delegate to existing implementation
}
```

Keep `next_biz_day_on_or_after` as a public function during migration (Group D will still
see it in cascade.rs). Do NOT delete it — Group I handles cleanup.

Commit: `"feat: add ensure_business_day — aligned name for next_biz_day_on_or_after (Rust)"`

### C5: Add prev_business_day(date)

```rust
/// Snap backward to previous Friday if date falls on a weekend. No-op if already a weekday.
/// Use for end dates — end dates snap backward, start dates snap forward.
pub fn prev_business_day(date: &str) -> String {
    let (y, m, d) = parse_ymd(date);  // use existing parse helper
    let weekday = day_of_week(y, m, d);  // or however weekday is computed
    match weekday {
        6 => add_days(date, -1),  // Saturday → Friday
        0 => add_days(date, -2),  // Sunday → Friday
        _ => date.to_string(),
    }
}
```

Adapt to the existing code style in date_utils.rs for weekday checking.

Commit: `"feat: add prev_business_day — snap backward to Friday (Rust)"`

### C6: Add dependency-type successor start helpers

These are shared helpers that cascade, constraints, and find_conflicts will all use.
Having ONE formula per dep type prevents the three-function divergence that caused Bugs 3-5.

```rust
/// FS: successor starts the next business day after predecessor's end, plus lag.
/// pred_end is inclusive (last working day of predecessor).
pub fn fs_successor_start(pred_end: &str, lag: i32) -> String {
    add_business_days(pred_end, 1 + lag)
}

/// SS: successor starts on same day as predecessor's start, plus lag.
pub fn ss_successor_start(pred_start: &str, lag: i32) -> String {
    add_business_days(pred_start, lag)
}

/// FF: successor must finish on same day as predecessor's end, plus lag.
/// Derives successor start from the required finish date.
pub fn ff_successor_start(pred_end: &str, lag: i32, succ_duration: i32) -> String {
    let required_finish = add_business_days(pred_end, lag);
    add_business_days(&required_finish, -(succ_duration - 1))
}

/// SF: successor must finish on or after predecessor's start, plus lag.
/// Derives successor start from the required finish date.
pub fn sf_successor_start(pred_start: &str, lag: i32, succ_duration: i32) -> String {
    let required_finish = add_business_days(pred_start, lag);
    add_business_days(&required_finish, -(succ_duration - 1))
}
```

**Test cases (use `node -e` or `cargo test` to verify):**
- `fs_successor_start("2026-03-06", 0)` → `"2026-03-09"` (Fri → Mon)
- `fs_successor_start("2026-03-06", 1)` → `"2026-03-10"` (Fri + 2 biz = Tue)
- `ss_successor_start("2026-03-02", 0)` → `"2026-03-02"` (same day)
- `ff_successor_start("2026-03-06", 0, 5)` → `"2026-03-02"` (Fri end, dur=5, start=Mon)
- `sf_successor_start("2026-03-02", 0, 5)` → `"2026-02-24"` (Tue, so finish=Mon 3/2, start=Tue 2/24)

Commit: `"feat: add fs/ss/ff/sf_successor_start — shared dep-type helpers (Rust)"`

### C7: Verify ConflictResult supports WEEKEND_VIOLATION

`ConflictResult` is defined in `lib.rs` (NOT `types.rs`) at line 76 as a struct with
`conflict_type: String`. WEEKEND_VIOLATION is just a string value — no type change needed.

Verify by reading `lib.rs` lines 73-82. The existing conflict types use string values like
`"SNLT_VIOLATED"`, `"FNLT_VIOLATED"`, `"MSO_CONFLICT"`, `"MFO_CONFLICT"`, `"DEP_VIOLATED"`.
Group D (task D10) will add `"WEEKEND_VIOLATION"` as a new conflict_type string value.

**No code change needed in this task** — just verify the struct can accommodate it (it can,
since conflict_type is a String).

Commit: (no commit needed — verification only)

### C8: Rename count_biz_days_to → business_day_delta

Add `business_day_delta` as a new public function that delegates to `count_biz_days_to`:

```rust
/// Signed business day difference. Positive if `to` is after `from`.
/// Aligned name with TS businessDaysDelta.
pub fn business_day_delta(from: &str, to: &str) -> i32 {
    count_biz_days_to(from, to)
}
```

Keep `count_biz_days_to` as-is during migration. Group I handles cleanup.

Commit: `"feat: add business_day_delta — aligned name for count_biz_days_to (Rust)"`

### C9: Write comprehensive Rust tests

Add a `#[cfg(test)] mod convention_tests` block with:

1. **task_duration tests** — all cases from C2
2. **task_end_date tests** — all cases from C3
3. **Roundtrip property** — `task_duration(s, &task_end_date(s, d)) == d` for d=1,3,5,10
4. **ensure_business_day tests** — weekday no-op, Saturday→Monday, Sunday→Monday
5. **prev_business_day tests** — weekday no-op, Saturday→Friday, Sunday→Friday
6. **fs_successor_start tests** — lag 0,1,2 including weekend crossing
7. **ss_successor_start tests** — lag 0,1,2
8. **ff_successor_start tests** — verify start derives correctly from finish
9. **sf_successor_start tests** — verify start derives correctly
10. **business_day_delta tests** — matches count_biz_days_to for same inputs

Run `cargo test` to verify all pass.

Commit: `"test: comprehensive tests for Rust convention functions"`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupC saving work"`.
- **Calculations**: NEVER do mental math. Use `node -e` or verify with `cargo test`.
