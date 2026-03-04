# Phase 12 Group I — Fix Critical Path Calculation & Scoping

You are implementing Phase 12 Group I for the Ganttlet project.
Read CLAUDE.md and docs/TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool where multiple users edit the same
schedule simultaneously over a network (CRDT-based sync). The scheduling engine runs as a
Rust→WASM module in each user's browser. All scheduling computations must be deterministic.

The scheduling engine currently **does not work correctly**. Critical path calculation has
**never worked end-to-end** — it occasionally highlights a milestone at the end of a chain
but never highlights the full chain of tasks and dependencies that form the critical path.
Your job is to make it work for real.

## Your files (ONLY modify these):
- `crates/scheduler/src/cpm.rs`
- `crates/scheduler/src/graph.rs`
- `crates/scheduler/src/lib.rs` (only the `compute_critical_path_scoped` WASM binding)

Do NOT modify `types.rs`, `constraints.rs`, `cascade.rs`, `date_utils.rs`, or any frontend file.
Other agents own those files.

## Current state of critical path

Read `crates/scheduler/src/cpm.rs` carefully. The current implementation:
- Has a `CriticalPathScope` enum with `Project`, `Workstream`, and `Milestone` variants (defined
  in cpm.rs, NOT in types.rs)
- Performs a forward pass (topological BFS computing ES/EF) and backward pass (reverse order
  computing LS/LF)
- Identifies critical tasks as those with `float.abs() < 1` (where float = LS - ES)
- The scoped version filters tasks by project/workstream and runs CPM on the filtered subset
- The milestone scope does a BFS backward through dependencies to find predecessor tasks

**Known problems:**
- The forward pass initializes ES/EF from the task's actual stored dates, not from computed
  dependency-driven dates. This means the initial schedule layout biases the CPM calculation
  rather than computing from first principles.
- The backward pass initializes ALL tasks' LF to the project end, then processes in reverse
  topological order. This should work in theory but may have issues with how the predecessor
  loop operates (it processes the CURRENT task's dependencies to constrain predecessors).
- The scoped computation filters tasks before running CPM, which drops cross-scope dependencies.
  If task A (in Engineering workstream) depends on task B (in Design workstream), and you scope
  to Engineering, the dependency is lost because B isn't in the filtered set.
- `float.abs() < 1` should probably be `float == 0` or use exact comparison since all values
  are integers (days).

## Tasks — execute in order:

### I1: Debug and fix critical path computation

Start by writing failing tests that prove the current CPM is broken:

1. **Linear chain test**: Create tasks A→B→C→D with FS dependencies. All four must be critical.
   Run the test — if it fails, the CPM is confirmed broken. If it passes, the existing tests
   may already cover this case, so write a more discriminating test.

2. **Diamond test**: Create A→B, A→C, B→D, C→D where B has duration 10 and C has duration 5.
   The critical path should be A→B→D (the longest path). C should NOT be critical (it has float).

3. **Debug the forward/backward pass**: Add temporary debug prints or trace through the logic.
   For each test case, compute ES/EF/LS/LF by hand and compare to what the code produces.
   Common issues to look for:
   - ES should be dependency-driven, not initialized from stored dates
   - The backward pass must correctly propagate from successors to predecessors
   - Float = LS - ES must be exactly 0 for critical tasks

4. **Fix the computation**: Make whatever changes are needed to produce correct CPM results.
   The algorithm should be:
   - Forward pass: initialize root tasks (no predecessors) with ES=0. Propagate ES/EF through
     the dependency graph in topological order.
   - Backward pass: initialize terminal tasks (no successors) with LF = project_end (max EF).
     Propagate LS/LF backward through the graph in reverse topological order.
   - Float = LS - ES. Tasks with float == 0 are critical.

5. Verify: all failing tests now pass.

### I2: Fix scoped critical path for project and workstream

The scoped computation currently filters tasks and runs CPM on the filtered set. This breaks
when dependencies cross scope boundaries.

1. Write a test: two workstreams ("Engineering" and "Design"), where an Engineering task depends
   on a Design task via FS. Scope to Engineering. The dependent task should still show up in the
   critical path because its predecessor constraint drives its ES.

2. Fix: when building the filtered task set, include the dependency information from the original
   (unfiltered) task list. The simplest approach: run CPM on the FULL task set, then filter the
   resulting critical task IDs to only those matching the scope.

3. Test: project-scoped CP returns the correct chain within that project
4. Test: workstream-scoped CP returns the correct chain within that workstream

### I3: Remove milestone scope option

The `Milestone` variant of `CriticalPathScope` is being removed. Only `Project` and `Workstream`
scopes should remain.

1. Remove the `Milestone { id: String }` variant from `CriticalPathScope` in cpm.rs
2. Remove the milestone match arm and BFS-backward logic from `compute_critical_path_scoped()`
3. Update `compute_critical_path_scoped()` to handle only `Project` and `Workstream`
4. Update the `compute_critical_path_scoped` WASM binding in `lib.rs` if the type signature
   changed (it should still accept a JsValue for the scope — the frontend will stop sending
   milestone scopes)
5. Delete or update the `scoped_milestone_traces_predecessors` test

### I4: Add critical dependency identification

The frontend needs to highlight not just critical tasks but also the dependency arrows between
them. Extend the critical path computation to also return critical edges.

1. A critical edge is a dependency where BOTH the from_task and to_task are on the critical path
2. Create a new struct or tuple return: `(Vec<String>, Vec<(String, String)>)` — critical task
   IDs and critical edges (from_id, to_id)
3. Update `compute_critical_path()` to collect and return critical edges alongside critical IDs
4. Update the WASM binding `compute_critical_path_scoped` in `lib.rs` to return a JSON object
   with both `taskIds: string[]` and `edges: [string, string][]`
5. Write tests: verify that a chain A→B→C returns edges [(A,B), (B,C)] when all are critical

### I5: Comprehensive test suite + verify

Add these tests (skip any that already exist from I1/I2):
- Empty project returns empty critical path
- Single task is always critical
- Parallel paths — only the longest is critical
- Task with slack is NOT critical
- Adding lag to a dependency can change the critical path
- Scoped CP for project with internal dependencies only
- Scoped CP for workstream with cross-scope dependency

Final verification:
- `cd crates/scheduler && cargo test` — all pass
- `cd crates/scheduler && cargo clippy` — no warnings
- Commit with message: "fix: correct CPM computation, fix scoped critical path, remove milestone scope, add critical edge identification"
