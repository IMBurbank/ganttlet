# Validation 03: Cross-Language Consistency Tests

**Complexity**: MEDIUM (~15 date computations)

## Prerequisites

Read `CLAUDE.md` first for full project context, especially the Date Conventions section.

## Task Description

Add 5 new canonical date pairs to both:
- `crates/scheduler/src/date_utils.rs` in the `cross_language_tests` module
- `src/utils/__tests__/dateUtils.test.ts` in the `cross-language consistency` describe block

Both files must have identical expected values. The format must match existing tests exactly.

## Critical Rule

For ALL date computations, use the shell functions — NEVER do mental math:

```bash
# Compute end date from start + duration (inclusive convention)
node -e "const d=require('date-fns'); console.log(d.format(d.addBusinessDays(d.parseISO('START'), DURATION-1), 'yyyy-MM-dd'))"

# Compute duration from start to end (inclusive)
node -e "const d=require('date-fns'); console.log(d.differenceInBusinessDays(d.parseISO('END'), d.parseISO('START')) + 1)"

# Check day of week
node -e "const d=require('date-fns'); console.log(d.format(d.parseISO('DATE'), 'EEEE'))"
```

## Read First

- `crates/scheduler/src/date_utils.rs` — find `cross_language_tests` module, understand the format
- `src/utils/__tests__/dateUtils.test.ts` — find `cross-language consistency` describe, understand the format

## 5 New Canonical Date Pairs

For each pair, compute start, duration, AND end date using tools. Verify the roundtrip.

### Pair 1: Cross month boundary (March to April)

- Start: 2026-03-26 (Thu — verify day of week with tool)
- Duration: 8
- Compute end date with tool (should cross into April)
- Verify roundtrip: `taskDuration(start, computed_end) === 8`

### Pair 2: Cross quarter boundary (June to July)

- Start: 2026-06-25 (Thu — verify day of week with tool)
- Duration: 7
- Compute end date with tool (should cross into July Q3)
- Verify roundtrip

### Pair 3: Start on Monday with long duration (20+ days)

- Start: 2026-05-04 (Mon — verify day of week with tool)
- Duration: 22
- Compute end date with tool (should be ~4.5 weeks later)
- Verify roundtrip

### Pair 4: Start on Friday with duration 1 (same-day edge case)

- Start: 2026-07-10 (Fri — verify day of week with tool)
- Duration: 1
- Compute end date with tool (should be same day)
- Verify roundtrip

### Pair 5: Cross year-end (December to January)

- Start: 2026-12-28 (Mon — verify day of week with tool)
- Duration: 6
- Compute end date with tool (should cross into 2027 January)
- Verify roundtrip

## Implementation

### In `date_utils.rs` (cross_language_tests module)

Add to `cross_lang_task_duration_matches_ts`:
```rust
assert_eq!(task_duration("START", "END"), DURATION); // description
```

Add to `cross_lang_task_end_date_matches_ts`:
```rust
assert_eq!(task_end_date("START", DURATION), "END"); // description
```

Add to `cross_lang_roundtrip_task_duration_end_date`:
```rust
("START", DURATION),
```

### In `dateUtils.test.ts`

Add to `durationCases` array:
```typescript
['START', 'END', DURATION],
```

Add to `endDateCases` array:
```typescript
['START', DURATION, 'END'],
```

Add to `roundtripCases` array:
```typescript
['START', DURATION],
```

## Expected Date Computations

- 5 pairs x 3 computations each (end date + duration check + day-of-week) = 15
- Every single computation must use a tool call

## Files to Modify

- `crates/scheduler/src/date_utils.rs` — add to `cross_language_tests` module
- `src/utils/__tests__/dateUtils.test.ts` — add to `cross-language consistency` describe

## Verification

```bash
cd crates/scheduler && cargo test cross_lang -- --nocapture
npm run test -- --run src/utils/__tests__/dateUtils.test.ts
```

Both Rust and TypeScript tests must pass. No existing tests may break.

## Deliverables

1. 5 new canonical pairs in both files with identical expected values
2. All Rust and TypeScript tests passing
3. Commit: `test: add 5 cross-language date consistency pairs with tool-verified values`
