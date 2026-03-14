//! WASM scheduling engine for Ganttlet.
//!
//! This crate implements the core scheduling logic — critical path, cascade
//! propagation, constraint evaluation, cycle detection, and conflict detection —
//! compiled to WebAssembly and called from the browser via `wasm-bindgen`.
//!
//! ## `#[wasm_bindgen]` exports
//!
//! - `compute_critical_path` — CPM on the full task graph
//! - `compute_critical_path_scoped` — CPM filtered to a project or workstream
//! - `would_create_cycle` — BFS reachability check before adding a dependency
//! - `compute_earliest_start` — earliest start for a single task from deps + constraints
//! - `cascade_dependents` — propagate a predecessor move to all transitive dependents
//! - `detect_conflicts` — find constraint violations across all tasks
//!   (wraps the internal `find_conflicts()` helper)
//! - `recalculate_earliest` — full topo-sort recalculation of all task dates
//!
//! ## Date convention
//!
//! All modules (except `cpm`) use the **inclusive end-date convention**: `end_date`
//! is the last working day a task occupies, and `duration` counts both endpoints.
//! See the `date_utils` module docs for details.

use wasm_bindgen::prelude::*;

pub mod cascade;
pub mod constraints;
pub mod cpm;
pub mod date_utils;
pub mod graph;
pub mod types;

use date_utils::{
    ff_successor_start, fs_successor_start, is_weekend_date, sf_successor_start, ss_successor_start,
};
use serde::{Deserialize, Serialize};
use types::{ConstraintType, Task};

/// Compute the critical path. Returns `{ taskIds: string[], edges: [string, string][] }`.
#[wasm_bindgen]
pub fn compute_critical_path(tasks_js: JsValue) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
    let result = cpm::compute_critical_path(&tasks);
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}

/// Compute the critical path scoped to a project or workstream.
/// Returns `{ taskIds: string[], edges: [string, string][] }`.
#[wasm_bindgen]
pub fn compute_critical_path_scoped(
    tasks_js: JsValue,
    scope_js: JsValue,
) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
    let scope: cpm::CriticalPathScope = serde_wasm_bindgen::from_value(scope_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize scope: {}", e)))?;
    let result = cpm::compute_critical_path_scoped(&tasks, &scope);
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}

/// Check if adding a dependency from predecessorId to successorId would create a cycle.
#[wasm_bindgen]
pub fn would_create_cycle(
    tasks_js: JsValue,
    successor_id: &str,
    predecessor_id: &str,
) -> Result<bool, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
    Ok(graph::would_create_cycle(
        &tasks,
        successor_id,
        predecessor_id,
    ))
}

/// Compute the earliest possible start date for a task given its dependencies.
#[wasm_bindgen]
pub fn compute_earliest_start(tasks_js: JsValue, task_id: &str) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
    let result = constraints::compute_earliest_start(&tasks, task_id);
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}

/// Cascade dependent tasks after a task moves. Returns array of CascadeResult.
#[wasm_bindgen]
pub fn cascade_dependents(
    tasks_js: JsValue,
    moved_task_id: &str,
    days_delta: i32,
) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
    let results = cascade::cascade_dependents(&tasks, moved_task_id, days_delta);
    serde_wasm_bindgen::to_value(&results)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}

/// Result of conflict detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictResult {
    pub task_id: String,
    pub conflict_type: String,
    pub constraint_date: String,
    pub actual_date: String,
    pub message: String,
}

