//! Core data structures for the scheduling engine.
//!
//! Defines the domain types shared across all modules:
//! - `Task` — a schedulable unit with dates, duration, deps, and constraints
//! - `Dependency` — a typed edge (FS/SS/FF/SF) with optional lag
//! - `DepType` — the four dependency relationship types
//! - `ConstraintType` — the eight scheduling constraint types
//!
//! And result types returned by WASM exports:
//! - `CascadeResult` — per-task updated dates from cascade propagation
//! - `RecalcResult` — per-task recalculated start/end from constraint evaluation
//! - `ConflictResult` — constraint violation details (task, type, dates)
//! - `CriticalPathResult` — critical task IDs and edges from CPM

use serde::{Deserialize, Serialize};

/// Constraint type for a task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConstraintType {
    ASAP, // As Soon As Possible (default)
    SNET, // Start No Earlier Than
    ALAP, // As Late As Possible
    SNLT, // Start No Later Than
    FNET, // Finish No Earlier Than
    FNLT, // Finish No Later Than
    MSO,  // Must Start On
    MFO,  // Must Finish On
}

/// Dependency type between two tasks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DepType {
    FS, // Finish-to-Start
    FF, // Finish-to-Finish
    SS, // Start-to-Start
    SF, // Start-to-Finish
}

/// A dependency link from one task to another.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub from_id: String,
    pub to_id: String,
    #[serde(rename = "type")]
    pub dep_type: DepType,
    pub lag: i32,
}

/// A task with scheduling-relevant fields only.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    /// First working day of the task (inclusive). Must be Mon-Fri.
    pub start_date: String,
    /// Last working day of the task (inclusive). Must be Mon-Fri.
    /// Derived: task_end_date(start_date, duration).
    pub end_date: String,
    /// Business days in [start_date, end_date] counting both endpoints.
    /// A 1-day task has duration=1 and start_date == end_date.
    pub duration: i32,
    pub is_milestone: bool,
    pub is_summary: bool,
    pub dependencies: Vec<Dependency>,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub work_stream: String,
    #[serde(default)]
    pub constraint_type: Option<ConstraintType>,
    #[serde(default)]
    pub constraint_date: Option<String>,
}

/// Result of a cascade operation: which task moved and its new dates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeResult {
    pub id: String,
    pub start_date: String,
    pub end_date: String,
}

/// Result of a recalculate-to-earliest operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcResult {
    pub id: String,
    pub new_start: String,
    pub new_end: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict: Option<String>,
}
