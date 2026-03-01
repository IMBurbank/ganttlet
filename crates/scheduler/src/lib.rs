use wasm_bindgen::prelude::*;

pub mod types;
pub mod cpm;
pub mod graph;
pub mod cascade;

use types::Task;

/// Compute the critical path, returning an array of critical task IDs.
#[wasm_bindgen]
pub fn compute_critical_path(tasks_js: JsValue) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
    let critical_ids = cpm::compute_critical_path(&tasks);
    serde_wasm_bindgen::to_value(&critical_ids)
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
