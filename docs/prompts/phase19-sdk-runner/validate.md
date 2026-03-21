---
phase: 19
group: validate
stage: final
agent_count: 1
scope:
  modify: []
  read_only:
    - scripts/sdk/**
    - scripts/lib/agent.sh
    - scripts/lib/stage.sh
    - scripts/lib/config.sh
    - scripts/generate-retry-config.sh
    - scripts/full-verify.sh
    - docs/prompts/curation/curator.md
    - docs/prompts/curation/reviewer-template.md
    - docs/prompts/curation/skill-curation.yaml
    - .claude/skills/curation/SKILL.md
    - .claude/skills/multi-agent-orchestration/SKILL.md
    - docs/multi-agent-guide.md
depends_on: [groupA, groupB, groupC, groupD]
tasks:
  - id: V1
    summary: "Run full-verify.sh"
  - id: V2
    summary: "Verify SDK runner CLI"
  - id: V3
    summary: "Verify bash syntax"
  - id: V4
    summary: "Verify curation config"
  - id: V5
    summary: "Verify code path preservation"
  - id: V6
    summary: "Verify documentation"
---

# Phase 19 Final Validation

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation.
Do NOT modify any source files. Report results only.

## V1: Full verification
```bash
./scripts/full-verify.sh
```
Must include "SDK type check" in output.

## V1a: Standalone type checks
```bash
npx tsc --noEmit              # frontend types unaffected
npx tsc -p tsconfig.sdk.json --noEmit  # SDK types pass independently
```

## V1b: Test count
```bash
npm test 2>&1 | grep -c 'scripts/sdk/__tests__'
# Expected: 9 test files discovered
npm test
# Expected: all pass, zero failures
```

## V2: SDK runner CLI
```bash
npx tsx scripts/sdk/agent-runner.ts --help
```
Must print usage with all required flags.

## V3: Bash syntax
```bash
bash -n scripts/lib/agent.sh
bash -n scripts/lib/stage.sh
bash -n scripts/lib/config.sh
bash -n scripts/generate-retry-config.sh
```

## V4: Curation config
```bash
yq '.stages | length' docs/prompts/curation/skill-curation.yaml
# Expected: 2

yq '.stages[0].groups | length' docs/prompts/curation/skill-curation.yaml
# Expected: 40

yq '.stages[1].groups | length' docs/prompts/curation/skill-curation.yaml
# Expected: 8
```

## V5: Code path preservation
```bash
# Verify existing claude -p path is reachable
grep -q 'claude.*--dangerously-skip-permissions.*-p' scripts/lib/agent.sh && echo "PASS: claude -p path present"

# Verify SDK_RUNNER gating
grep -q 'SDK_RUNNER' scripts/lib/agent.sh && echo "PASS: SDK_RUNNER gating present"

# Verify preflight respects SDK_RUNNER
grep -q 'SDK_RUNNER' scripts/lib/stage.sh && echo "PASS: preflight SDK_RUNNER check present"

# Verify LOG_DIR override
grep -q 'LOG_DIR:-' scripts/lib/config.sh && echo "PASS: LOG_DIR override present"
```

## V6: Documentation
```bash
grep -q 'SDK Agent Runner' docs/multi-agent-guide.md && echo "PASS: guide updated"
grep -q 'SDK' .claude/skills/multi-agent-orchestration/SKILL.md && echo "PASS: skill updated"
grep -q 'reviewer-template' .claude/skills/curation/SKILL.md && echo "PASS: curation skill updated"
! grep -q 'subagent_type.*skill-reviewer' docs/prompts/curation/curator.md && echo "PASS: curator no longer spawns reviewers"
grep -q 'LOG_DIR.*reviews' docs/prompts/curation/curator.md && echo "PASS: curator reads from disk"
```

## Final Report

```
## Phase 19 Final Validation Results
- [ ] full-verify.sh: PASS/FAIL
- [ ] Frontend tsc: PASS/FAIL
- [ ] SDK tsc: PASS/FAIL
- [ ] Test count: 9 SDK test files discovered
- [ ] All tests pass: zero failures
- [ ] SDK runner CLI: prints usage
- [ ] Bash syntax: all 4 files pass
- [ ] Curation config: 2 stages, 40+8 groups
- [ ] Code path preservation: claude -p, SDK_RUNNER, preflight, LOG_DIR
- [ ] Documentation: guide, skills, curator updated

OVERALL: PASS / FAIL
```
