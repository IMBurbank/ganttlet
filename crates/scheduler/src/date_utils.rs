//! Date utility functions for the scheduling engine.
//!
//! All date logic follows the **inclusive end-date convention**: `end_date` is the
//! last working day a task occupies, and `duration` counts both endpoints.
//!
//! The low-level primitive is `shift_date(date, n)` (`pub(crate)`), which shifts a
//! date by `n` business days (skipping weekends). Every other function is built on
//! top of it.
//!
//! ## Public API categories
//!
//! **Date ↔ duration conversion:**
//! - `task_duration(start, end)` — inclusive business day count
//! - `task_end_date(start, duration)` — end date from start + duration
//! - `task_start_date(end, duration)` — start date from end + duration (inverse)
//!
//! **Business day snapping:**
//! - `ensure_business_day(date)` — snap forward to next business day (Monday)
//! - `prev_business_day(date)` — snap backward to previous business day (Friday)
//!
//! **Dependency helpers (one per dep type):**
//! - `fs_successor_start(pred_end, lag)` — Finish-to-Start
//! - `ss_successor_start(pred_start, lag)` — Start-to-Start
//! - `ff_successor_start(pred_end, lag, succ_dur)` — Finish-to-Finish
//! - `sf_successor_start(pred_start, lag, succ_dur)` — Start-to-Finish
//!
//! **Shift counting:**
//! - `business_day_delta(from, to)` — non-negative business day count between dates

/// Parse "YYYY-MM-DD" to a (year, month, day) tuple.
pub fn parse_date(s: &str) -> (i32, u32, u32) {
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
    if m == 2 && is_leap_year(y) {
        29
    } else {
        DAYS_IN_MONTH[(m - 1) as usize]
    }
}

