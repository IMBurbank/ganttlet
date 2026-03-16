//! Property-based tests for date_utils invariants.

use ganttlet_scheduler::date_utils::*;
use proptest::prelude::*;

fn config() -> ProptestConfig {
    let cases = std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(256);
    ProptestConfig::with_cases(cases)
}

/// Generate a random weekday date in 2020-2030 range.
fn weekday_date() -> impl Strategy<Value = String> {
    (2020i32..2030, 1i32..366).prop_filter_map("weekday only", |(y, day)| {
        let date = add_days(&format!("{y}-01-01"), day - 1);
        if is_weekend_date(&date) {
            None
        } else {
            Some(date)
        }
    })
}

/// Generate an ordered pair of weekday dates.
fn ordered_weekday_pair() -> impl Strategy<Value = (String, String)> {
    weekday_date().prop_flat_map(|start| {
        (Just(start.clone()), 1..500i32).prop_map(move |(s, dur)| (s, task_end_date(&start, dur)))
    })
}

// Property 1: taskDuration inverts taskEndDate
proptest! {
    #![proptest_config(config())]
    #[test]
    fn duration_inverts_end(start in weekday_date(), dur in 1..500i32) {
        let end = task_end_date(&start, dur);
        prop_assert_eq!(task_duration(&start, &end), dur);
    }
}

// Property 2: taskEndDate inverts taskDuration
proptest! {
    #![proptest_config(config())]
    #[test]
    fn end_inverts_duration(pair in ordered_weekday_pair()) {
        let (start, end) = pair;
        let dur = task_duration(&start, &end);
        prop_assert_eq!(task_end_date(&start, dur), end);
    }
}

// Property 3: task_end_date / task_start_date round-trip
proptest! {
    #![proptest_config(config())]
    #[test]
    fn end_start_roundtrip(start in weekday_date(), dur in 1..500i32) {
        let end = task_end_date(&start, dur);
        let back = task_start_date(&end, dur);
        prop_assert_eq!(back, start);
    }
}

// Property 4: taskEndDate is always a weekday
proptest! {
    #![proptest_config(config())]
    #[test]
    fn end_date_never_weekend(start in weekday_date(), dur in 1..500i32) {
        let end = task_end_date(&start, dur);
        prop_assert!(!is_weekend_date(&end), "end date {} is a weekend", end);
    }
}

// Property 5: duration is always positive for ordered dates
proptest! {
    #![proptest_config(config())]
    #[test]
    fn duration_positive(pair in ordered_weekday_pair()) {
        let (start, end) = pair;
        prop_assert!(task_duration(&start, &end) >= 1);
    }
}

// Property 6: business_day_delta is consistent with task_duration
proptest! {
    #![proptest_config(config())]
    #[test]
    fn delta_duration_relationship(pair in ordered_weekday_pair()) {
        let (start, end) = pair;
        prop_assert_eq!(
            business_day_delta(&start, &end) + 1,
            task_duration(&start, &end)
        );
    }
}
