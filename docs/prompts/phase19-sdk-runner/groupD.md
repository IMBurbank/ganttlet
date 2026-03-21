---
phase: 19
group: D
stage: 2
agent_count: 1
scope:
  create:
    - scripts/sdk/__tests__/integration.test.ts
  modify:
    - scripts/lib/agent.sh
    - scripts/lib/stage.sh
    - scripts/full-verify.sh
  read_only:
    - scripts/sdk/agent-runner.ts
    - scripts/sdk/types.ts
    - scripts/lib/config.sh
    - scripts/lib/watch.sh
    - scripts/launch-phase.sh
    - docs/plans/sdk-agent-runner.md
depends_on: [groupA, groupB, groupC]
tasks:
  - id: D1
    summary: "Read agent.sh, stage.sh, merged SDK runner code"
  - id: D2
    summary: "Add SDK_RUNNER=1 code path to run_agent() in agent.sh"
  - id: D3
    summary: "Update preflight_check in stage.sh for SDK_RUNNER"
  - id: D4
    summary: "Add SDK type check to full-verify.sh"
  - id: D5
    summary: "Create integration test (bash↔TypeScript boundary)"
  - id: D6
    summary: "Run full-verify.sh — fix any issues"
---

# Phase 19 Group D — Bash Integration + Verification

You are implementing Phase 19 Group D for the Ganttlet project.
Read `CLAUDE.md` for full project context.
Read `docs/plans/sdk-agent-runner.md` Steps 9a, 12, 13, and 11j for the detailed design.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Worktree Rules (Non-Negotiable)

You are working in a **git worktree** — NOT in `/workspace`.
All file paths below are **relative to your worktree root** (your CWD).
**NEVER** modify, read from, or `cd` into `/workspace` — that is `main` and must not be touched.
All git operations (commit, push) happen in this worktree directory.

## Prerequisites

Groups A, B, and C (Stage 1) have already been merged. The following are now available:
- `scripts/sdk/agent-runner.ts` — TypeScript SDK runner with CLI entry point
- `scripts/sdk/types.ts` — Core types (RunnerOptions, AgentResult, etc.)
- `tsconfig.sdk.json` — Node-targeting TypeScript config
- `docs/prompts/curation/skill-curation.yaml` — Two-stage curation config (40+8 groups)
- `docs/prompts/curation/reviewer-template.md` — Reviewer task prompt template
- `scripts/lib/config.sh` — LOG_DIR env var override
- `docs/multi-agent-guide.md` — SDK runner documentation

Verify Stage 1 merged correctly:
```bash
npx tsc -p tsconfig.sdk.json --noEmit  # SDK types compile
npx tsx scripts/sdk/agent-runner.ts --help  # CLI works
yq '.stages | length' docs/prompts/curation/skill-curation.yaml  # → 2
```

## Your files (ONLY create/modify these):

**Create:**
- `scripts/sdk/__tests__/integration.test.ts` — Bash↔TypeScript boundary tests

**Modify:**
- `scripts/lib/agent.sh` — Add SDK_RUNNER=1 code path
- `scripts/lib/stage.sh` — Update preflight_check
- `scripts/full-verify.sh` — Add SDK type check

**Read-only:**
- `scripts/sdk/agent-runner.ts` — Understand CLI flags and RunnerOptions
- `scripts/sdk/types.ts` — Understand type interfaces
- `scripts/lib/config.sh` — Understand LOG_DIR (modified by Group C)
- `scripts/lib/watch.sh` — Understand WATCH mode (NOT modified)
- `scripts/launch-phase.sh` — Understand pipeline flow (NOT modified)

## Success Criteria (you're done when ALL of these are true):

1. `bash -n scripts/lib/agent.sh` passes
2. `bash -n scripts/lib/stage.sh` passes
3. Existing `claude -p` code path is unchanged and reachable when `SDK_RUNNER` is unset
4. SDK path uses `prompt_vars` bash array (not string word-splitting)
5. Preflight passes with `SDK_RUNNER=1` without per-group prompt files
6. `./scripts/full-verify.sh` runs SDK type check and passes end-to-end
7. Integration test passes — reviewer naming convention produces correct CLI args
8. All changes committed

