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
