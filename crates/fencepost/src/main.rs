use fencepost::protocol::{self, is_infra_error, read_stdin};
use fencepost::{ProjectContext, BASH_RULES, EDIT_RULES};
use std::process;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn print_help() {
    eprintln!(
        "fencepost {VERSION} — agent workflow guard

USAGE:
    fencepost <mode>       Run as a hook (reads from stdin, writes to stdout)
    fencepost <command>    Run a diagnostic command

MODES (hook integration):
    edit        Check an Edit/Write tool invocation
    bash        Check a Bash tool invocation

COMMANDS:
    init        Set up fencepost for this project (detects stack, writes config)
    doctor      Verify installation and project detection
    list-rules  List all registered rules with descriptions
    --version   Print version
    --help      Print this help

PROTOCOLS:
    claude      Claude Code PreToolUse hooks (default)

    Set FENCEPOST_PROTOCOL=<name> to use a different protocol adapter.
    See https://github.com/IMBurbank/fencepost for supported protocols.

INSTALL:
    cargo install fencepost"
    );
}

fn print_version() {
    println!("fencepost {VERSION}");
}

fn list_rules() {
    println!("Bash rules ({}):", BASH_RULES.len());
    for rule in BASH_RULES {
        println!("  {:<30} {}", rule.name(), rule.description());
    }
    println!();
    println!("Edit rules ({}):", EDIT_RULES.len());
    for rule in EDIT_RULES {
        println!("  {:<30} {}", rule.name(), rule.description());
    }
}

/// Detect project stack from files in the root directory.
/// Returns (stack_names, suggested_protected_patterns).
fn detect_project_stack(root: &std::path::Path) -> (Vec<&'static str>, Vec<serde_json::Value>) {
    let mut stacks = Vec::new();
    let mut patterns = Vec::new();

    // Node.js / JavaScript
    if root.join("package.json").exists() {
        stacks.push("node");
        patterns.push(serde_json::json!({
            "basename": "package-lock.json",
            "reason": "Managed by npm. Run `npm install` to regenerate."
        }));
        if root.join("yarn.lock").exists() {
            patterns.push(serde_json::json!({
                "basename": "yarn.lock",
                "reason": "Managed by yarn. Run `yarn install` to regenerate."
            }));
        }
        if root.join("node_modules").exists() {
            patterns.push(serde_json::json!({
                "path_contains": "node_modules/",
                "reason": "Dependencies directory. Run `npm install` to regenerate."
            }));
        }
        if root.join("dist").exists() || root.join("build").exists() {
            patterns.push(serde_json::json!({
                "glob": "dist/*",
                "reason": "Build output. Run the build command to regenerate."
            }));
        }
    }

    // Rust
    if root.join("Cargo.toml").exists() {
        stacks.push("rust");
        // target/ is already git-ignored usually, but protect it anyway
        if root.join("target").exists() {
            patterns.push(serde_json::json!({
                "path_contains": "target/release/",
                "reason": "Compiled binaries. Run `cargo build` to regenerate."
            }));
        }
    }

    // Python
    if root.join("pyproject.toml").exists()
        || root.join("setup.py").exists()
        || root.join("requirements.txt").exists()
    {
        stacks.push("python");
        patterns.push(serde_json::json!({
            "glob": "*.pyc",
            "reason": "Python bytecode. Auto-generated."
        }));
        patterns.push(serde_json::json!({
            "path_contains": "__pycache__/",
            "reason": "Python cache directory. Auto-generated."
        }));
    }

    // Go
    if root.join("go.mod").exists() {
        stacks.push("go");
    }

    // Ruby
    if root.join("Gemfile").exists() {
        stacks.push("ruby");
    }

    (stacks, patterns)
}

