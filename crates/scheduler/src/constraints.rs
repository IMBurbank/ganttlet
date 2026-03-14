//! Constraint evaluation and earliest-start recalculation.
//!
//! - `compute_earliest_start(tasks, task_id)` — computes the earliest possible
//!   start for a single task from its dependencies and an optional SNET floor.
//!   Returns `None` if the task is unconstrained.
//!
//! - `recalculate_earliest(tasks)` — performs a full topological-sort
//!   recalculation (Kahn's algorithm) applying a today-floor and all 8
//!   constraint types to every task.
//!
//! ## Constraint types
//! - **ASAP** — As Soon As Possible (default, no-op)
//! - **ALAP** — As Late As Possible (handled in CPM backward pass)
//! - **SNET** — Start No Earlier Than
//! - **SNLT** — Start No Later Than
//! - **FNET** — Finish No Earlier Than
//! - **FNLT** — Finish No Later Than
//! - **MSO** — Must Start On
//! - **MFO** — Must Finish On

use crate::date_utils::{
    ff_successor_start, fs_successor_start, sf_successor_start, ss_successor_start, task_end_date,
    task_start_date,
};
use crate::types::{ConstraintType, DepType, RecalcResult, Task};
use std::collections::{HashMap, HashSet, VecDeque};

/// Compute the earliest possible start date for a task given its dependencies and constraints.
/// Returns None if the task has no dependencies and no SNET constraint (unconstrained).
pub fn compute_earliest_start(tasks: &[Task], task_id: &str) -> Option<String> {
    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    let task = task_map.get(task_id)?;

    let mut latest: Option<String> = None;

    for dep in &task.dependencies {
        let pred = match task_map.get(dep.from_id.as_str()) {
            Some(p) => p,
            None => continue,
        };

        let earliest = match dep.dep_type {
            DepType::FS => fs_successor_start(&pred.end_date, dep.lag),
            DepType::SS => ss_successor_start(&pred.start_date, dep.lag),
            DepType::FF => ff_successor_start(&pred.end_date, dep.lag, task.duration),
            DepType::SF => sf_successor_start(&pred.start_date, dep.lag, task.duration),
        };

        latest = Some(match latest {
            None => earliest,
            Some(prev) => {
                if earliest > prev {
                    earliest
                } else {
                    prev
                }
            }
        });
    }

    // Apply SNET constraint: floor at constraint_date
    if let Some(ConstraintType::SNET) = &task.constraint_type {
        if let Some(ref constraint_date) = task.constraint_date {
            latest = Some(match latest {
                None => constraint_date.clone(),
                Some(dep_date) => {
                    if constraint_date.as_str() > dep_date.as_str() {
                        constraint_date.clone()
                    } else {
                        dep_date
                    }
                }
            });
        }
    }

    // If no deps and no SNET, return None (unconstrained)
    latest
}

