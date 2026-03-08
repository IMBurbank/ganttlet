use crate::date_utils::add_business_days;
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
            DepType::FS => {
                // Start after predecessor finishes: next business day after end_date, then + lag business days
                let next_biz = add_business_days(&pred.end_date, 1);
                add_business_days(&next_biz, dep.lag)
            }
            DepType::SS => {
                // Start when predecessor starts + lag business days
                add_business_days(&pred.start_date, dep.lag)
            }
            DepType::FF => {
                // Finish together: predecessor end_date + lag business days, then back up by duration
                let finish = add_business_days(&pred.end_date, dep.lag);
                add_business_days(&finish, -(task.duration - 1))
            }
            DepType::SF => {
                // Start-to-Finish: successor cannot finish until predecessor starts + lag
                // required_end = pred.start + lag, so required_start = required_end - (duration - 1)
                let required_end = add_business_days(&pred.start_date, dep.lag);
                add_business_days(&required_end, -(task.duration - 1))
            }
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
                    successors
                        .entry(dep.from_id.as_str())
                        .or_default()
                        .push(id);
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

        // Determine new_start: floor at today_date, apply SNET, apply dep-driven
        let mut new_start = match dep_earliest {
            Some(date) => date,
            None => task.start_date.clone(),
        };

        // Floor at today_date (never schedule in the past)
        if new_start.as_str() < today_date {
            new_start = today_date.to_string();
        }

        // Floor at SNET constraint date
        if let Some(ConstraintType::SNET) = &task.constraint_type {
            if let Some(ref constraint_date) = task.constraint_date {
                if new_start.as_str() < constraint_date.as_str() {
                    new_start = constraint_date.clone();
                }
            }
        }

        // Compute new_end preserving duration (business days)
        let new_end = add_business_days(&new_start, task.duration);

        // Only include in results if dates changed
        if new_start != task.start_date || new_end != task.end_date {
            results.push(RecalcResult {
                id: id.to_string(),
                new_start: new_start.clone(),
                new_end: new_end.clone(),
                conflict: None,
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
        // A(03-02 Mon..03-09 Mon, 5d) -> B(03-20..03-27, 5d) -> C(04-01..04-08, 5d)
        // B has slack (should start 03-10), C has slack (moves after B)
        // add_business_days("2026-03-02", 5) = "2026-03-09"
        let mut b = make_task("b", "2026-03-20", "2026-03-27", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-04-01", "2026-04-08", 5);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-09", 5), b, c];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        // A.end=03-09, so B earliest=03-10 (Tue), B.end=add_biz(03-10,5)=03-17
        // C earliest=03-18 (Wed), C.end=add_biz(03-18,5)=03-25
        assert_eq!(results.len(), 2);
        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b_result.new_start, "2026-03-10");
        assert_eq!(b_result.new_end, "2026-03-17");
        let c_result = results.iter().find(|r| r.id == "c").unwrap();
        assert_eq!(c_result.new_start, "2026-03-18");
        assert_eq!(c_result.new_end, "2026-03-25");
    }

    #[test]
    fn recalc_removes_slack() {
        // A(03-02 Mon..03-09 Mon, 5d) -> B(03-25..04-01, 5d). B has slack.
        let mut b = make_task("b", "2026-03-25", "2026-04-01", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-09", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        // B snaps to earliest: 03-10 (Tue), end=add_biz(03-10,5)=03-17
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "b");
        assert_eq!(results[0].new_start, "2026-03-10");
        assert_eq!(results[0].new_end, "2026-03-17");
    }

    #[test]
    fn recalc_today_floor() {
        // Task with no deps, start in the past. Should be floored at today (Wed).
        // add_business_days("2026-03-04", 5) = 2026-03-11
        let tasks = vec![make_task("a", "2025-01-01", "2025-01-08", 5)];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-04");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].new_start, "2026-03-04");
        assert_eq!(results[0].new_end, "2026-03-11");
    }

    #[test]
    fn recalc_snet_constraint() {
        // Task with SNET constraint. Dep says 03-10 but SNET says 03-20 (Fri).
        // add_business_days("2026-03-20", 5) = 2026-03-27
        let mut b = make_task("b", "2026-03-10", "2026-03-17", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        b.constraint_type = Some(ConstraintType::SNET);
        b.constraint_date = Some("2026-03-20".to_string());

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-09", 5), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "b");
        assert_eq!(results[0].new_start, "2026-03-20");
        assert_eq!(results[0].new_end, "2026-03-27");
    }

    #[test]
    fn recalc_scope_workstream() {
        // Two workstreams: Eng and Design. Only Eng should be recalculated.
        // A(03-02 Mon..03-09, 5d) -> e2/d2 (slack at 03-25)
        let mut e2 = make_task_with_project("e2", "2026-03-25", "2026-04-01", 5, "Alpha", "Eng");
        e2.dependencies = vec![make_dep("e1", "e2", DepType::FS, 0)];

        let mut d2 = make_task_with_project("d2", "2026-03-25", "2026-04-01", 5, "Alpha", "Design");
        d2.dependencies = vec![make_dep("d1", "d2", DepType::FS, 0)];

        let tasks = vec![
            make_task_with_project("e1", "2026-03-02", "2026-03-09", 5, "Alpha", "Eng"),
            e2,
            make_task_with_project("d1", "2026-03-02", "2026-03-09", 5, "Alpha", "Design"),
            d2,
        ];
        let results = recalculate_earliest(&tasks, None, Some("Eng"), None, "2026-03-02");

        // Only e2 should be moved (d2 is out of scope)
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "e2");
        assert_eq!(results[0].new_start, "2026-03-10");
    }

    #[test]
    fn recalc_scope_task_id() {
        // A -> B -> C. Scope by B: should recalculate B and C (downstream), not A.
        let mut b = make_task("b", "2026-03-25", "2026-04-01", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-04-20", "2026-04-27", 5);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-09", 5), b, c];
        let results = recalculate_earliest(&tasks, None, None, Some("b"), "2026-03-02");

        // B snaps to 03-10, B.end=03-17, C snaps to 03-18, C.end=03-25
        let b_result = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b_result.new_start, "2026-03-10");
        assert_eq!(b_result.new_end, "2026-03-17");

        let c_result = results.iter().find(|r| r.id == "c").unwrap();
        assert_eq!(c_result.new_start, "2026-03-18");
        assert_eq!(c_result.new_end, "2026-03-25");

        // A should not be in results
        assert!(results.iter().all(|r| r.id != "a"));
    }

    #[test]
    fn recalc_no_change_returns_empty() {
        // Task already at earliest position — no results
        // A.end=03-09, B earliest=03-10, B.end=add_biz(03-10,5)=03-17
        let mut b = make_task("b", "2026-03-10", "2026-03-17", 5);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-09", 5), b];
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
        // A: Mon 03-02 to Fri 03-06, duration=4 (consistent with dates).
        // A ends Friday 03-06. B should recalculate to start Monday 03-09.
        // B has duration=5, so end = add_business_days(03-09, 5) = 03-16 (Mon).
        let mut b = make_task("b", "2026-03-20", "2026-03-27", 5); // currently too late
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-02", "2026-03-06", 4), b];
        let results = recalculate_earliest(&tasks, None, None, None, "2026-03-02");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "b");
        assert_eq!(results[0].new_start, "2026-03-09"); // Monday
        assert_eq!(results[0].new_end, "2026-03-16");   // Monday (5 biz days later)
    }
}
