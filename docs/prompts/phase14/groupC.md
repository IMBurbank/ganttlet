---
phase: 14
group: C
stage: 1
agent_count: 1
scope:
  modify:
    - crates/scheduler/src/cascade.rs
    - src/utils/schedulerWasm.ts
  read_only:
    - crates/scheduler/src/types.rs
depends_on: []
tasks:
  - id: C1
    summary: "Read code"
  - id: C2
    summary: "Build adjacency list"
  - id: C3
    summary: "Add Rust tests"
  - id: C4
    summary: "Performance instrumentation"
  - id: C5
    summary: "Verify"
---

# Phase 14 Group C — Cascade Adjacency List Optimization + Instrumentation (R8)

You are implementing Phase 14 Group C for the Ganttlet project.
Read `CLAUDE.md` and `docs/phase14-recommendations.md` (Section R8, Section 7 Analysis, and Section 9 Key File Reference) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

## Success Criteria (you're done when ALL of these are true):
1. `cascade_dependents` in `cascade.rs` builds a predecessor-to-successors adjacency HashMap before cascading, replacing the O(n*d) inner scan with O(e*d) adjacency lookups
2. All 8 existing cargo tests pass with identical results (same output, same assertions)
3. At least 2 new tests exist: a large-scale benchmark test (50+ tasks) and an edge case test (orphan tasks with no deps)
4. `schedulerWasm.ts` wraps the WASM `cascade_dependents` call with `performance.mark/measure` and logs a warning if execution exceeds 16ms
5. All existing JS tests pass (`npm run test`)
6. WASM builds successfully (`npm run build:wasm`)
7. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- `cascade_dependents` still scans all tasks at each cascade level
- Any existing cargo test fails
- No performance instrumentation in schedulerWasm.ts
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool. The scheduling engine runs as a
Rust→WASM module in each user's browser. `cascade_dependents` is called on every drag completion
to shift dependent tasks.

## Your files (ONLY modify these):
- `crates/scheduler/src/cascade.rs` — adjacency list optimization + new tests
- `src/utils/schedulerWasm.ts` — performance instrumentation

Do NOT modify any other Rust files, TypeScript source files, or test files. Other agents own those files.

## Current Code State (read these before editing)

### cascade.rs (lines 1-82):
```rust
pub fn cascade_dependents(tasks: &[Task], moved_task_id: &str, days_delta: i32) -> Vec<CascadeResult> {
    if days_delta <= 0 { return Vec::new(); }

    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    let mut visited = HashSet::new();
    let mut shifted = HashSet::new();
    let mut results = Vec::new();

    fn cascade(task_id, delta, visited, shifted, task_map, tasks, results) {
        if visited.contains(task_id) { return; }
        visited.insert(task_id.to_string());

        // O(n*d) — scans ALL tasks to find dependents
        for task in tasks {
            for dep in &task.dependencies {
                if dep.from_id == task_id {
                    // ... shift task, recurse ...
                }
            }
        }
    }
}
```

The inner `for task in tasks` loop at line 38 scans all n tasks at every cascade level. For a task with d levels of transitive dependents, this is O(n * d).

### schedulerWasm.ts cascadeDependents (lines 133-163):
```typescript
export function cascadeDependents(tasks: Task[], movedTaskId: string, daysDelta: number): Task[] {
    if (!wasmModule) throw new Error('WASM scheduler not initialized');
    try {
        const wasmTasks = mapTasksToWasm(tasks);
        const results: CascadeResult[] = wasmModule.cascade_dependents(wasmTasks, movedTaskId, daysDelta);
        // ... merge results back into tasks ...
    } catch (err) { ... }
}
```

No performance instrumentation exists.

