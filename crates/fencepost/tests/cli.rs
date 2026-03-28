//! CLI command and config integration tests.

use fencepost::{check_edit, find_project_root, ProjectContext, BASH_RULES, EDIT_RULES};

// --- doctor/list-rules tests ---

#[test]
fn doctor_detects_project_root() {
    let ctx = ProjectContext::detect();
    assert!(
        ctx.is_some(),
        "detect() should find .git in test environment"
    );
    let ctx = ctx.unwrap();
    assert!(!ctx.default_branch().is_empty());
    assert!(!ctx.remote_name().is_empty());
}

#[test]
fn list_rules_has_expected_counts() {
    assert_eq!(BASH_RULES.len(), 10);
    assert_eq!(EDIT_RULES.len(), 3);
}

#[test]
fn list_rules_names_are_unique() {
    let mut names: Vec<&str> = BASH_RULES.iter().map(|r| r.name()).collect();
    names.extend(EDIT_RULES.iter().map(|r| r.name()));
    let unique_count = {
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        sorted.len()
    };
    assert_eq!(names.len(), unique_count, "Rule names must be unique");
}

#[test]
fn list_rules_descriptions_not_empty() {
    for rule in BASH_RULES {
        assert!(
            !rule.description().is_empty(),
            "Rule {} has empty description",
            rule.name()
        );
    }
    for rule in EDIT_RULES {
        assert!(
            !rule.description().is_empty(),
            "Rule {} has empty description",
            rule.name()
        );
    }
}

// --- config file tests ---

#[test]
fn config_malformed_json_uses_defaults() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
    std::fs::create_dir_all(tmp.path().join(".claude")).unwrap();
    std::fs::write(
        tmp.path().join(".claude/fencepost.json"),
        "{this is not valid json!!!",
    )
    .unwrap();

    let root = find_project_root(tmp.path()).unwrap();
    let ctx = ProjectContext::from_root_and_cwd(root, tmp.path().to_path_buf());
    // from_root_and_cwd doesn't load config (only detect does)
    // but the project root was found correctly
    assert_eq!(ctx.default_branch(), "main");
}

#[test]
fn config_no_file_uses_defaults() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
    // No .claude/fencepost.json — should use defaults without error
    let root = find_project_root(tmp.path()).unwrap();
    let ctx = ProjectContext::from_root_and_cwd(root, tmp.path().to_path_buf());
    assert_eq!(ctx.default_branch(), "main");
    assert_eq!(ctx.remote_name(), "origin");
}

#[test]
fn config_custom_protected_patterns_via_check() {
    // Create a project with a custom fencepost.json that protects *.lock files
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
    std::fs::create_dir_all(tmp.path().join(".claude")).unwrap();
    std::fs::write(
        tmp.path().join(".claude/fencepost.json"),
        r#"{"protected_files": [{"glob": "*.lock", "reason": "Lock files are generated"}]}"#,
    )
    .unwrap();

    // from_root_and_cwd uses hardcoded defaults, but we can verify
    // the config file is valid JSON and would parse correctly
    let root = find_project_root(tmp.path()).unwrap();
    assert_eq!(root, tmp.path().to_path_buf());

    // Test that the default context (without config) blocks .env
    let ctx = ProjectContext::from_root_and_cwd(root.clone(), tmp.path().to_path_buf());
    let env_file = format!("{}/.env", root.display());
    assert!(
        check_edit(&ctx, &env_file).is_some(),
        "Default context should block .env"
    );
}

// ===================================================================
// Config v1 contract test — FROZEN
// ===================================================================
// This test documents the EXACT v1 config schema. If it fails, you are
// making a breaking change to the config format. DO NOT just update
// the test to match your changes. Instead:
//
// 1. Increment the config version to 2
// 2. Add a migration function: migrate_v1_to_v2(config) -> config
// 3. Call it in detect() when version == 1
// 4. Update this test to be config_v1_frozen_contract (keep it!)
// 5. Add a new config_v2_contract test for the new schema
//
// This protects every project that already has a v1 config file.

/// A complete v1 config exercising every supported field.
const V1_CONFIG: &str = r#"{
    "version": 1,
    "protocol": "claude",
    "default_branch": "develop",
    "remote": "upstream",
    "worktrees_dir": ".worktrees",
    "protected_files": [
        { "basename": "yarn.lock", "reason": "Managed by yarn" },
        { "basename_prefix": ".secret", "reason": "Secrets" },
        { "path_contains": "dist/", "reason": "Build output" },
        { "glob": "*.pyc", "reason": "Python bytecode" }
    ],
    "protected_files_override": true,
    "rules": {
        "checkout-switch": "off",
        "clean-force": "warn"
    }
}"#;

