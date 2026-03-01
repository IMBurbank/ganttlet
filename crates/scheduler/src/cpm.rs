use crate::types::{DepType, Task};
use std::collections::{HashMap, HashSet, VecDeque};

/// Parse "YYYY-MM-DD" to days since epoch (simple arithmetic, no chrono).
fn date_to_days(date_str: &str) -> i64 {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return 0;
    }
    let y: i64 = parts[0].parse().unwrap_or(0);
    let m: i64 = parts[1].parse().unwrap_or(1);
    let d: i64 = parts[2].parse().unwrap_or(1);

    // Days from year 0 using a simplified calculation
    let mut y_adj = y;
    let mut m_adj = m;
    if m_adj <= 2 {
        y_adj -= 1;
        m_adj += 12;
    }
    365 * y_adj + y_adj / 4 - y_adj / 100 + y_adj / 400 + (153 * (m_adj - 3) + 2) / 5 + d - 1
}

struct SuccEdge {
    task_id: String,
    lag: i32,
    dep_type: DepType,
}

/// Compute the critical path using CPM. Returns IDs of critical tasks.
pub fn compute_critical_path(tasks: &[Task]) -> Vec<String> {
    let non_summary: Vec<&Task> = tasks.iter().filter(|t| !t.is_summary).collect();
    if non_summary.is_empty() {
        return vec![];
    }

    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    // Find project start (min start date) for day offset calculation
    let project_start = non_summary
        .iter()
        .map(|t| date_to_days(&t.start_date))
        .min()
        .unwrap_or(0);

    let to_days = |date_str: &str| -> i64 { date_to_days(date_str) - project_start };

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
            let dep_type = match dep.dep_type {
                DepType::FS | DepType::SS | DepType::FF => dep.dep_type.clone(),
            };
            *in_degree.entry(&t.id).or_insert(0) += 1;
            successors
                .entry(&dep.from_id)
                .or_default()
                .push(SuccEdge {
                    task_id: t.id.clone(),
                    lag: dep.lag,
                    dep_type,
                });
        }
    }

    // Initialize ES/EF from task dates
    for t in &non_summary {
        let start = to_days(&t.start_date);
        let dur = if t.is_milestone { 0 } else { t.duration as i64 };
        es.insert(&t.id, start);
        ef.insert(&t.id, start + dur);
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

    // Critical tasks have zero float (ES === LS)
    let mut critical_ids = Vec::new();
    for t in &non_summary {
        let task_es = *es.get(t.id.as_str()).unwrap_or(&0);
        let task_ls = *ls.get(t.id.as_str()).unwrap_or(&0);
        let float = task_ls - task_es;
        if float.abs() < 1 {
            critical_ids.push(t.id.clone());
        }
    }

    critical_ids
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
    fn empty_tasks_returns_empty() {
        assert!(compute_critical_path(&[]).is_empty());
    }

    #[test]
    fn only_summary_tasks_returns_empty() {
        let tasks = vec![Task {
            is_summary: true,
            ..make_task("summary", "2026-03-01", "2026-03-10", 9)
        }];
        assert!(compute_critical_path(&tasks).is_empty());
    }

    #[test]
    fn single_task_is_critical() {
        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 9)];
        let critical = compute_critical_path(&tasks);
        assert!(critical.contains(&"a".to_string()));
    }

    #[test]
    fn linear_fs_chain() {
        let mut b = make_task("b", "2026-03-10", "2026-03-19", 9);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];
        let mut c = make_task("c", "2026-03-19", "2026-03-28", 9);
        c.dependencies = vec![make_dep("b", "c", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 9), b, c];
        let critical = compute_critical_path(&tasks);
        assert!(critical.contains(&"a".to_string()));
        assert!(critical.contains(&"b".to_string()));
        assert!(critical.contains(&"c".to_string()));
    }

    #[test]
    fn non_critical_task_with_float() {
        let mut b = make_task("b", "2026-03-11", "2026-03-20", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FS, 0)];

        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-10", 10),
            b,
            make_task("c", "2026-03-01", "2026-03-05", 5),
        ];
        let critical = compute_critical_path(&tasks);
        assert!(critical.contains(&"a".to_string()));
        assert!(critical.contains(&"b".to_string()));
        assert!(!critical.contains(&"c".to_string()));
    }

    #[test]
    fn ss_dependency() {
        let mut b = make_task("b", "2026-03-06", "2026-03-15", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::SS, 5)];

        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 10), b];
        let critical = compute_critical_path(&tasks);
        assert!(critical.contains(&"a".to_string()));
        assert!(critical.contains(&"b".to_string()));
    }

    #[test]
    fn ff_dependency() {
        let mut b = make_task("b", "2026-03-01", "2026-03-10", 10);
        b.dependencies = vec![make_dep("a", "b", DepType::FF, 0)];

        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 10), b];
        let critical = compute_critical_path(&tasks);
        assert!(critical.contains(&"a".to_string()));
        assert!(critical.contains(&"b".to_string()));
    }

    #[test]
    fn milestone_on_critical_path() {
        let mut ms = make_task("ms", "2026-03-10", "2026-03-10", 0);
        ms.is_milestone = true;
        ms.dependencies = vec![make_dep("a", "ms", DepType::FS, 0)];

        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10", 10), ms];
        let critical = compute_critical_path(&tasks);
        assert!(critical.contains(&"a".to_string()));
        assert!(critical.contains(&"ms".to_string()));
    }

    #[test]
    fn excludes_summary_tasks() {
        let tasks = vec![
            Task {
                is_summary: true,
                ..make_task("summary", "2026-03-01", "2026-03-10", 10)
            },
            make_task("a", "2026-03-01", "2026-03-10", 10),
        ];
        let critical = compute_critical_path(&tasks);
        assert!(!critical.contains(&"summary".to_string()));
        assert!(critical.contains(&"a".to_string()));
    }
}
