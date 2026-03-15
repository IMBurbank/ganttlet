---
phase: 17
group: validate
stage: final
agent_count: 1
scope:
  modify: []
  read_only:
    - crates/bizday/
    - crates/scheduler/clippy.toml
    - scripts/datecalc-functions.sh
    - .claude/settings.json
    - CLAUDE.md
    - crates/scheduler/CLAUDE.md
    - package.json
    - Dockerfile
    - docs/plans/datecalc-tool.md
    - docs/plans/datecalc-validation/results.md
depends_on: [A, B, C, V]
tasks:
  - id: F1
    summary: "Run full-verify.sh"
  - id: F2
    summary: "Verify bizday binary works"
  - id: F3
    summary: "Verify shell functions work"
  - id: F4
    summary: "Verify hook is registered"
  - id: F5
    summary: "Verify Clippy ban works"
  - id: F6
    summary: "Verify CLAUDE.md updated"
  - id: F7
    summary: "Verify validation results documented"
---

# Phase 17 Final Validation

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation.

## Verification Steps

### F1: Full verification
```bash
./scripts/full-verify.sh
```

### F2: bizday binary
```bash
cargo test -p bizday
cargo build --release -p bizday
./target/release/bizday 2026-03-11 10  # → 2026-03-24
./target/release/bizday 2026-03-11 2026-03-24  # → 10
./target/release/bizday 2026-03-07  # → Saturday info
./target/release/bizday verify 2026-03-11 10 2026-03-24  # → OK, exit 0
./target/release/bizday verify 2026-03-11 10 2026-03-25  # → MISMATCH, exit 1
./target/release/bizday help
PROPTEST_CASES=1000 cargo test -p bizday proptest  # extended proptest
```

### F3: Shell functions
```bash
source scripts/datecalc-functions.sh
taskEndDate 2026-03-11 10  # → 2026-03-24
task_end_date 2026-03-11 10  # → 2026-03-24
taskDuration 2026-03-11 2026-03-24  # → 10
task_duration 2026-03-11 2026-03-24  # → 10
```

### F4: Hook registration
```bash
node -e "
const s = JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'));
const pt = s.hooks?.PostToolUse;
if (!pt) { console.log('FAIL: no PostToolUse hooks'); process.exit(1); }
const bizHook = pt.find(h => h.hooks?.some(hh => hh.command?.includes('bizday')));
if (!bizHook) { console.log('FAIL: no bizday hook found'); process.exit(1); }
console.log('PASS: bizday PostToolUse hook registered');
console.log('  matcher:', bizHook.matcher);
console.log('  command:', bizHook.hooks[0].command);
"
```

### F5: Clippy ban
```bash
test -f crates/scheduler/clippy.toml && echo "PASS: clippy.toml exists" || echo "FAIL"
grep -q "shift_date" crates/scheduler/clippy.toml && echo "PASS: shift_date banned" || echo "FAIL"
cargo clippy -p ganttlet-scheduler 2>&1 | grep -i "disallowed" || echo "PASS: no violations (expected)"
```

### F6: CLAUDE.md updated
```bash
grep -q "taskEndDate" CLAUDE.md && echo "PASS: CLAUDE.md has taskEndDate examples" || echo "FAIL"
grep -q "taskEndDate\|bizday" crates/scheduler/CLAUDE.md && echo "PASS: scheduler CLAUDE.md updated" || echo "FAIL"
grep -q "build:bizday" package.json && echo "PASS: build:bizday script exists" || echo "FAIL"
```

### F7: Validation results
```bash
test -f docs/plans/datecalc-validation/results.md && echo "PASS: results documented" || echo "FAIL"
bizday report --trend || echo "WARN: no log data yet (expected if validation didn't run)"
```

## Final Report

```
## Phase 17 Final Validation Results
- [ ] full-verify.sh: PASS/FAIL
- [ ] bizday binary: all commands work, proptest passes
- [ ] Shell functions: all 4 aliases work
- [ ] PostToolUse hook: registered in settings.json
- [ ] Clippy ban: clippy.toml exists with shift_date
- [ ] CLAUDE.md: updated with shell function examples
- [ ] Validation results: documented
```
