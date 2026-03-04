# Phase 12 Group L — SNET Constraint + Recalculate-to-Earliest

You are implementing Phase 12 Group L for the Ganttlet project.
Read CLAUDE.md and docs/TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool where multiple users edit the same
schedule simultaneously over a network (CRDT-based sync). The scheduling engine runs as a
Rust→WASM module in each user's browser. All scheduling computations must be deterministic.

The scheduling engine is being built from a rough foundation into real scheduling software in
this phase. Your group adds two new capabilities that don't exist yet: task constraints (SNET)
and schedule recalculation. These are core features found in every professional scheduling tool
(MS Project, Primavera P6) and are essential for the engine to be useful.

## Your files (ONLY modify these):
- `crates/scheduler/src/types.rs`
- `crates/scheduler/src/constraints.rs`
- `crates/scheduler/src/lib.rs` (only ADD a new `recalculate_earliest` function at the END)
- `crates/scheduler/src/date_utils.rs`

Do NOT modify `cpm.rs`, `cascade.rs`, `graph.rs`, or any frontend file. Other agents own those.
Another agent (Group I) is modifying `lib.rs` concurrently — you MUST only append a new function
at the end of the file. Do NOT modify any existing functions in lib.rs.

## Current state

Read `crates/scheduler/src/types.rs` and `crates/scheduler/src/constraints.rs`.

**types.rs**: Defines `Task`, `Dependency`, `DepType`, and `CascadeResult`. Tasks have dates,
duration, dependencies, project/workstream fields. There are NO constraint fields yet.

**constraints.rs**: Has a single function `compute_earliest_start(tasks, task_id)` that computes
the earliest possible start date for a task based on its predecessor dependencies. It handles
FS, SS, and FF dependency types with lag. Returns `Option<String>` (None if no dependencies).

**date_utils.rs**: Has `add_days(date_str, days) -> String` for date arithmetic.

## Tasks — execute in order:

### L1: Add SNET (Start No Earlier Than) constraint

SNET is the most important constraint type after ASAP (which is the implicit default). When a
task has an SNET constraint, it cannot start before the constraint date, even if its dependencies
would allow an earlier start. This is used when a task has an external deadline or dependency
that isn't modeled in the schedule (e.g., "can't start until the permit is issued on March 15").

1. In `types.rs`, add two optional fields to `Task`:
   ```rust
   #[serde(default)]
   pub constraint_type: Option<ConstraintType>,
   #[serde(default)]
   pub constraint_date: Option<String>,
   ```

2. In `types.rs`, define the `ConstraintType` enum with ONLY two variants:
   ```rust
   #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
   pub enum ConstraintType {
       ASAP,
       SNET,
   }
   ```
   Do NOT add other constraint types (ALAP, SNLT, etc.) — those are future work.

3. In `constraints.rs`, update `compute_earliest_start()`:
   - After computing the dependency-driven earliest start, check if the task has an SNET constraint
   - If it does, return the LATER of (dependency-driven ES, constraint date)
   - If the task has no dependencies but has SNET, return the constraint date
   - ASAP constraint (or no constraint) means no additional floor — existing behavior

4. Update ALL `make_task` test helper functions in constraints.rs (and any test file you touch)
   to include the new fields with default values (None/None).

5. Add tests:
   - Task with SNET constraint and no deps: earliest start = constraint date
   - Task with SNET and FS dep: earliest start = max(dep-driven, constraint date)
   - Task with SNET where dep drives later than constraint: dep wins
   - Task with ASAP constraint: behaves like no constraint
   - Task with no constraint fields (None): behaves like current code

### L2: Implement recalculate-to-earliest

Recalculate-to-earliest is a core scheduling operation. It snaps tasks to their earliest
possible start dates based on dependencies and constraints. In professional tools, this is
the "Schedule" button — it resolves all slack and ensures the schedule is as compact as possible.

1. Add `RecalcResult` to `types.rs`:
   ```rust
   #[derive(Debug, Clone, Serialize, Deserialize)]
   #[serde(rename_all = "camelCase")]
   pub struct RecalcResult {
       pub id: String,
       pub new_start: String,
       pub new_end: String,
   }
   ```

2. In `constraints.rs`, add a new public function:
   ```rust
   pub fn recalculate_earliest(
       tasks: &[Task],
       scope_project: Option<&str>,
       scope_workstream: Option<&str>,
       scope_task_id: Option<&str>,
       today_date: &str,
   ) -> Vec<RecalcResult>
   ```
   Scoping:
   - If `scope_task_id` is Some: recalculate that task + all its downstream dependents
   - If `scope_workstream` is Some: recalculate all tasks in that workstream
   - If `scope_project` is Some: recalculate all tasks in that project
   - If all None: recalculate everything

   Algorithm:
   a. Determine which tasks are in scope
   b. Build a dependency graph for the in-scope tasks (topological sort)
   c. Process tasks in topological order:
      - For each task, compute its earliest start using `compute_earliest_start()`
      - Floor the result at `today_date` (never schedule in the past)
      - If the task has an SNET constraint, floor at the constraint date too
      - If the task has no dependencies and no constraint, floor at today_date
      - Compute new_end = new_start + duration (preserving the original duration)
   d. Return a `RecalcResult` for each task whose dates changed

3. Add tests:
   - Linear chain A→B→C: recalculate snaps all to earliest possible dates
   - Task with slack: after recalculate, slack is removed
   - `today_date` floor: tasks are not scheduled before today
   - SNET constraint: task with SNET is not moved before its constraint date
   - Scope by workstream: only tasks in that workstream are affected
   - Scope by task ID: that task + dependents are recalculated

### L3: WASM binding + verify

Add a new WASM binding at the END of `lib.rs` (do NOT modify existing functions):

```rust
#[wasm_bindgen]
pub fn recalculate_earliest(
    tasks_js: JsValue,
    scope_project: Option<String>,
    scope_workstream: Option<String>,
    scope_task_id: Option<String>,
    today_date: &str,
) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize: {}", e)))?;
    let results = constraints::recalculate_earliest(
        &tasks,
        scope_project.as_deref(),
        scope_workstream.as_deref(),
        scope_task_id.as_deref(),
        today_date,
    );
    serde_wasm_bindgen::to_value(&results)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {}", e)))
}
```

Final verification:
- `cd crates/scheduler && cargo test` — all pass
- `cd crates/scheduler && cargo clippy` — no warnings
- Commit with message: "feat: add SNET constraint support and recalculate-to-earliest"
