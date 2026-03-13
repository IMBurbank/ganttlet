use crate::date_utils::{
    add_business_days, count_biz_days_to, fs_successor_start, next_biz_day_on_or_after,
};
use crate::types::{CascadeResult, DepType, Dependency, Task};
use std::collections::{HashMap, HashSet, VecDeque};

/// Cascade dependent tasks after moving a task.
/// Returns only the tasks whose dates changed (as CascadeResult).
///
/// The `tasks` slice must contain the moved task's **new** dates (the caller
/// is responsible for updating the moved task's dates before calling this
/// function — consistent with how ganttReducer.ts calls cascadeDependents).
///
/// Asymmetric behavior:
/// - Forward moves (positive delta): cascade only dependents that would
///   violate their dependency constraint, shifting each by the minimum
///   amount needed to satisfy the constraint.
/// - Backward moves (negative delta) and zero: return empty vec (expose
///   slack instead).
///
/// Slack is respected: if sufficient slack exists between predecessor and
/// successor, no cascade occurs even when the predecessor moves later.
pub fn cascade_dependents(
    tasks: &[Task],
    moved_task_id: &str,
    days_delta: i32,
) -> Vec<CascadeResult> {
    // Asymmetric cascade: only forward moves propagate
    if days_delta <= 0 {
        return Vec::new();
    }

    let task_map: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    // Build adjacency: predecessor_id → Vec<(dependent_id, &Dependency)>
    let mut succ_map: HashMap<&str, Vec<(&str, &Dependency)>> = HashMap::new();
    for task in tasks {
        for dep in &task.dependencies {
            succ_map
                .entry(dep.from_id.as_str())
                .or_default()
                .push((task.id.as_str(), dep));
        }
    }

    // Track effective dates for tasks that have been shifted during this cascade.
    // The moved task's new dates are already in task_map.
    let mut eff_start: HashMap<String, String> = HashMap::new();
    let mut eff_end: HashMap<String, String> = HashMap::new();
    let mut results: HashMap<String, CascadeResult> = HashMap::new();

    // BFS from the moved task. Process each predecessor and check its
    // dependents for constraint violations.
    let mut queue: VecDeque<&str> = VecDeque::new();
    let mut processed: HashSet<&str> = HashSet::new();

    queue.push_back(moved_task_id);

    while let Some(pred_id) = queue.pop_front() {
        if processed.contains(pred_id) {
            continue;
        }
        processed.insert(pred_id);

        // Predecessor's effective dates (from task_map for moved task, or
        // from eff_* maps if this task was itself cascaded earlier).
        let pred_eff_start = eff_start
            .get(pred_id)
            .cloned()
            .unwrap_or_else(|| task_map[pred_id].start_date.clone());
        let pred_eff_end = eff_end
            .get(pred_id)
            .cloned()
            .unwrap_or_else(|| task_map[pred_id].end_date.clone());

        if let Some(deps) = succ_map.get(pred_id) {
            for &(dep_id, dep_link) in deps {
                let dependent = match task_map.get(dep_id) {
                    Some(t) if !t.is_summary => t,
                    _ => continue,
                };

                // Current effective dates of the dependent (may have been
                // shifted by an earlier path through a diamond dependency).
                let dep_curr_start = eff_start
                    .get(dep_id)
                    .cloned()
                    .unwrap_or_else(|| dependent.start_date.clone());
                let dep_curr_end = eff_end
                    .get(dep_id)
                    .cloned()
                    .unwrap_or_else(|| dependent.end_date.clone());

                // Compute the required start/end dates based on dep type.
                // Only cascade if the dependent's current dates would violate
                // the constraint.
                let (new_start, new_end) = match dep_link.dep_type {
                    DepType::FS => {
                        // B must start no earlier than the first business day after
                        // pred.end (inclusive), plus lag business days.
                        let required = fs_successor_start(&pred_eff_end, dep_link.lag);
                        if required <= dep_curr_start {
                            // Constraint still satisfied — slack absorbs the move.
                            continue;
                        }
                        let shift = count_biz_days_to(&dep_curr_start, &required);
                        let new_end = add_business_days(&dep_curr_end, shift);
                        (required, new_end)
                    }
                    DepType::SS => {
                        // B must start no earlier than the first business day on or after
                        // (pred.start + lag business days).
                        let raw = add_business_days(&pred_eff_start, dep_link.lag);
                        let required = next_biz_day_on_or_after(&raw);
                        if required <= dep_curr_start {
                            continue;
                        }
                        let shift = count_biz_days_to(&dep_curr_start, &required);
                        let new_end = add_business_days(&dep_curr_end, shift);
                        (required, new_end)
                    }
                    DepType::FF => {
                        // B must end no earlier than the first business day on or after
                        // (pred.end + lag business days).
                        let raw_end = add_business_days(&pred_eff_end, dep_link.lag);
                        let required_end = next_biz_day_on_or_after(&raw_end);
                        if required_end <= dep_curr_end {
                            continue;
                        }
                        let shift = count_biz_days_to(&dep_curr_end, &required_end);
                        let new_start = add_business_days(&dep_curr_start, shift);
                        (new_start, required_end)
                    }
                    DepType::SF => {
                        // SF: successor's end must be no earlier than the first business day
                        // on or after (pred.start + lag business days).
                        let raw_end = add_business_days(&pred_eff_start, dep_link.lag);
                        let required_end = next_biz_day_on_or_after(&raw_end);
                        if required_end <= dep_curr_end {
                            continue;
                        }
                        let shift = count_biz_days_to(&dep_curr_end, &required_end);
                        let new_start = add_business_days(&dep_curr_start, shift);
                        (new_start, required_end)
                    }
                };

                // Update effective dates only if this path requires a larger
                // shift than a previous path (diamond dependency support).
                let needs_update = new_start > dep_curr_start
                    || (matches!(dep_link.dep_type, DepType::FF | DepType::SF)
                        && new_end > dep_curr_end);

                if needs_update {
                    eff_start.insert(dep_id.to_string(), new_start.clone());
                    eff_end.insert(dep_id.to_string(), new_end.clone());
                    results.insert(
                        dep_id.to_string(),
                        CascadeResult {
                            id: dep_id.to_string(),
                            start_date: new_start,
                            end_date: new_end,
                        },
                    );
                    // Allow re-processing this node's successors with updated dates.
                    processed.remove(dep_id);
                    queue.push_back(dep_id);
                }
            }
        }
    }

    results.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::date_utils::add_business_days;
    use crate::types::Dependency;

    // Helper: task with given id/start/end and default duration=7.
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

    fn make_dep_with_lag(from: &str, to: &str, lag: i32) -> Dependency {
        Dependency {
            from_id: from.to_string(),
            to_id: to.to_string(),
            dep_type: DepType::FS,
            lag,
        }
    }

    // ── Core cascade behavior ─────────────────────────────────────────────

    /// When a task moves forward and the dependent would violate FS lag=0,
    /// it cascades by the minimum amount to satisfy the constraint.
    ///
    /// Setup: A ends Tue Mar 17 (inclusive). B starts Wed Mar 11 (FS lag=0).
    /// Required B.start = fs_successor_start(A.end, 0) = add_biz(Mar 17, 1) = Wed Mar 18.
    /// B.start = Mar 11 < Mar 18 → violation.
    /// B shifts by count_biz(Mar 11 → Mar 18) = 5 biz days → starts Wed Mar 18.
    #[test]
    fn shifts_dependent_on_violation() {
        let tasks = vec![
            // A already at new position (moved task; caller updates first)
            make_task("a", "2026-03-01", "2026-03-17"), // moved +5 biz from Mar 10
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 5);
        let b = results.iter().find(|r| r.id == "b").unwrap();
        // B shifts to satisfy constraint: start = fs_successor_start(Mar 17, 0) = Wed Mar 18
        assert_eq!(b.start_date, "2026-03-18");
        // Duration preserved: Mar 20 + 5 biz days = Mar 27 (Fri)
        assert_eq!(b.end_date, "2026-03-27");
    }

    #[test]
    fn does_not_shift_moved_task() {
        let tasks = vec![make_task("a", "2026-03-01", "2026-03-17"), {
            let mut t = make_task("b", "2026-03-11", "2026-03-20");
            t.dependencies = vec![make_dep("a", "b")];
            t
        }];
        let results = cascade_dependents(&tasks, "a", 5);
        // The moved task itself should not appear in results
        assert!(results.iter().all(|r| r.id != "a"));
    }

    #[test]
    fn transitive_cascade() {
        // A → B → C. A moves +3 biz.
        // A.new_end = Mar 13 (Fri, inclusive).
        // B (starts Mar 11): required = fs_successor_start(Mar 13, 0) = add_biz(Mar 13, 1) = Mar 16 (Mon).
        //   shift = count_biz(Mar 11 → Mar 16) = 3. B.new_start = Mar 16, B.new_end = add_biz(Mar 20, 3) = Mar 25.
        // C (starts Mar 21=Sat): required = fs_successor_start(Mar 25, 0) = Mar 26 (Thu).
        //   count_biz(Mar 21 → Mar 26) = 4. C.new_start = add_biz(Mar 21, 4) = Mar 26 (Thu).
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-13"), // moved +3 biz from Mar 10
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
        assert_eq!(c.start_date, "2026-03-26");
    }

    #[test]
    fn skips_summary_tasks() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-17"), // moved
            {
                let mut t = make_task("summary", "2026-03-11", "2026-03-20");
                t.is_summary = true;
                t.dependencies = vec![make_dep("a", "summary")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 5);
        // Summary task should not be in results
        assert!(results.iter().all(|r| r.id != "summary"));
    }

    #[test]
    fn preserves_duration_on_violation() {
        // Each task has a known duration. After cascade, business-day duration
        // must be identical to before.
        //
        // A: start Mar 01, end Mar 05 (Fri), duration 4 biz. Moves +7 biz.
        // A.new_end = add_biz(Mar 05, 7) = Tue Mar 17.
        // B (starts Mar 06 Fri): required = Mar 17 > Mar 06 → violation.
        //   shift_B = count_biz(Mar 06 → Mar 17) = 7.
        //   B.new_start = Mar 17, B.new_end = add_biz(Mar 16, 7) = Wed Mar 25.
        // C (starts Mar 17 Tue): required = add_biz(Mar 25, 0) = Mar 25.
        //   Mar 17 < Mar 25 → violation, shift_C = count_biz(Mar 17 → Mar 25) = 6.
        //   C.new_start = Mar 25, C.new_end = add_biz(Mar 19, 6) = Mon Apr 01.
        // D (starts Mar 20 Fri): required = add_biz(Apr 01, 0) = Apr 01.
        //   Mar 20 < Apr 01 → violation, shift_D = count_biz(Mar 20 → Apr 01) = 9.
        //   D.new_start = Apr 01, D.new_end = add_biz(Mar 27, 9) = Fri Apr 10.
        let tasks = vec![
            {
                let mut t = make_task("a", "2026-03-01", "2026-03-17"); // moved +7 biz from Mar 05
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

        // Every cascaded task must preserve its business-day duration.
        for result in &results {
            let original = tasks.iter().find(|t| t.id == result.id).unwrap();
            let orig_dur = count_biz_days_to(&original.start_date, &original.end_date);
            let new_dur = count_biz_days_to(&result.start_date, &result.end_date);
            assert_eq!(
                new_dur, orig_dur,
                "Task {} duration changed: {} → {}",
                result.id, orig_dur, new_dur
            );
        }

        // All three dependents must be cascaded (all have violations)
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn diamond_dependency_no_double_shift() {
        // Diamond: A → B, A → C (from A), B → C.
        // C depends on both A and B; must only be shifted once, by the max needed.
        //
        // A.new_end = Mar 17 (Tue, inclusive).
        // B (starts Mar 11): required = fs_successor_start(Mar 17, 0) = Mar 18 (Wed). shift=5.
        //   B.new_start = Mar 18, B.new_end = add_biz(Mar 20, 5) = Mar 27 (Fri).
        // C (starts Mar 21 Sat): check A→C: required = Mar 18 <= Mar 21 → no violation (slack).
        //   Check B→C (with B.new_end=Mar 27): required = fs_successor_start(Mar 27, 0) = Mar 30 (Mon).
        //   count_biz(Mar 21 → Mar 30) = 6. C.new_start = add_biz(Mar 21, 6) = Mar 30 (Mon).
        //   C.new_end = add_biz(Mar 30, 6) = Apr 07 (Tue).
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-17"), // moved +5 biz from Mar 10
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
        assert_eq!(c_results.len(), 1, "Task c should appear exactly once");

        let c = &c_results[0];
        assert_eq!(c.start_date, "2026-03-30");
        assert_eq!(c.end_date, "2026-04-07");
    }

    #[test]
    fn backward_cascade_returns_empty() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-07"), // moved backward
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", -3);
        assert!(
            results.is_empty(),
            "Backward cascade should return empty vec"
        );
    }

    #[test]
    fn zero_delta_returns_empty() {
        let tasks = vec![make_task("a", "2026-03-01", "2026-03-10"), {
            let mut t = make_task("b", "2026-03-11", "2026-03-20");
            t.dependencies = vec![make_dep("a", "b")];
            t
        }];
        let results = cascade_dependents(&tasks, "a", 0);
        assert!(results.is_empty(), "Zero delta should return empty vec");
    }

    #[test]
    fn large_chain_cascade() {
        // Chain: t0 → t1 → ... → t49. t0 moves +2 biz.
        // Tasks are tightly linked: t_i.start = t_{i-1}.end (same day).
        // With FS lag=0, required t_i.start = t_{i-1}.end = t_i.start → zero slack.
        // When t0 moves +2 biz, t1 violates (starts before t0's new end),
        // cascades by 2, which causes t2 to violate, etc. All 49 cascade.
        let mut start = "2026-01-05".to_string(); // Mon Jan 5
        let mut tasks: Vec<Task> = Vec::with_capacity(50);
        for i in 0..50usize {
            let end = add_business_days(&start, 4); // 4 biz days later
            let t = make_task(&format!("t{}", i), &start, &end);
            // Next task starts on the same day this one ends (zero slack)
            start = end;
            tasks.push(t);
        }
        for i in 1..50usize {
            tasks[i].dependencies = vec![make_dep(&format!("t{}", i - 1), &format!("t{}", i))];
        }

        // Move t0 forward by +2 biz: update its end date in-place
        let new_t0_end = add_business_days(&tasks[0].end_date, 2);
        tasks[0].end_date = new_t0_end;

        let results = cascade_dependents(&tasks, "t0", 2);
        // All 49 dependents have violations (zero slack in tight chain)
        assert_eq!(results.len(), 49);
        // t0 itself must not appear
        assert!(results.iter().all(|r| r.id != "t0"));
    }

    #[test]
    fn orphan_tasks_unaffected() {
        // A moves +3. B depends on A. Orphans have no dependency on A.
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-13"), // moved +3 biz from Mar 10
            make_task("orphan1", "2026-03-05", "2026-03-15"),
            make_task("orphan2", "2026-03-20", "2026-03-28"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 3);
        // Only B cascades; orphans stay
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "b");
        // B.start = fs_successor_start(Mar 13, 0) = add_biz(Mar 13, 1) = Mon Mar 16
        assert_eq!(results[0].start_date, "2026-03-16");
        // B.end = add_biz(Mar 20, 3) = Mar 25 (Wed)
        assert_eq!(results[0].end_date, "2026-03-25");
    }

    // ── Slack-aware cascade tests (core new behavior) ─────────────────────

    /// Inclusive FS lag=1: A ends Thu Mar 12, B starts Mon Mar 16, lag=1.
    /// Required B.start = fs_successor_start(Mar 12, 1) = add_biz(Mar 12, 2) = Mon Mar 16 = B.start → zero slack.
    ///
    /// When A moves +1 biz to Fri Mar 13: required = add_biz(Mar 13, 2) = Tue Mar 17 > Mar 16.
    /// Wait — we want a NO-CASCADE scenario. Use A.end=Wed Mar 11 (after move):
    /// required = add_biz(Mar 11, 2) = Wed Mar 13 <= B.start (Mar 16) → no violation. B stays.
    #[test]
    fn no_cascade_when_predecessor_moves_into_weekend_with_lag() {
        let tasks = vec![
            make_task("a", "2026-03-09", "2026-03-11"), // A ends Wed Mar 11 (inclusive)
            {
                let mut t = make_task("b", "2026-03-16", "2026-03-27");
                t.dependencies = vec![make_dep_with_lag("a", "b", 1)];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 1);
        // required = fs_successor_start(Mar 11, 1) = add_biz(Mar 11, 2) = Wed Mar 13 <= Mar 16 → no violation
        assert!(
            results.is_empty(),
            "B should not cascade when slack absorbs the move (Scenario 1)"
        );
    }

    /// Inclusive FS lag=1: A ends Mon Mar 16, B starts Mon Mar 16, lag=1.
    /// Required B.start = fs_successor_start(Mar 16, 1) = add_biz(Mar 16, 2) = Wed Mar 18 > B.start (Mar 16).
    /// B must cascade to Mar 18.
    #[test]
    fn cascade_when_violation_occurs_with_lag() {
        let tasks = vec![
            make_task("a", "2026-03-09", "2026-03-16"), // moved to end Mon Mar 16
            {
                let mut t = make_task("b", "2026-03-16", "2026-03-27");
                t.dependencies = vec![make_dep_with_lag("a", "b", 1)];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 2);
        let b = results.iter().find(|r| r.id == "b").unwrap();
        // required = fs_successor_start(Mar 16, 1) = add_biz(Mar 16, 2) = Wed Mar 18
        assert_eq!(b.start_date, "2026-03-18");
    }

    // ── SF cascade tests ──────────────────────────────────────────────────

    fn make_sf_dep(from: &str, to: &str) -> Dependency {
        Dependency {
            from_id: from.to_string(),
            to_id: to.to_string(),
            dep_type: DepType::SF,
            lag: 0,
        }
    }

    fn make_sf_dep_with_lag(from: &str, to: &str, lag: i32) -> Dependency {
        Dependency {
            from_id: from.to_string(),
            to_id: to.to_string(),
            dep_type: DepType::SF,
            lag,
        }
    }

    /// Basic SF cascade: A starts Mar 10 (Tue), B (SF lag=0) must end >= Mar 10.
    /// B currently ends Mar 06 (Fri) → violation, B shifts forward.
    #[test]
    fn sf_basic_cascade() {
        let tasks = vec![
            make_task("a", "2026-03-10", "2026-03-17"), // A starts Tue Mar 10
            {
                let mut t = make_task("b", "2026-03-02", "2026-03-06"); // B ends Fri Mar 06
                t.duration = 5;
                t.dependencies = vec![make_sf_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 3);
        let b = results.iter().find(|r| r.id == "b").unwrap();
        // required_end = Mar 10 (Tue). B.end was Mar 06 < Mar 10 → violation.
        // shift = count_biz(Mar 06, Mar 10) = 2. B.new_end = Mar 10.
        assert_eq!(b.end_date, "2026-03-10");
        // B.new_start = add_biz(Mar 02, 2) = Mar 04 (Wed)
        assert_eq!(b.start_date, "2026-03-04");
    }

    /// SF with lag: A starts Mar 10, SF lag 2 → B must end >= add_biz(Mar 10, 2) = Mar 12.
    #[test]
    fn sf_cascade_with_lag() {
        let tasks = vec![make_task("a", "2026-03-10", "2026-03-17"), {
            let mut t = make_task("b", "2026-03-02", "2026-03-06");
            t.duration = 5;
            t.dependencies = vec![make_sf_dep_with_lag("a", "b", 2)];
            t
        }];
        let results = cascade_dependents(&tasks, "a", 3);
        let b = results.iter().find(|r| r.id == "b").unwrap();
        // required_end = add_biz(Mar 10, 2) = Mar 12 (Thu). B.end Mar 06 < Mar 12 → violation.
        assert_eq!(b.end_date, "2026-03-12");
    }

    /// SF slack absorption: B already ends Mar 15, A starts Mar 10, SF lag 0.
    /// required_end = Mar 10. B.end = Mar 15 > Mar 10 → no cascade.
    #[test]
    fn sf_slack_absorption() {
        let tasks = vec![make_task("a", "2026-03-10", "2026-03-17"), {
            let mut t = make_task("b", "2026-03-09", "2026-03-15");
            t.dependencies = vec![make_sf_dep("a", "b")];
            t
        }];
        let results = cascade_dependents(&tasks, "a", 3);
        assert!(
            results.is_empty(),
            "SF slack should absorb move — no cascade needed"
        );
    }

    /// Diamond: A→(SF)→B and A→(FS)→B — both constraints satisfied.
    #[test]
    fn sf_diamond_with_fs() {
        let tasks = vec![
            make_task("a", "2026-03-10", "2026-03-17"), // A starts Mar 10, ends Mar 17
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-18");
                t.duration = 6;
                // SF from A (pred.start=Mar 10): required_end = Mar 10. B.end=Mar 18 > Mar 10 → OK.
                // FS from A (pred.end=Mar 17): required_start = fs_successor_start(Mar 17, 0) = Mar 18. B.start=Mar 11 < Mar 18 → violation.
                t.dependencies = vec![make_sf_dep("a", "b"), make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 5);
        // FS dominates: B.start must be >= fs_successor_start(Mar 17, 0) = Wed Mar 18.
        let b = results.iter().find(|r| r.id == "b").unwrap();
        assert_eq!(b.start_date, "2026-03-18");
    }

    /// When sufficient slack exists, the predecessor can move forward without
    /// causing a cascade.
    ///
    /// A ends Mar 17 (Tue, inclusive). B starts Mar 20 (Fri), FS lag=0.
    /// required = fs_successor_start(Mar 17, 0) = add_biz(Mar 17, 1) = Mar 18. B.start = Mar 20 > Mar 18 → no violation.
    #[test]
    fn no_cascade_with_sufficient_slack() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-17"), // moved +5 biz from Mar 10
            {
                let mut t = make_task("b", "2026-03-20", "2026-03-31");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 5);
        assert!(
            results.is_empty(),
            "B should not cascade — it has enough slack to absorb A's move"
        );
    }

    /// When slack partially absorbs the move, cascade by the minimum needed.
    ///
    /// A ends Mar 20 (Fri, inclusive). B starts Mar 18 (Wed), FS lag=0.
    /// required = fs_successor_start(Mar 20, 0) = add_biz(Mar 20, 1) = Mon Mar 23.
    /// B.start = Mar 18 < Mar 23 → violation.
    /// Minimum shift = count_biz(Mar 18 → Mar 23) = 3 biz days.
    #[test]
    fn cascade_only_minimum_required() {
        // A.new_end = Fri Mar 20 (inclusive)
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-20"), // moved +8 biz from Mar 10
            {
                let mut t = make_task("b", "2026-03-18", "2026-03-27");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 8);
        let b = results.iter().find(|r| r.id == "b").unwrap();
        // required = Mon Mar 23. B starts Mar 18, violates. Shift = 3 biz.
        assert_eq!(b.start_date, "2026-03-23");
        // B.end = add_biz(Mar 27 Fri, 3) = Wed Apr 01
        assert_eq!(b.end_date, "2026-04-01");
    }

    /// Transitive slack: if B has enough slack to absorb A's move, C (dependent
    /// on B) should also not cascade (since B doesn't move).
    #[test]
    fn no_cascade_propagates_through_slack() {
        // A moves +3 biz, B has 5 biz days of slack → B doesn't cascade.
        // C depends on B; since B doesn't move, C also doesn't cascade.
        // A.new_end = add_biz(Mar 10, 3) = Mar 13.
        // B.start = Mar 20 (Fri). required = Mar 13 < Mar 20 → no violation.
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-13"), // moved +3 biz from Mar 10
            {
                let mut t = make_task("b", "2026-03-20", "2026-03-31");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
            {
                let mut t = make_task("c", "2026-04-01", "2026-04-10");
                t.dependencies = vec![make_dep("b", "c")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 3);
        assert!(
            results.is_empty(),
            "Neither B nor C should cascade — B's slack absorbs A's move"
        );
    }

    // ── Weekend-aware cascade tests ───────────────────────────────────────

    #[test]
    fn cascade_across_weekend_preserves_duration() {
        // A.new_end = Tue Mar 10 (moved from Fri Mar 06, +2 biz; inclusive end).
        // B starts Mon Mar 09, ends Fri Mar 13 (5 biz days duration).
        // required B.start = fs_successor_start(Mar 10, 0) = add_biz(Mar 10, 1) = Wed Mar 11.
        // B.start = Mar 09 < Mar 11 → violation. Shift = count_biz(Mar 09 → Mar 11) = 2.
        // B.new_start = Wed Mar 11, B.new_end = add_biz(Mar 13, 2) = Tue Mar 17.
        // This crosses the weekend, verifying business-day arithmetic is used.
        let tasks = vec![
            make_task("a", "2026-03-05", "2026-03-10"), // moved +2 biz from Mar 06 to Mar 10
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
        let results = cascade_dependents(&tasks, "a", 2);
        assert_eq!(results.len(), 1);
        let b = &results[0];
        assert_eq!(b.start_date, "2026-03-11"); // Wed (fs_successor_start(Mar 10, 0))
        assert_eq!(b.end_date, "2026-03-17"); // Tue (not Sat Mar 14!)
    }

    #[test]
    fn cascade_does_not_land_on_weekend() {
        // B starts Fri 2026-03-06, ends Fri 2026-03-13 (6 biz days).
        // A.new_end = Mon Mar 09 (moved +1 biz from Fri Mar 06; inclusive end).
        // required B.start = fs_successor_start(Mar 09, 0) = add_biz(Mar 09, 1) = Tue Mar 10.
        // B.start = Mar 06 < Mar 10 → violation.
        // Shift = count_biz(Mar 06 → Mar 10) = 2.
        // B.new_start = add_biz(Mar 06, 2) = Tue Mar 10 (not Sat Mar 07).
        // B.new_end = add_biz(Mar 13, 2) = Tue Mar 17.
        let tasks = vec![
            make_task("a", "2026-03-02", "2026-03-09"), // moved +1 biz from Mar 06
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
        // Start: fs_successor_start(Mon Mar 09, 0) = Tue Mar 10
        assert_eq!(b.start_date, "2026-03-10"); // Tue
                                                // End: add_biz(Mar 13, 2) = Tue Mar 17
        assert_eq!(b.end_date, "2026-03-17"); // Tue
    }

    // ── Agreement tests: cascade_dependents vs recalculate_earliest ────────
    // These invariant tests verify that cascade and recalculate produce the
    // same dates for all dependency types and lags. They catch regressions where
    // one function diverges from the other.
    //
    // Setup for all subtests:
    //   A: start=2026-03-02 (Mon), end=2026-03-06 (Fri), duration=5
    //   A moves +3 biz → new_start=2026-03-05 (Thu), new_end=2026-03-11 (Wed)
    //   B: start=2026-02-02 (Mon), end=2026-02-06 (Fri), duration=5
    //   B has internally consistent dates (end = taskEndDate(start, dur))
    //   so both cascade and recalculate can agree.
    //
    // Cascade computes: shift = count_biz(B.curr_start_or_end, required), then
    //                   new_dates = B.curr + shift (duration preserved).
    // Recalculate computes: new_start directly from dep formula (ASAP forward pass).
    // They agree iff B.curr dates are internally consistent AND both see A's new dates.

    fn make_dep_typed(from: &str, to: &str, dep_type: DepType, lag: i32) -> Dependency {
        Dependency {
            from_id: from.to_string(),
            to_id: to.to_string(),
            dep_type,
            lag,
        }
    }

    /// Build a two-task scenario with A at its new position (already moved)
    /// and B at a fixed old position that violates any dep constraint.
    /// A: start=2026-03-05 (Thu), end=2026-03-11 (Wed), dur=5 (moved +3 biz from Mon)
    /// B: start=2026-02-02 (Mon), end=2026-02-06 (Fri), dur=5 (old position, violates all deps)
    fn make_ab_scenario(dep_type: DepType, lag: i32) -> Vec<Task> {
        vec![
            // A already at moved position
            {
                let mut t = make_task("a", "2026-03-05", "2026-03-11");
                t.duration = 5;
                t
            },
            // B at old position (will violate any dep constraint with A's new dates)
            {
                let mut t = make_task("b", "2026-02-02", "2026-02-06");
                t.duration = 5;
                t.dependencies = vec![make_dep_typed("a", "b", dep_type, lag)];
                t
            },
        ]
    }

    #[test]
    fn cascade_and_recalculate_agree_on_all_dep_types() {
        use crate::constraints::recalculate_earliest;

        // (dep_type, lag, expected cascade start, expected recalc start)
        // All expected values verified via node -e with date-fns addBusinessDays.
        //
        // A.new_start=2026-03-05 (Thu), A.new_end=2026-03-11 (Wed)
        // B.curr_start=2026-02-02, B.curr_end=2026-02-06, B.dur=5
        //
        // FS lag=0: required_start = addBiz(A.end, 1) = 2026-03-12 (Thu)
        // FS lag=1: required_start = addBiz(A.end, 2) = 2026-03-13 (Fri)
        // FS lag=2: required_start = addBiz(A.end, 3) = 2026-03-16 (Mon)
        // SS lag=0: required_start = addBiz(A.start, 0) = 2026-03-05 (Thu)
        // SS lag=1: required_start = addBiz(A.start, 1) = 2026-03-06 (Fri)
        // SS lag=2: required_start = addBiz(A.start, 2) = 2026-03-09 (Mon)
        // FF lag=0: required_end = addBiz(A.end, 0) = 2026-03-11, start = addBiz(end, -4) = 2026-03-05
        // FF lag=1: required_end = addBiz(A.end, 1) = 2026-03-12, start = addBiz(end, -4) = 2026-03-06
        // SF lag=0: required_end = addBiz(A.start, 0) = 2026-03-05, start = addBiz(end, -4) = 2026-02-27
        // SF lag=1: required_end = addBiz(A.start, 1) = 2026-03-06, start = addBiz(end, -4) = 2026-03-02
        let cases: &[(DepType, i32, &str)] = &[
            (DepType::FS, 0, "2026-03-12"),
            (DepType::FS, 1, "2026-03-13"),
            (DepType::FS, 2, "2026-03-16"),
            (DepType::SS, 0, "2026-03-05"),
            (DepType::SS, 1, "2026-03-06"),
            (DepType::SS, 2, "2026-03-09"),
            (DepType::FF, 0, "2026-03-05"),
            (DepType::FF, 1, "2026-03-06"),
            (DepType::SF, 0, "2026-02-27"),
            (DepType::SF, 1, "2026-03-02"),
        ];

        for (dep_type, lag, expected_start) in cases {
            let tasks = make_ab_scenario(dep_type.clone(), *lag);

            // Run cascade: A moved +3 biz to its new position
            let cascade_results = cascade_dependents(&tasks, "a", 3);
            let cascade_b = cascade_results
                .iter()
                .find(|r| r.id == "b")
                .expect(&format!(
                    "cascade should move B for dep={:?} lag={}",
                    dep_type, lag
                ));

            // Run recalculate_earliest: A already at new position, recalc from scratch
            let recalc_results = recalculate_earliest(
                &tasks,
                None,
                None,
                None,
                "2026-01-01", // today far in past so no floor affects the result
            );
            let recalc_b = recalc_results.iter().find(|r| r.id == "b").expect(&format!(
                "recalculate should move B for dep={:?} lag={}",
                dep_type, lag
            ));

            // Both should agree on B's new start date
            assert_eq!(
                cascade_b.start_date, recalc_b.new_start,
                "cascade and recalculate disagree for dep={:?} lag={}: cascade={} recalc={}",
                dep_type, lag, cascade_b.start_date, recalc_b.new_start
            );

            // Both should land B at the expected start
            assert_eq!(
                cascade_b.start_date, *expected_start,
                "cascade B.start mismatch for dep={:?} lag={}: got {} expected {}",
                dep_type, lag, cascade_b.start_date, expected_start
            );
            assert_eq!(
                recalc_b.new_start, *expected_start,
                "recalculate B.start mismatch for dep={:?} lag={}: got {} expected {}",
                dep_type, lag, recalc_b.new_start, expected_start
            );
        }
    }

    /// Roundtrip invariant: edit → cascade → recalculate should produce zero additional drift.
    ///
    /// After cascade correctly positions all dependents, a subsequent call to
    /// recalculate_earliest on the cascaded tasks must return empty results (no task moves).
    ///
    /// Setup:
    ///   A → B → C (all FS lag=0)
    ///   A: start=2026-03-02 (Mon), end=2026-03-06 (Fri), dur=5
    ///   B: start=2026-03-09 (Mon), end=2026-03-13 (Fri), dur=5 (tight FS from A)
    ///   C: start=2026-03-16 (Mon), end=2026-03-20 (Fri), dur=5 (tight FS from B)
    ///
    /// A moves +2 biz: new_start=2026-03-04 (Wed), new_end=2026-03-10 (Mon)
    /// After cascade:
    ///   B: start=2026-03-11 (Wed), end=2026-03-17 (Tue) — shifted +2 biz to satisfy FS
    ///   C: start=2026-03-18 (Wed), end=2026-03-24 (Tue) — shifted +2 biz from B
    ///
    /// All date values verified via node -e with date-fns addBusinessDays.
    #[test]
    fn edit_cascade_recalculate_no_drift() {
        use crate::constraints::recalculate_earliest;

        // Initial task chain: A → B → C (tight FS, no slack)
        let mut tasks = vec![
            {
                let mut t = make_task("a", "2026-03-02", "2026-03-06");
                t.duration = 5;
                t
            },
            {
                let mut t = make_task("b", "2026-03-09", "2026-03-13");
                t.duration = 5;
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
            {
                let mut t = make_task("c", "2026-03-16", "2026-03-20");
                t.duration = 5;
                t.dependencies = vec![make_dep("b", "c")];
                t
            },
        ];

        // Step 1: Move A forward 2 biz days (caller updates A's dates before cascade)
        // A.new_start = addBiz('2026-03-02', 2) = 2026-03-04 (Wed)
        // A.new_end   = addBiz('2026-03-06', 2) = 2026-03-10 (Mon)
        tasks[0].start_date = "2026-03-04".to_string();
        tasks[0].end_date = "2026-03-10".to_string();

        // Step 2: Cascade — propagate A's move to B and C
        let cascade_results = cascade_dependents(&tasks, "a", 2);

        // Apply cascade results back to tasks (simulating what ganttReducer.ts does)
        for result in &cascade_results {
            if let Some(task) = tasks.iter_mut().find(|t| t.id == result.id) {
                task.start_date = result.start_date.clone();
                task.end_date = result.end_date.clone();
            }
        }

        // Verify cascade produced the expected dates
        // B: required_start = addBiz(A.new_end, 1) = addBiz('2026-03-10', 1) = 2026-03-11 (Wed)
        // B: new_end = addBiz('2026-03-13', 2) = 2026-03-17 (Tue)
        let b = tasks.iter().find(|t| t.id == "b").unwrap();
        assert_eq!(b.start_date, "2026-03-11", "cascade B start incorrect");
        assert_eq!(b.end_date, "2026-03-17", "cascade B end incorrect");

        // C: required_start = addBiz(B.new_end, 1) = addBiz('2026-03-17', 1) = 2026-03-18 (Wed)
        // C: new_end = addBiz('2026-03-20', 2) = 2026-03-24 (Tue)
        let c = tasks.iter().find(|t| t.id == "c").unwrap();
        assert_eq!(c.start_date, "2026-03-18", "cascade C start incorrect");
        assert_eq!(c.end_date, "2026-03-24", "cascade C end incorrect");

        // Step 3: Recalculate on the cascaded tasks — should produce ZERO changes
        // (cascade already placed tasks at their earliest valid positions)
        let recalc_results = recalculate_earliest(
            &tasks,
            None,
            None,
            None,
            "2026-01-01", // far in past so today-floor doesn't affect
        );

        assert!(
            recalc_results.is_empty(),
            "recalculate after cascade should produce no changes (no drift), but got: {:?}",
            recalc_results
                .iter()
                .map(|r| format!("{}: {} → {}", r.id, r.new_start, r.new_end))
                .collect::<Vec<_>>()
        );
    }
}
