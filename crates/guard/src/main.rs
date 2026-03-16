use guard::{block_json, check_bash, check_edit, is_infra_error, read_stdin};
use std::process;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(|s| s.as_str()).unwrap_or("");

    // Read stdin once — fail-open on infrastructure errors (ENXIO/EAGAIN/ENOENT)
    let stdin_data = match read_stdin() {
        Ok(data) => data,
        Err(ref e) if is_infra_error(e) => {
            // Infrastructure issue: stdin FD unavailable — fail-open, don't brick session
            process::exit(0);
        }
        Err(e) => {
            println!("{}", block_json(&format!("Hook error — blocking: {}", e)));
            process::exit(0);
        }
    };

    // Parse JSON — fail-closed on malformed input (logic error)
    let input: serde_json::Value = match serde_json::from_str(&stdin_data) {
        Ok(v) => v,
        Err(e) => {
            println!("{}", block_json(&format!("Hook error — blocking: {}", e)));
            process::exit(0);
        }
    };

    let result = match mode {
        "edit" => check_edit(&input),
        "bash" => check_bash(&input),
        _ => None, // Unknown mode: fail-open
    };

    if let Some(reason) = result {
        println!("{}", block_json(&reason));
    }

    process::exit(0);
}