fn init() {
    use std::fs;

    // Detect project root
    let root = match ProjectContext::detect() {
        Some(ctx) => ctx.root().to_path_buf(),
        None => {
            let cwd = std::env::current_dir().unwrap_or_default();
            if cwd.join(".git").exists() {
                cwd
            } else {
                eprintln!("Error: not in a git repository. Run `git init` first.");
                process::exit(1);
            }
        }
    };

    println!("Setting up fencepost in {}", root.display());
    println!();

    // Detect project stack
    let (stacks, extra_patterns) = detect_project_stack(&root);
    if stacks.is_empty() {
        println!("  Stack: (no specific stack detected)");
    } else {
        println!("  Stack: {}", stacks.join(", "));
    }

    // Ensure .claude/ directory exists
    let claude_dir = root.join(".claude");
    if !claude_dir.exists() {
        fs::create_dir_all(&claude_dir).unwrap_or_else(|e| {
            eprintln!("Error creating .claude/: {}", e);
            process::exit(1);
        });
    }

    // Create or update .claude/settings.json with hooks
    let settings_path = claude_dir.join("settings.json");
    let settings_updated = if settings_path.exists() {
        let contents = fs::read_to_string(&settings_path).unwrap_or_default();
        if contents.contains("fencepost") {
            println!("  Hooks: already registered in .claude/settings.json ✓");
            false
        } else {
            // Try to merge hooks into existing settings
            if let Ok(mut settings) = serde_json::from_str::<serde_json::Value>(&contents) {
                let hooks = settings
                    .as_object_mut()
                    .unwrap()
                    .entry("hooks")
                    .or_insert_with(|| serde_json::json!({}));
                let pre = hooks
                    .as_object_mut()
                    .unwrap()
                    .entry("PreToolUse")
                    .or_insert_with(|| serde_json::json!([]));
                if let Some(arr) = pre.as_array_mut() {
                    arr.push(serde_json::json!({
                        "matcher": "Edit|Write",
                        "hooks": [{"type": "command", "command": "fencepost edit || true"}]
                    }));
                    arr.push(serde_json::json!({
                        "matcher": "Bash",
                        "hooks": [{"type": "command", "command": "fencepost bash || true"}]
                    }));
                }
                let pretty = serde_json::to_string_pretty(&settings).unwrap();
                fs::write(&settings_path, format!("{}\n", pretty)).unwrap();
                println!("  Hooks: added to .claude/settings.json ✓");
                true
            } else {
                eprintln!("  Hooks: .claude/settings.json exists but is not valid JSON — skipping");
                false
            }
        }
    } else {
        let settings = serde_json::json!({
            "hooks": {
                "PreToolUse": [
                    {
                        "matcher": "Edit|Write",
                        "hooks": [{"type": "command", "command": "fencepost edit || true"}]
                    },
                    {
                        "matcher": "Bash",
                        "hooks": [{"type": "command", "command": "fencepost bash || true"}]
                    }
                ]
            }
        });
        let pretty = serde_json::to_string_pretty(&settings).unwrap();
        fs::write(&settings_path, format!("{}\n", pretty)).unwrap();
        println!("  Hooks: created .claude/settings.json ✓");
        true
    };

    // Create .claude/fencepost.json if stack-specific patterns were detected
    let config_path = claude_dir.join("fencepost.json");
    if config_path.exists() {
        println!("  Config: .claude/fencepost.json already exists ✓");
    } else if !extra_patterns.is_empty() {
        let config = serde_json::json!({
            "protected_files": extra_patterns
        });
        let pretty = serde_json::to_string_pretty(&config).unwrap();
        fs::write(&config_path, format!("{}\n", pretty)).unwrap();
        println!(
            "  Config: created .claude/fencepost.json with {} project-specific pattern(s) ✓",
            extra_patterns.len()
        );
    } else {
        println!("  Config: using defaults (no project-specific patterns needed)");
    }

    println!();

    // Show summary
    println!("Setup complete. Protected files:");
    println!("  Built-in: .env*, *.lock, package-lock.json, pnpm-lock.yaml, go.sum");
    if !extra_patterns.is_empty() {
        print!("  Project:  ");
        let names: Vec<String> = extra_patterns
            .iter()
            .filter_map(|p| {
                p.get("basename")
                    .or(p.get("basename_prefix"))
                    .or(p.get("path_contains"))
                    .or(p.get("glob"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .collect();
        println!("{}", names.join(", "));
    }

    println!();
    if settings_updated {
        println!("Next: verify with `fencepost doctor`");
    } else {
        println!("Run `fencepost doctor` to verify setup.");
    }
}

fn doctor() {
    let mut ok = true;

    // Binary on PATH
    print!("  fencepost binary: ");
    println!("v{VERSION} ✓");

    // Protocol
    let proto = std::env::var("FENCEPOST_PROTOCOL")
        .unwrap_or_else(|_| protocol::DEFAULT_PROTOCOL.to_string());
    print!("  protocol: ");
    if protocol::get_adapter(&proto).is_some() {
        println!("{proto} ✓");
    } else {
        println!("{proto} NOT SUPPORTED ✗");
        eprintln!("    Supported protocols: claude");
        ok = false;
    }

    // Project detection
    print!("  project root: ");
    match ProjectContext::detect() {
        Some(ctx) => {
            println!("{} ✓", ctx.root().display());

            print!("  default branch: ");
            let branch_source = if std::env::var("FENCEPOST_DEFAULT_BRANCH").is_ok() {
                "env"
            } else if ctx.root().join(".claude/fencepost.json").exists() {
                "config/auto"
            } else {
                "auto"
            };
            println!("{} ({}) ✓", ctx.default_branch(), branch_source);

            print!("  remote: ");
            let remote_source = if std::env::var("FENCEPOST_REMOTE").is_ok() {
                "env"
            } else if ctx.root().join(".claude/fencepost.json").exists() {
                "config/auto"
            } else {
                "auto"
            };
            println!("{} ({}) ✓", ctx.remote_name(), remote_source);

            print!("  worktree dir: ");
            println!("{} ✓", ctx.worktrees_dir().display());

            print!("  CWD: ");
            if ctx.is_project_root_cwd() {
                println!("{} (project root)", ctx.cwd().display());
            } else if ctx.is_worktree_cwd() {
                println!("{} (worktree) ✓", ctx.cwd().display());
            } else {
                println!("{}", ctx.cwd().display());
            }

            // Check hooks registration
            print!("  hooks: ");
            let settings_path = ctx.root().join(".claude/settings.json");
            match std::fs::read_to_string(&settings_path) {
                Ok(contents) => {
                    if contents.contains("fencepost") {
                        println!("registered in .claude/settings.json ✓");
                    } else {
                        println!("NOT FOUND in .claude/settings.json ✗");
                        eprintln!("    Add fencepost hooks to .claude/settings.json:");
                        eprintln!("    {{\"hooks\":{{\"PreToolUse\":[");
                        eprintln!(
                            "      {{\"matcher\":\"Edit|Write\",\"hooks\":[{{\"command\":\"fencepost edit || true\"}}]}},"
                        );
                        eprintln!(
                            "      {{\"matcher\":\"Bash\",\"hooks\":[{{\"command\":\"fencepost bash || true\"}}]}}"
                        );
                        eprintln!("    ]}}}}");
                        ok = false;
                    }
                }
                Err(_) => {
                    println!("NO .claude/settings.json ✗");
                    eprintln!("    Create .claude/settings.json with fencepost hooks.");
                    ok = false;
                }
            }

            // Check config file
            print!("  config: ");
            let config_path = ctx.root().join(".claude/fencepost.json");
            if config_path.exists() {
                match std::fs::read_to_string(&config_path) {
                    Ok(contents) => match serde_json::from_str::<serde_json::Value>(&contents) {
                        Ok(_) => println!(".claude/fencepost.json ✓"),
                        Err(e) => {
                            println!(".claude/fencepost.json INVALID ✗");
                            eprintln!("    Parse error: {}", e);
                            ok = false;
                        }
                    },
                    Err(e) => {
                        println!(".claude/fencepost.json UNREADABLE ✗");
                        eprintln!("    {}", e);
                        ok = false;
                    }
                }
            } else {
                println!("using defaults (no .claude/fencepost.json)");
            }

            // Show config warnings (unknown fields, invalid rule names, etc.)
            for warning in ctx.config_warnings() {
                println!("  warning: {}", warning);
                ok = false;
            }

            // Validate rule override names against registered rules
            let registered: Vec<&str> = BASH_RULES
                .iter()
                .map(|r| r.name())
                .chain(EDIT_RULES.iter().map(|r| r.name()))
                .collect();
            for rule_name in ctx.rule_override_names() {
                if !registered.contains(&rule_name) {
                    println!(
                        "  warning: config rule '{}' not found (typo?). Known rules: {}",
                        rule_name,
                        registered.join(", ")
                    );
                    ok = false;
                }
            }
        }
        None => {
            println!("NOT FOUND ✗");
            eprintln!("    No .git found in any ancestor of CWD.");
            eprintln!("    Fencepost will fail-open (no protection).");
            ok = false;
        }
    }

    // Rule count
    print!("  rules: ");
    println!(
        "{} bash + {} edit = {} total ✓",
        BASH_RULES.len(),
        EDIT_RULES.len(),
        BASH_RULES.len() + EDIT_RULES.len()
    );

    if ok {
        println!("\nAll checks passed. Fencepost is active.");
    } else {
        println!("\nIssues found. Fix them before relying on fencepost.");
        process::exit(1);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(|s| s.as_str()).unwrap_or("");

    // CLI commands (no stdin needed)
    match mode {
        "--help" | "-h" | "help" => {
            print_help();
            process::exit(0);
        }
        "--version" | "-V" => {
            print_version();
            process::exit(0);
        }
        "list-rules" => {
            list_rules();
            process::exit(0);
        }
        "init" => {
            init();
            process::exit(0);
        }
        "doctor" => {
            doctor();
            process::exit(0);
        }
        "" => {
            print_help();
            process::exit(0);
        }
        _ => {} // Fall through to hook mode
    }

    // Debug logging: FENCEPOST_LOG=debug shows the full decision path on stderr
    fencepost::log_debug!("fencepost v{} starting", VERSION);

    // Select protocol adapter (default: claude, override: FENCEPOST_PROTOCOL=<name>)
    let protocol_name = std::env::var("FENCEPOST_PROTOCOL")
        .unwrap_or_else(|_| protocol::DEFAULT_PROTOCOL.to_string());
    let adapter = match protocol::get_adapter(&protocol_name) {
        Some(a) => a,
        None => {
            eprintln!(
                "fencepost: unknown protocol '{}'. Supported: claude",
                protocol_name
            );
            process::exit(1);
        }
    };

    fencepost::log_debug!("protocol: {}", protocol_name);

    // Hook mode: detect project context
    let ctx = match ProjectContext::detect() {
        Some(ctx) => {
            fencepost::log_debug!("root: {}", ctx.root().display());
            fencepost::log_debug!("branch: {}", ctx.default_branch());
            fencepost::log_debug!("remote: {}", ctx.remote_name());
            fencepost::log_debug!("cwd: {}", ctx.cwd().display());
            ctx
        }
        None => {
            fencepost::log_debug!("no .git found — fail-open");
            eprintln!("fencepost: no .git found — skipping checks (fail-open)");
            process::exit(0);
        }
    };

    // Read stdin once — fail-open on infrastructure errors (ENXIO/EAGAIN/ENOENT)
    let stdin_data = match read_stdin() {
        Ok(data) => data,
        Err(ref e) if is_infra_error(e) => {
            process::exit(0);
        }
        Err(e) => {
            println!(
                "{}",
                adapter.format_error(&format!("Hook error — blocking: {}", e))
            );
            process::exit(0);
        }
    };

    // FROZEN CONVENTION: "edit" and "bash" subcommands are used in every project's
    // hook config. Do not rename without a migration strategy.
    //
    // Dispatch to the selected protocol adapter — it parses the input,
    // calls the framework-agnostic check functions, and formats the output.
    protocol::run_hook(&*adapter, &ctx, mode, &stdin_data);

    process::exit(0);
}