## Failure Criteria (keep working if any of these are true):

- `for var in $SDK_PROMPT_VARS` (unquoted word-split — must use array)
- `model_flag` referenced but not defined in SDK path
- `exit_code` used without `local` declaration in SDK path
- `local prompt_file` declared in else-branch shadows SDK path assignment
- Integration test missing for naming convention

## Tasks — execute in order:

### D1: Read and understand the current code

1. Read `scripts/lib/agent.sh` — understand `run_agent()` function structure, retry loop, `build_retry_context()`, `log_agent_metrics()`
2. Read `scripts/lib/stage.sh` — understand `preflight_check()` (lines 29-36) and `run_parallel_stage()`
3. Read `scripts/sdk/agent-runner.ts` — understand CLI flags, RunnerOptions type
4. Read `scripts/sdk/types.ts` — understand type interfaces
5. Verify Stage 1 code merged: `npx tsx scripts/sdk/agent-runner.ts --help`

### D2: Add SDK_RUNNER=1 code path to agent.sh (Plan Step 9a)

Add an `if [[ "${SDK_RUNNER:-}" == "1" ]]` block at the start of `run_agent()`, before the
existing retry loop. When `SDK_RUNNER=1`, the bash retry loop is SKIPPED entirely — the
TypeScript runner handles its own retries and attempt fallbacks.

```bash
if [[ "${SDK_RUNNER:-}" == "1" ]]; then

  # ── Shared locals ────────────────────────────────────────────────
  local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
  local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
  local prompt_file=""
  local exit_code=0

  # ── Prompt vars as array (safe for values with spaces) ───────────
  local -a prompt_vars=("SKILL=${group}")
  [[ -n "${LOG_DIR:-}" ]] && prompt_vars+=("LOG_DIR=${LOG_DIR}")

  # ── Reviewer angle detection ─────────────────────────────────────
  local -r _REVIEW_ANGLES="accuracy|structure|scope|history|adversarial"
  if [[ "$group" =~ ^(.+)-(${_REVIEW_ANGLES})$ ]]; then
    local skill="${BASH_REMATCH[1]}"
    local angle="${BASH_REMATCH[2]}"
    : "${SDK_POLICY:=reviewer}"
    : "${SDK_AGENT:=skill-reviewer}"
    : "${SDK_OUTPUT_FILE:=${LOG_DIR}/reviews/${skill}/${angle}.md}"
    prompt_vars=("SKILL=${skill}" "ANGLE=${angle}")
    [[ -n "${LOG_DIR:-}" ]] && prompt_vars+=("LOG_DIR=${LOG_DIR}")
    : "${prompt_file:=docs/prompts/curation/reviewer-template.md}"
  fi

  # ── Build CLI args ───────────────────────────────────────────────
  local policy="${SDK_POLICY:-default}"
  local -a extra_args=()
  [[ -n "${SDK_OUTPUT_FILE:-}" ]] && extra_args+=(--output-file "$SDK_OUTPUT_FILE")
  [[ -n "${SDK_AGENT:-}" ]] && extra_args+=(--agent "$SDK_AGENT")

  for var in "${prompt_vars[@]}"; do
    extra_args+=(--prompt-var "$var")
  done

  : "${prompt_file:=${PROMPTS_DIR}/${group}.md}"

  # ── Invoke runner ────────────────────────────────────────────────
  set +e
  local result
  result=$(npx tsx scripts/sdk/agent-runner.ts \
    --group "$group" \
    --workdir "$workdir" \
    --prompt "$prompt_file" \
    --log "$logfile" \
    --phase "${PHASE:-unknown}" \
    --policy "$policy" \
    ${max_turns:+--max-turns "${max_turns}"} \
    ${max_budget:+--max-budget "${max_budget}"} \
    ${MAX_RETRIES:+--max-crash-retries "${MAX_RETRIES}"} \
    ${MODEL:+--model "${MODEL}"} \
    "${extra_args[@]}" \
    2>>"$logfile")
  exit_code=$?
  set -e

  if [[ $exit_code -eq 0 ]]; then
    ok "${group}: completed successfully"
    log "${group}: result: ${result}"
    return 0
  else
    err "${group}: failed. Result: ${result}"
    return 1
  fi
else
  # existing claude -p invocation with retry loop (UNCHANGED)
```

