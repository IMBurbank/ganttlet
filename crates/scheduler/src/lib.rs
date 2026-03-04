use wasm_bindgen::prelude::*;

pub mod types;
pub mod date_utils;
pub mod cpm;
pub mod graph;
pub mod cascade;
pub mod constraints;

use types::Task;

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
pub fn compute_critical_path_scoped(tasks_js: JsValue, scope_js: JsValue) -> Result<JsValue, JsValue> {
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
    Ok(graph::would_create_cycle(&tasks, successor_id, predecessor_id))
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