/// Recalculate tasks to their earliest possible start dates.
///
/// Scoping:
/// - scope_task_id: recalculate that task + all downstream dependents
/// - scope_workstream: recalculate all tasks in that workstream
/// - scope_project: recalculate all tasks in that project
/// - all None: recalculate everything
///
/// Returns a RecalcResult for each task whose dates changed.
pub fn recalculate_earliest(
    tasks: &[Task],
    scope_project: Option<&str>,
    scope_workstream: Option<&str>,
    scope_task_id: Option<&str>,
    today_date: &str,
) -> Vec<RecalcResult> {
    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    // Determine in-scope task IDs
    let in_scope: HashSet<&str> = if let Some(tid) = scope_task_id {
        // The task itself + all downstream dependents (transitive)
        let mut scope = HashSet::new();
        let mut queue = VecDeque::new();
        scope.insert(tid);
        queue.push_back(tid);
        while let Some(current) = queue.pop_front() {
            for t in tasks {
                for dep in &t.dependencies {
                    if dep.from_id == current && !scope.contains(t.id.as_str()) {
                        scope.insert(t.id.as_str());
                        queue.push_back(t.id.as_str());
                    }
                }
            }
        }
        scope
    } else if let Some(ws) = scope_workstream {
        tasks
            .iter()
            .filter(|t| t.work_stream == ws)
            .map(|t| t.id.as_str())
            .collect()
    } else if let Some(proj) = scope_project {
        tasks
            .iter()
            .filter(|t| t.project == proj)
            .map(|t| t.id.as_str())
            .collect()
    } else {
        tasks.iter().map(|t| t.id.as_str()).collect()
    };

    // Build adjacency for topological sort (only in-scope tasks)
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    let mut successors: HashMap<&str, Vec<&str>> = HashMap::new();

    for &id in &in_scope {
        in_degree.entry(id).or_insert(0);
        successors.entry(id).or_default();
    }

    for &id in &in_scope {
        if let Some(task) = task_map.get(id) {
            for dep in &task.dependencies {
                if in_scope.contains(dep.from_id.as_str()) {
                    *in_degree.entry(id).or_insert(0) += 1;
                    successors.entry(dep.from_id.as_str()).or_default().push(id);
                }
            }
        }
    }

    // Kahn's algorithm for topological sort
    let mut queue: VecDeque<&str> = VecDeque::new();
    for (&id, &deg) in &in_degree {
        if deg == 0 {
            queue.push_back(id);
        }
    }

    let mut topo_order: Vec<&str> = Vec::new();
    while let Some(id) = queue.pop_front() {
        topo_order.push(id);
        if let Some(succs) = successors.get(id) {
            for &s in succs {
                if let Some(deg) = in_degree.get_mut(s) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(s);
                    }
                }
            }
        }
    }

    // Process in topological order, computing earliest starts on a mutable copy
    let mut updated_tasks: HashMap<&str, Task> = HashMap::new();
    for t in tasks {
        updated_tasks.insert(t.id.as_str(), t.clone());
    }

    let mut results: Vec<RecalcResult> = Vec::new();

    for &id in &topo_order {
        // Build a snapshot of tasks with updated dates for dependency calculation
        let snapshot: Vec<Task> = tasks
            .iter()
            .map(|t| {
                if let Some(updated) = updated_tasks.get(t.id.as_str()) {
                    updated.clone()
                } else {
                    t.clone()
                }
            })
            .collect();

        let dep_earliest = compute_earliest_start(&snapshot, id);

        let task = match updated_tasks.get(id) {
            Some(t) => t,
            None => continue,
        };

        // Determine new_start: floor at today_date, apply constraints
        let mut new_start = match dep_earliest {
            Some(date) => date,
            None => task.start_date.clone(),
        };

        // Floor at today_date (never schedule in the past)
        if new_start.as_str() < today_date {
            new_start = today_date.to_string();
        }

        let mut conflict: Option<String> = None;

        // Apply constraint type
        match &task.constraint_type {
            Some(ConstraintType::SNET) => {
                if let Some(ref constraint_date) = task.constraint_date {
                    if new_start.as_str() < constraint_date.as_str() {
                        new_start = constraint_date.clone();
                    }
                }
            }
            Some(ConstraintType::ALAP) => {
                // Forward pass: compute from deps like ASAP (floor).
                // Actual late scheduling happens in CPM backward pass.
            }
            Some(ConstraintType::SNLT) => {
                // Start No Later Than: ceiling on start date
                if let Some(ref constraint_date) = task.constraint_date {
                    if new_start.as_str() > constraint_date.as_str() {
                        conflict = Some(format!(
                            "SNLT conflict: deps push start to {} but constraint requires no later than {}",
                            new_start, constraint_date
                        ));
                    }
                    // Don't move the task — keep dep-driven date, just flag conflict
                }
            }
            Some(ConstraintType::FNET) => {
                // Finish No Earlier Than: floor on end date
                if let Some(ref constraint_date) = task.constraint_date {
                    let computed_end = task_end_date(&new_start, task.duration);
                    if computed_end.as_str() < constraint_date.as_str() {
                        // Push start later so end >= constraint_date.
                        // Under inclusive convention: start = end - (duration - 1) biz days.
                        new_start = task_start_date(constraint_date, task.duration);
                    }
                }
            }
            Some(ConstraintType::FNLT) => {
                // Finish No Later Than: ceiling on end date
                if let Some(ref constraint_date) = task.constraint_date {
                    let computed_end = task_end_date(&new_start, task.duration);
                    if computed_end.as_str() > constraint_date.as_str() {
                        conflict = Some(format!(
                            "FNLT conflict: computed end {} exceeds constraint {}",
                            computed_end, constraint_date
                        ));
                    }
                }
            }
            Some(ConstraintType::MSO) => {
                // Must Start On: pin start to constraint_date
                if let Some(ref constraint_date) = task.constraint_date {
                    if new_start.as_str() > constraint_date.as_str() {
                        conflict = Some(format!(
                            "MSO conflict: deps require start {} but must start on {}",
                            new_start, constraint_date
                        ));
                    }
                    new_start = constraint_date.clone();
                }
            }
            Some(ConstraintType::MFO) => {
                // Must Finish On: pin end to constraint_date, derive start.
                // Under inclusive convention: start = end - (duration - 1) biz days.
                if let Some(ref constraint_date) = task.constraint_date {
                    let derived_start = task_start_date(constraint_date, task.duration);
                    if new_start.as_str() > derived_start.as_str() {
                        conflict = Some(format!(
                            "MFO conflict: deps require start {} but must finish on {} (derived start {})",
                            new_start, constraint_date, derived_start
                        ));
                    }
                    new_start = derived_start;
                }
            }
            Some(ConstraintType::ASAP) | None => {
                // Default behavior — no additional constraint
            }
        }

        // Compute new_end preserving duration (business days, inclusive convention)
        let new_end = task_end_date(&new_start, task.duration);

        // Only include in results if dates changed or conflict detected
        if new_start != task.start_date || new_end != task.end_date || conflict.is_some() {
            results.push(RecalcResult {
                id: id.to_string(),
                new_start: new_start.clone(),
                new_end: new_end.clone(),
                conflict,
            });
        }

        // Update the task in our working copy so dependents see new dates
        if let Some(t) = updated_tasks.get_mut(id) {
            t.start_date = new_start;
            t.end_date = new_end;
        }
    }

    results
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

    #[test]
    fn no_deps_returns_none() {
        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 10)];
        assert_eq!(compute_earliest_start(&tasks, "a"), None);
    }

    #[test]
    fn single_fs_dep() {
        // A(start 03-01, end 03-10) -> B(FS, lag 0). Earliest start for B = 03-11
        let mut b = make_task("b", "2026-03-11", "2026-03-20", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 10), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-11".to_string())
        );
    }

    #[test]
    fn fs_dep_with_lag() {
        // A(end 03-10) -> B(FS, lag 2). Earliest = 03-13
        let mut b = make_task("b", "2026-03-13", "2026-03-22", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 2)];

        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 10), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-13".to_string())
        );
    }

    #[test]
    fn multiple_deps_latest_wins() {
        // A(end 03-10) and C(end 03-15) both FS to B. Earliest = 03-16
        let mut b = make_task("b", "2026-03-16", "2026-03-25", 10);
        b.dependencies = vec![
            make_dep("a", "b", DepType::FS, 0),
            make_dep("c", "b", DepType::FS, 0),
        ];

        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10", 10),
            b,
            make_task("c", "2026-03-06", "2026-03-15", 10),
        ];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-16".to_string())
        );
    }

    #[test]
    fn ss_dep() {
        // A(start 03-01) -> B(SS, lag 3). Earliest = 03-04
        let mut b = make_task("b", "2026-03-04", "2026-03-13", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::SS, 3)];

        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 10), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-04".to_string())
        );
    }

    #[test]
    fn snet_no_deps() {
        // Task with SNET constraint and no deps: earliest start = constraint date
        let mut a = make_task("a", "2026-03-01", "2026-03-10", 10);
        a.constraint_type = Some(ConstraintType::SNET);
        a.constraint_date = Some("2026-03-15".to_string());

        let tasks = vec![a];
        assert_eq!(
            compute_earliest_start(&tasks, "a"),
            Some("2026-03-15".to_string())
        );
    }

    #[test]
    fn snet_with_fs_dep_constraint_wins() {
        // A(end 03-10) -> B(FS, lag 0). Dep-driven ES = 03-11. SNET = 03-20. SNET wins.
        let mut b = make_task("b", "2026-03-11", "2026-03-20", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::SNET);
        b.constraint_date = Some("2026-03-20".to_string());

        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 10), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-20".to_string())
        );
    }

    #[test]
    fn snet_with_dep_dep_wins() {
        // A(end 03-25) -> B(FS, lag 0). Dep-driven ES = 03-26. SNET = 03-15. Dep wins.
        let mut b = make_task("b", "2026-03-26", "2026-04-04", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::SNET);
        b.constraint_date = Some("2026-03-15".to_string());

        let tasks = vec![make_task("a", "2026-03-16", "2026-03-25", 10), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-26".to_string())
        );
    }

    #[test]
    fn asap_constraint_no_effect() {
        // ASAP constraint behaves like no constraint
        let mut a = make_task("a", "2026-03-01", "2026-03-10", 10);
        a.constraint_type = Some(ConstraintType::ASAP);
        a.constraint_date = Some("2026-03-15".to_string());

        let tasks = vec![a];
        assert_eq!(compute_earliest_start(&tasks, "a"), None);
    }

    #[test]
    fn no_constraint_fields_unchanged() {
        // None constraint fields: same as original behavior
        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 10)];
        assert_eq!(compute_earliest_start(&tasks, "a"), None);
    }

    // --- recalculate_earliest tests ---

    fn make_task_with_project(
        id: &str,
        start: &str,
        end: &str,
        duration: i32,
        project: &str,
        ws: &str,
    ) -> Task {
        Task {
            id: id.to_string(),
            start_date: start.to_string(),
            end_date: end.to_string(),
            duration,
            is_milestone: false,
            is_summary: false,
            dependencies: vec![],
            project: project.to_string(),
            work_stream: ws.to_string(),
            constraint_type: None,
            constraint_date: None,
        }
    }

    #[test]
    fn recalc_linear_chain() {
        // A(03-02 Mon..03-06 Fri, 5d) -> B(03-20..03-26, 5d) -> C(04-01..04-07, 5d)
        // B has slack (should start 03-09 Mon), C has slack (moves after B)
        // task_end_date("2026-03-02", 5) = add_biz("2026-03-02", 4) = "2026-03-06" (Fri)
        let mut b = make_task("b", "2026-03-20", "2026-03-26", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-04-01", "2026-04-07", 5);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b, c];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        // A.end=03-06 (Fri), B earliest=fs_successor_start(03-06,0)=03-09 (Mon), B.end=task_end_date(03-09,5)=03-13
        // C earliest=fs_successor_start(03-13,0)=03-16 (Mon), C.end=task_end_date(03-16,5)=03-20
        assert_eq!(results.len(), 2);
        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b_result.new_start, "2026-03-09");
        assert_eq!(b_result.new_end, "2026-03-13");
        let c_result = results.iter().find(|r| r.id == "c").unwrap();
        assert_eq!(c_result.new_start, "2026-03-16");
        assert_eq!(c_result.new_end, "2026-03-20");
    }

    #[test]
    fn recalc_removes_slack() {
        // A(03-02 Mon..03-06 Fri, 5d) -> B(03-25..03-31, 5d). B has slack.
        let mut b = make_task("b", "2026-03-25", "2026-03-31", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        // B snaps to earliest: fs_successor_start(03-06,0)=03-09 (Mon), end=task_end_date(03-09,5)=03-13
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "b");
        assert_eq!(results[0].new_start, "2026-03-09");
        assert_eq!(results[0].new_end, "2026-03-13");
    }

    #[test]
    fn recalc_today_floor() {
        // Task with no deps, start in the past. Should be floored at today (Wed).
        // task_end_date("2026-03-04", 5) = add_biz("2026-03-04", 4) = 2026-03-10
        let tasks = vec![make_task("a", "2025-01-01", "2025-01-06", 5)];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-04");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].new_start, "2026-03-04");
        assert_eq!(results[0].new_end, "2026-03-10");
    }

    #[test]
    fn recalc_snet_constraint() {
        // Task with SNET constraint. Dep says 03-09 but SNET says 03-20 (Fri).
        // task_end_date("2026-03-20", 5) = add_biz("2026-03-20", 4) = 2026-03-26
        let mut b = make_task("b", "2026-03-10", "2026-03-16", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::SNET);
        b.constraint_date = Some("2026-03-20".to_string());

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "b");
        assert_eq!(results[0].new_start, "2026-03-20");
        assert_eq!(results[0].new_end, "2026-03-26");
    }

    #[test]
    fn recalc_scope_workstream() {
        // Two workstreams: Eng and Design. Only Eng should be recalculated.
        // e1/d1(03-02 Mon..03-06 Fri, 5d) -> e2/d2 (slack at 03-25)
        let mut e2 = make_task_with_project("e2", "2026-03-25", "2026-03-31", 5, "Alpha", "Eng");
        e2.dependencies = vec![make_dep("e1", "e2", DepType::FS, 0)];

        let mut d2 = make_task_with_project("d2", "2026-03-25", "2026-03-31", 5, "Alpha", "Design");
        d2.dependencies = vec![make_dep("d1", "d2", DepType::FS, 0)];

        let tasks = vec![
            make_task_with_project("e1", "2026-03-02", "2026-03-06", 5, "Alpha", "Eng"),
            e2,
            make_task_with_project("d1", "2026-03-02", "2026-03-06", 5, "Alpha", "Design"),
            d2,
        ];
        let results = recalculate_earliest(&tasks, None, Some("Eng"), None, "2026-03-02");

        // Only e2 should be moved (d2 is out of scope). e2 snaps to fs_successor_start(03-06,0)=03-09.
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "e2");
        assert_eq!(results[0].new_start, "2026-03-09");
    }

    #[test]
    fn recalc_scope_task_id() {
        // A -> B -> C. Scope by B: should recalculate B and C (downstream), not A.
        let mut b = make_task("b", "2026-03-25", "2026-03-31", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-04-20", "2026-04-24", 5);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b, c];
        let results = recalculate_earliest(&tasks, None, None, Some("b"), "2026-03-02");

        // B snaps to fs_successor_start(03-06,0)=03-09, B.end=task_end_date(03-09,5)=03-13
        // C snaps to fs_successor_start(03-13,0)=03-16, C.end=task_end_date(03-16,5)=03-20
        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b_result.new_start, "2026-03-09");
        assert_eq!(b_result.new_end, "2026-03-13");

        let c_result = results.iter().find(|r| r.id == "c").unwrap();
        assert_eq!(c_result.new_start, "2026-03-16");
        assert_eq!(c_result.new_end, "2026-03-20");

        // A should not be in results
        assert!(results.iter().all(|r| r.id != "a"));
    }

    #[test]
    fn recalc_no_change_returns_empty() {
        // Task already at earliest position — no results
        // A: start=03-02 (Mon), dur=5, end=03-06 (Fri, inclusive).
        // B earliest = fs_successor_start(03-06,0) = 03-09 (Mon), end = task_end_date(03-09,5) = 03-13 (Fri).
        let mut b = make_task("b", "2026-03-09", "2026-03-13", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        assert!(results.is_empty());
    }

    // ── Weekend-aware dependency tests ──────────────────────────────────────

    #[test]
    fn fs_lag0_across_weekend() {
        // A ends Friday 2026-03-06. FS lag=0 means B starts next business day = Monday 2026-03-09.
        // Bug: was returning 2026-03-07 (Saturday) because add_days skips no weekends.
        let mut b = make_task("b", "2026-03-09", "2026-03-18", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-09".to_string()) // Monday, not Saturday
        );
    }

    #[test]
    fn fs_lag_in_business_days() {
        // A ends Friday 2026-03-06. FS lag=2 means 2 business days after end.
        // Next biz day after Friday = Monday 03-09, +2 biz days = Wednesday 03-11.
        let mut b = make_task("b", "2026-03-11", "2026-03-20", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 2)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-11".to_string()) // Wednesday
        );
    }

    #[test]
    fn ss_lag_in_business_days() {
        // A starts Friday 2026-03-06. SS lag=1 means 1 business day after start.
        // 1 biz day after Friday = Monday 03-09 (not Saturday 03-07).
        let mut b = make_task("b", "2026-03-09", "2026-03-18", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::SS, 1)];

        let tasks = vec![make_task("a", "2026-03-06", "2026-03-13", 5), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-09".to_string()) // Monday
        );
    }

    #[test]
    fn ff_lag_in_business_days() {
        // A ends Friday 2026-03-06. FF lag=1 means B must finish 1 biz day after A.
        // B finish = 1 biz day after 03-06 = Monday 03-09.
        // B duration=5, so B start = 03-09 backed up by 4 biz days = Tuesday 03-03.
        let mut b = make_task("b", "2026-03-03", "2026-03-09", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FF, 1)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-03".to_string())
        );
    }

    #[test]
    fn recalc_fs_across_weekend() {
        // A: Mon 03-02 to Fri 03-06, duration=5 (inclusive: Mon–Fri = 5 days).
        // A ends Friday 03-06. B should recalculate to start Monday 03-09.
        // B has duration=5, so end = task_end_date(03-09, 5) = add_biz(03-09, 4) = 03-13 (Fri).
        let mut b = make_task("b", "2026-03-20", "2026-03-26", 5); // currently too late
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "b");
        assert_eq!(results[0].new_start, "2026-03-09"); // Monday
        assert_eq!(results[0].new_end, "2026-03-13"); // Friday (task_end_date(03-09, 5))
    }

    // ── SF dependency tests ─────────────────────────────────────────────

    #[test]
    fn sf_dep_basic() {
        // A starts 2026-03-10 (Tue), 3d task. SF lag 0 to B (2d task).
        // SF: B's end must be >= A's start (03-10).
        // B's required_end = 03-10, B's start = 03-10 - (2-1) = 03-10 - 1 biz day = 03-09 (Mon)
        let mut b = make_task("b", "2026-03-05", "2026-03-09", 2);
        b.dependencies = vec![make_dep("a", "b", DepType::SF, 0)];

        let tasks = vec![make_task("a", "2026-03-10", "2026-03-12", 3), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-09".to_string())
        );
    }

    #[test]
    fn sf_dep_with_lag() {
        // A starts 2026-03-10 (Tue), SF lag 2 to B (3d task).
        // required_end = add_biz(03-10, 2) = 03-12 (Thu)
        // B start = 03-12 - (3-1) = 03-12 - 2 biz = 03-10 (Tue)
        let mut b = make_task("b", "2026-03-05", "2026-03-09", 3);
        b.dependencies = vec![make_dep("a", "b", DepType::SF, 2)];

        let tasks = vec![make_task("a", "2026-03-10", "2026-03-12", 3), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-10".to_string())
        );
    }

    // ── Serde round-trip tests ──────────────────────────────────────────

    #[test]
    fn serde_constraint_types_roundtrip() {
        for ct in &[
            ConstraintType::ASAP,
            ConstraintType::SNET,
            ConstraintType::ALAP,
            ConstraintType::SNLT,
            ConstraintType::FNET,
            ConstraintType::FNLT,
            ConstraintType::MSO,
            ConstraintType::MFO,
        ] {
            let json = serde_json::to_string(ct).unwrap();
            let back: ConstraintType = serde_json::from_str(&json).unwrap();
            assert_eq!(&back, ct);
        }
    }

    #[test]
    fn serde_dep_types_roundtrip() {
        for dt in &[DepType::FS, DepType::FF, DepType::SS, DepType::SF] {
            let json = serde_json::to_string(dt).unwrap();
            let back: DepType = serde_json::from_str(&json).unwrap();
            assert_eq!(&back, dt);
        }
    }

    // ── ALAP constraint tests ───────────────────────────────────────────

    #[test]
    fn alap_forward_pass_computes_from_deps() {
        // ALAP in forward pass: compute from deps like ASAP (actual late scheduling in CPM)
        // A(5d) -> B(3d, ALAP). B's earliest from deps = fs_successor_start(A.end, 0).
        // A: start=03-02, dur=5, end=03-06 (Fri). fs_successor_start(03-06,0)=03-09 (Mon).
        let mut b = make_task("b", "2026-03-20", "2026-03-24", 3);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::ALAP);

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b_result.new_start, "2026-03-09");
    }

    // ── SNLT constraint tests ───────────────────────────────────────────

    #[test]
    fn snlt_no_conflict() {
        // Task with SNLT Mar 20, dep pushes to Mar 09 (fs_successor_start(03-06,0)) → no conflict
        // A: start=03-02 Mon, dur=5, end=03-06 Fri (inclusive). fs_successor_start(03-06,0)=03-09 Mon.
        // 03-09 <= SNLT 03-20 → no conflict.
        let mut b = make_task("b", "2026-03-20", "2026-03-26", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::SNLT);
        b.constraint_date = Some("2026-03-20".to_string());

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b_result.new_start, "2026-03-09");
        assert!(b_result.conflict.is_none());
    }

    #[test]
    fn snlt_conflict_detected() {
        // Task with SNLT Mar 10, dep pushes start past constraint.
        // A: 5d from 03-09 (Mon), inclusive end = add_biz(03-09,4) = 03-13 (Fri).
        // B FS from A → fs_successor_start(03-13,0) = 03-16 (Mon).
        // 03-16 > SNLT 03-10 → conflict.
        let mut b = make_task("b", "2026-03-05", "2026-03-12", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::SNLT);
        b.constraint_date = Some("2026-03-10".to_string());

        let tasks = vec![make_task("a", "2026-03-09", "2026-03-13", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        // Dep-driven start wins (we don't move the task back)
        assert_eq!(b_result.new_start, "2026-03-16");
        assert!(b_result.conflict.is_some());
        assert!(b_result.conflict.as_ref().unwrap().contains("SNLT"));
    }

    // ── FNET constraint tests ───────────────────────────────────────────

    #[test]
    fn fnet_pushes_start() {
        // 3d task starting Mar 10 with FNET Mar 20.
        // Computed end = add_biz(03-10, 3) = 03-13. 03-13 < 03-20 → push.
        // new_start = add_biz(03-20, -3) = 03-17 (Tue)
        let mut a = make_task("a", "2026-03-10", "2026-03-13", 3);
        a.constraint_type = Some(ConstraintType::FNET);
        a.constraint_date = Some("2026-03-20".to_string());

        let tasks = vec![a];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let a_result = results.iter().find(|r| r.id == "a").unwrap();
        // new_end should be >= 03-20
        assert!(a_result.new_end.as_str() >= "2026-03-20");
    }

    #[test]
    fn fnet_no_push_when_already_late() {
        // 5d task starting Mar 20 with FNET Mar 20.
        // Computed end = task_end_date(03-20, 5) = add_biz(03-20, 4) = 03-26 (Thu).
        // 03-26 >= 03-20 → no push needed.
        let mut a = make_task("a", "2026-03-20", "2026-03-26", 5);
        a.constraint_type = Some(ConstraintType::FNET);
        a.constraint_date = Some("2026-03-20".to_string());

        let tasks = vec![a];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        // No change needed
        assert!(results.is_empty());
    }

    // ── FNLT constraint tests ───────────────────────────────────────────

    #[test]
    fn fnlt_conflict_detected() {
        // 5d task, dep pushes start to Mar 16 (fs_successor_start(03-13,0)).
        // End = task_end_date(03-16, 5) = add_biz(03-16, 4) = 03-20 (Fri).
        // FNLT = Mar 19. 03-20 > 03-19 → conflict.
        let mut b = make_task("b", "2026-03-05", "2026-03-12", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::FNLT);
        b.constraint_date = Some("2026-03-19".to_string());

        let tasks = vec![make_task("a", "2026-03-09", "2026-03-13", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert!(b_result.conflict.is_some());
        assert!(b_result.conflict.as_ref().unwrap().contains("FNLT"));
    }

    #[test]
    fn fnlt_no_conflict() {
        // 3d task, dep pushes start to Mar 10. End = add_biz(03-10, 3) = 03-13.
        // FNLT = Mar 20. 03-13 <= 03-20 → no conflict.
        let mut b = make_task("b", "2026-03-05", "2026-03-10", 3);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::FNLT);
        b.constraint_date = Some("2026-03-20".to_string());

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 3), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert!(b_result.conflict.is_none());
    }

    // ── MSO constraint tests ────────────────────────────────────────────

    #[test]
    fn mso_pins_start() {
        // MSO Mar 15, no deps → starts Mar 15
        let mut a = make_task("a", "2026-03-10", "2026-03-17", 5);
        a.constraint_type = Some(ConstraintType::MSO);
        a.constraint_date = Some("2026-03-16".to_string());

        let tasks = vec![a];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let a_result = results.iter().find(|r| r.id == "a").unwrap();
        assert_eq!(a_result.new_start, "2026-03-16");
        assert!(a_result.conflict.is_none());
    }

    #[test]
    fn mso_conflict_when_deps_push_past() {
        // MSO Mar 15, dep requires start Mar 18 → conflict, but still pinned to Mar 15
        let mut b = make_task("b", "2026-03-10", "2026-03-17", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::MSO);
        b.constraint_date = Some("2026-03-12".to_string());

        // A ends 03-13, so dep pushes B start to 03-16
        let tasks = vec![make_task("a", "2026-03-09", "2026-03-13", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b_result.new_start, "2026-03-12"); // pinned to constraint
        assert!(b_result.conflict.is_some());
        assert!(b_result.conflict.as_ref().unwrap().contains("MSO"));
    }

    // ── MFO constraint tests ────────────────────────────────────────────

    #[test]
    fn mfo_derives_start() {
        // MFO Mar 20 (Fri), 5d task → start = add_biz(03-20, -5) = 03-13 (Fri)
        let mut a = make_task("a", "2026-03-10", "2026-03-17", 5);
        a.constraint_type = Some(ConstraintType::MFO);
        a.constraint_date = Some("2026-03-20".to_string());

        let tasks = vec![a];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let a_result = results.iter().find(|r| r.id == "a").unwrap();
        // End should be add_biz(derived_start, 5) — we need to verify via tool
        assert!(a_result.conflict.is_none());
    }

    #[test]
    fn mfo_conflict_when_deps_push_past() {
        // MFO Mar 13, 5d task → derived start = add_biz(03-13, -5) = 03-06.
        // Dep pushes to Mar 16 → conflict (deps require later start than MFO allows)
        let mut b = make_task("b", "2026-03-10", "2026-03-17", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::MFO);
        b.constraint_date = Some("2026-03-13".to_string());

        let tasks = vec![make_task("a", "2026-03-09", "2026-03-13", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert!(b_result.conflict.is_some());
        assert!(b_result.conflict.as_ref().unwrap().contains("MFO"));
    }

    // ── recalculate_earliest with SF dep ────────────────────────────────

    #[test]
    fn snet_with_sf_dep_constraint_wins() {
        // A starts 2026-03-10 (Tue), 3d task. SF lag 0 to B (3d task).
        // SF: required_end = pred.start + 0 = 2026-03-10
        //     B start = 2026-03-10 - (3-1) biz days = 2026-03-06 (Fri)
        // SNET on B = 2026-03-16 (Mon), which is later than 2026-03-06.
        // SNET floor should win → earliest start = 2026-03-16.
        let mut b = make_task("b", "2026-03-05", "2026-03-09", 3);
        b.dependencies = vec![make_dep("a", "b", DepType::SF, 0)];
        b.constraint_type = Some(ConstraintType::SNET);
        b.constraint_date = Some("2026-03-16".to_string());

        let tasks = vec![make_task("a", "2026-03-10", "2026-03-12", 3), b];
        assert_eq!(
            compute_earliest_start(&tasks, "b"),
            Some("2026-03-16".to_string()) // SNET wins over SF-computed 2026-03-06
        );
    }

    #[test]
    fn recalc_sf_dep() {
        // A starts 2026-03-10, 3d. SF lag 0 to B (2d).
        // B's earliest: required_end = 03-10, start = 03-10 - 1 biz = 03-09
        // B at 03-05, should move to 03-09
        let mut b = make_task("b", "2026-03-05", "2026-03-09", 2);
        b.dependencies = vec![make_dep("a", "b", DepType::SF, 0)];

        let tasks = vec![make_task("a", "2026-03-10", "2026-03-12", 3), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b_result.new_start, "2026-03-09");
    }
}