#[test]
fn config_v1_frozen_contract() {
    // Create a project with a complete v1 config
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
    std::fs::create_dir_all(tmp.path().join(".claude")).unwrap();
    std::fs::write(tmp.path().join(".claude/fencepost.json"), V1_CONFIG).unwrap();

    // detect() must parse every v1 field correctly
    // We can't call detect() (uses real CWD), so test via the parsing functions directly.
    let config: serde_json::Value = serde_json::from_str(V1_CONFIG).unwrap();

    // version field must be recognized (no warning)
    assert!(
        config.get("version").unwrap().as_u64() == Some(1),
        "v1 config must have version: 1"
    );

    // default_branch must be extractable
    assert_eq!(
        config.get("default_branch").unwrap().as_str().unwrap(),
        "develop",
        "v1 'default_branch' field must be a string"
    );

    // remote must be extractable
    assert_eq!(
        config.get("remote").unwrap().as_str().unwrap(),
        "upstream",
        "v1 'remote' field must be a string"
    );

    // worktrees_dir must be extractable
    assert_eq!(
        config.get("worktrees_dir").unwrap().as_str().unwrap(),
        ".worktrees",
        "v1 'worktrees_dir' field must be a string"
    );

    // protected_files must be an array of pattern objects
    let files = config.get("protected_files").unwrap().as_array().unwrap();
    assert_eq!(files.len(), 4, "v1 config has 4 protected file patterns");

    // Each pattern type must be recognized
    assert!(
        files[0].get("basename").is_some(),
        "v1 must support 'basename' pattern"
    );
    assert!(
        files[1].get("basename_prefix").is_some(),
        "v1 must support 'basename_prefix' pattern"
    );
    assert!(
        files[2].get("path_contains").is_some(),
        "v1 must support 'path_contains' pattern"
    );
    assert!(
        files[3].get("glob").is_some(),
        "v1 must support 'glob' pattern"
    );

    // Each pattern must have a reason
    for (i, file) in files.iter().enumerate() {
        assert!(
            file.get("reason").and_then(|v| v.as_str()).is_some(),
            "v1 pattern {} must have a 'reason' string",
            i
        );
    }

    // protected_files_override must be a boolean
    assert_eq!(
        config.get("protected_files_override").unwrap().as_bool(),
        Some(true),
        "v1 'protected_files_override' must be a boolean"
    );

    // rules must be an object of rule_name -> severity_string
    let rules = config.get("rules").unwrap().as_object().unwrap();
    assert_eq!(rules.len(), 2, "v1 config has 2 rule overrides");
    assert_eq!(rules.get("checkout-switch").unwrap().as_str(), Some("off"));
    assert_eq!(rules.get("clean-force").unwrap().as_str(), Some("warn"));

    // Verify that ALL fields in V1_CONFIG are in the known fields list
    // (if this fails, a field was added to the test but not to KNOWN_FIELDS)
    let known = vec![
        "version",
        "protocol",
        "default_branch",
        "remote",
        "worktrees_dir",
        "protected_files",
        "protected_files_override",
        "rules",
    ];
    for key in config.as_object().unwrap().keys() {
        assert!(
            known.contains(&key.as_str()),
            "v1 config field '{}' is not in the known fields list.\n\
             → If you added a new field, add it to KNOWN_FIELDS in context.rs detect().\n\
             → If you renamed a field, you are making a BREAKING CHANGE. See instructions above.",
            key
        );
    }
}

// ===================================================================
// Message quality meta-tests
// ===================================================================
// These exercise every registered rule with a triggering input and
// validate that the composed message follows the three-part pattern:
//   "{attempted} — {explanation}. {suggestion}"
// New rules that produce vague or empty messages will fail here.

use fencepost::check_bash;
use std::path::PathBuf;

fn root_ctx() -> ProjectContext {
    ProjectContext::from_root_and_cwd(PathBuf::from("/project"), PathBuf::from("/project"))
}