/// Find scheduling conflicts: constraint violations and negative float.
fn find_conflicts(tasks: &[Task]) -> Vec<ConflictResult> {
    let mut conflicts = Vec::new();

    for task in tasks {
        if let (Some(ref ct), Some(ref cd)) = (&task.constraint_type, &task.constraint_date) {
            match ct {
                ConstraintType::SNLT => {
                    if task.start_date > *cd {
                        conflicts.push(ConflictResult {
                            task_id: task.id.clone(),
                            conflict_type: "SNLT_VIOLATED".to_string(),
                            constraint_date: cd.clone(),
                            actual_date: task.start_date.clone(),
                            message: format!(
                                "Task {} starts {} but must start no later than {}",
                                task.id, task.start_date, cd
                            ),
                        });
                    }
                }
                ConstraintType::FNLT => {
                    if task.end_date > *cd {
                        conflicts.push(ConflictResult {
                            task_id: task.id.clone(),
                            conflict_type: "FNLT_VIOLATED".to_string(),
                            constraint_date: cd.clone(),
                            actual_date: task.end_date.clone(),
                            message: format!(
                                "Task {} ends {} but must finish no later than {}",
                                task.id, task.end_date, cd
                            ),
                        });
                    }
                }
                ConstraintType::MSO => {
                    if task.start_date != *cd {
                        conflicts.push(ConflictResult {
                            task_id: task.id.clone(),
                            conflict_type: "MSO_CONFLICT".to_string(),
                            constraint_date: cd.clone(),
                            actual_date: task.start_date.clone(),
                            message: format!(
                                "Task {} starts {} but must start on {}",
                                task.id, task.start_date, cd
                            ),
                        });
                    }
                }
                ConstraintType::MFO => {
                    if task.end_date != *cd {
                        conflicts.push(ConflictResult {
                            task_id: task.id.clone(),
                            conflict_type: "MFO_CONFLICT".to_string(),
                            constraint_date: cd.clone(),
                            actual_date: task.end_date.clone(),
                            message: format!(
                                "Task {} ends {} but must finish on {}",
                                task.id, task.end_date, cd
                            ),
                        });
                    }
                }
                _ => {} // ASAP, SNET, ALAP, FNET don't generate conflicts
            }
        }
    }

    // Check for dependency violations (negative float proxy):
    // A task's start date (or for FF/SF, start derived from required end) violates the constraint.
    let task_map: std::collections::HashMap<&str, &Task> =
        tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    for task in tasks {
        for dep in &task.dependencies {
            if let Some(pred) = task_map.get(dep.from_id.as_str()) {
                let required_start = match dep.dep_type {
                    types::DepType::FS => fs_successor_start(&pred.end_date, dep.lag),
                    types::DepType::SS => ss_successor_start(&pred.start_date, dep.lag),
                    types::DepType::FF => {
                        ff_successor_start(&pred.end_date, dep.lag, task.duration)
                    }
                    types::DepType::SF => {
                        sf_successor_start(&pred.start_date, dep.lag, task.duration)
                    }
                };
                if task.start_date < required_start {
                    conflicts.push(ConflictResult {
                        task_id: task.id.clone(),
                        conflict_type: "DEP_VIOLATED".to_string(),
                        constraint_date: required_start.clone(),
                        actual_date: task.start_date.clone(),
                        message: format!(
                            "Task {} starts {} but dependency requires no earlier than {}",
                            task.id, task.start_date, required_start
                        ),
                    });
                }
            }
        }
    }

    // Check for weekend violations: tasks must not start or end on Sat/Sun.
    for task in tasks {
        if is_weekend_date(&task.start_date) {
            conflicts.push(ConflictResult {
                task_id: task.id.clone(),
                conflict_type: "WEEKEND_VIOLATION".to_string(),
                constraint_date: task.start_date.clone(),
                actual_date: task.start_date.clone(),
                message: format!("Task {} starts on a weekend ({})", task.id, task.start_date),
            });
        }
        if is_weekend_date(&task.end_date) {
            conflicts.push(ConflictResult {
                task_id: task.id.clone(),
                conflict_type: "WEEKEND_VIOLATION".to_string(),
                constraint_date: task.end_date.clone(),
                actual_date: task.end_date.clone(),
                message: format!("Task {} ends on a weekend ({})", task.id, task.end_date),
            });
        }
    }

    conflicts
}

