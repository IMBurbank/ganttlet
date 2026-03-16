//! Report module — parses bizday.log and generates summaries.
//!
//! Reads from `.claude/logs/bizday.log` (or `$BIZDAY_LOG_DIR/bizday.log`).

use crate::log as bizday_log;
use std::collections::HashMap;

/// A parsed log event.
#[derive(Debug, Clone)]
struct Event {
    timestamp: u64,
    event_type: String,
    details: String,
    session: String,
    elapsed_ms: Option<u64>,
}

/// Per-session statistics.
#[derive(Debug, Default)]
struct SessionStats {
    computes: u32,
    verified: u32,
    mismatches: u32,
    weekends: u32,
    unverifiable: u32,
    suppressed: u32,
    false_matches: u32,
}

/// Run the report command with the given flags.
pub fn run(args: &[String]) {
    let log_path = bizday_log::log_path();
    let content = match std::fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => {
            println!("0 sessions, 0 events");
            println!("# No log data found at {log_path}");
            return;
        }
    };

    let events = parse_log(&content);
    if events.is_empty() {
        println!("0 sessions, 0 events");
        println!("# Log file is empty");
        return;
    }

    // Parse flags
    let session_filter = get_flag_value(args, "--session");
    let events = if let Some(ref sid) = session_filter {
        events
            .into_iter()
            .filter(|e| e.session == *sid)
            .collect::<Vec<_>>()
    } else {
        events
    };

    if args.iter().any(|a| a == "--trend") {
        run_trend(&events);
    } else if args.iter().any(|a| a == "--mismatches") {
        run_mismatches(&events);
    } else if args.iter().any(|a| a == "--unverified") {
        run_unverified(&events);
    } else if args.iter().any(|a| a == "--false-matches") {
        run_false_matches(&events);
    } else if args.iter().any(|a| a == "--slow") {
        run_slow(&events);
    } else if args.iter().any(|a| a == "--pr-summary") {
        run_pr_summary(&events);
    } else if args.iter().any(|a| a == "--eval") {
        run_eval(&events);
    } else {
        run_default(&events);
    }
}

fn get_flag_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1).cloned())
}

fn parse_log(content: &str) -> Vec<Event> {
    let mut events = Vec::new();
    let mut current_session = String::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.splitn(3, ' ').collect();
        if parts.len() < 2 {
            continue;
        }

        let timestamp: u64 = parts[0].parse().unwrap_or(0);
        let event_type = parts[1].to_string();
        let details = if parts.len() > 2 {
            parts[2].to_string()
        } else {
            String::new()
        };

        if event_type == "SESSION" {
            current_session = details.clone();
            continue;
        }

        // Extract elapsed_ms if present
        let elapsed_ms = details
            .split_whitespace()
            .find(|s| s.starts_with("elapsed_ms="))
            .and_then(|s| s.strip_prefix("elapsed_ms="))
            .and_then(|s| s.parse::<u64>().ok());

        events.push(Event {
            timestamp,
            event_type,
            details,
            session: current_session.clone(),
            elapsed_ms,
        });
    }

    events
}

fn session_stats(events: &[Event]) -> HashMap<String, SessionStats> {
    let mut stats: HashMap<String, SessionStats> = HashMap::new();
    for e in events {
        let s = stats.entry(e.session.clone()).or_default();
        match e.event_type.as_str() {
            "COMPUTE" => s.computes += 1,
            "VERIFIED" => s.verified += 1,
            "MISMATCH" => s.mismatches += 1,
            "WEEKEND" => s.weekends += 1,
            "UNVERIFIABLE" => s.unverifiable += 1,
            "SUPPRESSED" => s.suppressed += 1,
            "FALSE_MATCH" => s.false_matches += 1,
            _ => {}
        }
    }
    stats
}

fn run_default(events: &[Event]) {
    let stats = session_stats(events);
    let sessions = stats.len();
    let total_events: u32 = events.len() as u32;
    let total_computes: u32 = stats.values().map(|s| s.computes).sum();
    let total_verified: u32 = stats.values().map(|s| s.verified).sum();
    let total_mismatches: u32 = stats.values().map(|s| s.mismatches).sum();
    let total_false_matches: u32 = stats.values().map(|s| s.false_matches).sum();

    let proactive_rate = if total_events > 0 {
        (total_computes as f64 / total_events as f64) * 100.0
    } else {
        0.0
    };
    let fp_rate = if total_verified + total_mismatches > 0 {
        (total_false_matches as f64 / (total_verified + total_mismatches) as f64) * 100.0
    } else {
        0.0
    };

    println!(
        "{sessions} sessions, {total_events} events, {total_computes} computes, \
         {total_mismatches} mismatches, proactive={proactive_rate:.0}%, FP={fp_rate:.1}%"
    );
}

