//! Tests for the verify/lint module.

use std::process::Command;

fn bizday_lint_content(content: &str) -> (String, i32) {
    let output = Command::new(env!("CARGO_BIN_EXE_bizday"))
        .args(["lint", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("failed to start bizday");

    use std::io::Write;
    let mut child = output;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(content.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    (stdout, output.status.code().unwrap_or(-1))
}

fn bizday_lint_file(path: &str) -> (String, i32) {
    let output = Command::new(env!("CARGO_BIN_EXE_bizday"))
        .args(["lint", path])
        .output()
        .expect("failed to run bizday");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    (stdout, output.status.code().unwrap_or(-1))
}

#[test]
fn mismatch_detected_end_date() {
    // task_end_date("2026-03-11", 10) near "2026-03-25" should warn (correct is 2026-03-24)
    let content = r#"let end = task_end_date("2026-03-11", 10); // "2026-03-25""#;
    let (out, code) = bizday_lint_content(content);
    assert_eq!(code, 1, "expected exit 1 for mismatch, got stdout: {out}");
    assert!(
        out.contains("2026-03-24"),
        "expected correct date in warning: {out}"
    );
    assert!(
        out.contains("2026-03-25"),
        "expected wrong date mentioned: {out}"
    );
}

#[test]
fn correct_value_no_warning() {
    // task_end_date("2026-03-11", 10) near "2026-03-24" should NOT warn
    let content = r#"let end = task_end_date("2026-03-11", 10); // "2026-03-24""#;
    let (out, code) = bizday_lint_content(content);
    assert_eq!(code, 0, "expected exit 0 for correct value, got: {out}");
    assert!(out.contains("OK"), "expected OK: {out}");
}

#[test]
fn weekend_detection() {
    // start_date: "2026-03-07" should warn (Saturday)
    let content = r#"start_date: "2026-03-07""#;
    let (out, code) = bizday_lint_content(content);
    assert_eq!(code, 1, "expected exit 1 for weekend, got: {out}");
    assert!(
        out.contains("Saturday"),
        "expected Saturday in warning: {out}"
    );
    assert!(
        out.contains("weekend"),
        "expected 'weekend' in warning: {out}"
    );
}

#[test]
fn comment_exclusion() {
    // Comments should be skipped
    let content = r#"// task_end_date("2026-03-11", 10) "2026-03-25""#;
    let (out, code) = bizday_lint_content(content);
    assert_eq!(code, 0, "expected exit 0 for comment, got: {out}");
    assert!(out.contains("OK"), "expected OK for comment: {out}");
}

#[test]
fn non_scheduling_context_no_warn() {
    // Plain date without scheduling context should not trigger weekend warning
    let content = r#"let birthday = "2026-03-07"; // just a date"#;
    let (out, code) = bizday_lint_content(content);
    assert_eq!(
        code, 0,
        "expected exit 0 for non-scheduling context, got: {out}"
    );
}

#[test]
fn lint_file_works() {
    use std::io::Write;
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    writeln!(
        tmp,
        r#"let end = task_end_date("2026-03-11", 10); // "2026-03-25""#
    )
    .unwrap();
    tmp.flush().unwrap();

    let (out, code) = bizday_lint_file(tmp.path().to_str().unwrap());
    assert_eq!(code, 1, "expected exit 1 for file lint mismatch: {out}");
    assert!(out.contains("2026-03-24"), "expected correct date: {out}");
}

#[test]
fn taskenddate_js_variant() {
    // JS-style function name also detected
    let content = r#"const end = taskEndDate("2026-03-11", 10); // "2026-03-25""#;
    let (out, code) = bizday_lint_content(content);
    assert_eq!(code, 1, "expected exit 1 for JS variant mismatch: {out}");
    assert!(out.contains("2026-03-24"), "expected correct date: {out}");
}
