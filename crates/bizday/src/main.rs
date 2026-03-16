mod compute;
mod log;
mod report;
mod verify;

use std::env;
use std::process;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage();
        process::exit(1);
    }

    match args[1].as_str() {
        "help" | "--help" | "-h" => {
            print_usage();
        }
        "verify" => run_verify(&args[2..]),
        "lint" => run_lint(&args[2..]),
        "false-match" => run_false_match(&args[2..]),
        "report" => run_report(&args[2..]),
        _ => run_compute(&args[1..]),
    }
}

fn run_compute(args: &[String]) {
    if args.is_empty() {
        eprintln!("Error: expected at least one argument (date)");
        process::exit(1);
    }

    let first = &args[0];

    if args.len() == 1 {
        // bizday <date> — info mode
        let output = compute::info(first);
        println!("{output}");
        return;
    }

    let second = &args[1];

    // Try to parse second arg as integer (duration)
    if let Ok(dur) = second.parse::<i32>() {
        // bizday <date> <integer> — end date mode
        if dur < 1 {
            eprintln!("Error: duration must be >= 1");
            process::exit(1);
        }
        let result = compute::end_date(first, dur);
        log::log_compute("end_date", &format!("{first} {dur}"), &result);
        println!("{result}");
        println!("# task_end_date(\"{first}\", {dur}) = \"{result}\"");
    } else {
        // bizday <date> <date> — duration mode
        let biz_days = compute::duration(first, second);
        let cal_days = compute::calendar_days(first, second);
        log::log_compute(
            "duration",
            &format!("{first} {second}"),
            &biz_days.to_string(),
        );
        println!("{biz_days}");
        println!(
            "# task_duration(\"{first}\", \"{second}\") = {biz_days} business days ({cal_days} calendar days)"
        );
    }
}

fn run_verify(args: &[String]) {
    // bizday verify <date> <integer> <expected>
    if args.len() < 3 {
        eprintln!("Error: verify requires 3 arguments: <date> <duration> <expected>");
        process::exit(1);
    }

    let start = &args[0];
    let dur: i32 = match args[1].parse() {
        Ok(d) => d,
        Err(_) => {
            eprintln!("Error: second argument must be an integer");
            process::exit(1);
        }
    };
    let expected = &args[2];

    let start_time = std::time::Instant::now();
    let actual = compute::end_date(start, dur);
    let elapsed_ms = start_time.elapsed().as_millis() as u64;
    if actual == *expected {
        log::log_verified(
            &format!("task_end_date({start}, {dur}) = {actual}"),
            elapsed_ms,
        );
        println!("OK");
        println!("# task_end_date(\"{start}\", {dur}) = \"{actual}\" (matches expected)");
    } else {
        log::log_mismatch(
            &format!("task_end_date({start}, {dur}) expected={expected} actual={actual}"),
            elapsed_ms,
        );
        println!("MISMATCH");
        println!("# task_end_date(\"{start}\", {dur}) = \"{actual}\" (expected \"{expected}\")");
        process::exit(1);
    }
}

fn run_lint(args: &[String]) {
    if args.is_empty() {
        // Read from stdin
        let warnings = verify::lint_stdin();
        print_warnings(&warnings);
    } else if args[0] == "--stdin" {
        let warnings = verify::lint_stdin();
        print_warnings(&warnings);
    } else {
        let warnings = verify::lint_file(&args[0]);
        print_warnings(&warnings);
    }
}

fn print_warnings(warnings: &[verify::Warning]) {
    if warnings.is_empty() {
        println!("OK");
        println!("# No date issues found");
    } else {
        for w in warnings {
            let json = serde_json::to_string(&w).unwrap_or_default();
            println!("{json}");
        }
        process::exit(1);
    }
}

fn run_false_match(args: &[String]) {
    if args.is_empty() {
        eprintln!("Error: false-match requires <file>:<line> argument");
        process::exit(1);
    }
    log::record_false_match(&args[0]);
    println!("OK");
    println!("# Recorded false match: {}", args[0]);
}

fn run_report(args: &[String]) {
    report::run(args);
}

fn print_usage() {
    println!("bizday - Business day calculator (uses inclusive convention)");
    println!();
    println!("USAGE:");
    println!("  bizday <date> <duration>     End date for N-day task (inclusive)");
    println!("  bizday <date> <date>         Inclusive business day count between dates");
    println!("  bizday <date>                Date info (day of week, weekend check)");
    println!("  bizday verify <date> <dur> <expected>  Verify and exit 0/1");
    println!("  bizday lint [<file>]          Lint file for date math issues");
    println!("  bizday lint --stdin           Lint from stdin (PostToolUse JSON)");
    println!("  bizday false-match <file>:<line>  Record false positive");
    println!("  bizday report [flags]         Show verification metrics");
    println!("  bizday help                   Show this help");
    println!();
    println!("CONVENTION:");
    println!("  end_date is INCLUSIVE - the last working day the task occupies.");
    println!("  duration counts both endpoints: Mon-Fri = 5 business days.");
    println!("  bizday 2026-03-11 10 = 2026-03-24 (task_end_date, NOT shift_date)");
    println!();
    println!("REPORT FLAGS:");
    println!("  --trend          Per-session table");
    println!("  --mismatches     List all MISMATCH events");
    println!("  --unverified     List unverified dates");
    println!("  --false-matches  List FALSE_MATCH events");
    println!("  --slow           Events with elapsed_ms > 10");
    println!("  --pr-summary     Markdown table for PR descriptions");
    println!("  --eval           Checkpoint evaluation");
    println!("  --session <id>   Filter to specific session");
}
