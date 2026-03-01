use crate::date_utils::add_days;
use crate::types::{DepType, Task};
use std::collections::HashMap;

/// Compute the earliest possible start date for a task given its dependencies.
/// Returns None if the task has no dependencies (unconstrained).
pub fn compute_earliest_start(tasks: &[Task], task_id: &str) -> Option<String> {
    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    let task = task_map.get(task_id)?;

    if task.dependencies.is_empty() {
        return None;
    }

    let mut latest: Option<String> = None;

    for dep in &task.dependencies {
        let pred = match task_map.get(dep.from_id.as_str()) {
            Some(p) => p,
            None => continue,
        };

        let earliest = match dep.dep_type {
            DepType::FS => {
                // Start after predecessor finishes: end_date + lag + 1 day
                add_days(&pred.end_date, dep.lag + 1)
            }
            DepType::SS => {
                // Start when predecessor starts + lag
                add_days(&pred.start_date, dep.lag)
            }
            DepType::FF => {
                // Finish together: predecessor end_date + lag - task duration + 1 day
                add_days(&pred.end_date, dep.lag - task.duration + 1)
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

    latest
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
}
