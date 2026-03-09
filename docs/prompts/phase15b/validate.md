---
phase: 15b
group: validate
stage: final
agent_count: 1
scope:
  modify: []
  read_only:
    - src/utils/dependencyUtils.ts
    - src/utils/__tests__/dependencyUtils.test.ts
    - e2e/gantt.spec.ts
    - e2e/collab.spec.ts
depends_on: [E, F, G]
tasks:
  - id: V1
    summary: "Run full-verify.sh"
  - id: V2
    summary: "Run npm run e2e"
  - id: V3
    summary: "Run npm run e2e:collab"
  - id: V4
    summary: "Spot-check SF arrow rendering"
---

# Phase 15b Validation Agent

You are the validation agent for Phase 15b of the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation.

## Your job

Run all verification steps. Do NOT modify any source files. If tests fail, investigate
the root cause and report it — do not fix code (that's the implementation agents' job).

## Verification Steps — execute in order:

### V1: Run full-verify.sh

```bash
./scripts/full-verify.sh
```

Expected: tsc, vitest, cargo test all pass.
If any fail, record the exact error output.

### V2: Run single-tab E2E tests

```bash
npm run e2e
```

Expected: all gantt.spec.ts tests pass, including the new SF arrow test.
If any fail, record which test and the error.

### V3: Run collab E2E tests

```bash
npm run e2e:collab
```

Expected: all collab.spec.ts tests pass, including the new/updated constraint cascade
and conflict indicator cross-tab tests.

Known pre-existing issues:
- Relay server compilation may be slow or fail
- Popover timing issues may cause intermittent timeouts

If E2E collab tests fail, distinguish between:
1. Pre-existing infrastructure issues (relay compilation, timeout)
2. New failures from Phase 15b changes (these are real problems)

### V4: Spot-check SF arrow rendering

If a dev server is available:
```bash
npm run dev &
```

Then verify SF arrow rendering by checking the built output or using Playwright to take a screenshot.

If dev server is not feasible, verify programmatically:
- Read `src/utils/dependencyUtils.ts` and confirm the SF backward path fix is correct
- Read the new unit tests and confirm they cover the bug scenario

## Report Format

Update `.agent-status.json` with results:

```json
{
  "group": "validate",
  "phase": "15b",
  "tasks": {
    "V1": { "status": "done", "result": "pass" },
    "V2": { "status": "done", "result": "pass" },
    "V3": { "status": "done", "result": "fail", "note": "relay compilation timeout (pre-existing)" },
    "V4": { "status": "done", "result": "pass" }
  },
  "last_updated": "..."
}
```

## Error Handling

- Do NOT fix code. Report issues only.
- If infrastructure is broken, note it and move on.
- Emergency: `git add -A && git commit -m "emergency: validate saving status"`.
