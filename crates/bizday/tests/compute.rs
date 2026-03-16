//! Hand-written integration tests for the bizday CLI.

use std::process::Command;

fn bizday(args: &[&str]) -> (String, i32) {
    let output = Command::new(env!("CARGO_BIN_EXE_bizday"))
        .args(args)
        .output()
        .expect("failed to run bizday");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    (stdout, output.status.code().unwrap_or(-1))
}

fn first_line(output: &str) -> &str {
    output.lines().next().unwrap_or("")
}

// --- end date tests ---

#[test]
fn end_date_10_day_task() {
    // bizday 2026-03-11 10 -> 2026-03-24
    let (out, code) = bizday(&["2026-03-11", "10"]);
    assert_eq!(code, 0);
    assert_eq!(first_line(&out), "2026-03-24");
}

#[test]
fn end_date_5_day_task() {
    // bizday 2026-03-02 5 -> 2026-03-06
    let (out, code) = bizday(&["2026-03-02", "5"]);
    assert_eq!(code, 0);
    assert_eq!(first_line(&out), "2026-03-06");
}

#[test]
fn end_date_same_day_task() {
    // bizday 2026-03-02 1 -> 2026-03-02
    let (out, code) = bizday(&["2026-03-02", "1"]);
    assert_eq!(code, 0);
    assert_eq!(first_line(&out), "2026-03-02");
}

#[test]
fn end_date_crossing_weekend() {
    // bizday 2026-03-06 3 -> 2026-03-10 (Friday + 3 = Tuesday)
    let (out, code) = bizday(&["2026-03-06", "3"]);
    assert_eq!(code, 0);
    assert_eq!(first_line(&out), "2026-03-10");
}

// --- duration tests ---

#[test]
fn duration_10_day_span() {
    // bizday 2026-03-11 2026-03-24 -> 10
    let (out, code) = bizday(&["2026-03-11", "2026-03-24"]);
    assert_eq!(code, 0);
    assert_eq!(first_line(&out), "10");
}

#[test]
fn duration_same_day() {
    // bizday 2026-03-02 2026-03-02 -> 1
    let (out, code) = bizday(&["2026-03-02", "2026-03-02"]);
    assert_eq!(code, 0);
    assert_eq!(first_line(&out), "1");
}

// --- info tests ---

#[test]
fn info_weekend_saturday() {
    // bizday 2026-03-07 -> contains "Saturday" and "2026-03-09"
    let (out, code) = bizday(&["2026-03-07"]);
    assert_eq!(code, 0);
    assert!(out.contains("Saturday"), "expected 'Saturday' in: {out}");
    assert!(
        out.contains("2026-03-09"),
        "expected '2026-03-09' in: {out}"
    );
}

// --- verify tests ---

#[test]
fn verify_correct_exits_0() {
    // bizday verify 2026-03-11 10 2026-03-24 -> exit 0
    let (out, code) = bizday(&["verify", "2026-03-11", "10", "2026-03-24"]);
    assert_eq!(code, 0);
    assert!(out.contains("OK"), "expected 'OK' in: {out}");
}

#[test]
fn verify_wrong_exits_1() {
    // bizday verify 2026-03-11 10 2026-03-25 -> exit 1
    let (_, code) = bizday(&["verify", "2026-03-11", "10", "2026-03-25"]);
    assert_eq!(code, 1);
}
