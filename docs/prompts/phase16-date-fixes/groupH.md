---
phase: 16
group: H
stage: 5
agent_count: 1
scope:
  modify:
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/constraints.rs
    - crates/scheduler/src/lib.rs
    - src/utils/schedulerWasm.ts
    - src/utils/__tests__/dateUtils.test.ts
  read_only:
    - docs/plans/date-calc-fixes.md
    - crates/scheduler/src/date_utils.rs
    - src/utils/dateUtils.ts
depends_on: [D, E, F, G]
tasks:
  - id: H1
    summary: "Add cascade/recalculate agreement test (A4)"
  - id: H2
    summary: "Add find_conflicts/recalculate agreement test (A5)"
  - id: H3
    summary: "Add cross-language consistency tests (A3)"
  - id: H4
    summary: "Add assertTaskInvariants to schedulerWasm.ts (A2)"
  - id: H5
    summary: "Add roundtrip test: edit → cascade → recalculate → no drift"
---

# Phase 16 Group H — Structural Tests + WASM Assertions

You are implementing Phase 16 Group H for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

With all bug fixes landed (Groups D-G), this group adds **structural tests** that prevent
entire categories of bugs from recurring. These are the Architectural Prevention items
(A2-A5) from the plan. They test invariants, not specific values.

## Your files (ONLY modify these):
- `crates/scheduler/src/cascade.rs` — add Rust agreement tests
- `crates/scheduler/src/constraints.rs` — add Rust agreement tests
- `crates/scheduler/src/lib.rs` — add Rust agreement tests
- `src/utils/schedulerWasm.ts` — add assertTaskInvariants
- `src/utils/__tests__/dateUtils.test.ts` — add cross-language tests

**Read-only:**
- `docs/plans/date-calc-fixes.md` — §Architectural Prevention (A2-A5)
- `crates/scheduler/src/date_utils.rs` — convention functions
- `src/utils/dateUtils.ts` — TS convention functions

## Tasks — execute in order:

### H1: Cascade/recalculate agreement test (A4)

This is the highest-impact structural test. Add to Rust tests:

```rust
#[test]
fn cascade_and_recalculate_agree_on_all_dep_types() {
    for dep_type in [FS, SS, FF, SF] {
        for lag in [0, 1, 2] {
            // Create a two-task chain with the given dep type and lag
            let (pred, succ, dep) = make_test_chain(dep_type, lag);

            // Move predecessor forward by 3 business days
            let cascade_results = cascade_dependents(&tasks, &pred.id, 3);
            let cascade_start = &cascade_results[0].start_date;

            // Run recalculate_earliest on the same scenario
            let recalc_results = recalculate_earliest(&updated_tasks, ...);
            let recalc_start = &recalc_results[0].new_start;

            assert_eq!(cascade_start, recalc_start,
                "Mismatch for {:?} lag={}: cascade={}, recalc={}",
                dep_type, lag, cascade_start, recalc_start);
        }
    }
}
```

Adapt the test setup to use existing test helpers. Look at how existing tests in cascade.rs
and constraints.rs create test data.

Run `cargo test` to verify.

Commit: `"test: cascade/recalculate agreement for all dep types and lags (A4)"`

### H2: find_conflicts/recalculate agreement test (A5)

Add to Rust tests:

```rust
#[test]
fn conflict_date_matches_recalculate_resolution() {
    for dep_type in [FS, SS, FF, SF] {
        // Create a violating scenario (successor starts too early)
        let tasks = make_violating_chain(dep_type);

        let conflicts = find_conflicts(&tasks);
        let recalc = recalculate_earliest(&tasks, ...);

        for conflict in &conflicts {
            let resolved = recalc.iter()
                .find(|r| r.id == conflict.task_id)
                .expect(&format!("No recalculate result for conflict task {}", conflict.task_id));

            assert_eq!(conflict.constraint_date, resolved.new_start,
                "For {:?}: conflict says {} but recalculate moves to {}",
                dep_type, conflict.constraint_date, resolved.new_start);
        }
    }
}
```

