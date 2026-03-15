//! Task dependency graph utilities.
//!
//! `would_create_cycle` uses BFS reachability to check whether adding a
//! dependency edge would introduce a cycle in the task graph. This is called
//! before inserting any new dependency to maintain a DAG invariant.

use crate::date_utils::is_weekend_date;
use crate::types::Task;
use std::collections::HashSet;

/// Check if adding a dependency from predecessor_id -> successor_id
/// would create a cycle. We walk forward from successor_id and see
/// if predecessor_id is reachable.
pub fn would_create_cycle(tasks: &[Task], successor_id: &str, predecessor_id: &str) -> bool {
    let mut visited = HashSet::new();
    let mut queue = vec![successor_id.to_string()];

    while let Some(current) = queue.pop() {
        if current == predecessor_id {
            return true;
        }
        if visited.contains(&current) {
            continue;
        }
        visited.insert(current.clone());

        // Find all tasks that depend on `current` (current is a predecessor)
        for task in tasks {
            for dep in &task.dependencies {
                if dep.from_id == current {
                    queue.push(task.id.clone());
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{DepType, Dependency};

    fn make_task(id: &str) -> Task {
        let start = "2026-03-02";
        let end = "2026-03-10";
        debug_assert!(
            !is_weekend_date(start),
            "make_task start is weekend: {start}"
        );
        debug_assert!(!is_weekend_date(end), "make_task end is weekend: {end}");
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
    fn non_cyclic_dependency() {
        let tasks = vec![
            make_task("a"),
            {
                let mut t = make_task("b");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
            make_task("c"),
        ];
        // Adding c -> a should not create cycle
        assert!(!would_create_cycle(&tasks, "a", "c"));
    }

    #[test]
    fn direct_cycle() {
        let tasks = vec![make_task("a"), {
            let mut t = make_task("b");
            t.dependencies = vec![make_dep("a", "b")];
            t
        }];
        // Adding b -> a would create cycle: a->b->a
        assert!(would_create_cycle(&tasks, "a", "b"));
    }

    #[test]
    fn sf_cycle_detected() {
        // A→(SF)→B→(FS)→A should be detected as a cycle
        let tasks = vec![make_task("a"), {
            let mut t = make_task("b");
            t.dependencies = vec![Dependency {
                from_id: "a".to_string(),
                to_id: "b".to_string(),
                dep_type: DepType::SF,
                lag: 0,
            }];
            t
        }];
        // Adding B→A (FS) would create: A→(SF)→B→(FS)→A
        assert!(would_create_cycle(&tasks, "a", "b"));
    }

    #[test]
    fn transitive_cycle() {
        let tasks = vec![
            make_task("a"),
            {
                let mut t = make_task("b");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
            {
                let mut t = make_task("c");
                t.dependencies = vec![make_dep("b", "c")];
                t
            },
        ];
        // Adding c -> a would create cycle: a->b->c->a
        assert!(would_create_cycle(&tasks, "a", "c"));
    }
}