**Critical:** Do NOT modify the existing retry loop in the `else` branch.
Close the `if/else` with `fi` after the existing retry loop's closing brace.

Commit: `feat: integrate SDK runner into agent.sh behind SDK_RUNNER flag`

### D3: Update preflight_check in stage.sh (Plan Step 9a)

The `preflight_check()` function (stage.sh lines 29-36) validates that `${PROMPTS_DIR}/${group}.md`
exists for every group. Reviewer groups use a shared template (`reviewer-template.md`) resolved
by the naming convention in `run_agent()`, so per-group prompt files don't exist for them.

When `SDK_RUNNER=1`, skip the per-group prompt file check:

```bash
  # Skip per-group prompt check when SDK_RUNNER handles prompt resolution
  if [[ "${SDK_RUNNER:-}" != "1" ]]; then
    local prompts_exist=true
    for group in "$@"; do
      if [[ ! -f "${PROMPTS_DIR}/${group}.md" ]]; then
        err "Missing prompt file: ${PROMPTS_DIR}/${group}.md"
        prompts_exist=false
      fi
    done
    $prompts_exist || return 1
  fi
```

Commit: `feat: skip prompt file preflight when SDK_RUNNER handles resolution`

### D4: Add SDK type check to full-verify.sh (Plan Step 12)

Add after the existing `npx tsc --noEmit` line:

```bash
echo ""
echo "=== SDK type check ==="
npx tsc -p tsconfig.sdk.json --noEmit
```

Commit: `feat: add SDK type check to full-verify.sh`

### D5: Create integration test (Plan Step 11j)

Create `scripts/sdk/__tests__/integration.test.ts` — bash↔TypeScript boundary smoke test.

```typescript
// @vitest-environment node
import { execSync } from "child_process";
```

Approach: create a mock `agent-runner.ts` that prints its received args as JSON to stdout,
then source `agent.sh` functions in a bash subshell and call `run_agent()` with `SDK_RUNNER=1`.

Test cases:
- Reviewer naming convention: group `hooks-adversarial` → `--policy reviewer --agent skill-reviewer --output-file .../reviews/hooks/adversarial.md --prompt-var SKILL=hooks --prompt-var ANGLE=adversarial`
- Curator group: group `scheduling-engine` → `--prompt-var SKILL=scheduling-engine --prompt-var LOG_DIR=...`, no `--agent`, no `--output-file`
- Non-reviewer group: group `some-feature` → generic `SKILL=${group}`, no `--agent`
- `prompt_file` override from naming convention reaches `--prompt`
- `SDK_POLICY`/`SDK_OUTPUT_FILE` env var overrides naming convention defaults
- LOG_DIR env var override: `LOG_DIR=/tmp/test-override` → config.sh respects pre-set value
- LOG_DIR unset → config.sh derives from PHASE and run_suffix as before

Commit: `test: add integration tests for bash↔TypeScript boundary`

### D6: Run full-verify.sh (Plan Step 13)

```bash
./scripts/full-verify.sh
```

Verify:
- All existing tests still pass
- 9 SDK test files discovered by `npm test` (8 from Group A + integration.test.ts from this group)
- SDK type check passes (new in full-verify.sh)
- Integration test passes
- `npx tsx scripts/sdk/agent-runner.ts --help` works
- Frontend `npx tsc --noEmit` still passes

Fix any issues. Commit only if fixes needed.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches)
- Level 2: Commit WIP, move to next task
- Level 3: Commit, mark blocked
- Emergency: `git add -A && git commit -m "emergency: groupD saving work"`
- **Calculations**: NEVER do mental math — use `python3 -c` for arithmetic
