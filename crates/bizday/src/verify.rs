//! Date verification and lint module.
//!
//! Detects date math mismatches and weekend dates in scheduling contexts.
//! Uses simple string scanning (no regex crate) to keep dependencies minimal.

use ganttlet_scheduler::date_utils;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Warning {
    pub warning: String,
}

/// Lint from stdin (PostToolUse JSON).
pub fn lint_stdin() -> Vec<Warning> {
    let mut input = String::new();
    if std::io::Read::read_to_string(&mut std::io::stdin(), &mut input).is_ok() {
        lint_content(&input)
    } else {
        Vec::new()
    }
}

/// Lint a file for date math issues.
pub fn lint_file(path: &str) -> Vec<Warning> {
    match std::fs::read_to_string(path) {
        Ok(content) => lint_content(&content),
        Err(e) => vec![Warning {
            warning: format!("Could not read file {path}: {e}"),
        }],
    }
}

/// Check if a line is a comment line (should be skipped).
fn is_comment_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with("//")
        || trimmed.starts_with('#')
        || trimmed.starts_with('*')
        || trimmed.starts_with("<!--")
}

/// Try to extract a YYYY-MM-DD date at a given position in a string.
fn extract_date_at(s: &str, pos: usize) -> Option<&str> {
    if pos + 10 > s.len() {
        return None;
    }
    let candidate = &s[pos..pos + 10];
    if is_date_literal(candidate) {
        Some(candidate)
    } else {
        None
    }
}

/// Check if a string looks like YYYY-MM-DD.
fn is_date_literal(s: &str) -> bool {
    if s.len() != 10 {
        return false;
    }
    let bytes = s.as_bytes();
    // YYYY-MM-DD
    bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[0..4].iter().all(|b| b.is_ascii_digit())
        && bytes[5..7].iter().all(|b| b.is_ascii_digit())
        && bytes[8..10].iter().all(|b| b.is_ascii_digit())
}

/// Find all YYYY-MM-DD date literals in a string.
fn find_dates(s: &str) -> Vec<(usize, &str)> {
    let mut results = Vec::new();
    let bytes = s.as_bytes();
    if s.len() < 10 {
        return results;
    }
    for i in 0..=s.len() - 10 {
        if let Some(date) = extract_date_at(s, i) {
            // Make sure it's bounded (not part of a longer number)
            let before_ok = i == 0 || !bytes[i - 1].is_ascii_digit();
            let after_ok = i + 10 >= s.len() || !bytes[i + 10].is_ascii_digit();
            if before_ok && after_ok {
                results.push((i, date));
            }
        }
    }
    results
}

/// Parse an integer from a string slice, returning None if not a valid integer.
fn parse_int(s: &str) -> Option<i32> {
    s.trim().parse::<i32>().ok()
}

/// Scheduling context keywords that indicate a date is used in scheduling.
const SCHEDULING_KEYWORDS: &[&str] = &[
    "start_date",
    "end_date",
    "start",
    "end",
    "duration",
    "lag",
    "task_end_date",
    "task_duration",
    "task_start_date",
    "taskEndDate",
    "taskDuration",
    "business_day_delta",
    "assert",
    "expect",
    "constraint",
];

/// Check if a line contains scheduling context near a date.
fn has_scheduling_context(line: &str) -> bool {
    let lower = line.to_lowercase();
    SCHEDULING_KEYWORDS
        .iter()
        .any(|kw| lower.contains(&kw.to_lowercase()))
}

/// Core lint logic — analyzes content for date math issues.
pub fn lint_content(content: &str) -> Vec<Warning> {
    let mut warnings = Vec::new();

    for line in content.lines() {
        if is_comment_line(line) {
            continue;
        }

        // Check for task_end_date / taskEndDate calls with literal args near a date result
        check_end_date_calls(line, &mut warnings);

        // Check for task_duration / taskDuration calls with literal args near a number
        check_duration_calls(line, &mut warnings);

        // Check for weekend dates in scheduling contexts
        check_weekend_dates(line, &mut warnings);
    }

    warnings
}

/// Look for task_end_date("YYYY-MM-DD", N) or taskEndDate("YYYY-MM-DD", N)
/// patterns, and check if there's a nearby date that should match.
fn check_end_date_calls(line: &str, warnings: &mut Vec<Warning>) {
    for func_name in &["task_end_date", "taskEndDate"] {
        let mut search_from = 0;
        while let Some(pos) = line[search_from..].find(func_name) {
            let abs_pos = search_from + pos;
            if let Some(call) = parse_end_date_call(line, abs_pos + func_name.len()) {
                let actual = date_utils::task_end_date(&call.start, call.duration);
                // Look for a date near this call that should be the result
                let dates = find_dates(line);
                for &(dpos, date) in &dates {
                    // Skip the start date itself
                    if date == call.start {
                        continue;
                    }
                    // Check if this date is "near" the call (within ~80 chars)
                    let call_end = abs_pos + func_name.len() + call.span;
                    let dist = if dpos > call_end {
                        dpos - call_end
                    } else if abs_pos > dpos + 10 {
                        abs_pos - (dpos + 10)
                    } else {
                        0
                    };
                    if dist <= 80 && date != actual {
                        warnings.push(Warning {
                            warning: format!(
                                "Date check: {func_name}(\"{}\", {}) should be {actual}, but code has {date}.\n  Run: taskEndDate {} {}",
                                call.start, call.duration, call.start, call.duration
                            ),
                        });
                    }
                }
            }
            search_from = abs_pos + func_name.len();
        }
    }
}

struct EndDateCall {
    start: String,
    duration: i32,
    span: usize,
}

