use crate::types::{CascadeResult, Task};
use std::collections::{HashMap, HashSet};

/// Parse "YYYY-MM-DD" to a (year, month, day) tuple.
fn parse_date(s: &str) -> (i32, u32, u32) {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 {
        return (2026, 1, 1);
    }
    let y: i32 = parts[0].parse().unwrap_or(2026);
    let m: u32 = parts[1].parse().unwrap_or(1);
    let d: u32 = parts[2].parse().unwrap_or(1);
    (y, m, d)
}

/// Days in each month (non-leap).
const DAYS_IN_MONTH: [u32; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

fn is_leap_year(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i32, m: u32) -> u32 {
    if m == 2 && is_leap_year(y) { 29 } else { DAYS_IN_MONTH[(m - 1) as usize] }
}

/// Format (year, month, day) as "YYYY-MM-DD".
fn format_date(y: i32, m: u32, d: u32) -> String {
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Add `delta` days to a date string, returning a new date string.
fn add_days(date_str: &str, delta: i32) -> String {
    let (mut y, mut m, mut d) = parse_date(date_str);
    let mut remaining = delta;

    if remaining >= 0 {
        while remaining > 0 {
            let dim = days_in_month(y, m);
            let left_in_month = dim - d;
            if remaining as u32 <= left_in_month {
                d += remaining as u32;
                remaining = 0;
            } else {
                remaining -= (left_in_month + 1) as i32;
                m += 1;
                d = 1;
                if m > 12 {
                    m = 1;
                    y += 1;
                }
            }
        }
    } else {
        remaining = -remaining;
        while remaining > 0 {
            if remaining as u32 <= d - 1 {
                d -= remaining as u32;
                remaining = 0;
            } else {
                remaining -= d as i32;
                m -= 1;
                if m < 1 {
                    m = 12;
                    y -= 1;
                }
                d = days_in_month(y, m);
            }
        }
    }

    format_date(y, m, d)
}

/// Cascade dependent tasks after moving a task.
/// Returns only the tasks whose dates changed (as CascadeResult).
pub fn cascade_dependents(tasks: &[Task], moved_task_id: &str, days_delta: i32) -> Vec<CascadeResult> {
    // Clone task data into a mutable map
    let mut task_dates: HashMap<String, (String, String)> = tasks
        .iter()
        .map(|t| (t.id.clone(), (t.start_date.clone(), t.end_date.clone())))
        .collect();
    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    let mut visited = HashSet::new();
    let mut results = Vec::new();

    fn cascade(
        task_id: &str,
        delta: i32,
        visited: &mut HashSet<String>,
        task_dates: &mut HashMap<String, (String, String)>,
        task_map: &HashMap<&str, &Task>,
        tasks: &[Task],
        results: &mut Vec<CascadeResult>,
    ) {
        if visited.contains(task_id) {
            return;
        }
        visited.insert(task_id.to_string());

        // Find all tasks that depend on this task
        for task in tasks {
            for dep in &task.dependencies {
                if dep.from_id == task_id {
                    let dependent = match task_map.get(task.id.as_str()) {
                        Some(t) if !t.is_summary => t,
                        _ => continue,
                    };

                    if let Some(dates) = task_dates.get_mut(&task.id) {
                        dates.0 = add_days(&dates.0, delta);
                        dates.1 = add_days(&dates.1, delta);
                        results.push(CascadeResult {
                            id: dependent.id.clone(),
                            start_date: dates.0.clone(),
                            end_date: dates.1.clone(),
                        });
                    }

                    cascade(
                        &task.id,
                        delta,
                        visited,
                        task_dates,
                        task_map,
                        tasks,
                        results,
                    );
                }
            }
        }
    }

    cascade(
        moved_task_id,
        days_delta,
        &mut visited,
        &mut task_dates,
        &task_map,
        tasks,
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
}
