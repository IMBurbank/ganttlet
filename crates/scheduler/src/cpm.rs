//! Critical Path Method (CPM) implementation.
//!
//! This module uses a standard exclusive integer model where:
//! - early_start and late_start are inclusive
//! - early_finish and late_finish are exclusive (day AFTER the task)
//! - duration = finish - start (integer arithmetic)
//!
//! This is the standard CPM convention used in scheduling literature.
//! Do NOT apply the project's inclusive end-date convention here —
//! CPM is an abstract graph algorithm, not a date calculation.
//! The conversion between CPM integers and calendar dates happens
//! at the boundaries (input: date→int, output: int→date).

use crate::types::{ConstraintType, DepType, Task};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CriticalPathScope {
    Project { name: String },
    Workstream { name: String },
}

/// Result of critical path computation: critical task IDs and critical edges.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticalPathResult {
    pub task_ids: Vec<String>,
    pub edges: Vec<(String, String)>,
}

struct SuccEdge {
    task_id: String,
    lag: i32,
    dep_type: DepType,
}

/// Compute the critical path using CPM. Returns critical task IDs and critical edges.
///
/// A critical edge is a dependency where both the predecessor and successor are
/// on the critical path.
pub fn compute_critical_path(tasks: &[Task]) -> CriticalPathResult {
    let non_summary: Vec<&Task> = tasks.iter().filter(|t| !t.is_summary).collect();
    if non_summary.is_empty() {
        return CriticalPathResult {
            task_ids: vec![],
            edges: vec![],
        };
    }

    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    // ES/EF for each task
    let mut es: HashMap<&str, i64> = HashMap::new();
    let mut ef: HashMap<&str, i64> = HashMap::new();

    // Build adjacency with dependency type
    let mut in_degree: HashMap<&str, i32> = HashMap::new();
    let mut successors: HashMap<&str, Vec<SuccEdge>> = HashMap::new();

    for t in &non_summary {
        in_degree.insert(&t.id, 0);
        successors.entry(&t.id).or_default();
    }

    for t in &non_summary {
        for dep in &t.dependencies {
            // Skip if predecessor doesn't exist or is summary
            match task_map.get(dep.from_id.as_str()) {
                Some(pred) if !pred.is_summary => {}
                _ => continue,
            }
            let dep_type = dep.dep_type.clone();
            *in_degree.entry(&t.id).or_insert(0) += 1;
            successors.entry(&dep.from_id).or_default().push(SuccEdge {
                task_id: t.id.clone(),
                lag: dep.lag,
                dep_type,
            });
        }
    }

    // Initialize ES=0, EF=duration for all tasks.
    // CPM computes from first principles using durations and dependencies,
    // not from stored dates which may reflect manual positioning.
    for t in &non_summary {
        let dur = if t.is_milestone { 0 } else { t.duration as i64 };
        es.insert(&t.id, 0);
        ef.insert(&t.id, dur);
    }

    // Forward pass - BFS in topological order
    let mut queue: VecDeque<&str> = VecDeque::new();
    for t in &non_summary {
        if *in_degree.get(t.id.as_str()).unwrap_or(&0) == 0 {
            queue.push_back(&t.id);
        }
    }

    let mut processed: Vec<String> = Vec::new();
    let mut processed_set: HashSet<&str> = HashSet::new();

    while let Some(current) = queue.pop_front() {
        if processed_set.contains(current) {
            continue;
        }
        processed_set.insert(current);
        processed.push(current.to_string());

        let cur_es = *es.get(current).unwrap_or(&0);
        let cur_ef = *ef.get(current).unwrap_or(&0);

        if let Some(edges) = successors.get(current) {
            for edge in edges {
                let succ_id = edge.task_id.as_str();
                let succ_task = match task_map.get(succ_id) {
                    Some(t) => t,
                    None => continue,
                };
                let succ_dur = if succ_task.is_milestone {
                    0
                } else {
                    succ_task.duration as i64
                };
                let current_succ_es = *es.get(succ_id).unwrap_or(&0);

                let new_es = match edge.dep_type {
                    DepType::FS => cur_ef + edge.lag as i64,
                    DepType::SS => cur_es + edge.lag as i64,
                    DepType::FF => cur_ef + edge.lag as i64 - succ_dur,
                    DepType::SF => cur_es + edge.lag as i64 - succ_dur,
                };

                if new_es > current_succ_es {
                    es.insert(succ_id, new_es);
                    ef.insert(succ_id, new_es + succ_dur);
                }

                let deg = in_degree.entry(succ_id).or_insert(1);
                *deg -= 1;
                if *deg <= 0 {
                    queue.push_back(succ_id);
                }
            }
        }
    }

    // Find the project end (max EF)
    let project_end = ef.values().copied().max().unwrap_or(0);

    // Backward pass
    let mut ls: HashMap<&str, i64> = HashMap::new();
    let mut lf: HashMap<&str, i64> = HashMap::new();

    for t in &non_summary {
        let dur = if t.is_milestone { 0 } else { t.duration as i64 };
        lf.insert(&t.id, project_end);
        ls.insert(&t.id, project_end - dur);
    }

    // Process in reverse topological order
    for task_id_str in processed.iter().rev() {
        let task_id = task_id_str.as_str();
        let task = match task_map.get(task_id) {
            Some(t) => t,
            None => continue,
        };
        let cur_ls = *ls.get(task_id).unwrap_or(&project_end);
        let cur_lf = *lf.get(task_id).unwrap_or(&project_end);

        for dep in &task.dependencies {
            match task_map.get(dep.from_id.as_str()) {
                Some(pred) if !pred.is_summary => {
                    let pred_dur = if pred.is_milestone {
                        0
                    } else {
                        pred.duration as i64
                    };

                    let (new_lf, new_ls) = match dep.dep_type {
                        DepType::FS => {
                            let nlf = cur_ls - dep.lag as i64;
                            (nlf, nlf - pred_dur)
                        }
                        DepType::SS => {
                            let nls = cur_ls - dep.lag as i64;
                            (nls + pred_dur, nls)
                        }
                        DepType::FF => {
                            let nlf = cur_lf - dep.lag as i64;
                            (nlf, nlf - pred_dur)
                        }
                        DepType::SF => {
                            // SF backward: LS_pred >= LF_succ - lag
                            let nls = cur_lf - dep.lag as i64;
                            (nls + pred_dur, nls)
                        }
                    };

                    let pred_id = dep.from_id.as_str();
                    if new_lf < *lf.get(pred_id).unwrap_or(&project_end) {
                        lf.insert(pred_id, new_lf);
                    }
                    if new_ls < *ls.get(pred_id).unwrap_or(&project_end) {
                        ls.insert(pred_id, new_ls);
                    }
                }
                _ => continue,
            }
        }
    }

    // ALAP resolution: after backward pass, ALAP tasks use LS as their ES
    for t in &non_summary {
        if let Some(ConstraintType::ALAP) = &t.constraint_type {
            let task_ls = *ls.get(t.id.as_str()).unwrap_or(&0);
            let dur = if t.is_milestone { 0 } else { t.duration as i64 };
            es.insert(&t.id, task_ls);
            ef.insert(&t.id, task_ls + dur);
        }
    }

    // Critical tasks: float (LS - ES) == 0
    let mut critical_set: HashSet<String> = HashSet::new();
    let mut critical_ids = Vec::new();
    for t in &non_summary {
        let task_es = *es.get(t.id.as_str()).unwrap_or(&0);
        let task_ls = *ls.get(t.id.as_str()).unwrap_or(&0);
        let float = task_ls - task_es;
        if float == 0 {
            critical_set.insert(t.id.clone());
            critical_ids.push(t.id.clone());
        }
    }

    // Critical edges: dependencies where both endpoints are on the critical path
    let mut critical_edges = Vec::new();
    for t in &non_summary {
        if !critical_set.contains(&t.id) {
            continue;
        }
        for dep in &t.dependencies {
            if critical_set.contains(&dep.from_id) {
                critical_edges.push((dep.from_id.clone(), t.id.clone()));
            }
        }
    }

    CriticalPathResult {
        task_ids: critical_ids,
        edges: critical_edges,
    }
}

