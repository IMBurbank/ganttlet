# Validation 03: Cross-Language Consistency Tests

**Difficulty:** MEDIUM (~15 date computations)

## Prerequisites

1. Read `CLAUDE.md` first for full project context, especially the Date Conventions section.
2. Read `crates/scheduler/src/date_utils.rs` — specifically the `cross_language_tests` module. Understand the exact format of existing tests and the comment conventions.
3. Read `src/utils/__tests__/dateUtils.test.ts` — specifically the `cross-language consistency` describe block. Note how `durationCases`, `endDateCases`, and `roundtripCases` arrays are structured.

## Critical Rule

**NEVER compute dates mentally.** Use the `taskEndDate` and `taskDuration` shell functions for ALL date computations. These are available in the shell and mirror the Rust/TS functions exactly:

```bash
taskEndDate 2026-03-11 10    # → 2026-03-24 (end date for 10-day task starting Mar 11)
taskDuration 2026-03-11 2026-03-24  # → 10 (inclusive business day count)
```

Every expected value in every test assertion MUST be verified with one of these tool calls before you write it. No exceptions — even for "obvious" cases.

## Task

Add 5 new canonical date pairs to BOTH:
- `crates/scheduler/src/date_utils.rs` :: `cross_language_tests` module
- `src/utils/__tests__/dateUtils.test.ts` :: `cross-language consistency` describe block

The two files must have **identical** expected values. This is the whole point of cross-language tests.

### Date Pairs to Add

For each pair, you need: start date, duration, and end date — ALL computed with tools.

**Pair 1: Cross month boundary (March → April)**
- Start: 2026-03-25 (Wednesday)
- Duration: 8
- Compute end: `taskEndDate 2026-03-25 8`
- Verify roundtrip: `taskDuration 2026-03-25 <computed_end>`

**Pair 2: Cross quarter boundary (June → July)**
- Start: 2026-06-25 (Thursday)
- Duration: 7
- Compute end: `taskEndDate 2026-06-25 7`
- Verify roundtrip: `taskDuration 2026-06-25 <computed_end>`

**Pair 3: Monday start with long duration (20+ days)**
- Start: 2026-04-06 (Monday)
- Duration: 22
- Compute end: `taskEndDate 2026-04-06 22`
- Verify roundtrip: `taskDuration 2026-04-06 <computed_end>`

**Pair 4: Friday start with duration 1 (same-day edge case)**
- Start: 2026-03-20 (Friday)
- Duration: 1
- Compute end: `taskEndDate 2026-03-20 1`
- Verify: should be same day (Friday)
- Verify roundtrip: `taskDuration 2026-03-20 <computed_end>`

**Pair 5: Cross year-end (December → January)**
- Start: 2026-12-28 (Monday)
- Duration: 8
- Compute end: `taskEndDate 2026-12-28 8`
- Verify roundtrip: `taskDuration 2026-12-28 <computed_end>`

### Rust Implementation

In `crates/scheduler/src/date_utils.rs`, add assertions to the existing `cross_lang_task_duration_matches_ts` and `cross_lang_task_end_date_matches_ts` tests. Follow the exact comment format:

```rust
// Cross-month: Mar 25 + 8 days → <computed_end>
assert_eq!(task_duration("2026-03-25", "<computed_end>"), 8);
```

```rust
// Cross-month: Mar 25 dur=8 → <computed_end>
assert_eq!(task_end_date("2026-03-25", 8), "<computed_end>");
```

Also add the 5 new pairs to the `cross_lang_roundtrip_task_duration_end_date` test.

### TypeScript Implementation

In `src/utils/__tests__/dateUtils.test.ts`, add the same 5 pairs to `durationCases`, `endDateCases`, and `roundtripCases` arrays. Follow the exact format:

```typescript
// Cross-month: Mar 25 + 8 days
['2026-03-25', '<computed_end>', 8],
```

## Expected Date Computations

You must make at least **15** separate `taskEndDate` or `taskDuration` tool calls:
- 5 `taskEndDate` calls (one per pair)
- 5 `taskDuration` roundtrip calls (one per pair)
- 5 additional verification calls (e.g., confirming day-of-week for start dates)

## Verification

```bash
cd crates/scheduler && cargo test cross_language_tests -- --nocapture
npm run test -- --run src/utils/__tests__/dateUtils.test.ts
```

Both must pass. The expected values must be **identical** between Rust and TypeScript.

## Deliverables

- Modified: `crates/scheduler/src/date_utils.rs` (extended `cross_language_tests`)
- Modified: `src/utils/__tests__/dateUtils.test.ts` (extended cross-language consistency block)
- All tests passing in both languages
