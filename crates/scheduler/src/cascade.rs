use crate::date_utils::add_business_days;
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

                // Only shift each task once, using business days to preserve duration
                // and avoid landing on weekends
                if shifted.insert(dep_id.to_string()) {
                    let new_start = add_business_days(&dependent.start_date, delta);
                    let new_end = add_business_days(&dependent.end_date, delta);
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
    use crate::date_utils::add_days;
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
        // Delta is now in business days. B: Wed 03-11 +5 biz = Wed 03-18, Fri 03-20 +5 biz = Fri 03-27
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
        assert_eq!(b.start_date, "2026-03-18");
        assert_eq!(b.end_date, "2026-03-27");
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
        // Delta=3 business days. C: Sat 03-21 +3 biz = Wed 03-25
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
        assert_eq!(c.start_date, "2026-03-25");
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
        // With business-day cascade, both start and end shift by the same number
        // of business days, so business-day duration is preserved.
        let tasks = vec![
            {
                let mut t = make_task("a", "2026-03-01", "2026-03-05");
                t.duration = 4;
                t
            },
            {
                let mut t = make_task("b", "2026-03-06", "2026-03-16");
                t.duration = 10;
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
            {
                let mut t = make_task("c", "2026-03-17", "2026-03-19");
                t.duration = 2;
                t.dependencies = vec![make_dep("b", "c")];
                t
            },
            {
                let mut t = make_task("d", "2026-03-20", "2026-03-27");
                t.duration = 7;
                t.dependencies = vec![make_dep("c", "d")];
                t
            },
        ];

        let results = cascade_dependents(&tasks, "a", 7);

        // Every cascaded task must be shifted by exactly 7 business days
        for result in &results {
            let original = tasks.iter().find(|t| t.id == result.id).unwrap();
            assert_eq!(
                result.start_date,
                add_business_days(&original.start_date, 7),
                "Task {} start not shifted by 7 biz days", result.id
            );
            assert_eq!(
                result.end_date,
                add_business_days(&original.end_date, 7),
                "Task {} end not shifted by 7 biz days", result.id
            );
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

        // C should be shifted by exactly 5 business days (not 10)
        let c = &c_results[0];
        assert_eq!(c.start_date, "2026-03-27"); // Sat 03-21 +5 biz = Fri 03-27
        assert_eq!(c.end_date, "2026-04-06");   // Mon 03-30 +5 biz = Mon 04-06
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
        // Use month boundaries to avoid date clamping issues
        let mut tasks: Vec<Task> = (0..50).map(|i| {
            make_task(
                &format!("t{}", i),
                &add_days("2026-01-01", (i * 5) as i32),
                &add_days("2026-01-01", (i * 5 + 4) as i32),
            )
        }).collect();
        for i in 1..50 {
            tasks[i].dependencies = vec![make_dep(&format!("t{}", i - 1), &format!("t{}", i))];
        }
        let results = cascade_dependents(&tasks, "t0", 2);
        assert_eq!(results.len(), 49);
        // Moved task itself must not appear in results
        assert!(results.iter().all(|r| r.id != "t0"), "Moved task t0 should not be in results");
        // Verify every result was shifted by exactly +2 business days
        for r in &results {
            let orig = tasks.iter().find(|t| t.id == r.id).unwrap();
            assert_eq!(r.start_date, add_business_days(&orig.start_date, 2), "Task {} start not shifted +2 biz", r.id);
            assert_eq!(r.end_date, add_business_days(&orig.end_date, 2), "Task {} end not shifted +2 biz", r.id);
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
        // B: Wed 03-11 +3 biz = Mon 03-16, Fri 03-20 +3 biz = Wed 03-25
        assert_eq!(results[0].start_date, "2026-03-16");
        assert_eq!(results[0].end_date, "2026-03-25");
    }

    #[test]
    fn forward_cascade_still_works() {
        // Verify forward cascade (+5 business days) shifts dependents correctly.
        // Delta is now in business days (not calendar days).
        // B: Wed 03-11 + 5 biz = Wed 03-18, Fri 03-20 + 5 biz = Fri 03-27
        // C: Sat 03-21 + 5 biz = Fri 03-27, Mon 03-30 + 5 biz = Mon 04-06
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
        assert_eq!(b.start_date, "2026-03-18");
        assert_eq!(b.end_date, "2026-03-27");

        let c = results.iter().find(|r| r.id == "c").unwrap();
        assert_eq!(c.start_date, "2026-03-27");
        assert_eq!(c.end_date, "2026-04-06");
    }

    // ── Weekend-aware cascade tests ──────────────────────────────────────

    #[test]
    fn cascade_across_weekend_preserves_duration() {
        // B starts Mon 2026-03-09, ends Fri 2026-03-13 (5 biz days).
        // Move A forward by 1 calendar day (Thu->Fri). Cascade should shift B
        // by 1 business day: Mon 03-09 -> Tue 03-10, Fri 03-13 -> Mon 03-16.
        // Bug: add_days shifts to Tue 03-10 / Sat 03-14, changing duration.
        let tasks = vec![
            make_task("a", "2026-03-05", "2026-03-06"), // Thu-Fri
            {
                let t = Task {
                    id: "b".to_string(),
                    start_date: "2026-03-09".to_string(), // Mon
                    end_date: "2026-03-13".to_string(),   // Fri (5 biz days)
                    duration: 5,
                    is_milestone: false,
                    is_summary: false,
                    dependencies: vec![make_dep("a", "b")],
                    project: String::new(),
                    work_stream: String::new(),
                    constraint_type: None,
                    constraint_date: None,
                };
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 1);
        assert_eq!(results.len(), 1);
        let b = &results[0];
        assert_eq!(b.start_date, "2026-03-10"); // Tue
        assert_eq!(b.end_date, "2026-03-16");   // Mon (not Sat 03-14!)
    }

    #[test]
    fn cascade_does_not_land_on_weekend() {
        // B starts Fri 2026-03-06, ends Fri 2026-03-13 (6 biz days).
        // Cascade +1 should give Mon 2026-03-09 start (not Sat 03-07).
        let tasks = vec![
            make_task("a", "2026-03-02", "2026-03-06"),
            {
                let t = Task {
                    id: "b".to_string(),
                    start_date: "2026-03-06".to_string(), // Fri
                    end_date: "2026-03-13".to_string(),   // Fri
                    duration: 6,
                    is_milestone: false,
                    is_summary: false,
                    dependencies: vec![make_dep("a", "b")],
                    project: String::new(),
                    work_stream: String::new(),
                    constraint_type: None,
                    constraint_date: None,
                };
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 1);
        assert_eq!(results.len(), 1);
        let b = &results[0];
        // Start should skip weekend: Fri+1 biz day = Mon
        assert_eq!(b.start_date, "2026-03-09"); // Mon, not Sat
        // End should also be a weekday, preserving duration
        assert_eq!(b.end_date, "2026-03-16");   // Mon
    }
}
