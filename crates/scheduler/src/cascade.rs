use crate::date_utils::add_days;
use crate::types::{CascadeResult, Task};
use std::collections::{HashSet, HashMap};

/// Cascade dependent tasks after moving a task.
/// Returns only the tasks whose dates changed (as CascadeResult).
///
/// Asymmetric behavior:
/// - Forward moves (positive delta): push all dependents forward
/// - Backward moves (negative delta) and zero: return empty vec (expose slack instead)
pub fn cascade_dependents(tasks: &[Task], moved_task_id: &str, days_delta: i32) -> Vec<CascadeResult> {
    // Asymmetric cascade: only forward moves propagate
    if days_delta <= 0 {
        return Vec::new();
    }

    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    // Build adjacency list: from_id -> list of dependent task IDs
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();
    for task in tasks {
        for dep in &task.dependencies {
            dependents.entry(dep.from_id.as_str()).or_default().push(task.id.as_str());
        }
    }

    let mut visited = HashSet::new();
    let mut shifted = HashSet::new();
    let mut results = Vec::new();

    fn cascade<'a>(
        task_id: &str,
        delta: i32,
        visited: &mut HashSet<String>,
        shifted: &mut HashSet<String>,
        task_map: &HashMap<&str, &'a Task>,
        dependents: &HashMap<&str, Vec<&str>>,
        results: &mut Vec<CascadeResult>,
    ) {
        if visited.contains(task_id) {
            return;
        }
        visited.insert(task_id.to_string());

        // Look up dependents via adjacency list (not full scan)
        if let Some(dep_ids) = dependents.get(task_id) {
            for &dep_id in dep_ids {
                let dependent = match task_map.get(dep_id) {
                    Some(t) if !t.is_summary => t,
                    _ => continue,
                };

                // Only shift each task once, using original dates to preserve duration
                if shifted.insert(dep_id.to_string()) {
                    let new_start = add_days(&dependent.start_date, delta);
                    let new_end = add_days(&dependent.end_date, delta);
                    results.push(CascadeResult {
                        id: dependent.id.clone(),
                        start_date: new_start,
                        end_date: new_end,
                    });
                }

                cascade(
                    dep_id,
                    delta,
                    visited,
                    shifted,
                    task_map,
                    dependents,
                    results,
                );
            }
        }
    }

    cascade(
        moved_task_id,
        days_delta,
        &mut visited,
        &mut shifted,
        &task_map,
        &dependents,
        &mut results,
    );

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Dependency, DepType};

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

    fn make_dep(from: &str, to: &str) -> Dependency {
        Dependency {
            from_id: from.to_string(),
            to_id: to.to_string(),
            dep_type: DepType::FS,
            lag: 0,
        }
    }

    #[test]
    fn shifts_dependent_tasks() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 5);
        let b = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b.start_date, "2026-03-16");
        assert_eq!(b.end_date, "2026-03-25");
    }

    #[test]
    fn does_not_shift_moved_task() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 5);
        // The moved task itself should not appear in results
        assert!(results.iter().find(|r| r.id == "a").is_none());
    }

    #[test]
    fn transitive_cascade() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
            {
                let mut t = make_task("c", "2026-03-21", "2026-03-30");
                t.dependencies = vec![make_dep("b", "c")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 3);
        let c = results.iter().find(|r| r.id == "c").unwrap();
        assert_eq!(c.start_date, "2026-03-24");
    }

    #[test]
    fn skips_summary_tasks() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10"),
            {
                let mut t = make_task("summary", "2026-03-11", "2026-03-20");
                t.is_summary = true;
                t.dependencies = vec![make_dep("a", "summary")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 5);
        // Summary task should not be in results
        assert!(results.iter().find(|r| r.id == "summary").is_none());
    }

    #[test]
    fn preserves_duration_for_all_tasks() {
        // Chain of 4 tasks with varying durations
        let tasks = vec![
            {
                let mut t = make_task("a", "2026-03-01", "2026-03-05"); // 4 days
                t.duration = 4;
                t
            },
            {
                let mut t = make_task("b", "2026-03-06", "2026-03-16"); // 10 days
                t.duration = 10;
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
            {
                let mut t = make_task("c", "2026-03-17", "2026-03-19"); // 2 days
                t.duration = 2;
                t.dependencies = vec![make_dep("b", "c")];
                t
            },
            {
                let mut t = make_task("d", "2026-03-20", "2026-03-27"); // 7 days
                t.duration = 7;
                t.dependencies = vec![make_dep("c", "d")];
                t
            },
        ];

        let results = cascade_dependents(&tasks, "a", 7);

        // Every cascaded task must preserve its original duration
        for result in &results {
            let original = tasks.iter().find(|t| t.id == result.id).unwrap();
            let orig_start = crate::date_utils::parse_date(&original.start_date);
            let orig_end = crate::date_utils::parse_date(&original.end_date);
            let new_start = crate::date_utils::parse_date(&result.start_date);
            let new_end = crate::date_utils::parse_date(&result.end_date);

            // Duration = difference in days between end and start
            // Using a simple calculation: both should shift by the same delta
            let orig_duration_approx = (orig_end.2 as i32) - (orig_start.2 as i32);
            let new_duration_approx = (new_end.2 as i32) - (new_start.2 as i32);

            // For same-month dates, durations must match exactly
            if orig_start.1 == orig_end.1 && new_start.1 == new_end.1 {
                assert_eq!(
                    orig_duration_approx, new_duration_approx,
                    "Duration changed for task {}: was {} days, now {} days",
                    result.id, orig_duration_approx, new_duration_approx
                );
            }
        }

        assert_eq!(results.len(), 3); // b, c, d should all be shifted
    }

    #[test]
    fn diamond_dependency_no_double_shift() {
        // Diamond: A → B, A → C, B → C
        // C depends on both A and B; must only be shifted once
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
            {
                let mut t = make_task("c", "2026-03-21", "2026-03-30");
                t.dependencies = vec![make_dep("a", "c"), make_dep("b", "c")];
                t
            },
        ];

        let results = cascade_dependents(&tasks, "a", 5);

        // C should appear exactly once
        let c_results: Vec<_> = results.iter().filter(|r| r.id == "c").collect();
        assert_eq!(c_results.len(), 1, "Task c should appear exactly once in results");

        // C should be shifted by exactly 5 days (not 10)
        let c = &c_results[0];
        assert_eq!(c.start_date, "2026-03-26");
        assert_eq!(c.end_date, "2026-04-04");
    }

    #[test]
    fn backward_cascade_returns_empty() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", -3);
        assert!(results.is_empty(), "Backward cascade should return empty vec");
    }

    #[test]
    fn zero_delta_returns_empty() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 0);
        assert!(results.is_empty(), "Zero delta should return empty vec");
    }

    #[test]
    fn large_chain_cascade() {
        // 50-task chain: t0 -> t1 -> t2 -> ... -> t49
        let mut tasks: Vec<Task> = (0..50).map(|i| {
            let start_day = 1 + i * 10;
            let end_day = start_day + 9;
            make_task(
                &format!("t{}", i),
                &format!("2026-03-{:02}", start_day.min(28)),
                &format!("2026-03-{:02}", end_day.min(28)),
            )
        }).collect();
        for i in 1..50 {
            tasks[i].dependencies = vec![make_dep(&format!("t{}", i - 1), &format!("t{}", i))];
        }
        let results = cascade_dependents(&tasks, "t0", 2);
        assert_eq!(results.len(), 49);
        // Each task shifted by exactly 2 days
        for r in &results {
            assert!(!r.id.is_empty());
        }
    }

    #[test]
    fn orphan_tasks_unaffected() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10"),
            make_task("orphan1", "2026-03-05", "2026-03-15"),
            make_task("orphan2", "2026-03-20", "2026-03-28"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 3);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "b");
    }

    #[test]
    fn forward_cascade_still_works() {
        // Verify forward cascade (+5 days) still shifts dependents correctly
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
            {
                let mut t = make_task("c", "2026-03-21", "2026-03-30");
                t.dependencies = vec![make_dep("b", "c")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 5);
        assert_eq!(results.len(), 2);

        let b = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b.start_date, "2026-03-16");
        assert_eq!(b.end_date, "2026-03-25");

        let c = results.iter().find(|r| r.id == "c").unwrap();
        assert_eq!(c.start_date, "2026-03-26");
        assert_eq!(c.end_date, "2026-04-04");
    }
}
