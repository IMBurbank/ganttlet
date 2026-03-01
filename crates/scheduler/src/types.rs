use serde::{Deserialize, Serialize};

/// Dependency type between two tasks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DepType {
    FS,
    FF,
    SS,
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
    pub start_date: String,
    pub end_date: String,
    pub duration: i32,
    pub is_milestone: bool,
    pub is_summary: bool,
    pub dependencies: Vec<Dependency>,
}

/// Result of a cascade operation: which task moved and its new dates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeResult {
    pub id: String,
    pub start_date: String,
    pub end_date: String,
}
