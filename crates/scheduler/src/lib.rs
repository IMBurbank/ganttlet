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
        if is_weekend_date(&task.start_date) || is_weekend_date(&task.end_date) {
            let (bad_date, which) = if is_weekend_date(&task.start_date) {
                (task.start_date.clone(), "starts")
            } else {
                (task.end_date.clone(), "ends")
            };
            conflicts.push(ConflictResult {
                task_id: task.id.clone(),
                conflict_type: "WEEKEND_VIOLATION".to_string(),
                constraint_date: bad_date.clone(),
                actual_date: bad_date.clone(),
                message: format!("Task {} {} on a weekend ({})", task.id, which, bad_date),
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
        let mut task = make_task("a", "2026-03-15", "2026-03-20");
        task.constraint_type = Some(ConstraintType::SNLT);
        task.constraint_date = Some("2026-03-12".to_string());
        let conflicts = find_conflicts(&[task]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].conflict_type, "SNLT_VIOLATED");
    }

    #[test]
    fn detect_dependency_violation() {
        // B starts Mar 10 but A (FS dep) ends Mar 15 → B should start after Mar 15
        let a = make_task("a", "2026-03-09", "2026-03-15");
        let mut b = make_task("b", "2026-03-10", "2026-03-18");
        b.dependencies = vec![Dependency {
            from_id: "a".to_string(),
            to_id: "b".to_string(),
            dep_type: DepType::FS,
            lag: 0,
        }];
        let conflicts = find_conflicts(&[a, b]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].conflict_type, "NEGATIVE_FLOAT");
        assert_eq!(conflicts[0].task_id, "b");
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