Commit: `"test: find_conflicts/recalculate agreement for all dep types (A5)"`

### H3: Cross-language consistency tests (A3)

Add to `dateUtils.test.ts` — these tests call WASM functions and compare to TS:

```typescript
describe('cross-language consistency', () => {
  // This requires WASM to be loaded. If WASM isn't available in test
  // environment, skip with a clear message.
  const cases = [
    { start: '2026-03-02', dur: 5 },   // Mon, full week
    { start: '2026-03-06', dur: 1 },   // Fri, single day
    { start: '2026-03-06', dur: 3 },   // Fri, crosses weekend
    { start: '2026-03-02', dur: 10 },  // Two weeks
    { start: '2026-03-02', dur: 1 },   // Single day
  ];

  for (const { start, dur } of cases) {
    it(`task_end_date agrees for ${start}, dur=${dur}`, () => {
      const tsEnd = taskEndDate(start, dur);
      const rustEnd = wasmModule.task_end_date(start, dur);
      expect(tsEnd).toBe(rustEnd);
    });

    it(`task_duration agrees for ${start} → end`, () => {
      const end = taskEndDate(start, dur);
      const tsDur = taskDuration(start, end);
      const rustDur = wasmModule.task_duration(start, end);
      expect(tsDur).toBe(rustDur);
    });
  }
});
```

Check how WASM is loaded in the test environment. If there's an existing pattern for
WASM tests, follow it. If WASM isn't available in Vitest, note this and create a
separate test file that can run with WASM loaded.

Commit: `"test: cross-language consistency — TS and Rust agree via WASM (A3)"`

### H4: Add assertTaskInvariants to schedulerWasm.ts (A2)

Add debug-mode invariant assertions before WASM calls:

```typescript
import { taskDuration, isWeekendDate } from './dateUtils';

function assertTaskInvariants(task: Task): void {
  if (import.meta.env.PROD) return;
  if (task.isSummary || task.isMilestone) return;

  const computed = taskDuration(task.startDate, task.endDate);
  console.assert(computed === task.duration,
    `Task ${task.id}: duration ${task.duration} != computed ${computed} (${task.startDate} → ${task.endDate})`);
  console.assert(task.startDate <= task.endDate,
    `Task ${task.id}: start ${task.startDate} > end ${task.endDate}`);
  console.assert(!isWeekendDate(task.startDate),
    `Task ${task.id}: starts on weekend ${task.startDate}`);
  console.assert(!isWeekendDate(task.endDate),
    `Task ${task.id}: ends on weekend ${task.endDate}`);
}
```

Call `assertTaskInvariants` on each task before sending to WASM. Find the function that
prepares task data for WASM (around line 24-43) and add the check:

```typescript
// Before WASM call:
tasks.forEach(assertTaskInvariants);
```

Use `import.meta.env.PROD` (Vite convention) not `process.env.NODE_ENV` for tree-shaking.

Commit: `"feat: add assertTaskInvariants — dev-mode WASM boundary checks (A2)"`

### H5: Roundtrip test

Add a test that verifies: edit → cascade → recalculate produces no drift.

```rust
#[test]
fn edit_cascade_recalculate_no_drift() {
    // Create a chain: A → B → C (all FS)
    let tasks = make_three_task_chain();

    // Move A forward 2 business days
    let cascade_1 = cascade_dependents(&tasks, "A", 2);
    let tasks_after_cascade = apply_cascade(&tasks, &cascade_1);

    // Run recalculate on the cascaded state
    let recalc = recalculate_earliest(&tasks_after_cascade, ...);

    // No task should move — cascade already placed them correctly
    assert!(recalc.is_empty() || recalc.iter().all(|r| r.new_start == find_task(&tasks_after_cascade, &r.id).start_date),
        "Drift detected after cascade → recalculate roundtrip");
}
```

Commit: `"test: edit → cascade → recalculate roundtrip — no drift"`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupH saving work"`.
- **Calculations**: NEVER do mental math.
