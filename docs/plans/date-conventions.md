# Date Convention Unification — Analysis & Proposal

> **Status:** Ready for implementation.
> **Parent plan:** `docs/plans/date-calc-fixes.md`

## Current State: Three Names, Four Boundaries, Zero Clarity

### The "business day count" family — 4 functions, 3 names, 2 boundary conventions

| Function | Language | Boundaries | Counts | Used for |
|---|---|---|---|---|
| `workingDaysBetween(s, e)` | TS | `[s, e)` | start-inclusive, end-exclusive | **Duration** (labeled "canonical") |
| `businessDaysBetween(s, e)` | TS | `[s, e)` | start-inclusive, end-exclusive | **Pixel mapping** in collapsed-weekend mode |
| `businessDaysDelta(s, e)` | TS | date-fns convention | signed difference | **Cascade shift deltas** |
| `count_biz_days_to(f, t)` | Rust | `(f, t]` | start-exclusive, end-inclusive | **Cascade shift amounts** |

`businessDaysBetween` and `count_biz_days_to` return the **same number** for the
same inputs but count **different days**:

```
Mon 3/9 → Fri 3/13:
  TS  [start,end): {Mon, Tue, Wed, Thu}     = 4
  Rust (start,end]: {Tue, Wed, Thu, Fri}    = 4
```

Same result, different sets. An agent can swap them and tests pass accidentally.

### The "shift a date" family — consistent naming, inconsistent wrappers

| Function | Language | Notes |
|---|---|---|
| `addBusinessDays(date, n)` | date-fns (TS) | The real implementation |
| `addBusinessDaysToDate(dateStr, n)` | TS | Thin wrapper: parse → addBusinessDays → format |
| `add_business_days(date_str, n)` | Rust | Hand-rolled, matches date-fns behavior |
| `addDaysToDate(dateStr, n)` | TS | Thin wrapper around date-fns `addDays` |
| `add_days(date_str, delta)` | Rust | Hand-rolled calendar day shift |

These are fine semantically. The TS wrappers just handle string↔Date conversion.

### The "snap to weekday" family

| Function | Language | Direction | Notes |
|---|---|---|---|
| `next_biz_day_on_or_after(date)` | Rust | Forward | Used after lag calculations |
| *(none)* | TS | — | No equivalent exists |
| *(none)* | Either | Backward | Needed for snapping end dates |

### The vocabulary problem

Three words used interchangeably for "Monday through Friday":
- **"working"**: `workingDaysBetween`
- **"business"**: `businessDaysBetween`, `businessDaysDelta`, `addBusinessDaysToDate`
- **"biz"**: `count_biz_days_to`, `next_biz_day_on_or_after`

An agent grepping for "business" misses `workingDaysBetween` (the duration function).
An agent grepping for "biz" finds only Rust code. No search term finds all date functions.

---

## Why This Matters

### 1. No function means what its name says

`workingDaysBetween` is documented as "canonical duration calculation" but doesn't
compute duration correctly (exclusive end, but duration is inclusive). The most important
function in the codebase has a misleading doc comment.

### 2. Duration is derived from a counting primitive, not a dedicated function

Every callsite does `duration = workingDaysBetween(start, end)`. There's no
`taskDuration(start, end)` that encodes the convention. When the convention changes
(exclusive → inclusive), every callsite must change individually. A dedicated function
means you change one place.

### 3. End-date derivation is scattered arithmetic

Every callsite does `end = addBusinessDays(start, duration)`. With inclusive convention
it should be `addBusinessDays(start, duration - 1)`. The `- 1` is currently missing
everywhere and will need to be added everywhere. A dedicated `taskEndDate(start, dur)`
function would centralize this.

### 4. The Rust/TS boundary is a convention cliff

An agent working in TypeScript sees `workingDaysBetween`. They cross into Rust and see
`count_biz_days_to`. Different name, different boundaries. They assume it's the Rust
equivalent, use it for duration, and introduce an off-by-one.

### 5. `compute_earliest_start` vs `cascade_dependents` vs `find_conflicts`

Three functions compute "when can a successor start after an FS predecessor":