fn run_trend(events: &[Event]) {
    let stats = session_stats(events);
    println!(
        "{:<12} {:>8} {:>8} {:>10} {:>8} {:>6}",
        "Session", "Compute", "Verified", "Mismatch", "Weekend", "FP"
    );
    println!("{}", "-".repeat(60));

    let mut cum = SessionStats::default();
    let mut sorted: Vec<_> = stats.iter().collect();
    sorted.sort_by(|(a, _), (b, _)| a.cmp(b));

    for (sid, s) in &sorted {
        println!(
            "{:<12} {:>8} {:>8} {:>10} {:>8} {:>6}",
            sid, s.computes, s.verified, s.mismatches, s.weekends, s.false_matches
        );
        cum.computes += s.computes;
        cum.verified += s.verified;
        cum.mismatches += s.mismatches;
        cum.weekends += s.weekends;
        cum.false_matches += s.false_matches;
    }
    println!("{}", "-".repeat(60));
    println!(
        "{:<12} {:>8} {:>8} {:>10} {:>8} {:>6}",
        "TOTAL", cum.computes, cum.verified, cum.mismatches, cum.weekends, cum.false_matches
    );
}

fn run_mismatches(events: &[Event]) {
    let mismatches: Vec<_> = events
        .iter()
        .filter(|e| e.event_type == "MISMATCH")
        .collect();
    if mismatches.is_empty() {
        println!("No mismatches found");
        return;
    }
    for e in &mismatches {
        println!("[{}] session={} {}", e.timestamp, e.session, e.details);
    }
    println!("# Total: {} mismatches", mismatches.len());
}

fn run_unverified(events: &[Event]) {
    let unverified: Vec<_> = events
        .iter()
        .filter(|e| e.event_type == "UNVERIFIABLE")
        .collect();
    if unverified.is_empty() {
        println!("No unverified dates found");
        return;
    }
    for e in &unverified {
        println!("[{}] session={} {}", e.timestamp, e.session, e.details);
    }
    println!("# Total: {} unverified", unverified.len());
}

fn run_false_matches(events: &[Event]) {
    let fps: Vec<_> = events
        .iter()
        .filter(|e| e.event_type == "FALSE_MATCH")
        .collect();
    if fps.is_empty() {
        println!("No false matches recorded");
        return;
    }
    for e in &fps {
        println!("[{}] session={} {}", e.timestamp, e.session, e.details);
    }
    println!("# Total: {} false matches", fps.len());
}

fn run_slow(events: &[Event]) {
    let slow: Vec<_> = events
        .iter()
        .filter(|e| e.elapsed_ms.map_or(false, |ms| ms > 10))
        .collect();
    if slow.is_empty() {
        println!("No slow events (all < 10ms)");
        return;
    }
    for e in &slow {
        println!(
            "[{}] {} {}ms {}",
            e.timestamp,
            e.event_type,
            e.elapsed_ms.unwrap_or(0),
            e.details
        );
    }
}

fn run_pr_summary(events: &[Event]) {
    let stats = session_stats(events);
    let sessions = stats.len();
    let total_computes: u32 = stats.values().map(|s| s.computes).sum();
    let total_verified: u32 = stats.values().map(|s| s.verified).sum();
    let total_mismatches: u32 = stats.values().map(|s| s.mismatches).sum();
    let total_weekends: u32 = stats.values().map(|s| s.weekends).sum();
    let total_false_matches: u32 = stats.values().map(|s| s.false_matches).sum();

    println!("| Metric | Value |");
    println!("|--------|-------|");
    println!("| Sessions | {sessions} |");
    println!("| Computes | {total_computes} |");
    println!("| Verified | {total_verified} |");
    println!("| Mismatches | {total_mismatches} |");
    println!("| Weekend warnings | {total_weekends} |");
    println!("| False positives | {total_false_matches} |");
}

fn run_eval(events: &[Event]) {
    let stats = session_stats(events);
    let sessions = stats.len();

    // Checkpoint at 10, 50, then every 50
    let checkpoints = [10, 50, 100, 150, 200, 250, 300];
    let checkpoint = checkpoints.iter().rev().find(|&&c| sessions >= c);

    match checkpoint {
        Some(&c) => {
            let total_computes: u32 = stats.values().map(|s| s.computes).sum();
            let total_verified: u32 = stats.values().map(|s| s.verified).sum();
            let total_mismatches: u32 = stats.values().map(|s| s.mismatches).sum();
            let coverage = if total_computes + total_verified > 0 {
                ((total_verified as f64) / (total_computes + total_verified) as f64) * 100.0
            } else {
                0.0
            };
            println!(
                "Checkpoint {c}: {sessions} sessions, coverage={coverage:.0}%, mismatches={total_mismatches}"
            );
        }
        None => {
            println!("Not enough sessions for evaluation ({sessions} < 10). Keep going!");
        }
    }
}