### Existing cargo tests (lines 84-323 in cascade.rs):
1. `shifts_dependent_tasks` — A→B chain, +5 days
2. `does_not_shift_moved_task` — moved task not in results
3. `transitive_cascade` — A→B→C chain, +3 days
4. `skips_summary_tasks` — summary tasks not shifted
5. `preserves_duration_for_all_tasks` — 4-task chain, durations preserved
6. `diamond_dependency_no_double_shift` — A→B, A→C, B→C diamond
7. `backward_cascade_returns_empty` — negative delta returns empty
8. `zero_delta_returns_empty` — zero delta returns empty

## Tasks — execute in order:

### C1: Read and understand the current code

1. Read `crates/scheduler/src/cascade.rs` (full file)
2. Read `crates/scheduler/src/types.rs` (Task, Dependency, CascadeResult types)
3. Read `src/utils/schedulerWasm.ts` (cascadeDependents wrapper)
4. Run `cd crates/scheduler && cargo test` to verify all tests pass

### C2: Build adjacency list in cascade_dependents

Replace the O(n*d) inner scan with an O(e*d) adjacency lookup:

```rust
pub fn cascade_dependents(tasks: &[Task], moved_task_id: &str, days_delta: i32) -> Vec<CascadeResult> {
    if days_delta <= 0 { return Vec::new(); }

    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    // Build predecessor-to-successors adjacency map: O(e) where e = total edges
    let mut successors: HashMap<&str, Vec<&str>> = HashMap::new();
    for task in tasks {
        for dep in &task.dependencies {
            successors.entry(dep.from_id.as_str())
                .or_default()
                .push(task.id.as_str());
        }
    }

    let mut visited = HashSet::new();
    let mut shifted = HashSet::new();
    let mut results = Vec::new();

    fn cascade(
        task_id: &str,
        delta: i32,
        visited: &mut HashSet<String>,
        shifted: &mut HashSet<String>,
        task_map: &HashMap<&str, &Task>,
        successors: &HashMap<&str, Vec<&str>>,
        results: &mut Vec<CascadeResult>,
    ) {
        if visited.contains(task_id) { return; }
        visited.insert(task_id.to_string());

        // O(1) lookup of successors instead of scanning all tasks
        if let Some(deps) = successors.get(task_id) {
            for &successor_id in deps {
                let dependent = match task_map.get(successor_id) {
                    Some(t) if !t.is_summary => t,
                    _ => continue,
                };

                if shifted.insert(successor_id.to_string()) {
                    let new_start = add_days(&dependent.start_date, delta);
                    let new_end = add_days(&dependent.end_date, delta);
                    results.push(CascadeResult {
                        id: dependent.id.clone(),
                        start_date: new_start,
                        end_date: new_end,
                    });
                }

                cascade(successor_id, delta, visited, shifted, task_map, successors, results);
            }
        }
    }

    cascade(moved_task_id, days_delta, &mut visited, &mut shifted, &task_map, &successors, &mut results);
    results
}
```

Key changes:
- Build `successors: HashMap<&str, Vec<&str>>` once at function start — O(e)
- Inner function uses `successors.get(task_id)` instead of scanning all tasks — O(1) per level
- `task_map` is only used for lookup, not iteration
- The `tasks` slice is no longer passed to the inner function

1. Implement the adjacency list optimization
2. Run `cargo test` — ALL 8 existing tests must pass with identical results
3. Commit: `"perf: cascade_dependents uses adjacency list — O(e*d) instead of O(n*d) (R8)"`

### C3: Add new Rust tests

Add at least 2 new tests:

1. **Large-scale test (50+ tasks)**:
```rust
#[test]
fn scales_to_50_tasks() {
    // Build a linear chain of 50 tasks: T0 → T1 → T2 → ... → T49
    let mut tasks: Vec<Task> = (0..50).map(|i| {
        let start = format!("2026-04-{:02}", (i % 28) + 1);
        let end = format!("2026-04-{:02}", (i % 28) + 2);
        let mut t = make_task(&format!("t{}", i), &start, &end);
        if i > 0 {
            t.dependencies = vec![make_dep(&format!("t{}", i - 1), &format!("t{}", i))];
        }
        t
    }).collect();

    let results = cascade_dependents(&tasks, "t0", 3);
    // All 49 dependent tasks should be shifted
    assert_eq!(results.len(), 49);
    // Each should be shifted by exactly 3 days
    for r in &results {
        let original = tasks.iter().find(|t| t.id == r.id).unwrap();
        // Verify the shift (compare to original + 3)
        assert_eq!(r.start_date, add_days(&original.start_date, 3));
        assert_eq!(r.end_date, add_days(&original.end_date, 3));
    }
}
```