```
compute_earliest_start:  add_business_days(pred.end, 1 + lag)   — treats end as INCLUSIVE
cascade_dependents:      next_biz_on_or_after(add_biz(end, lag)) — treats end as EXCLUSIVE
find_conflicts:          next_biz_on_or_after(add_biz(end, lag)) — treats end as EXCLUSIVE
```

Two against one. The two EXCLUSIVE functions were written later (cascade in Phase 10,
conflicts in Phase 11). `compute_earliest_start` was written first (Phase 8) and happens
to match the CORRECT inclusive convention by accident — but nobody documented this, so
the later functions diverged.

---

## Proposal: Unified Convention

### Principle 1: One word — "business day"

Drop "working" and "biz". Use "business day" in TS, `business_day` in Rust.

### Principle 2: Two dedicated scheduling functions

These encode the project's date convention in one place. Everything else calls them.

| Purpose | TS | Rust | Semantics |
|---|---|---|---|
| Duration from dates | `taskDuration(start, end)` | `task_duration(start, end)` | Business days in `[start, end]` inclusive. Returns 1 for same-day task. |
| End date from duration | `taskEndDate(start, duration)` | `task_end_date(start, duration)` | `addBusinessDays(start, duration - 1)`. Returns `start` for duration=1. |

These are the ONLY functions that encode the inclusive convention. All other date functions
are convention-independent primitives.

### Principle 3: Aligned primitive names across languages

| Purpose | TS | Rust | Boundaries |
|---|---|---|---|
| Shift by N biz days | `addBusinessDays` (date-fns direct) | `add_business_days(date, n)` | N/A — shifts, doesn't count |
| Shift by N calendar days | `addDays` (date-fns direct) | `add_days(date, n)` | N/A |
| Snap forward to weekday | `ensureBusinessDay(date)` | `ensure_business_day(date)` | Returns input if already weekday |
| Snap backward to weekday | `prevBusinessDay(date)` | `prev_business_day(date)` | New — needed for end-date validation |
| Calendar days between | `daysBetween(s, e)` | `calendar_days_between(s, e)` | Signed difference, no boundary issue |
| Signed biz day shift | `businessDaysDelta(s, e)` | `business_day_delta(s, e)` | Signed, for cascade shift amounts |
| Weekend check | `isWeekend` (date-fns direct) | `is_weekend(y, m, d)` | Boolean |

### Principle 4: Remove/deprecate the ambiguous functions

| Current | Action | Reason |
|---|---|---|
| `workingDaysBetween` | **Replace** with `taskDuration` | Wrong semantics, wrong name |
| `businessDaysBetween` (TS) | **Keep** for pixel mapping only | Different purpose, fine as-is |
| `count_biz_days_to` (Rust) | **Rename** to `business_day_delta` | Matches TS `businessDaysDelta`; "biz" → "business_day", cross-language consistency |
| `next_biz_day_on_or_after` | **Rename** to `ensure_business_day` | Align with TS, drop abbreviation |
| `addBusinessDaysToDate` | **Keep** as convenience wrapper | Handles string↔Date; just rename callers' mental model |
| `addDaysToDate` | **Keep** as convenience wrapper | Same |
| `isWeekendDay` | **Keep** or drop (just wraps `isWeekend`) | Low value but not harmful |

### Principle 5: FS earliest-start computed ONE way

Currently three functions compute FS earliest start differently. Unify on ONE formula
and extract it:

```rust
/// Earliest start for successor given FS dependency with inclusive pred.end_date.
/// Successor starts the next business day after predecessor's last working day, plus lag.
fn fs_successor_start(pred_end: &str, lag: i32) -> String {
    add_business_days(pred_end, 1 + lag)
}
```

Used by: `compute_earliest_start`, `cascade_dependents`, `find_conflicts`.
No more divergence.

Similarly for SS, FF, SF — extract `ss_successor_start`, `ff_successor_start`,
`sf_successor_start` as shared helpers.

---

## Concrete Changes

### In `crates/scheduler/src/date_utils.rs`:

```rust
// ADD: Convention-encoding functions
pub fn task_duration(start: &str, end: &str) -> i32 { ... }  // inclusive [start, end]
pub fn task_end_date(start: &str, duration: i32) -> String { ... }  // addBiz(start, dur-1)
pub fn ensure_business_day(date: &str) -> String { ... }  // rename next_biz_day_on_or_after
pub fn prev_business_day(date: &str) -> String { ... }  // new: snap backward

// RENAME: count_biz_days_to → keep as internal, or inline into cascade.rs

// ADD: FS/SS/FF/SF earliest-start helpers (shared by cascade + constraints + conflicts)
pub fn fs_successor_start(pred_end: &str, lag: i32) -> String { add_business_days(pred_end, 1 + lag) }
pub fn ss_successor_start(pred_start: &str, lag: i32) -> String { add_business_days(pred_start, lag) }
pub fn ff_successor_start(pred_end: &str, lag: i32, succ_duration: i32) -> String { ... }
pub fn sf_successor_start(pred_start: &str, lag: i32, succ_duration: i32) -> String { ... }
```

### In `src/utils/dateUtils.ts`:

```typescript
// ADD: Convention-encoding functions
export function taskDuration(start: string, end: string): number { ... }  // inclusive
export function taskEndDate(start: string, duration: number): string { ... }
export function ensureBusinessDay(date: Date): Date { ... }
export function prevBusinessDay(date: Date): Date { ... }

// DEPRECATE: workingDaysBetween — replace all callsites with taskDuration
// KEEP: businessDaysBetween (pixel mapping), businessDaysDelta (cascade shifts)
// KEEP: daysBetween (calendar days), addBusinessDaysToDate, addDaysToDate
```

### In callers (ganttReducer, sheetsMapper, yjsBinding, TaskBar, etc.):

```typescript
// BEFORE (scattered, convention-dependent):
const duration = workingDaysBetween(startDate, endDate);
const endDate = formatDate(addBusinessDays(parseISO(startDate), duration));

// AFTER (centralized, convention-encoded):
const duration = taskDuration(startDate, endDate);
const endDate = taskEndDate(startDate, duration);
```

### In cascade.rs, constraints.rs, lib.rs:

```rust
// BEFORE (three different FS formulas):
// constraints.rs:  add_business_days(pred.end, 1) + lag
// cascade.rs:      next_biz_day_on_or_after(add_business_days(pred.end, lag))
// lib.rs:          next_biz_day_on_or_after(add_business_days(pred.end, lag))

// AFTER (one shared helper):
let required_start = fs_successor_start(&pred.end_date, dep.lag);
```

---

## Migration Safety

The convention change (exclusive → inclusive) touches every duration calculation.
The naming change (workingDaysBetween → taskDuration) touches every callsite.
Doing both at once is risky.

**Recommended order:**
1. Add `taskDuration` and `taskEndDate` with correct inclusive semantics (new functions)
2. Add `fs_successor_start` etc. as shared Rust helpers
3. Migrate callers from `workingDaysBetween` → `taskDuration` one file at a time
4. Migrate Rust cascade/constraints/conflicts to shared helpers
5. Fix remaining end-date computations to use `taskEndDate`
6. Delete `workingDaysBetween` once no callers remain
7. Rename Rust functions (`next_biz_day_on_or_after` → `ensure_business_day`, etc.)

Steps 1-2 are additive (no breaking changes). Steps 3-5 are the actual fix.
Steps 6-7 are cleanup.

---

## What This Prevents

| Failure mode | How unified conventions prevent it |
|---|---|
| Agent uses wrong duration function | Only ONE function computes duration: `taskDuration` |
| Agent derives end date with wrong formula | Only ONE function: `taskEndDate` |
| Agent writes FS logic with wrong convention | Shared `fs_successor_start` helper — no raw arithmetic |
| Agent greps for "working" and misses Rust code | All functions use "business day" |
| Agent assumes `count_biz_days_to` = `businessDaysBetween` | `count_biz_days_to` inlined or renamed explicitly |
| New constraint type uses wrong end formula | `task_end_date` is the only way to derive end from start+dur |
| Cascade and recalculate diverge again | Both call `fs_successor_start` — single source of truth |