/// Detect scheduling conflicts (constraint violations and negative float).
/// Returns array of ConflictResult.
#[wasm_bindgen]
pub fn detect_conflicts(tasks_js: JsValue) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
    let conflicts = find_conflicts(&tasks);
    serde_wasm_bindgen::to_value(&conflicts)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize conflicts: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use types::{DepType, Dependency};

    fn make_task(id: &str, start: &str, end: &str) -> Task {
        Task {
            id: id.to_string(),
            start_date: start.to_string(),
            end_date: end.to_string(),
            duration: 7,
            is_milestone: false,
            is_summary: false,
            dependencies: vec![],
            project: String::new(),
            work_stream: String::new(),
            constraint_type: None,
            constraint_date: None,
        }
    }

    #[test]
    fn detect_mso_conflict() {
        let mut task = make_task("a", "2026-03-12", "2026-03-18");
        task.constraint_type = Some(ConstraintType::MSO);
        task.constraint_date = Some("2026-03-10".to_string());
        // A starts Mar 12 but MSO says must start on Mar 10
        let conflicts = find_conflicts(&[task]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].conflict_type, "MSO_CONFLICT");
        assert_eq!(conflicts[0].task_id, "a");
    }

    #[test]
    fn detect_fnlt_conflict() {
        let mut task = make_task("a", "2026-03-10", "2026-03-20");
        task.constraint_type = Some(ConstraintType::FNLT);
        task.constraint_date = Some("2026-03-18".to_string());
        // A ends Mar 20 but FNLT says must finish no later than Mar 18
        let conflicts = find_conflicts(&[task]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].conflict_type, "FNLT_VIOLATED");
    }

    #[test]
    fn no_conflicts_when_constraints_satisfied() {
        let mut task = make_task("a", "2026-03-10", "2026-03-18");
        task.constraint_type = Some(ConstraintType::MSO);
        task.constraint_date = Some("2026-03-10".to_string());
        let conflicts = find_conflicts(&[task]);
        assert!(conflicts.is_empty());
    }

    #[test]
    fn multiple_conflicts_detected() {
        let mut t1 = make_task("a", "2026-03-12", "2026-03-18");
        t1.constraint_type = Some(ConstraintType::MSO);
        t1.constraint_date = Some("2026-03-10".to_string());

        let mut t2 = make_task("b", "2026-03-10", "2026-03-20");
        t2.constraint_type = Some(ConstraintType::FNLT);
        t2.constraint_date = Some("2026-03-18".to_string());

        let conflicts = find_conflicts(&[t1, t2]);
        assert_eq!(conflicts.len(), 2);
    }

    #[test]
    fn detect_snlt_conflict() {
        // task starts Mon 03-16 (weekday), SNLT=03-12 → 03-16 > 03-12 → SNLT_VIOLATED.
        let mut task = make_task("a", "2026-03-16", "2026-03-20");
        task.constraint_type = Some(ConstraintType::SNLT);
        task.constraint_date = Some("2026-03-12".to_string());
        let conflicts = find_conflicts(&[task]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].conflict_type, "SNLT_VIOLATED");
    }

    #[test]
    fn detect_dependency_violation() {
        // B starts Mar 10 but A (FS dep) ends Fri Mar 13 →
        // fs_successor_start(03-13, 0) = 03-16 (Mon) > B.start 03-10 → DEP_VIOLATED.
        // A ends on a weekday (Fri) so no WEEKEND_VIOLATION.
        let a = make_task("a", "2026-03-09", "2026-03-13");
        let mut b = make_task("b", "2026-03-10", "2026-03-18");
        b.dependencies = vec![Dependency {
            from_id: "a".to_string(),
            to_id: "b".to_string(),
            dep_type: DepType::FS,
            lag: 0,
        }];
        let conflicts = find_conflicts(&[a, b]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].conflict_type, "DEP_VIOLATED");
        assert_eq!(conflicts[0].task_id, "b");
    }

    // ── Agreement tests: find_conflicts vs recalculate_earliest ───────────
    // These tests verify that when find_conflicts detects a DEP_VIOLATED
    // conflict, the constraint_date it reports equals the new_start that
    // recalculate_earliest would compute for the same scenario.
    //
    // Setup for all subtests:
    //   A: start=2026-03-09 (Mon), end=2026-03-13 (Fri), duration=5
    //   B: duration=5, placed too early (violates dep constraint with A)
    //
    // Dep type formula sources (using *_successor_start helpers):
    //   FS lag=0: required_start = addBiz('2026-03-13', 1)  = 2026-03-16 (Mon)
    //   SS lag=0: required_start = addBiz('2026-03-09', 0)  = 2026-03-09 (Mon)
    //   FF lag=0: required_start = addBiz('2026-03-13', -4) = 2026-03-09 (Mon)
    //   SF lag=0: required_start = addBiz('2026-03-09', -4) = 2026-03-03 (Tue)
    // All verified via node -e with date-fns.

    #[test]
    fn conflict_date_matches_recalculate_resolution() {
        use crate::constraints::recalculate_earliest;

        // (dep_type, lag, A.start, A.end, A.dur, B.start, B.end, B.dur, expected_required_start)
        // B is placed BEFORE the required_start so it violates the constraint.
        // B has internally consistent dates (B.end = taskEndDate(B.start, B.dur)).
        let cases: &[(DepType, i32, &str, &str, i32, &str, &str, i32, &str)] = &[
            // FS: B starts too early before A ends
            // A ends 2026-03-13, FS lag=0 → required=2026-03-16 (Mon)
            // B.start=2026-03-10 (Tue) < 2026-03-16 → violation
            (
                DepType::FS,
                0,
                "2026-03-09",
                "2026-03-13",
                5,
                "2026-03-10",
                "2026-03-16",
                5,
                "2026-03-16",
            ),
            // SS: B starts before A starts + lag=0
            // A starts 2026-03-09, SS lag=0 → required=2026-03-09 (Mon)
            // B.start=2026-03-05 (Thu) < 2026-03-09 → violation
            (
                DepType::SS,
                0,
                "2026-03-09",
                "2026-03-13",
                5,
                "2026-03-05",
                "2026-03-11",
                5,
                "2026-03-09",
            ),
            // FF: B starts before required start derived from A.end
            // A ends 2026-03-13, FF lag=0, B.dur=5 → required_start = addBiz('2026-03-13', -4) = 2026-03-09
            // B.start=2026-03-05 (Thu) < 2026-03-09 → violation
            (
                DepType::FF,
                0,
                "2026-03-09",
                "2026-03-13",
                5,
                "2026-03-05",
                "2026-03-11",
                5,
                "2026-03-09",
            ),
            // SF: B starts before required start derived from A.start
            // A starts 2026-03-09, SF lag=0, B.dur=5 → required_start = addBiz('2026-03-09', -4) = 2026-03-03
            // B.start=2026-02-27 (Fri) < 2026-03-03 → violation
            (
                DepType::SF,
                0,
                "2026-03-09",
                "2026-03-13",
                5,
                "2026-02-27",
                "2026-03-05",
                5,
                "2026-03-03",
            ),
        ];

        for (dep_type, lag, a_start, a_end, a_dur, b_start, b_end, b_dur, expected_req) in cases {
            let a = {
                let mut t = make_task("a", a_start, a_end);
                t.duration = *a_dur;
                t
            };
            let b = {
                let mut t = make_task("b", b_start, b_end);
                t.duration = *b_dur;
                t.dependencies = vec![Dependency {
                    from_id: "a".to_string(),
                    to_id: "b".to_string(),
                    dep_type: dep_type.clone(),
                    lag: *lag,
                }];
                t
            };
            let tasks = [a, b];

            // find_conflicts should detect a DEP_VIOLATED conflict for B
            let conflicts = find_conflicts(&tasks);
            let dep_conflict = conflicts
                .iter()
                .find(|c| c.task_id == "b" && c.conflict_type == "DEP_VIOLATED")
                .expect(&format!(
                    "expected DEP_VIOLATED for dep={:?} lag={}",
                    dep_type, lag
                ));

            // The constraint_date from find_conflicts = required_start
            assert_eq!(
                dep_conflict.constraint_date, *expected_req,
                "find_conflicts constraint_date mismatch for dep={:?} lag={}",
                dep_type, lag
            );

            // recalculate_earliest should move B to the same required_start
            let recalc_results = recalculate_earliest(
                &tasks,
                None,
                None,
                None,
                "2026-01-01", // far in past so today-floor doesn't affect
            );
            let recalc_b = recalc_results.iter().find(|r| r.id == "b").expect(&format!(
                "recalculate should move B for dep={:?} lag={}",
                dep_type, lag
            ));

            // The conflict date should match the recalculate resolution
            assert_eq!(
                dep_conflict.constraint_date, recalc_b.new_start,
                "find_conflicts and recalculate disagree for dep={:?} lag={}: conflict_date={} recalc={}",
                dep_type, lag, dep_conflict.constraint_date, recalc_b.new_start
            );
        }
    }
}

/// Recalculate tasks to their earliest possible start dates.
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