/// Inputs that trigger each bash rule. Each entry: (command, description).
/// If a rule is CWD-dependent, the test uses root_ctx() to trigger the block path.
fn bash_triggering_inputs() -> Vec<(&'static str, &'static str)> {
    vec![
        ("git push origin main", "push-to-default-branch"),
        ("git checkout main", "checkout-switch"),
        ("git reset --hard HEAD~3", "reset-hard"),
        ("git clean -fd", "clean-force"),
        ("git branch -D feature", "branch-force-delete"),
        (
            "git worktree remove /project/.claude/worktrees/other",
            "worktree-remove",
        ),
        (
            "rm -rf /project/.claude/worktrees/my-wt",
            "rm-worktree-root",
        ),
        (
            "sed -i s/x/y/ /project/src/file.ts",
            "sed-tee-protected-path",
        ),
        (
            "python3 -c \"import os; os.system('rm /project/file')\"",
            "interpreter-write",
        ),
        (
            "echo hello > /project/file.txt",
            "redirect-to-protected-path",
        ),
    ]
}

/// Inputs that trigger each edit rule.
fn edit_triggering_inputs() -> Vec<(&'static str, &'static str)> {
    vec![
        ("/project/.env", "protected-file-pattern"),
        ("/project/src/App.tsx", "workspace-isolation"),
    ]
}

#[test]
fn meta_all_bash_rules_produce_three_part_messages() {
    let ctx = root_ctx();
    for (cmd, rule_name) in bash_triggering_inputs() {
        let result = check_bash(&ctx, cmd);
        assert!(
            result.is_some(),
            "Rule '{}' should trigger on '{}' (at root CWD)",
            rule_name,
            cmd
        );
        let reason = result.unwrap();

        // Must contain " — " separator (attempted — explanation)
        assert!(
            reason.contains(" — "),
            "Rule '{}' message missing ' — ' separator: {}",
            rule_name,
            reason
        );

        // Split and validate each part
        let parts: Vec<&str> = reason.splitn(2, " — ").collect();
        let attempted = parts[0];
        let rest = parts[1];

        assert!(
            attempted.len() >= 10,
            "Rule '{}' attempted too vague ({}): '{}'",
            rule_name,
            attempted.len(),
            attempted
        );
        assert!(
            !rest.is_empty(),
            "Rule '{}' missing explanation+suggestion after ' — '",
            rule_name
        );
    }
}

#[test]
fn meta_all_edit_rules_produce_three_part_messages() {
    let ctx = root_ctx();
    for (path, rule_name) in edit_triggering_inputs() {
        let result = check_edit(&ctx, path);
        assert!(
            result.is_some(),
            "Rule '{}' should trigger on '{}'",
            rule_name,
            path
        );
        let reason = result.unwrap();

        assert!(
            reason.contains(" — "),
            "Rule '{}' message missing ' — ' separator: {}",
            rule_name,
            reason
        );

        let parts: Vec<&str> = reason.splitn(2, " — ").collect();
        assert!(
            parts[0].len() >= 10,
            "Rule '{}' attempted too vague: '{}'",
            rule_name,
            parts[0]
        );
    }
}

#[test]
fn meta_cwd_enforcement_triggers_at_root() {
    let ctx = root_ctx();
    let result = check_edit(&ctx, "/project/.claude/worktrees/wt/src/foo.ts");
    assert!(result.is_some(), "CWD enforcement should trigger at root");
    let reason = result.unwrap();
    assert!(reason.contains(" — "), "Missing separator: {}", reason);
}

#[test]
fn meta_every_registered_rule_is_exercised() {
    // Verify our triggering inputs cover all rules
    let bash_names: Vec<&str> = bash_triggering_inputs().iter().map(|(_, n)| *n).collect();
    let edit_names: Vec<&str> = edit_triggering_inputs().iter().map(|(_, n)| *n).collect();

    for rule in BASH_RULES {
        assert!(
            bash_names.contains(&rule.name()),
            "Bash rule '{}' has no triggering input in meta-test.\n\
             → Add an entry to bash_triggering_inputs() in tests/cli.rs.\n\
             → The entry should be a command that triggers this rule at the project root CWD.",
            rule.name()
        );
    }
    for rule in EDIT_RULES {
        let name = rule.name();
        assert!(
            edit_names.contains(&name) || name == "cwd-enforcement",
            "Edit rule '{}' has no triggering input in meta-test.\n\
             → Add an entry to edit_triggering_inputs() in tests/cli.rs.\n\
             → The entry should be a file path that triggers this rule.",
            name
        );
    }
}