/// Format (year, month, day) as "YYYY-MM-DD".
pub fn format_date(y: i32, m: u32, d: u32) -> String {
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Day of week for a date: 0=Sun, 1=Mon, ..., 6=Sat (Zeller-like via Tomohiko Sakamoto).
pub fn day_of_week(y: i32, m: u32, d: u32) -> u32 {
    let t = [0i32, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if m < 3 { y - 1 } else { y };
    ((y + y / 4 - y / 100 + y / 400 + t[(m - 1) as usize] + d as i32) % 7) as u32
}

fn is_weekend(y: i32, m: u32, d: u32) -> bool {
    let dow = day_of_week(y, m, d);
    dow == 0 || dow == 6
}

/// Returns true if the date string falls on a Saturday or Sunday.
pub fn is_weekend_date(date: &str) -> bool {
    let (y, m, d) = parse_date(date);
    is_weekend(y, m, d)
}

/// Shift a date by `n` business days (Mon-Fri). Positive = forward, negative = backward.
///
/// This is a low-level shift primitive — crate-internal only. External code should use
/// `task_end_date(start, duration)` for end-date derivation (inclusive convention) or
/// the dep-type helpers (`fs_successor_start`, etc.) for dependency calculations.
pub(crate) fn shift_date(date_str: &str, n: i32) -> String {
    let mut result = date_str.to_string();
    let mut remaining = n.abs();
    let step = if n >= 0 { 1 } else { -1 };
    while remaining > 0 {
        result = add_days(&result, step);
        let (y, m, d) = parse_date(&result);
        if !is_weekend(y, m, d) {
            remaining -= 1;
        }
    }
    result
}

/// Add `delta` days to a date string, returning a new date string.
pub fn add_days(date_str: &str, delta: i32) -> String {
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

/// Inclusive business day count: [start, end] counting both endpoints.
/// A same-day task returns 1.
pub fn task_duration(start: &str, end: &str) -> i32 {
    business_day_delta(start, end) + 1
}

/// Derive end date from start + duration using inclusive convention.
/// task_end_date(start, 1) returns start (same-day task).
pub fn task_end_date(start: &str, duration: i32) -> String {
    shift_date(start, duration - 1)
}

/// Derive start date from end + duration using inclusive convention.
/// Inverse of task_end_date: task_start_date(task_end_date(start, dur), dur) == start.
pub fn task_start_date(end: &str, duration: i32) -> String {
    shift_date(end, -(duration - 1))
}

/// Snap forward to next Monday if date falls on a weekend. No-op if already a weekday.
pub fn ensure_business_day(date: &str) -> String {
    let (y, m, d) = parse_date(date);
    if is_weekend(y, m, d) {
        shift_date(date, 1)
    } else {
        date.to_string()
    }
}

/// Snap backward to previous Friday if date falls on a weekend. No-op if already a weekday.
pub fn prev_business_day(date: &str) -> String {
    let (y, m, d) = parse_date(date);
    let wd = day_of_week(y, m, d);
    match wd {
        6 => add_days(date, -1), // Saturday → Friday
        0 => add_days(date, -2), // Sunday → Friday
        _ => date.to_string(),
    }
}

/// FS: successor starts the next business day after predecessor's end, plus lag.
pub fn fs_successor_start(pred_end: &str, lag: i32) -> String {
    shift_date(pred_end, 1 + lag)
}

/// SS: successor starts on same day as predecessor's start, plus lag.
pub fn ss_successor_start(pred_start: &str, lag: i32) -> String {
    shift_date(pred_start, lag)
}

/// FF: successor must finish on same day as predecessor's end, plus lag.
/// Derives successor start from the required finish date.
pub fn ff_successor_start(pred_end: &str, lag: i32, succ_duration: i32) -> String {
    let required_finish = shift_date(pred_end, lag);
    shift_date(&required_finish, -(succ_duration - 1))
}

/// SF: successor must finish on or after predecessor's start, plus lag.
/// Derives successor start from the required finish date.
pub fn sf_successor_start(pred_start: &str, lag: i32, succ_duration: i32) -> String {
    let required_finish = shift_date(pred_start, lag);
    shift_date(&required_finish, -(succ_duration - 1))
}

/// Count the number of business days from `from` to `to`.
/// Returns 0 if `to <= from`. Used by cascade to compute shift amounts.
pub fn business_day_delta(from: &str, to: &str) -> i32 {
    if from >= to {
        return 0;
    }
    let mut count = 0;
    let mut current = from.to_string();
    while current < to.to_string() {
        current = add_days(&current, 1);
        let (y, m, d) = parse_date(&current);
        if !is_weekend(y, m, d) {
            count += 1;
        }
    }
    count
}

#[cfg(test)]
mod convention_tests {
    use super::*;

    #[test]
    fn task_duration_cases() {
        // Mon–Fri = 5
        assert_eq!(task_duration("2026-03-02", "2026-03-06"), 5);
        // Same day = 1
        assert_eq!(task_duration("2026-03-02", "2026-03-02"), 1);
        // Fri to next Tue = 3 (Fri, Mon, Tue)
        assert_eq!(task_duration("2026-03-06", "2026-03-10"), 3);
        // Two weeks = 10
        assert_eq!(task_duration("2026-03-11", "2026-03-24"), 10);
    }

    #[test]
    fn task_end_date_cases() {
        // Mon + dur=5 → Fri
        assert_eq!(task_end_date("2026-03-02", 5), "2026-03-06");
        // Mon + dur=1 → Mon (same day)
        assert_eq!(task_end_date("2026-03-02", 1), "2026-03-02");
    }

    #[test]
    fn roundtrip_duration_end() {
        let start = "2026-03-02";
        for dur in [1, 3, 5, 10] {
            let end = task_end_date(start, dur);
            assert_eq!(
                task_duration(start, &end),
                dur,
                "roundtrip failed for dur={}",
                dur
            );
        }
    }

    #[test]
    fn ensure_business_day_cases() {
        // Weekday → no-op
        assert_eq!(ensure_business_day("2026-03-09"), "2026-03-09"); // Monday
                                                                     // Saturday → Monday
        assert_eq!(ensure_business_day("2026-03-07"), "2026-03-09");
        // Sunday → Monday
        assert_eq!(ensure_business_day("2026-03-08"), "2026-03-09");
    }

    #[test]
    fn prev_business_day_cases() {
        // Weekday → no-op
        assert_eq!(prev_business_day("2026-03-09"), "2026-03-09"); // Monday
                                                                   // Saturday → Friday
        assert_eq!(prev_business_day("2026-03-07"), "2026-03-06");
        // Sunday → Friday
        assert_eq!(prev_business_day("2026-03-08"), "2026-03-06");
    }

    #[test]
    fn fs_successor_start_cases() {
        // Fri lag=0 → Mon
        assert_eq!(fs_successor_start("2026-03-06", 0), "2026-03-09");
        // Fri lag=1 → Tue
        assert_eq!(fs_successor_start("2026-03-06", 1), "2026-03-10");
        // Fri lag=2 → Wed
        assert_eq!(fs_successor_start("2026-03-06", 2), "2026-03-11");
    }

    #[test]
    fn ss_successor_start_cases() {
        // Mon lag=0 → Mon (same day)
        assert_eq!(ss_successor_start("2026-03-02", 0), "2026-03-02");
        // Mon lag=1 → Tue
        assert_eq!(ss_successor_start("2026-03-02", 1), "2026-03-03");
        // Mon lag=2 → Wed
        assert_eq!(ss_successor_start("2026-03-02", 2), "2026-03-04");
    }

    #[test]
    fn ff_successor_start_cases() {
        // Fri end, lag=0, dur=5 → start=Mon
        assert_eq!(ff_successor_start("2026-03-06", 0, 5), "2026-03-02");
        // Fri end, lag=1, dur=3 → required_finish=Mon, start=Thu
        assert_eq!(ff_successor_start("2026-03-06", 1, 3), "2026-03-05");
    }

    #[test]
    fn sf_successor_start_cases() {
        // Mon start, lag=0, dur=5 → required_finish=Mon, start=2026-02-24
        assert_eq!(sf_successor_start("2026-03-02", 0, 5), "2026-02-24");
        // Mon start, lag=1, dur=3 → required_finish=Tue, start=2026-02-27
        assert_eq!(sf_successor_start("2026-03-02", 1, 3), "2026-02-27");
    }

    #[test]
    fn business_day_delta_cases() {
        // Mon to Fri = 4 (matches business_day_delta)
        assert_eq!(business_day_delta("2026-03-09", "2026-03-13"), 4);
        // Fri to Mon = 1
        assert_eq!(business_day_delta("2026-03-06", "2026-03-09"), 1);
        // Same day = 0
        assert_eq!(business_day_delta("2026-03-09", "2026-03-09"), 0);
        // Two-week span: Mon Mar 2 to Fri Mar 13 = 9 business days
        assert_eq!(business_day_delta("2026-03-02", "2026-03-13"), 9);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shift_date_forward() {
        // Wed Mar 11 + 10 business days = Wed Mar 25
        assert_eq!(shift_date("2026-03-11", 10), "2026-03-25");
        // Fri Mar 20 + 10 business days = Fri Apr 3
        assert_eq!(shift_date("2026-03-20", 10), "2026-04-03");
        // Sun Mar 1 + 10 business days = Fri Mar 13
        assert_eq!(shift_date("2026-03-01", 10), "2026-03-13");
    }

    #[test]
    fn shift_date_backward() {
        // Wed Mar 25 - 10 business days = Wed Mar 11
        assert_eq!(shift_date("2026-03-25", -10), "2026-03-11");
    }

    #[test]
    fn shift_date_from_weekend() {
        // Sat 2026-03-21 + 5 should match date-fns: 2026-03-27
        assert_eq!(shift_date("2026-03-21", 5), "2026-03-27");
        // Sun 2026-03-01 + 10 should match date-fns: 2026-03-13
        assert_eq!(shift_date("2026-03-01", 10), "2026-03-13");
        // Fri 2026-03-20 + 5 should be: 2026-03-27
        assert_eq!(shift_date("2026-03-20", 5), "2026-03-27");
    }

    #[test]
    fn business_day_delta_basic() {
        // Mon Mar 09 to Tue Mar 17 across a weekend
        // Mar 10(1), 11(2), 12(3), 13(4), [14 Sat, 15 Sun], 16(5), 17(6)? wait:
        // from Mar 09, stepping to Mar 17:
        // Mar 10 Tue:1, 11 Wed:2, 12 Thu:3, 13 Fri:4, [14 Sat skip, 15 Sun skip], 16 Mon:5, 17 Tue:6
        // Actually Mar 9 is Mon (Mar 1=Sun, +8=Mon)
        assert_eq!(business_day_delta("2026-03-09", "2026-03-17"), 6);
        // Same date: 0
        assert_eq!(business_day_delta("2026-03-09", "2026-03-09"), 0);
        // from > to: 0
        assert_eq!(business_day_delta("2026-03-17", "2026-03-09"), 0);
        // Adjacent weekdays: 1
        assert_eq!(business_day_delta("2026-03-09", "2026-03-10"), 1);
        // Fri to Mon = 1 business day
        assert_eq!(business_day_delta("2026-03-06", "2026-03-09"), 1);
    }

    #[test]
    fn day_of_week_known_dates() {
        assert_eq!(day_of_week(2026, 3, 1), 0); // Sunday
        assert_eq!(day_of_week(2026, 3, 2), 1); // Monday
        assert_eq!(day_of_week(2026, 3, 6), 5); // Friday
        assert_eq!(day_of_week(2026, 3, 7), 6); // Saturday
    }
}

/// Cross-language consistency tests: Rust must produce the same results as the
/// TypeScript taskDuration() and taskEndDate() functions in dateUtils.ts.
///
/// The canonical case list here mirrors src/utils/__tests__/dateUtils.test.ts
/// § "cross-language consistency". Both sets of expected values were computed
/// using node -e with date-fns addBusinessDays/differenceInBusinessDays.
///
/// Rule: any change to expected values here must be reflected in dateUtils.test.ts
/// and vice versa.
#[cfg(test)]
mod cross_language_tests {
    use super::*;

    // task_duration(start, end) === differenceInBusinessDays(end, start) + 1
    // Canonical cases (identical to TS durationCases in dateUtils.test.ts):
    //   ('2026-03-02', '2026-03-02') → 1   (same-day task)
    //   ('2026-03-02', '2026-03-06') → 5   (Mon-Fri = 5)
    //   ('2026-03-06', '2026-03-06') → 1   (1-day task)
    //   ('2026-03-06', '2026-03-10') → 3   (Fri-Tue spanning weekend = 3)
    //   ('2026-03-02', '2026-03-13') → 10  (2 weeks Mon-Fri = 10)

    #[test]
    fn cross_lang_task_duration_matches_ts() {
        assert_eq!(task_duration("2026-03-02", "2026-03-02"), 1); // same-day
        assert_eq!(task_duration("2026-03-02", "2026-03-06"), 5); // Mon-Fri
        assert_eq!(task_duration("2026-03-06", "2026-03-06"), 1); // 1-day from Fri
        assert_eq!(task_duration("2026-03-06", "2026-03-10"), 3); // Fri-Tue spanning weekend
        assert_eq!(task_duration("2026-03-02", "2026-03-13"), 10); // 2 weeks Mon-Fri
    }

    // task_end_date(start, duration) === addBusinessDays(start, duration - 1)
    // Canonical cases (identical to TS endDateCases in dateUtils.test.ts):
    //   ('2026-03-02', 1) → '2026-03-02'  (dur=1: same day)
    //   ('2026-03-02', 5) → '2026-03-06'  (dur=5: Mon-Fri)
    //   ('2026-03-06', 1) → '2026-03-06'  (dur=1 from Fri: stays Fri)
    //   ('2026-03-06', 3) → '2026-03-10'  (dur=3 from Fri: Fri Mon Tue)
    //   ('2026-03-02', 10) → '2026-03-13' (dur=10: Mon to 2-week Fri)

    #[test]
    fn cross_lang_task_end_date_matches_ts() {
        assert_eq!(task_end_date("2026-03-02", 1), "2026-03-02"); // dur=1: same day
        assert_eq!(task_end_date("2026-03-02", 5), "2026-03-06"); // dur=5: Mon-Fri
        assert_eq!(task_end_date("2026-03-06", 1), "2026-03-06"); // dur=1 from Fri
        assert_eq!(task_end_date("2026-03-06", 3), "2026-03-10"); // dur=3 Fri-Tue
        assert_eq!(task_end_date("2026-03-02", 10), "2026-03-13"); // dur=10: 2 weeks
    }

    // Roundtrip: task_duration(start, task_end_date(start, dur)) == dur
    // Canonical cases (identical to TS roundtripCases in dateUtils.test.ts):
    //   ('2026-03-02', 1), ('2026-03-02', 5), ('2026-03-06', 3), ('2026-03-02', 10)

    #[test]
    fn cross_lang_roundtrip_task_duration_end_date() {
        for (start, dur) in [
            ("2026-03-02", 1),
            ("2026-03-02", 5),
            ("2026-03-06", 3),
            ("2026-03-02", 10),
        ] {
            let end = task_end_date(start, dur);
            assert_eq!(
                task_duration(start, &end),
                dur,
                "roundtrip failed for start={} dur={}",
                start,
                dur
            );
        }
    }
}