/// Parse ("YYYY-MM-DD", N) after a function name position.
fn parse_end_date_call(line: &str, after: usize) -> Option<EndDateCall> {
    let rest = &line[after..];
    let rest = rest.trim_start();
    if !rest.starts_with('(') {
        return None;
    }
    let rest = &rest[1..]; // skip '('

    // Find the start date (quoted or unquoted)
    let (start_date, rest) = extract_quoted_date(rest)?;

    // Skip comma and whitespace
    let rest = rest.trim_start();
    if !rest.starts_with(',') {
        return None;
    }
    let rest = &rest[1..].trim_start();

    // Parse the integer duration
    let end_of_num = rest
        .find(|c: char| !c.is_ascii_digit() && c != '-')
        .unwrap_or(rest.len());
    let dur = parse_int(&rest[..end_of_num])?;

    let total_span = (line.len() - after) - rest.len() + end_of_num;

    Some(EndDateCall {
        start: start_date.to_string(),
        duration: dur,
        span: total_span,
    })
}

/// Extract a quoted date like "YYYY-MM-DD" from a string, returning the date and remaining string.
fn extract_quoted_date(s: &str) -> Option<(String, &str)> {
    let s = s.trim_start();
    if s.starts_with('"') || s.starts_with('\'') {
        let quote = s.as_bytes()[0];
        let rest = &s[1..];
        let end = rest.find(|c: char| c as u8 == quote)?;
        let inner = &rest[..end];
        if is_date_literal(inner) {
            return Some((inner.to_string(), &rest[end + 1..]));
        }
    }
    // Try unquoted: just look for a date
    if s.len() >= 10 && is_date_literal(&s[..10]) {
        return Some((s[..10].to_string(), &s[10..]));
    }
    None
}

/// Look for task_duration("A", "B") or taskDuration("A", "B") near an integer.
fn check_duration_calls(line: &str, warnings: &mut Vec<Warning>) {
    for func_name in &["task_duration", "taskDuration"] {
        let mut search_from = 0;
        while let Some(pos) = line[search_from..].find(func_name) {
            let abs_pos = search_from + pos;
            if let Some(call) = parse_duration_call(line, abs_pos + func_name.len()) {
                let actual = date_utils::task_duration(&call.start, &call.end);
                // Look for integers near this call
                let numbers = find_integers(line);
                for &(npos, num) in &numbers {
                    let call_end = abs_pos + func_name.len() + call.span;
                    let dist = if npos > call_end {
                        npos - call_end
                    } else if abs_pos > npos {
                        abs_pos - npos
                    } else {
                        0
                    };
                    if dist <= 80 && num != actual && num > 0 {
                        warnings.push(Warning {
                            warning: format!(
                                "Date check: {func_name}(\"{}\", \"{}\") should be {actual}, but code has {num}.\n  Run: taskDuration {} {}",
                                call.start, call.end, call.start, call.end
                            ),
                        });
                    }
                }
            }
            search_from = abs_pos + func_name.len();
        }
    }
}

struct DurationCall {
    start: String,
    end: String,
    span: usize,
}

/// Parse ("A", "B") after a function name position.
fn parse_duration_call(line: &str, after: usize) -> Option<DurationCall> {
    let rest = &line[after..];
    let rest = rest.trim_start();
    if !rest.starts_with('(') {
        return None;
    }
    let rest = &rest[1..];

    let (start_date, rest) = extract_quoted_date(rest)?;
    let rest = rest.trim_start();
    if !rest.starts_with(',') {
        return None;
    }
    let rest = &rest[1..];
    let (end_date, rest) = extract_quoted_date(rest)?;

    let total_span = (line.len() - after) - rest.len();

    Some(DurationCall {
        start: start_date.to_string(),
        end: end_date.to_string(),
        span: total_span,
    })
}

/// Find all standalone integers in a line (not part of dates).
fn find_integers(s: &str) -> Vec<(usize, i32)> {
    let mut results = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            // Skip if this is part of a date (preceded by - and digits)
            if start >= 5 && bytes[start - 1] == b'-' {
                continue;
            }
            let num_str = &s[start..i];
            if let Some(n) = parse_int(num_str) {
                // Skip years (4 digits starting with 20xx)
                if !(num_str.len() == 4 && num_str.starts_with("20")) {
                    results.push((start, n));
                }
            }
        } else {
            i += 1;
        }
    }
    results
}

/// Check for weekend dates used as start_date or end_date in scheduling contexts.
fn check_weekend_dates(line: &str, warnings: &mut Vec<Warning>) {
    if !has_scheduling_context(line) {
        return;
    }

    let dates = find_dates(line);
    let lower = line.to_lowercase();

    for &(_pos, date) in &dates {
        if date_utils::is_weekend_date(date) {
            // Check if it's near a scheduling keyword
            let near_start = lower.contains("start_date")
                || (lower.contains("start") && !lower.contains("start_with"));
            let near_end = lower.contains("end_date")
                || (lower.contains("_end") && !lower.contains("weekend"));

            let (y, m, d) = date_utils::parse_date(date);
            let dow = date_utils::day_of_week(y, m, d);
            let day_name = match dow {
                0 => "Sunday",
                6 => "Saturday",
                _ => continue,
            };

            let context = if near_start {
                "start_date"
            } else if near_end {
                "end_date"
            } else {
                "scheduling context"
            };

            warnings.push(Warning {
                warning: format!(
                    "Weekend date: {date} ({day_name}) used as {context}. Tasks cannot start/end on weekends.\n  Check: bizday {date}"
                ),
            });
        }
    }
}
