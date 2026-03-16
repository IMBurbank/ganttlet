//! Thin wrappers around `ganttlet_scheduler::date_utils` for CLI use.

use ganttlet_scheduler::date_utils;

/// Compute end date for a task starting on `start` with `duration` business days (inclusive).
pub fn end_date(start: &str, duration: i32) -> String {
    date_utils::task_end_date(start, duration)
}

/// Compute inclusive business day count between two dates.
pub fn duration(start: &str, end: &str) -> i32 {
    date_utils::task_duration(start, end)
}

/// Return info about a date: day of week, weekend status, next/prev business day.
pub fn info(date: &str) -> String {
    let (y, m, d) = date_utils::parse_date(date);
    let dow = date_utils::day_of_week(y, m, d);
    let day_name = match dow {
        0 => "Sunday",
        1 => "Monday",
        2 => "Tuesday",
        3 => "Wednesday",
        4 => "Thursday",
        5 => "Friday",
        6 => "Saturday",
        _ => "Unknown",
    };

    let is_weekend = date_utils::is_weekend_date(date);

    if is_weekend {
        let next_biz = date_utils::ensure_business_day(date);
        format!("{day_name}\n# {date} is a weekend day\n# Next business day: {next_biz}")
    } else {
        format!("{day_name}\n# {date} is a weekday (business day)")
    }
}

/// Compute calendar days between two dates (inclusive of both endpoints).
pub fn calendar_days(start: &str, end: &str) -> i32 {
    let mut count = 0i32;
    let mut current = start.to_string();
    if start <= end {
        while current <= end.to_string() {
            count += 1;
            current = date_utils::add_days(&current, 1);
        }
    }
    count
}