2. **Orphan tasks test (tasks with no dependencies)**:
```rust
#[test]
fn orphan_tasks_unaffected() {
    let tasks = vec![
        make_task("a", "2026-03-01", "2026-03-10"),
        make_task("b", "2026-03-11", "2026-03-20"), // No dependency on A
        make_task("c", "2026-03-21", "2026-03-30"), // No dependency on anything
    ];
    let results = cascade_dependents(&tasks, "a", 5);
    assert!(results.is_empty(), "Tasks without dependencies should not be shifted");
}
```

3. Run `cargo test` — all tests (old + new) must pass
4. Commit: `"test: add large-scale and orphan cascade tests (R8)"`

### C4: Add performance instrumentation in schedulerWasm.ts

In `src/utils/schedulerWasm.ts`, wrap the WASM `cascade_dependents` call:

1. In `cascadeDependents` function (line ~141), add instrumentation:
```typescript
const perfLabel = `cascade_dependents_${movedTaskId}`;
performance.mark(`${perfLabel}_start`);

const results: CascadeResult[] = wasmModule.cascade_dependents(wasmTasks, movedTaskId, daysDelta);

performance.mark(`${perfLabel}_end`);
const measure = performance.measure(perfLabel, `${perfLabel}_start`, `${perfLabel}_end`);

if (measure.duration > 16) {
  console.warn(`cascade_dependents took ${measure.duration.toFixed(1)}ms (>${16}ms threshold) for task ${movedTaskId}`);
}

// Clean up marks
performance.clearMarks(`${perfLabel}_start`);
performance.clearMarks(`${perfLabel}_end`);
performance.clearMeasures(perfLabel);
```

2. Do the same for `cascadeDependentsWithIds` function (line ~206)

3. Run `npx tsc --noEmit` and `npm run test`
4. Run `npm run build:wasm` to verify WASM builds
5. Commit: `"feat: add cascade latency instrumentation with 16ms threshold warning (R8)"`

### C5: Verify and finalize

1. Run `cd crates/scheduler && cargo test` — all tests pass
2. Run `npm run build:wasm` — WASM builds
3. Run `npx tsc --noEmit` — no TS errors
4. Run `npm run test` — JS tests pass
5. Verify no files outside your scope were modified: `git diff --name-only`
6. Update `claude-progress.txt` with final status
7. Commit any remaining fixes

## Progress Tracking

After completing each major task, append a status line to `claude-progress.txt`:
```
# STATUS values: DONE, IN_PROGRESS, BLOCKED, SKIPPED
# Format: TASK_ID | STATUS | ISO_TIMESTAMP | MESSAGE
C1 | DONE | 2026-03-06T10:23Z | Read cascade.rs, 8 existing tests pass
C2 | DONE | 2026-03-06T10:45Z | Adjacency list implemented, all tests pass
```
On restart, read `claude-progress.txt` and `git log --oneline -10` first. Skip completed tasks.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.
- Emergency: `git add -A && git commit -m "emergency: groupC saving work"`.
- **Calculations**: NEVER do mental math or date arithmetic. Use `node -e "const {differenceInCalendarDays,addDays}=require('date-fns'); ..."` or `date -d '2026-03-06 + 17 days' +%Y-%m-%d` or `python3 -c "print(...)"`. Prefer `date-fns` directly (`differenceInCalendarDays`, `addDays`, `addBusinessDays`) over project wrappers when writing new code.
