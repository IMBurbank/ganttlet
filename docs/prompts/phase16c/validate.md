---
phase: 16c
group: validate
stage: final
agent_count: 1
scope:
  modify: []
  read_only:
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/constraints.rs
    - crates/scheduler/src/lib.rs
    - crates/scheduler/src/graph.rs
    - crates/scheduler/src/date_utils.rs
    - src/utils/dateUtils.ts
    - src/components/table/TaskRow.tsx
    - src/components/gantt/TaskBarPopover.tsx
    - src/sheets/sheetsMapper.ts
    - .claude/agents/rust-scheduler.md
    - CLAUDE.md
depends_on: [A, B, C, D]
tasks:
  - id: V1
    summary: "Run ./scripts/full-verify.sh"
  - id: V2
    summary: "Run cargo doc --no-deps"
  - id: V3
    summary: "Verify no weekend dates in make_task callsites"
  - id: V4
    summary: "Verify no inline dayPx ternaries remain"
  - id: V5
    summary: "Verify validateStartDate is wired"
  - id: V6
    summary: "Verify sheetsMapper validates dates"
  - id: V7
    summary: "Verify CLAUDE.md has callsite-search rule"
---

# Phase 16c Validation Agent

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation.

## Verification Steps:

### V1: Full verification

```bash
./scripts/full-verify.sh
```

Report pass/fail for each stage (tsc, vitest, cargo test).

### V2: Cargo doc

```bash
cd crates/scheduler && cargo doc --no-deps 2>&1 | tail -10
```

Must succeed with no warnings. Verify `//!` blocks exist:
```bash
head -5 src/date_utils.rs src/cascade.rs src/constraints.rs src/graph.rs src/types.rs src/lib.rs
```

All 6 files should start with `//!`.

### V3: Verify no weekend dates in make_task callsites

```bash
echo "=== Weekend dates in Rust test helpers (excluding cpm.rs) ==="
grep -n 'make_task\|make_task_with_project' crates/scheduler/src/cascade.rs crates/scheduler/src/constraints.rs crates/scheduler/src/lib.rs crates/scheduler/src/graph.rs | grep -oP '\d{4}-\d{2}-\d{2}' | sort -u | while read d; do
  day=$(node -e "console.log(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date('${d}T12:00:00Z').getUTCDay()])")
  if [ "$day" = "Sat" ] || [ "$day" = "Sun" ]; then
    echo "FAIL: $d is $day"
  fi
done
echo "If no FAIL lines above: PASS"
```

### V4: Verify no inline dayPx ternaries remain

```bash
echo "=== Inline dayPx ternaries (should only be in dateUtils.ts getDayPx) ==="
grep -rn 'colWidth / 7\|colWidth / 30' src/ --include='*.ts' --include='*.tsx'
echo "If only dateUtils.ts getDayPx: PASS"
```

### V5: Verify validateStartDate is wired

```bash
echo "=== validateStartDate usage in TaskRow ==="
grep -n 'validateStartDate' src/components/table/TaskRow.tsx || echo "FAIL: not found"

echo "=== TaskBarPopover has date validation ==="
grep -n 'validateStartDate\|validateEndDate\|isWeekendDate\|dateError\|setDateError' src/components/gantt/TaskBarPopover.tsx | head -10
echo "If matches found: PASS"
```

### V6: Verify sheetsMapper validates dates

```bash
echo "=== sheetsMapper date validation ==="
grep -n 'ensureBusinessDay\|prevBusinessDay\|taskDuration' src/sheets/sheetsMapper.ts || echo "FAIL: no validation"

echo "=== sheetsMapper tests for invalid input ==="
grep -n 'weekend\|invalid\|snap' src/sheets/__tests__/sheetsMapper.test.ts || echo "FAIL: no invalid input tests"
```

### V7: Verify CLAUDE.md has callsite-search rule

```bash
echo "=== Callsite-search rule in CLAUDE.md ==="
grep -n 'findReferences.*callsite\|callsite.*findReferences\|pattern bug' CLAUDE.md || echo "FAIL: rule not found"
```

### V8: Verify rust-scheduler.md is fixed

```bash
echo "=== rust-scheduler.md checks ==="
echo "--- Should NOT contain is_weekend() (private fn) ---"
grep -n 'is_weekend()' .claude/agents/rust-scheduler.md && echo "FAIL" || echo "PASS"

echo "--- Should contain is_weekend_date ---"
grep -n 'is_weekend_date' .claude/agents/rust-scheduler.md || echo "FAIL: missing"

echo "--- Should contain detect_conflicts ---"
grep -n 'detect_conflicts' .claude/agents/rust-scheduler.md || echo "FAIL: missing"

echo "--- Should NOT contain 'replaces next_biz_day_on_or_after' ---"
grep -n 'replaces.*next_biz_day' .claude/agents/rust-scheduler.md && echo "FAIL: stale note" || echo "PASS"

echo "--- Should contain LSP pointer ---"
grep -n 'LSP\|hover\|documentSymbol' .claude/agents/rust-scheduler.md || echo "FAIL: no LSP pointer"
```

## Final Report

After all checks, output a summary:
```
## Phase 16c Validation Results
- [ ] full-verify.sh: PASS/FAIL
- [ ] cargo doc: PASS/FAIL
- [ ] No weekend dates in make_task: PASS/FAIL
- [ ] No inline dayPx ternaries: PASS/FAIL
- [ ] validateStartDate wired: PASS/FAIL
- [ ] sheetsMapper validates dates: PASS/FAIL
- [ ] CLAUDE.md callsite-search rule: PASS/FAIL
- [ ] rust-scheduler.md fixed: PASS/FAIL
```

Report results. Do NOT fix code — report only.
