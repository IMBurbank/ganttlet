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

/// Add `n` business days (Mon-Fri) to a date string. Matches date-fns/addBusinessDays.
/// Positive values go forward, negative values go backward.
pub fn add_business_days(date_str: &str, n: i32) -> String {
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

/// Advance a date to the next business day if it falls on a weekend.
/// Returns the date unchanged if it is already a business day.
pub fn next_biz_day_on_or_after(date: &str) -> String {
    let (y, m, d) = parse_date(date);
    if is_weekend(y, m, d) {
        add_business_days(date, 1)
    } else {
        date.to_string()
    }
}

/// Count the number of business days needed to advance `from` to reach `to`.
/// `to` must be >= `from`; returns 0 if `to <= from`.
/// Used by cascade to compute minimum shift amounts.
pub fn count_biz_days_to(from: &str, to: &str) -> i32 {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_business_days_forward() {
        // Wed Mar 11 + 10 business days = Wed Mar 25
        assert_eq!(add_business_days("2026-03-11", 10), "2026-03-25");
        // Fri Mar 20 + 10 business days = Fri Apr 3
        assert_eq!(add_business_days("2026-03-20", 10), "2026-04-03");
        // Sun Mar 1 + 10 business days = Fri Mar 13
        assert_eq!(add_business_days("2026-03-01", 10), "2026-03-13");
    }

    #[test]
    fn add_business_days_backward() {
        // Wed Mar 25 - 10 business days = Wed Mar 11
        assert_eq!(add_business_days("2026-03-25", -10), "2026-03-11");
    }

    #[test]
    fn add_business_days_from_weekend() {
        // Sat 2026-03-21 + 5 should match date-fns: 2026-03-27
        assert_eq!(add_business_days("2026-03-21", 5), "2026-03-27");
        // Sun 2026-03-01 + 10 should match date-fns: 2026-03-13
        assert_eq!(add_business_days("2026-03-01", 10), "2026-03-13");
        // Fri 2026-03-20 + 5 should be: 2026-03-27
        assert_eq!(add_business_days("2026-03-20", 5), "2026-03-27");
    }

    #[test]
    fn count_biz_days_to_basic() {
        // Mon Mar 09 to Tue Mar 17 across a weekend
        // Mar 10(1), 11(2), 12(3), 13(4), [14 Sat, 15 Sun], 16(5), 17(6)? wait:
        // from Mar 09, stepping to Mar 17:
        // Mar 10 Mon:1, 11 Tue:2, 12 Wed:3, 13 Thu:4, [14 Sat skip, 15 Sun skip], 16 Mon:5, 17 Tue:6
        // Actually Mar 9 is Mon (Mar 1=Sun, +8=Mon)
        assert_eq!(count_biz_days_to("2026-03-09", "2026-03-17"), 6);
        // Same date: 0
        assert_eq!(count_biz_days_to("2026-03-09", "2026-03-09"), 0);
        // from > to: 0
        assert_eq!(count_biz_days_to("2026-03-17", "2026-03-09"), 0);
        // Adjacent weekdays: 1
        assert_eq!(count_biz_days_to("2026-03-09", "2026-03-10"), 1);
        // Fri to Mon = 1 business day
        assert_eq!(count_biz_days_to("2026-03-06", "2026-03-09"), 1);
    }

    #[test]
    fn day_of_week_known_dates() {
        assert_eq!(day_of_week(2026, 3, 1), 0); // Sunday
        assert_eq!(day_of_week(2026, 3, 2), 1); // Monday
        assert_eq!(day_of_week(2026, 3, 6), 5); // Friday
        assert_eq!(day_of_week(2026, 3, 7), 6); // Saturday
    }
}
