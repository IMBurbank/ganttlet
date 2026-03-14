---
phase: 16
group: validate
stage: final
agent_count: 1
scope:
  modify: []
  read_only:
    - docs/plans/date-calc-fixes.md
    - src/utils/dateUtils.ts
    - crates/scheduler/src/date_utils.rs
    - src/state/ganttReducer.ts
    - src/utils/schedulerWasm.ts
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/constraints.rs
    - crates/scheduler/src/lib.rs
depends_on: [A, B, C, D, E, F, G, H, I]
tasks:
  - id: V1
    summary: "Run ./scripts/full-verify.sh"
  - id: V2
    summary: "Verify no workingDaysBetween callers remain"
  - id: V3
    summary: "Verify no next_biz_day_on_or_after callers remain"
  - id: V4
    summary: "Verify taskDuration/taskEndDate roundtrip"
  - id: V5
    summary: "Verify cascade/recalculate agreement tests pass"
  - id: V6
    summary: "Verify cross-language consistency"
---

# Phase 16 Validation Agent

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation.

## Verification Steps:

### V1: Full verification

```bash
./scripts/full-verify.sh
```

Report pass/fail for each stage (tsc, vitest, cargo test).

### V2: Verify deprecated function removal — workingDaysBetween

```bash
echo "=== workingDaysBetween callers ==="
grep -rn 'workingDaysBetween' src/ --include='*.ts' --include='*.tsx' || echo "PASS: no callers"

echo "=== workingDaysBetween in tests (should only be in deprecation tests if any) ==="
grep -rn 'workingDaysBetween' src/ --include='*.test.ts' || echo "PASS: no test references"
```

### V3: Verify deprecated function removal — next_biz_day_on_or_after

```bash
echo "=== next_biz_day_on_or_after callers ==="
grep -rn 'next_biz_day_on_or_after' crates/ --include='*.rs' || echo "PASS: no callers"

echo "=== count_biz_days_to callers ==="
grep -rn 'count_biz_days_to' crates/ --include='*.rs' || echo "PASS: no callers"
```

### V4: Verify taskDuration/taskEndDate roundtrip

Run this verification script:
```bash
node -e "
const { taskDuration, taskEndDate } = require('./src/utils/dateUtils');
const cases = [
  { start: '2026-03-02', dur: 1 },
  { start: '2026-03-02', dur: 5 },
  { start: '2026-03-06', dur: 3 },
  { start: '2026-03-11', dur: 10 },
  { start: '2026-03-02', dur: 20 },
];
let pass = true;
for (const { start, dur } of cases) {
  const end = taskEndDate(start, dur);
  const roundtrip = taskDuration(start, end);
  if (roundtrip !== dur) {
    console.log('FAIL:', start, dur, '->', end, '->', roundtrip);
    pass = false;
  }
}
console.log(pass ? 'PASS: all roundtrips correct' : 'FAIL: see above');
"
```

Note: This may need `tsx` or `ts-node` if the project doesn't have CJS exports.
Adapt the import mechanism to match the project's test setup.

### V5: Verify cascade/recalculate agreement

```bash
cd crates/scheduler && cargo test cascade_and_recalculate_agree 2>&1 | tail -5
cd crates/scheduler && cargo test conflict_date_matches 2>&1 | tail -5
cd crates/scheduler && cargo test edit_cascade_recalculate 2>&1 | tail -5
```

### V6: Verify cross-language consistency

Check if cross-language tests exist and pass:
```bash
npm run test -- --reporter=verbose 2>&1 | grep -A2 'cross-language' || echo "No cross-language tests found"
```

### V7: Spot-check "may need change" files

These files were flagged as potentially needing updates. Verify they still work:
```bash
echo "=== Check bar width in DependencyLayer/SlackIndicator/SummaryBar ==="
grep -n 'taskEndX\|endX.*taskX\|width.*endX' src/components/gantt/DependencyLayer.tsx src/components/gantt/SlackIndicator.tsx src/components/gantt/SummaryBar.tsx 2>/dev/null || echo "No bar width patterns found"

echo "=== Check fakeData end dates are business days ==="
grep -n 'endDate' src/data/fakeData.ts | head -10
```

Visually inspect: do any of these look broken by the inclusive convention change?
Report any concerns but do NOT fix code.

## Final Report

After all checks, output a summary:
```
## Phase 16 Validation Results
- [ ] full-verify.sh: PASS/FAIL
- [ ] workingDaysBetween removed: PASS/FAIL
- [ ] next_biz_day_on_or_after removed: PASS/FAIL
- [ ] taskDuration/taskEndDate roundtrip: PASS/FAIL
- [ ] cascade/recalculate agreement: PASS/FAIL
- [ ] cross-language consistency: PASS/FAIL
- [ ] "may need change" files: OK/CONCERNS
```

Report results. Do NOT fix code — report only.
