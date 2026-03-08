use crate::date_utils::{add_business_days, count_biz_days_to, next_biz_day_on_or_after};
use crate::types::{CascadeResult, Dependency, DepType, Task};
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
pub fn cascade_dependents(tasks: &[Task], moved_task_id: &str, days_delta: i32) -> Vec<CascadeResult> {
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
                        // B must start no earlier than the first business day on or after
                        // (pred.end + lag business days).
                        let raw = add_business_days(&pred_eff_end, dep_link.lag);
                        let required = next_biz_day_on_or_after(&raw);
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
                        // SF cascade: successor's finish must be >= pred start + lag.
                        // Full implementation in Stage 2 (Group B).
                        continue;
                    }
                };

                // Update effective dates only if this path requires a larger
                // shift than a previous path (diamond dependency support).
                let needs_update = new_start > dep_curr_start
                    || (dep_link.dep_type == DepType::FF && new_end > dep_curr_end);

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
    /// Setup: A ends Tue Mar 10. B starts Wed Mar 11 (FS lag=0).
    /// Required B.start = add_biz(A.end, 0) = A.end.
    /// Before move: required = Mar 10, B.start = Mar 11 > Mar 10 → 1 biz day slack.
    ///
    /// A moves +5 biz → A.new_end = Tue Mar 17.
    /// Required B.start = Mar 17 > B.start (Mar 11) → violation.
    /// B shifts by count_biz(Mar 11 → Mar 17) = 4 biz days → starts Mar 17.
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
        // B shifts to satisfy constraint: start = A.new_end = Mar 17 (Tue)
        assert_eq!(b.start_date, "2026-03-17");
        // Duration preserved: Mar 20 + 4 biz days = Mar 26 (Thu)
        assert_eq!(b.end_date, "2026-03-26");
    }

    #[test]
    fn does_not_shift_moved_task() {
        let tasks = vec![
            make_task("a", "2026-03-01", "2026-03-17"),
            {
                let mut t = make_task("b", "2026-03-11", "2026-03-20");
                t.dependencies = vec![make_dep("a", "b")];
                t
            },
        ];
        let results = cascade_dependents(&tasks, "a", 5);
        // The moved task itself should not appear in results
        assert!(results.iter().all(|r| r.id != "a"));
    }

    #[test]
    fn transitive_cascade() {
        // A → B → C. A moves +3 biz.
        // A.new_end = add_biz(Mar 10, 3) = Mar 13 (Fri).
        // B (starts Mar 11): required = Mar 13 > Mar 11 → shift 2 biz.
        //   B.new_start = Mar 13, B.new_end = add_biz(Mar 20, 2) = Mar 24 (Tue).
        // C (starts Mar 21=Sat): required = add_biz(Mar 24, 0) = Mar 24.
        //   Mar 21 (Sat) < Mar 24 (Tue) → shift 2 biz.
        //   C.new_start = Mar 24.
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
        assert_eq!(c.start_date, "2026-03-24");
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
        // A.new_end = add_biz(Mar 10, 5) = Mar 17.
        // B (starts Mar 11): required = Mar 17 > Mar 11 → shift 4 biz.
        //   B.new_start = Mar 17, B.new_end = add_biz(Mar 20, 4) = Mar 26.
        // C (starts Mar 21 Sat): check A→C: required = Mar 17 < Mar 21 → no violation.
        //   Check B→C: required = add_biz(Mar 26, 0) = Mar 26 > Mar 21 → violation.
        //   C.new_start = Mar 26 (Thu), C.new_end = add_biz(Mar 30, 4) = Apr 03.
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
        assert_eq!(c.start_date, "2026-03-26");
        assert_eq!(c.end_date, "2026-04-03");
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
            tasks[i].dependencies =
                vec![make_dep(&format!("t{}", i - 1), &format!("t{}", i))];
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
        // B.start = required = add_biz(Mar 13, 0) = Mar 13 (Fri)
        assert_eq!(results[0].start_date, "2026-03-13");
        // B.end = add_biz(Mar 20, 2) = Mar 24 (Tue)
        assert_eq!(results[0].end_date, "2026-03-24");
    }

    // ── Slack-aware cascade tests (core new behavior) ─────────────────────

    /// Scenario from the issue: FS lag=1. A ends Mar 13 (Fri), B starts Mar 16 (Mon).
    /// Required B.start = add_biz(Mar 13, 1) = Mar 16 = B.start → zero slack.
    ///
    /// When A moves to end Mar 14 (Sat): required = add_biz(Mar 14, 1) = Mar 16.
    /// B.start = Mar 16 = required → no violation. B should NOT move.
    #[test]
    fn no_cascade_when_predecessor_moves_into_weekend_with_lag() {
        let tasks = vec![
            make_task("a", "2026-03-09", "2026-03-14"), // moved to end Sat Mar 14
            {
                let mut t = make_task("b", "2026-03-16", "2026-03-27");
                t.dependencies = vec![make_dep_with_lag("a", "b", 1)];
                t
            },
        ];
        // A moved +1 biz day (from Fri Mar 13 to Mon... wait, let me use days_delta=1)
        let results = cascade_dependents(&tasks, "a", 1);
        // B.start = Mar 16 = add_biz(Mar 14, 1) = Mar 16 → no violation
        assert!(
            results.is_empty(),
            "B should not cascade when slack absorbs the move (Scenario 1)"
        );
    }

    /// Scenario 2 from the issue: A ends Mar 16 (Mon), lag=1.
    /// required B.start = add_biz(Mar 16, 1) = Mar 17 (Tue) > B.start (Mar 16).
    /// B must cascade to Mar 17.
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
        // required = add_biz(Mar 16, 1) = Mar 17 (Tue)
        assert_eq!(b.start_date, "2026-03-17");
    }

    /// When sufficient slack exists, the predecessor can move forward without
    /// causing a cascade.
    ///
    /// A ends Mar 10 (Tue), B starts Mar 20 (Fri), FS lag=0.
    /// required = add_biz(Mar 10, 0) = Mar 10. B.start = Mar 20. 8 biz days of slack.
    /// A moves +5 biz → A.new_end = Mar 17.
    /// required = Mar 17. B.start = Mar 20 > Mar 17 → still no violation.
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
    /// A ends Mar 10 (Tue), B starts Mar 14 (Sat) ≡ Mar 16 (Mon as effective business day).
    /// Wait, let me use a cleaner example:
    /// A ends Mar 10, B starts Mar 18 (Wed), FS lag=0.
    /// required = add_biz(Mar 10, 0) = Mar 10. Slack = count_biz(Mar 10 → Mar 18) = 6.
    /// A moves +8 biz → A.new_end = add_biz(Mar 10, 8) = Mar 20 (Fri).
    /// required = Mar 20. B.start = Mar 18 < Mar 20 → violation.
    /// Minimum shift = count_biz(Mar 18 → Mar 20) = 2 biz days.
    #[test]
    fn cascade_only_minimum_required() {
        // A.new_end = add_biz("2026-03-10", 8) = Fri Mar 20
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
        // required = Mar 20. B starts Mar 18, violates. Shift = 2 biz.
        assert_eq!(b.start_date, "2026-03-20");
        // B.end = add_biz(Mar 27 Fri, 2) = Tue Mar 31
        assert_eq!(b.end_date, "2026-03-31");
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
        // A.new_end = Tue Mar 10 (moved from Fri Mar 06, +2 biz).
        // B starts Mon Mar 09, ends Fri Mar 13 (5 biz days duration).
        // required B.start = add_biz(Mar 10, 0) = Mar 10.
        // B.start = Mar 09 < Mar 10 → violation. Shift = 1 biz day.
        // B.new_start = Mar 10 (Tue), B.new_end = add_biz(Mar 13, 1) = Mon Mar 16.
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
        assert_eq!(b.start_date, "2026-03-10"); // Tue
        assert_eq!(b.end_date, "2026-03-16"); // Mon (not Sat Mar 14!)
    }

    #[test]
    fn cascade_does_not_land_on_weekend() {
        // B starts Fri 2026-03-06, ends Fri 2026-03-13 (6 biz days).
        // A.new_end = Mon Mar 09 (moved +1 biz from Mar 06).
        // required B.start = Mar 09 > B.start (Mar 06) → violation.
        // Shift = count_biz(Mar 06 → Mar 09) = 1 (Mon).
        // B.new_start = Mon Mar 09 (not Sat Mar 07).
        // B.new_end = add_biz(Mar 13, 1) = Mon Mar 16.
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
        // Start should skip weekend: Fri+1 biz day = Mon
        assert_eq!(b.start_date, "2026-03-09"); // Mon, not Sat
        // End should also be a weekday, preserving duration
        assert_eq!(b.end_date, "2026-03-16"); // Mon
    }
}
