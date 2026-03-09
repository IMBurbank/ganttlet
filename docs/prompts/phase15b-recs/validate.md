---
phase: 15b-recs
group: validate
stage: final
agent_count: 1
scope:
  modify: []
  read_only:
    - scripts/lib/watch.sh
    - scripts/lib/validate.sh
    - scripts/lib/merge.sh
    - scripts/lib/tmux-supervisor.sh
    - docs/multi-agent-guide.md
    - .claude/skills/multi-agent-orchestration/SKILL.md
    - .claude/skills/shell-scripting/SKILL.md
depends_on: [A, B, C]
tasks:
  - id: V1
    summary: "Syntax check all modified scripts"
  - id: V2
    summary: "Verify docs consistency"
  - id: V3
    summary: "Run tsc and vitest (regression check)"
---

# Phase 15b-recs Validation Agent

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation.

## Verification Steps:

### V1: Syntax check scripts
```bash
bash -n scripts/lib/watch.sh && echo "PASS: watch.sh" || echo "FAIL: watch.sh"
bash -n scripts/lib/validate.sh && echo "PASS: validate.sh" || echo "FAIL: validate.sh"
bash -n scripts/lib/merge.sh && echo "PASS: merge.sh" || echo "FAIL: merge.sh"
bash -n scripts/lib/tmux-supervisor.sh && echo "PASS: tmux-supervisor.sh" || echo "FAIL: tmux-supervisor.sh"
```

### V2: Verify docs consistency
Read all modified docs and scripts. Check:
1. `VALIDATE_TIMEOUT` default matches in watch.sh, validate.sh, and docs
2. `AGENT_STALL_THRESHOLD` default matches in tmux-supervisor.sh and docs
3. WASM skip condition (`crates/`) matches in merge.sh and docs
4. Pipe mode documented correctly (watch_validate uses `-p`)
5. No contradictions between docs files

### V3: Regression check
```bash
npx tsc --noEmit 2>&1 | tail -5
npm run test 2>&1 | tail -10
```

Report results. Do NOT fix code — report only.