/// Compute critical path scoped to a subset of tasks.
///
/// Runs CPM on the full task set to preserve cross-scope dependencies,
/// then filters results to only include tasks matching the scope.
pub fn compute_critical_path_scoped(
    tasks: &[Task],
    scope: &CriticalPathScope,
) -> CriticalPathResult {
    let full_result = compute_critical_path(tasks);

    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    let in_scope = |task_id: &str| -> bool {
        match task_map.get(task_id) {
            Some(task) => match scope {
                CriticalPathScope::Project { name } => task.project == *name,
                CriticalPathScope::Workstream { name } => task.work_stream == *name,
            },
            None => false,
        }
    };

    let task_ids: Vec<String> = full_result
        .task_ids
        .into_iter()
        .filter(|id| in_scope(id))
        .collect();

    let scoped_set: HashSet<&str> = task_ids.iter().map(|s| s.as_str()).collect();

    let edges: Vec<(String, String)> = full_result
        .edges
        .into_iter()
        .filter(|(from, to)| scoped_set.contains(from.as_str()) && scoped_set.contains(to.as_str()))
        .collect();

    CriticalPathResult { task_ids, edges }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Dependency;

    fn make_task(id: &str, start: &str, end: &str, duration: i32) -> Task {
        Task {
            id: id.to_string(),
            start_date: start.to_string(),
            end_date: end.to_string(),
            duration,
            is_milestone: false,
            is_summary: false,
            dependencies: vec![],
            project: String::new(),
            work_stream: String::new(),
            constraint_type: None,
            constraint_date: None,
        }
    }

    fn make_dep(from: &str, to: &str, dep_type: DepType, lag: i32) -> Dependency {
        Dependency {
            from_id: from.to_string(),
            to_id: to.to_string(),
            dep_type,
            lag,
        }
    }

    fn make_project_task(id: &str, start: &str, end: &str, duration: i32, project: &str) -> Task {
        Task {
            project: project.to_string(),
            ..make_task(id, start, end, duration)
        }
    }

    fn make_workstream_task(
        id: &str,
        start: &str,
        end: &str,
        duration: i32,
        project: &str,
        ws: &str,
    ) -> Task {
        Task {
            project: project.to_string(),
            work_stream: ws.to_string(),
            ..make_task(id, start, end, duration)
        }
    }

    // --- I1: Core CPM tests ---

    #[test]
    fn empty_tasks_returns_empty() {
        let result = compute_critical_path(&[]);
        assert!(result.task_ids.is_empty());
        assert!(result.edges.is_empty());
    }

    #[test]
    fn only_summary_tasks_returns_empty() {
        let tasks = vec![Task {
            is_summary: true,
            ..make_task("summary", "2026-03-02", "2026-03-10", 9)
        }];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.is_empty());
    }

    #[test]
    fn single_task_is_critical() {
        let tasks = vec![make_task("a", "2026-03-02", "2026-03-10", 9)];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
    }

    #[test]
    fn standalone_task_alongside_chain() {
        let mut b = make_task("b", "2026-03-10", "2026-03-19", 9);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![
            make_task("a", "2026-03-02", "2026-03-10", 9),
            b,
            make_task("c", "2026-03-02", "2026-03-05", 5), // standalone, shorter
        ];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
        assert!(!result.task_ids.contains(&"c".to_string()));
    }

    #[test]
    fn linear_fs_chain() {
        let mut b = make_task("b", "2026-03-10", "2026-03-19", 9);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-03-19", "2026-03-27", 9);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-10", 9), b, c];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
        assert!(result.task_ids.contains(&"c".to_string()));
    }

    #[test]
    fn linear_chain_four_tasks() {
        // A→B→C→D, all duration 5. All must be critical.
        let mut b = make_task("b", "2026-03-02", "2026-03-06", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-03-02", "2026-03-06", 5);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];
        let mut d = make_task("d", "2026-03-02", "2026-03-06", 5);
        d.dependencies = vec![make_dep("c", "d", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b, c, d];
        let result = compute_critical_path(&tasks);
        assert_eq!(result.task_ids.len(), 4);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
        assert!(result.task_ids.contains(&"c".to_string()));
        assert!(result.task_ids.contains(&"d".to_string()));
    }

    #[test]
    fn linear_chain_ignores_stored_dates() {
        // Tasks with deliberately wrong stored dates — CPM must compute from first principles
        let mut b = make_task("b", "2026-03-20", "2026-03-25", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-03-02", "2026-03-06", 5);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-16", "2026-03-20", 5), b, c];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
        assert!(result.task_ids.contains(&"c".to_string()));
    }

    #[test]
    fn diamond_critical_path() {
        // A→B, A→C, B→D, C→D. B duration 10, C duration 5.
        // Critical path: A→B→D (longest path). C has float.
        let mut b = make_task("b", "2026-03-02", "2026-03-11", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-03-02", "2026-03-06", 5);
        c.dependencies = vec![make_dep("a", "c", DepType::FS, 0)];
        let mut d = make_task("d", "2026-03-02", "2026-03-06", 5);
        d.dependencies = vec![
            make_dep("b", "d", DepType::FS, 0),
            make_dep("c", "d", DepType::FS, 0),
        ];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b, c, d];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
        assert!(result.task_ids.contains(&"d".to_string()));
        assert!(!result.task_ids.contains(&"c".to_string()));
    }

    #[test]
    fn non_critical_task_with_float() {
        let mut b = make_task("b", "2026-03-11", "2026-03-20", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![
            make_task("a", "2026-03-02", "2026-03-10", 10),
            b,
            make_task("c", "2026-03-02", "2026-03-05", 5),
        ];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
        assert!(!result.task_ids.contains(&"c".to_string()));
    }

    #[test]
    fn ss_dependency() {
        let mut b = make_task("b", "2026-03-06", "2026-03-16", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::SS, 5)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-10", 10), b];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
    }

    #[test]
    fn ff_dependency() {
        let mut b = make_task("b", "2026-03-02", "2026-03-10", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FF, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-10", 10), b];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
    }

    #[test]
    fn milestone_on_critical_path() {
        let mut ms = make_task("ms", "2026-03-10", "2026-03-10", 0);
        ms.is_milestone = true;
        ms.dependencies = vec![make_dep("a", "ms", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-10", 10), ms];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"ms".to_string()));
    }

    #[test]
    fn excludes_summary_tasks() {
        let mut b = make_task("b", "2026-03-11", "2026-03-20", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let tasks = vec![
            Task {
                is_summary: true,
                ..make_task("summary", "2026-03-02", "2026-03-10", 10)
            },
            make_task("a", "2026-03-02", "2026-03-10", 10),
            b,
        ];
        let result = compute_critical_path(&tasks);
        assert!(!result.task_ids.contains(&"summary".to_string()));
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
    }

    #[test]
    fn parallel_paths_longest_is_critical() {
        // Path 1: a1→a2 (5+10=15) — longer, critical
        // Path 2: b1→b2 (5+5=10) — shorter, has float
        let mut a2 = make_task("a2", "2026-03-02", "2026-03-11", 10);
        a2.dependencies = vec![make_dep("a1", "a2", DepType::FS, 0)];
        let mut b2 = make_task("b2", "2026-03-02", "2026-03-06", 5);
        b2.dependencies = vec![make_dep("b1", "b2", DepType::FS, 0)];

        let tasks = vec![
            make_task("a1", "2026-03-02", "2026-03-06", 5),
            a2,
            make_task("b1", "2026-03-02", "2026-03-06", 5),
            b2,
        ];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a1".to_string()));
        assert!(result.task_ids.contains(&"a2".to_string()));
        assert!(!result.task_ids.contains(&"b1".to_string()));
        assert!(!result.task_ids.contains(&"b2".to_string()));
    }

    #[test]
    fn lag_changes_critical_path() {
        // A→B (FS, lag 0): B ES=5, EF=10
        // A→C (FS, lag 10): C ES=15, EF=20 — C path becomes critical due to lag
        let mut b = make_task("b", "2026-03-02", "2026-03-06", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-03-02", "2026-03-06", 5);
        c.dependencies = vec![make_dep("a", "c", DepType::FS, 10)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b, c];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"c".to_string()));
        assert!(!result.task_ids.contains(&"b".to_string()));
    }

    // --- I4: Critical edge tests ---

    #[test]
    fn critical_edges_linear_chain() {
        let mut b = make_task("b", "2026-03-02", "2026-03-06", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-03-02", "2026-03-06", 5);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b, c];
        let result = compute_critical_path(&tasks);
        assert_eq!(result.edges.len(), 2);
        assert!(result.edges.contains(&("a".to_string(), "b".to_string())));
        assert!(result.edges.contains(&("b".to_string(), "c".to_string())));
    }

    #[test]
    fn critical_edges_diamond() {
        // Critical path A→B→D. C is not critical.
        // Edges: (A,B) and (B,D) are critical. (A,C) and (C,D) are not.
        let mut b = make_task("b", "2026-03-02", "2026-03-11", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-03-02", "2026-03-06", 5);
        c.dependencies = vec![make_dep("a", "c", DepType::FS, 0)];
        let mut d = make_task("d", "2026-03-02", "2026-03-06", 5);
        d.dependencies = vec![
            make_dep("b", "d", DepType::FS, 0),
            make_dep("c", "d", DepType::FS, 0),
        ];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b, c, d];
        let result = compute_critical_path(&tasks);
        assert_eq!(result.edges.len(), 2);
        assert!(result.edges.contains(&("a".to_string(), "b".to_string())));
        assert!(result.edges.contains(&("b".to_string(), "d".to_string())));
        assert!(!result.edges.contains(&("a".to_string(), "c".to_string())));
        assert!(!result.edges.contains(&("c".to_string(), "d".to_string())));
    }

    #[test]
    fn critical_edges_empty() {
        let result = compute_critical_path(&[]);
        assert!(result.edges.is_empty());
    }

    #[test]
    fn critical_edges_single_task() {
        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5)];
        let result = compute_critical_path(&tasks);
        assert!(result.edges.is_empty());
    }

    // --- I2: Scoped critical path tests ---

    #[test]
    fn scoped_project_matches_all_when_same_project() {
        let mut b = make_project_task("b", "2026-03-10", "2026-03-19", 9, "Alpha");
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let tasks = vec![
            make_project_task("a", "2026-03-02", "2026-03-10", 9, "Alpha"),
            b,
        ];

        let scoped = compute_critical_path_scoped(
            &tasks,
            &CriticalPathScope::Project {
                name: "Alpha".to_string(),
            },
        );
        let full = compute_critical_path(&tasks);
        assert_eq!(full.task_ids, scoped.task_ids);
    }

    #[test]
    fn scoped_project_filters() {
        // Alpha chain: a1 -> a2
        let mut a2 = make_project_task("a2", "2026-03-11", "2026-03-20", 10, "Alpha");
        a2.dependencies = vec![make_dep("a1", "a2", DepType::FS, 0)];

        // Beta chain: b1 -> b2
        let mut b2 = make_project_task("b2", "2026-03-11", "2026-03-20", 10, "Beta");
        b2.dependencies = vec![make_dep("b1", "b2", DepType::FS, 0)];

        let tasks = vec![
            make_project_task("a1", "2026-03-02", "2026-03-10", 10, "Alpha"),
            a2,
            make_project_task("b1", "2026-03-02", "2026-03-10", 10, "Beta"),
            b2,
        ];

        let alpha_critical = compute_critical_path_scoped(
            &tasks,
            &CriticalPathScope::Project {
                name: "Alpha".to_string(),
            },
        );
        assert!(alpha_critical.task_ids.contains(&"a1".to_string()));
        assert!(alpha_critical.task_ids.contains(&"a2".to_string()));
        assert!(!alpha_critical.task_ids.contains(&"b1".to_string()));
        assert!(!alpha_critical.task_ids.contains(&"b2".to_string()));
    }

    #[test]
    fn scoped_workstream_filters() {
        // Engineering chain: e1 -> e2
        let mut e2 =
            make_workstream_task("e2", "2026-03-11", "2026-03-20", 10, "Alpha", "Engineering");
        e2.dependencies = vec![make_dep("e1", "e2", DepType::FS, 0)];

        // Design chain: d1 -> d2
        let mut d2 = make_workstream_task("d2", "2026-03-11", "2026-03-20", 10, "Alpha", "Design");
        d2.dependencies = vec![make_dep("d1", "d2", DepType::FS, 0)];

        let tasks = vec![
            make_workstream_task("e1", "2026-03-02", "2026-03-10", 10, "Alpha", "Engineering"),
            e2,
            make_workstream_task("d1", "2026-03-02", "2026-03-10", 10, "Alpha", "Design"),
            d2,
        ];

        let eng_critical = compute_critical_path_scoped(
            &tasks,
            &CriticalPathScope::Workstream {
                name: "Engineering".to_string(),
            },
        );
        assert!(eng_critical.task_ids.contains(&"e1".to_string()));
        assert!(eng_critical.task_ids.contains(&"e2".to_string()));
        assert!(!eng_critical.task_ids.contains(&"d1".to_string()));
        assert!(!eng_critical.task_ids.contains(&"d2".to_string()));
    }

    #[test]
    fn workstream_scope_empty_returns_empty() {
        let tasks = vec![make_workstream_task(
            "a",
            "2026-03-02",
            "2026-03-10",
            10,
            "Alpha",
            "Engineering",
        )];
        let result = compute_critical_path_scoped(
            &tasks,
            &CriticalPathScope::Workstream {
                name: "NonExistent".to_string(),
            },
        );
        assert!(result.task_ids.is_empty());
    }

    #[test]
    fn cross_workstream_dependency() {
        // Design: d1 (dur 10)
        // Engineering: e1 (dur 5, depends on d1 FS)
        // Full critical path: d1→e1 (both critical)
        // Scope to Engineering: e1 is critical, d1 filtered out (Design scope)
        let mut e1 =
            make_workstream_task("e1", "2026-03-11", "2026-03-16", 5, "Alpha", "Engineering");
        e1.dependencies = vec![make_dep("d1", "e1", DepType::FS, 0)];

        let tasks = vec![
            make_workstream_task("d1", "2026-03-02", "2026-03-10", 10, "Alpha", "Design"),
            e1,
        ];

        let eng_critical = compute_critical_path_scoped(
            &tasks,
            &CriticalPathScope::Workstream {
                name: "Engineering".to_string(),
            },
        );
        assert!(eng_critical.task_ids.contains(&"e1".to_string()));
        assert!(!eng_critical.task_ids.contains(&"d1".to_string()));
    }

    #[test]
    fn scoped_project_internal_deps() {
        // Alpha: a1→a2→a3 (5+5+5=15) — longest overall, critical
        // Beta: b1 (dur 10) — shorter, has float
        let mut a2 = make_project_task("a2", "2026-03-02", "2026-03-06", 5, "Alpha");
        a2.dependencies = vec![make_dep("a1", "a2", DepType::FS, 0)];
        let mut a3 = make_project_task("a3", "2026-03-02", "2026-03-06", 5, "Alpha");
        a3.dependencies = vec![make_dep("a2", "a3", DepType::FS, 0)];

        let tasks = vec![
            make_project_task("a1", "2026-03-02", "2026-03-06", 5, "Alpha"),
            a2,
            a3,
            make_project_task("b1", "2026-03-02", "2026-03-10", 10, "Beta"),
        ];

        let alpha_critical = compute_critical_path_scoped(
            &tasks,
            &CriticalPathScope::Project {
                name: "Alpha".to_string(),
            },
        );
        assert!(alpha_critical.task_ids.contains(&"a1".to_string()));
        assert!(alpha_critical.task_ids.contains(&"a2".to_string()));
        assert!(alpha_critical.task_ids.contains(&"a3".to_string()));
        assert!(!alpha_critical.task_ids.contains(&"b1".to_string()));
    }

    // --- SF dependency tests ---

    #[test]
    fn sf_dep_forward_pass() {
        // A(3d) →SF→ B(2d). SF: EF_B >= ES_A + lag.
        // ES_A = 0, EF_A = 3. ES_B should be = ES_A + 0 - 2 = -2, floored at 0.
        // So B: ES=0, EF=2. A: ES=0, EF=3. Project end=3.
        // Both critical (same ES).
        let mut b = make_task("b", "2026-03-02", "2026-03-03", 2);
        b.dependencies = vec![make_dep("a", "b", DepType::SF, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-04", 3), b];
        let result = compute_critical_path(&tasks);
        // A is critical (longer). B has float since EF_B=2 < project_end=3.
        assert!(result.task_ids.contains(&"a".to_string()));
    }

    #[test]
    fn sf_dep_chain_with_fs() {
        // A(5d) →FS→ C(3d), A(5d) →SF→ B(2d), B(2d) →FS→ C(3d)
        // A: ES=0, EF=5. B: SF from A → ES=max(0, 0+0-2)=0, EF=2.
        // C: FS from A → ES=5. FS from B → ES=2. Max=5, EF=8.
        // Critical path: A→C via FS.
        let mut b = make_task("b", "2026-03-02", "2026-03-03", 2);
        b.dependencies = vec![make_dep("a", "b", DepType::SF, 0)];

        let mut c = make_task("c", "2026-03-02", "2026-03-04", 3);
        c.dependencies = vec![
            make_dep("a", "c", DepType::FS, 0),
            make_dep("b", "c", DepType::FS, 0),
        ];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b, c];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"c".to_string()));
    }

    // --- ALAP resolution test ---

    #[test]
    fn alap_task_uses_late_start() {
        // A(5d) →FS→ B(3d, ALAP) →FS→ C(2d)
        // Forward: A ES=0 EF=5. B ES=5 EF=8. C ES=8 EF=10.
        // Backward: project_end=10. C LS=8 LF=10. B LS=5 LF=8. A LS=0 LF=5.
        // ALAP on B: ES set to LS=5. Still critical (float=0).
        let mut b = make_task("b", "2026-03-02", "2026-03-04", 3);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::ALAP);

        let mut c = make_task("c", "2026-03-02", "2026-03-03", 2);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b, c];
        let result = compute_critical_path(&tasks);
        // All on critical path since it's a linear chain
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
        assert!(result.task_ids.contains(&"c".to_string()));
    }

    #[test]
    fn alap_task_non_critical_becomes_critical() {
        // A(5d), B(3d, ALAP) — no deps between them.
        // Forward: A ES=0 EF=5, B ES=0 EF=3.
        // project_end=5. Backward: A LS=0 LF=5, B LS=2 LF=5.
        // ALAP resolution: B ES=LS=2, EF=2+3=5. Float=LS-ES=2-2=0 → B becomes critical.
        let mut b = make_task("b", "2026-03-02", "2026-03-04", 3);
        b.constraint_type = Some(ConstraintType::ALAP);

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        let result = compute_critical_path(&tasks);
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
    }

    #[test]
    fn alap_with_successor_delays_correctly() {
        // A(10d), B(3d, ALAP)→FS→C(2d). No dep between A and B.
        // Forward: A ES=0 EF=10. B ES=0 EF=3. C ES=3 EF=5.
        // project_end=10. Backward: all LS=project_end-dur.
        // A LS=0 LF=10. C LS=8 LF=10. B LS=5 LF=8.
        // ALAP: B ES=5, EF=8. Float for B: 5-5=0 → critical.
        // C: LS=8, ES=3 originally, but B is predecessor and pushed to ES=5...
        // Actually C ES from forward pass stays 3, and with ALAP B is now at 5...
        // CPM doesn't re-run forward pass after ALAP — it just sets ES.
        // C's ES in forward pass is 3 (from B FS). After ALAP, B's ES becomes 5,
        // but C's ES is still 3 from forward pass. The float check: C LS=8, ES=3 → float=5.
        let mut b = make_task("b", "2026-03-02", "2026-03-04", 3);
        b.constraint_type = Some(ConstraintType::ALAP);
        let mut c = make_task("c", "2026-03-02", "2026-03-03", 2);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-11", 10), b, c];
        let result = compute_critical_path(&tasks);
        // A is critical (longest). B becomes critical via ALAP (float=0).
        assert!(result.task_ids.contains(&"a".to_string()));
        assert!(result.task_ids.contains(&"b".to_string()));
    }
}
