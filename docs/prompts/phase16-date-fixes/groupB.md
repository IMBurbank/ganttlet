---
phase: 16
group: B
stage: 2
agent_count: 1
scope:
  modify:
    - src/utils/dateUtils.ts
    - src/utils/__tests__/dateUtils.test.ts
  read_only:
    - docs/plans/date-calc-fixes.md
    - docs/plans/date-conventions.md
    - src/types/index.ts
depends_on: [A]
tasks:
  - id: B1
    summary: "Read dateUtils.ts — understand existing functions"
  - id: B2
    summary: "Add taskDuration(start, end)"
  - id: B3
    summary: "Add taskEndDate(start, duration)"
  - id: B4
    summary: "Add ensureBusinessDay(date)"
  - id: B5
    summary: "Add prevBusinessDay(date)"
  - id: B6
    summary: "Add isWeekendDate(dateStr)"
  - id: B7
    summary: "Add withDuration(task) helper"
  - id: B8
    summary: "Write comprehensive tests"
---

# Phase 16 Group B — TypeScript Convention Functions

You are implementing Phase 16 Group B for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

The codebase needs new convention-encoding functions that centralize the inclusive end-date
convention. These are purely **additive** — no existing callers change. Later groups (E, F, G)
will migrate callers to use these functions.

**Inclusive convention:**
- `end_date` = last working day (inclusive)
- `duration` = business days in [start, end] counting both
- `end = addBusinessDays(start, duration - 1)`
- `duration = differenceInBusinessDays(end, start) + 1`

## Your files (ONLY modify these):
- `src/utils/dateUtils.ts` — add new exported functions
- `src/utils/__tests__/dateUtils.test.ts` — comprehensive tests

**Read-only:**
- `docs/plans/date-calc-fixes.md` — §Stage 1, §Architectural Prevention §A1
- `docs/plans/date-conventions.md` — function naming glossary
- `src/types/index.ts` — Task type definition

## Tasks — execute in order:

### B1: Read and understand

Read `src/utils/dateUtils.ts`. Note:
- `workingDaysBetween(start, end)` — the function being replaced (exclusive, returns `differenceInBusinessDays`)
- `businessDaysBetween(start, end)` — pixel mapping, different purpose (keep as-is)
- `addBusinessDaysToDate(dateStr, n)` — thin wrapper around date-fns `addBusinessDays`
- All string↔Date conversion patterns used in the file

### B2: Add taskDuration(start, end)

```typescript
/**
 * Inclusive business day count: [start, end] counting both endpoints.
 * A same-day task has duration 1. Uses date-fns differenceInBusinessDays.
 */
export function taskDuration(start: string, end: string): number {
  return differenceInBusinessDays(parseISO(end), parseISO(start)) + 1;
}
```

**Test cases (use `node -e` to verify before writing tests):**
- `taskDuration('2026-03-11', '2026-03-24')` → 10 (Wed to Tue, 2 full weeks)
- `taskDuration('2026-03-02', '2026-03-02')` → 1 (same day)
- `taskDuration('2026-03-06', '2026-03-10')` → 3 (Fri, Mon, Tue)
- `taskDuration('2026-03-02', '2026-03-06')` → 5 (Mon-Fri full week)

Commit: `"feat: add taskDuration — inclusive business day count"`

### B3: Add taskEndDate(start, duration)

```typescript
/**
 * Derive end date from start + duration using inclusive convention.
 * taskEndDate(start, 1) returns start (same-day task).
 * Inverse of taskDuration: taskDuration(start, taskEndDate(start, dur)) === dur.
 */
export function taskEndDate(start: string, duration: number): string {
  return format(addBusinessDays(parseISO(start), duration - 1), 'yyyy-MM-dd');
}
```

**Test cases:**
- `taskEndDate('2026-03-02', 5)` → `'2026-03-06'` (Mon + 4 biz days = Fri)
- `taskEndDate('2026-03-02', 1)` → `'2026-03-02'` (same day)
- `taskEndDate('2026-03-06', 3)` → `'2026-03-10'` (Fri + 2 biz days = Tue)