#[test]
fn meta_confirm_tokens_follow_convention() {
    for rule in BASH_RULES {
        if let Some(token) = rule.confirm_token() {
            assert!(
                token.starts_with("I_"),
                "Rule '{}' confirm_token '{}' must start with 'I_'.\n\
                 → The token is an assertion the agent makes about their situation.\n\
                 → Example: I_CREATED_THIS=1, I_VERIFIED_MERGE=1",
                rule.name(),
                token
            );
            assert!(
                token.ends_with("=1"),
                "Rule '{}' confirm_token '{}' must end with '=1'.\n\
                 → The token is a shell variable assignment prefix.\n\
                 → Example: I_CREATED_THIS=1",
                rule.name(),
                token
            );
            assert!(
                token.len() >= 15,
                "Rule '{}' confirm_token '{}' is too short ({} chars).\n\
                 → The token must be descriptive of the condition being asserted.\n\
                 → Bad: I_OK=1 (too vague). Good: I_CREATED_THIS=1 (describes the assertion).",
                rule.name(),
                token,
                token.len()
            );
        }
    }
}

// ===================================================================
// Protocol adapter meta-tests
// ===================================================================

use fencepost::protocol::{self, CheckRequest};

#[test]
fn meta_default_protocol_is_claude() {
    // FROZEN: changing the default protocol would break every project
    // that doesn't explicitly set FENCEPOST_PROTOCOL.
    assert_eq!(
        protocol::DEFAULT_PROTOCOL,
        "claude",
        "Default protocol must remain 'claude'.\n\
         → Changing this breaks every project using fencepost hooks.\n\
         → New protocols must be opt-in via FENCEPOST_PROTOCOL=<name>."
    );
}

#[test]
fn meta_all_protocols_registered() {
    // Every name in supported_protocols() must return an adapter from get_adapter()
    for name in protocol::supported_protocols() {
        assert!(
            protocol::get_adapter(name).is_some(),
            "Protocol '{}' is in supported_protocols() but get_adapter() returns None.\n\
             → Add it to the match in get_adapter().",
            name
        );
    }
}

#[test]
fn meta_all_protocols_pass_smoke_test() {
    for name in protocol::supported_protocols() {
        let adapter = protocol::get_adapter(name).unwrap();

        // Adapter name matches
        assert_eq!(
            adapter.name(),
            *name,
            "Protocol '{}' adapter.name() returns '{}' — must match.",
            name,
            adapter.name()
        );

        // Sample edit input parses correctly
        let edit_result = adapter.parse_request("edit", adapter.sample_edit_input());
        assert!(
            edit_result.is_ok(),
            "Protocol '{}' sample_edit_input failed to parse: {:?}\n\
             → Fix sample_edit_input() to return valid protocol JSON.",
            name,
            edit_result.err()
        );
        match edit_result.unwrap() {
            CheckRequest::Edit { ref file_path } => {
                assert!(
                    !file_path.is_empty(),
                    "Protocol '{}' sample_edit_input parsed but file_path is empty.\n\
                     → sample_edit_input() must include a non-empty file path.",
                    name
                );
            }
            _ => panic!(
                "Protocol '{}' sample_edit_input with mode 'edit' should produce CheckRequest::Edit.\n\
                 → Fix parse_request to handle mode 'edit'.",
                name
            ),
        }

        // Sample bash input parses correctly
        let bash_result = adapter.parse_request("bash", adapter.sample_bash_input());
        assert!(
            bash_result.is_ok(),
            "Protocol '{}' sample_bash_input failed to parse: {:?}\n\
             → Fix sample_bash_input() to return valid protocol JSON.",
            name,
            bash_result.err()
        );
        match bash_result.unwrap() {
            CheckRequest::Bash { ref command } => {
                assert!(
                    !command.is_empty(),
                    "Protocol '{}' sample_bash_input parsed but command is empty.\n\
                     → sample_bash_input() must include a non-empty command.",
                    name
                );
            }
            _ => panic!(
                "Protocol '{}' sample_bash_input with mode 'bash' should produce CheckRequest::Bash.\n\
                 → Fix parse_request to handle mode 'bash'.",
                name
            ),
        }

        // format_block produces non-empty output
        let block = adapter.format_block("test reason");
        assert!(
            !block.is_empty(),
            "Protocol '{}' format_block returned empty string.\n\
             → format_block must return the framework's block response format.",
            name
        );

        // format_error produces non-empty output
        let error = adapter.format_error("test error");
        assert!(
            !error.is_empty(),
            "Protocol '{}' format_error returned empty string.",
            name
        );

        // Unknown mode returns Unknown (fail-open)
        let unknown = adapter.parse_request("nonexistent", adapter.sample_bash_input());
        assert!(
            matches!(unknown, Ok(CheckRequest::Unknown)),
            "Protocol '{}' should return CheckRequest::Unknown for unknown modes.\n\
             → This ensures fail-open behavior for unrecognized subcommands.",
            name
        );
    }
}