**Roundtrip property:** `taskDuration(start, taskEndDate(start, dur)) === dur` for all valid inputs.

Commit: `"feat: add taskEndDate — derive end from start + inclusive duration"`

### B4: Add ensureBusinessDay(date)

```typescript
/**
 * Snap forward to next Monday if date is a weekend. No-op if already a weekday.
 * Use for start dates and ADD_TASK date snapping.
 */
export function ensureBusinessDay(date: Date): Date {
  const day = date.getDay();
  if (day === 0) return addDays(date, 1);  // Sunday → Monday
  if (day === 6) return addDays(date, 2);  // Saturday → Monday
  return date;
}
```

Commit: `"feat: add ensureBusinessDay — snap forward to weekday"`

### B5: Add prevBusinessDay(date)

```typescript
/**
 * Snap backward to previous Friday if date is a weekend. No-op if already a weekday.
 * Use for end dates — end dates snap backward, not forward.
 */
export function prevBusinessDay(date: Date): Date {
  const day = date.getDay();
  if (day === 0) return addDays(date, -2);  // Sunday → Friday
  if (day === 6) return addDays(date, -1);  // Saturday → Friday
  return date;
}
```

Commit: `"feat: add prevBusinessDay — snap backward to weekday"`

### B6: Add isWeekendDate(dateStr)

```typescript
/**
 * Check if a date string falls on a weekend. For validation use.
 */
export function isWeekendDate(dateStr: string): boolean {
  return isWeekend(parseISO(dateStr));
}
```

Commit: `"feat: add isWeekendDate — string convenience for validation"`

### B7: Add withDuration(task) helper

This is Architectural Prevention A1 — ensures duration is always recomputed when dates change.

```typescript
/**
 * Returns task with duration recomputed from dates. Use whenever task dates change
 * to prevent stale duration values (prevents Bugs 13/14 class of errors).
 * Exception: RECALCULATE_EARLIEST preserves duration (Rust maintains it internally).
 */
export function withDuration<T extends { startDate: string; endDate: string }>(
  task: T
): T & { duration: number } {
  return { ...task, duration: taskDuration(task.startDate, task.endDate) };
}
```

Commit: `"feat: add withDuration — centralized duration recomputation"`

### B8: Write comprehensive tests

Add a new `describe('inclusive convention functions')` block to `dateUtils.test.ts`:

1. **taskDuration tests:**
   - Same-day task → 1
   - Full week Mon-Fri → 5
   - Cross-weekend Fri-Tue → 3
   - Two full weeks → 10
   - Convention example from plan: 3/11-3/24 → 10

2. **taskEndDate tests:**
   - Duration 1 → same day
   - Duration 5 from Monday → Friday
   - Duration 3 from Friday → Tuesday (crosses weekend)

3. **Roundtrip property tests:**
   - `taskDuration(start, taskEndDate(start, dur)) === dur` for dur=1,3,5,10
   - `taskEndDate(start, taskDuration(start, end)) === end` for multiple start/end pairs

4. **ensureBusinessDay tests:**
   - Weekday → unchanged
   - Saturday → Monday
   - Sunday → Monday

5. **prevBusinessDay tests:**
   - Weekday → unchanged
   - Saturday → Friday
   - Sunday → Friday

6. **isWeekendDate tests:**
   - Monday → false, Saturday → true, Sunday → true

7. **withDuration tests:**
   - Recomputes correct duration from dates
   - Preserves other task fields

**IMPORTANT:** Use `node -e` with `date-fns` to verify ALL expected values before writing tests. NEVER do date math in your head.

Commit: `"test: comprehensive tests for inclusive convention functions"`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupB saving work"`.
- **Calculations**: NEVER do mental math. Use `node -e` for ALL date arithmetic.
