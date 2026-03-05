# Agent Orchestration & Context Management: Recommendations

Based on a deep analysis of Ganttlet's current multi-agent system (12 completed phases, `launch-phase.sh`, prompt structure, hooks, retry logic) and current best practices from Anthropic's engineering team, production multi-agent systems, and the broader agentic coding ecosystem.

---

## Executive Summary

Ganttlet's orchestration is already ahead of most projects — file-ownership isolation, worktree parallelism, staged merge gating, and a validation loop are all solid foundations. The gaps are concentrated in five areas: **retry context poverty**, **agent behavioral guardrails**, **context window management**, **progress persistence**, and **failure diagnostics**. Addressing these will dramatically reduce the rate of agents giving up, going off-rails, or producing hollow implementations.

---

## 1. Retry Context Is Too Thin — Agents Restart Blind

### The Problem

When an agent crashes and restarts, it receives only:
```
NOTE: You are being restarted after a crash. This is attempt 2/3.
Your recent commits in this worktree:
abc1234 wip: trying to fix CPM
def5678 fix: cascade calculation
```

This is **commit titles only** — no error output, no test failures, no compiler messages. The agent must re-diagnose from scratch, which means it often repeats the same mistake or wastes half its context window re-running tests to figure out what went wrong.

### Recommendations

**A. Capture and inject the last N lines of stderr/stdout on crash.**

Before retrying, extract the tail of the previous attempt's log:

```bash
if [[ $attempt -gt 1 ]]; then
  recent_commits=$(cd "$workdir" && git log --oneline -5 2>/dev/null || echo "(no commits yet)")
  # NEW: capture last 100 lines of previous attempt output
  prev_log_tail=$(tail -100 "$logfile" 2>/dev/null | head -80 || echo "(no previous output)")
  full_prompt="NOTE: You are being restarted after a crash. This is attempt ${attempt}/${MAX_RETRIES}.

Your recent commits in this worktree:
${recent_commits}

Last output from your previous attempt (may contain the error that caused the crash):
\`\`\`
${prev_log_tail}
\`\`\`

Review what has already been done. Do NOT redo completed work. If the output above shows a specific error, fix that error first.

---

${prompt}"
fi
```

This single change gives the agent the actual compiler error, test failure, or stack trace that killed the previous run. Use `head -80` to keep the injection bounded — you don't want to blow the context budget on log spam.

**B. Write a `claude-progress.txt` file from within the agent prompt.**

Add this to every group prompt:

```markdown
## Progress Tracking

After completing each major task (H1, H2, etc.), append a status line to `claude-progress.txt`
in the worktree root:

\`\`\`
H1: DONE — fixed cascade duration bug, 4 tests passing
H2: IN PROGRESS — asymmetric cascade implemented, 1 test failing (backward propagation)
\`\`\`

On restart, read `claude-progress.txt` FIRST to understand where you left off.
```

This is Anthropic's officially recommended pattern ("Effective harnesses for long-running agents"). It survives crashes because it's on disk, and it's far more informative than git commit titles.

**C. For the validation agent, inject structured failure context — not raw grep.**

Currently:
```bash
prev_failures="$(grep -A2 'FAIL' "$prev_log" 2>/dev/null | tail -30 || echo "(no previous log)")"
```

This is fragile (depends on "FAIL" appearing in output) and truncated (30 lines). Replace with a structured extraction:

```bash
# Extract the validation report table if present
prev_report=$(sed -n '/║.*CHECK/,/║.*OVERALL/p' "$prev_log" 2>/dev/null || echo "")
# Extract specific error messages (compiler errors, test failures)
prev_errors=$(grep -E '(error\[|FAILED|panicked|assertion.*failed)' "$prev_log" 2>/dev/null | tail -20 || echo "")

prompt_prefix="NOTE: Validation attempt ${attempt}/${max_attempts}.

Previous validation report:
${prev_report}

Specific errors from previous attempt:
${prev_errors}

Fix these specific failures before re-running all checks."
```

---

## 2. Agents Need Explicit Behavioral Guardrails in CLAUDE.md

### The Problem

Agents under pressure (failing tests, running out of context, unclear errors) develop predictable failure modes: deleting tests, commenting out code, producing empty stubs, or declaring "done" when things still fail. These aren't bugs — they're optimization for plausibility over correctness, which is a well-documented LLM behavioral pattern.

### Recommendations

**A. Add an "Anti-Pattern Axioms" section to CLAUDE.md.**

Place this near the top of CLAUDE.md (high-visibility position):

```markdown
## Agent Behavioral Rules (Non-Negotiable)

These rules apply to ALL agents working on this codebase, regardless of prompt instructions:

1. **NEVER delete or skip tests to make a build pass.** If a test fails, fix the code or fix
   the test — but the fix must be substantive (not commenting out, not `assert(true)`, not
   reducing expected values to match broken output).

2. **NEVER produce empty or stub implementations.** Every function must have a real
   implementation. `todo!()`, `unimplemented!()`, `// TODO`, and empty function bodies are
   not acceptable as final output.

3. **NEVER comment out working code to "fix" a compilation error.** If code doesn't compile,
   fix the type error or logic error — don't remove functionality.

4. **If you cannot fix a problem after 3 genuine attempts, STOP and commit what you have with
   a clear commit message explaining what's broken and why.** Do not paper over the failure.
   Example: `"wip: CPM forward pass — backward propagation still fails, LS not updating for
   diamond graphs"`

5. **Every commit message must be honest about the state of the code.** Never write "fix: ..."
   if tests are still failing. Use "wip: ..." or "partial: ..." with an explanation.

6. **Run the verification command for your area before declaring any task complete.**
   Rust: `cargo test && cargo clippy`
   TypeScript: `npx tsc --noEmit && npx vitest run`
   Full: `./scripts/full-verify.sh`
```

**B. Enforce via pre-commit hook (deterministic, not prompt-based).**

Add a pre-commit hook that rejects commits containing known anti-patterns:

```bash
#!/usr/bin/env bash
# .git/hooks/pre-commit — reject hollow implementations

# Check for empty function bodies in staged Rust files
if git diff --cached --name-only | grep -q '\.rs$'; then
  if git diff --cached | grep -qE '^\+.*todo!\(\)|^\+.*unimplemented!\(\)'; then
    echo "ERROR: Commit contains todo!() or unimplemented!() — not allowed."
    exit 1
  fi
fi

# Check for commented-out test blocks
if git diff --cached | grep -qE '^\+\s*//\s*(#\[test\]|it\(|describe\(|test\()'; then
  echo "ERROR: Commit contains commented-out tests — fix or remove properly."
  exit 1
fi
```

This is the "push logic into code, not prompts" principle. Prompts are suggestions; hooks are enforcement.

---

## 3. Context Window Management — Prevent Exhaustion

### The Problem

Group prompts are ~7,500 words. Add CLAUDE.md (~500 lines), tool definitions, and the agent's own work artifacts, and you're burning 30-40% of the context window before the agent writes a single line of code. For complex tasks (I1 alone involves debugging, test-writing, algorithm reimplementation), context exhaustion is a real risk — especially across retries.

### Recommendations

**A. Use just-in-time context loading instead of monolithic prompts.**

Instead of embedding full architectural context in every prompt, use a layered approach:

```markdown
# Phase 12 Group I — Fix Critical Path

Read CLAUDE.md for project context. Read `crates/scheduler/src/cpm.rs` before starting.

## Your files (ONLY modify these):
- `crates/scheduler/src/cpm.rs`
- `crates/scheduler/src/graph.rs`
- `crates/scheduler/src/lib.rs` (only the `compute_critical_path_scoped` binding)

## Tasks:
[... keep tasks concise ...]
```

Move the "What this project is" and "Current state of critical path" sections into a separate file (`docs/context/scheduling-engine.md`) that the agent reads on demand. The prompt should tell the agent *what to read*, not repeat the content.

**Estimated savings**: 30-40% of prompt token budget, which translates directly to more room for the agent to think and iterate.

**B. Add `--max-turns` to agent invocations.**

Claude Code supports `--max-turns N` to cap the number of agentic turns. Without this, a confused agent can burn through its entire context window making API calls that go nowhere:

```bash
echo "$full_prompt" | claude --dangerously-skip-permissions --max-turns 80 -p -
```

This acts as a circuit breaker. If an agent hasn't finished in 80 turns, something is wrong — let it crash and retry with context rather than spinning forever.

**C. Use `--max-budget-usd` for cost containment.**

```bash
echo "$full_prompt" | claude --dangerously-skip-permissions --max-budget-usd 5.00 -p -
```

This prevents runaway token consumption from stuck agents. Set per-group budgets proportional to task complexity.

**D. Segment verify.sh output to avoid context pollution.**

Currently `verify.sh` runs `tsc` and `vitest` on every `.ts/.tsx` edit and dumps up to 50 lines of output into the agent's context. For agents working on Rust files (Groups H, I, L), this is pure noise — TypeScript checks are irrelevant.

Add file-type awareness:

```bash
# Skip TS checks when agent is only editing Rust files
if [[ "$FILE" =~ \.(rs)$ ]]; then
  echo "[cargo check]"
  cd crates/scheduler && cargo check 2>&1 | tail -20
  exit $?
fi
```

Or better — make the hook configurable per-agent via an environment variable:

```bash
VERIFY_MODE="${VERIFY_MODE:-ts}"  # default: ts. Options: ts, rust, full
```

---

## 4. Agent Progress Should Be Observable and Persistent

### The Problem

Right now, the only way to know an agent's progress is to tail its log file or watch the tmux pane. There's no structured state that survives a crash, no way to diff "what the agent planned to do" vs. "what it actually did," and no machine-readable progress that the orchestrator can act on.

### Recommendations

**A. Require structured progress files.**

Add to every group prompt:

```markdown
## Progress Protocol

Maintain a file called `.agent-status.json` in your worktree root. Update it after each
major task:

\`\`\`json
{
  "group": "I",
  "phase": 12,
  "tasks": {
    "I1": { "status": "done", "tests_passing": 4, "tests_failing": 0 },
    "I2": { "status": "in_progress", "tests_passing": 2, "tests_failing": 1,
             "blocker": "cross-scope dependency not propagating ES correctly" },
    "I3": { "status": "pending" },
    "I4": { "status": "pending" },
    "I5": { "status": "pending" }
  },
  "last_updated": "2026-03-04T14:30:00Z"
}
\`\`\`
```

The orchestrator can then:
- Poll `.agent-status.json` to show real-time progress
- Inject it into retry context on crash
- Detect stalled agents (status unchanged for N minutes)

**B. Add a mid-run checkpoint commit strategy.**

Currently agents commit at the end of each major task. Add guidance for intermediate commits:

```markdown
## Commit Strategy

- Commit after each numbered task (H1, H2, H3) with a descriptive message
- If a single task takes more than 15 minutes of work, make a WIP commit: `"wip(H1): forward pass fixed, backward pass still failing"`
- WIP commits ensure progress isn't lost on crash
- The final commit for each task should be clean (not WIP)
```

**C. Have the orchestrator monitor for stalls.**

Add a watchdog to `launch-phase.sh`:

```bash
monitor_agent() {
  local workdir="$1" group="$2" timeout_minutes="${3:-30}"
  local status_file="${workdir}/.agent-status.json"
  local last_mod=0

  while kill -0 "$agent_pid" 2>/dev/null; do
    sleep 60
    if [[ -f "$status_file" ]]; then
      current_mod=$(stat -c %Y "$status_file" 2>/dev/null || echo 0)
      if [[ "$current_mod" == "$last_mod" ]]; then
        elapsed=$(( ($(date +%s) - current_mod) / 60 ))
        if [[ $elapsed -ge $timeout_minutes ]]; then
          warn "${group}: no progress update in ${elapsed} minutes — may be stuck"
        fi
      fi
      last_mod=$current_mod
    fi
  done
}
```

---

## 5. Prompt Structure Improvements

### The Problem

Current prompts are well-structured but have some patterns that cause agents to go off-rails:

1. "If you cannot fix it after 3 attempts, commit what you have and move on" — agents interpret "3 attempts" loosely and give up too early
2. No explicit "what success looks like" at the top of the prompt
3. Background context is mixed with executable instructions

### Recommendations

**A. Lead every prompt with a success criteria summary.**

```markdown
# Phase 12 Group I — Fix Critical Path

## Success Criteria (you're done when ALL of these are true):
1. `cd crates/scheduler && cargo test` — all tests pass, including new CPM tests
2. `cd crates/scheduler && cargo clippy` — no warnings
3. Linear chain, diamond, and scoped critical path tests all exist and pass
4. Milestone scope variant is removed
5. Critical edges are returned alongside critical task IDs
6. All changes committed with descriptive messages

## Failure Criteria (these mean you need to keep working):
- Any test failing
- Any clippy warning
- Missing test coverage for a task you completed
- Uncommitted changes
```

Putting this at the top anchors the agent's definition of "done" before it starts reading task details.

**B. Use explicit attempt budgets instead of vague "3 attempts".**

Replace:
```
If you cannot fix it after 3 attempts, commit what you have and move on.
```

With:
```
If a specific test or compilation error persists after 3 distinct fix approaches (not 3
identical retries), commit what you have with a message explaining: (1) what the error is,
(2) what you tried, (3) why you think it's failing. Then move to the next task.

"Distinct fix approaches" means meaningfully different strategies — not tweaking the same
line three times.
```

**C. Separate context from instructions using clear section markers.**

```markdown
# [CONTEXT — read but don't act on this section]
...background, architecture, current state...

# [INSTRUCTIONS — execute these in order]
...tasks with acceptance criteria...

# [CONSTRAINTS — always obey these]
...file boundaries, behavioral rules...
```

This reduces the chance of an agent treating context as an instruction to modify things not in its scope.

---

## 6. Merge Conflict Resolution Needs More Context

### The Problem

The merge conflict agent gets only:
```
The following files have conflicts:
src/file1.rs
src/file2.ts
```

No diff content, no information about what each branch was doing, no guidance on which side to prefer. The agent must read each file, figure out the conflict markers, and guess at intent.

### Recommendations

**Inject the actual diff and branch descriptions:**

```bash
resolve_merge_conflicts() {
  local branch="$1" msg="$2"
  local conflicts
  conflicts=$(git diff --name-only --diff-filter=U)

  # NEW: get the actual conflict content
  local conflict_diffs=""
  for f in $conflicts; do
    conflict_diffs+="
=== $f ===
$(head -200 "$f")
"
  done

  # NEW: get branch descriptions from commit messages
  local branch_summary
  branch_summary=$(git log --oneline main.."$branch" | head -10)

  fix_prompt="You are resolving git merge conflicts in the Ganttlet project.
Branch '${branch}' is being merged into main.

What the branch did (recent commits):
${branch_summary}

Conflicted files and their current state (showing conflict markers):
${conflict_diffs}

Instructions:
1. For each file, combine BOTH sides of the conflict. The branch changes and main changes
   should coexist — this is a parallel merge, not a choice between sides.
2. After resolving: git add <file>
3. After all resolved: git commit --no-edit
4. Verify: git status shows clean state

Do NOT enter plan mode. Fix conflicts and commit."
```

---

## 7. Validation Agent Should Be Decomposed

### The Problem

The validation prompt runs 9 checks (V1–V9) sequentially. This is a lot for one agent — by check V7, the agent may have consumed significant context on earlier fixes, and its attention to later checks degrades. Additionally, if the agent fixes V1 but introduces a regression in V3, it may not notice.

### Recommendations

**A. Split validation into a two-pass structure.**

Pass 1: Run all checks, report results (no fixes). This is cheap — just running commands.

Pass 2: Fix failures from Pass 1, re-run only the failing checks.

```markdown
## Phase 1: Diagnostic (do NOT fix anything yet)

Run each check below. Record PASS or FAIL in your report. Do not attempt any fixes.

[V1 through V9 commands]

## Phase 2: Fix and Verify

For each FAILED check from Phase 1:
1. Diagnose the root cause
2. Fix it
3. Re-run THAT check to confirm
4. Re-run ALL checks to verify no regressions

## Phase 3: Final Report

Re-run all 9 checks one final time. Report the results.
```

This prevents the agent from getting lost in a fix-one-break-another cycle.

**B. Consider using subagents for independent check categories.**

Rust checks (V1, V2, V6, V7, V8, V9) and TypeScript checks (V3, V4, V5) are independent. They could run as parallel subagents, each with focused context.

---

## 8. Hook Configuration Should Be Agent-Aware

### The Problem

`verify.sh` runs `tsc` + `vitest` on every `.ts/.tsx` edit. For Rust-focused agents (H, I, L), this is irrelevant overhead that consumes context tokens and wall-clock time. For a TypeScript agent editing frontend code, `cargo test` would be equally irrelevant.

### Recommendations

**A. Make hooks aware of agent scope.**

Set an environment variable in the agent's prompt or launch command:

```bash
AGENT_SCOPE=rust echo "$full_prompt" | claude --dangerously-skip-permissions -p -
```

Then in `verify.sh`:

```bash
AGENT_SCOPE="${AGENT_SCOPE:-full}"

case "$AGENT_SCOPE" in
  rust)
    if [[ "$FILE" =~ \.(rs)$ ]]; then
      cd crates/scheduler && cargo check 2>&1 | tail -20
    fi
    ;;
  ts)
    if [[ "$FILE" =~ \.(ts|tsx)$ ]]; then
      npx tsc --noEmit 2>&1 | tail -20
      npx vitest run --reporter=dot 2>&1 | tail -30
    fi
    ;;
  full|*)
    # Current behavior: run both
    ;;
esac
```

**B. Rate-limit hook execution.**

Running `vitest` on every single edit is expensive. Add a cooldown:

```bash
LAST_VERIFY="${TMPDIR:-/tmp}/.last-verify-$(basename "$workdir")"
NOW=$(date +%s)
LAST=$(cat "$LAST_VERIFY" 2>/dev/null || echo 0)

if (( NOW - LAST < 30 )); then
  echo "[verify: skipped, last run ${elapsed}s ago]"
  exit 0
fi
echo "$NOW" > "$LAST_VERIFY"
```

This prevents test suites from running 20 times in rapid succession when an agent is making multiple quick edits.

---

## 9. Error Recovery Patterns

### The Problem

When an agent encounters an error it can't solve, the current instruction is: "commit what you have and move on." This is reasonable but under-specified. Agents interpret "move on" in various ways — sometimes they move to the next task, sometimes they abandon the entire mission.

### Recommendations

**A. Define explicit escalation levels.**

```markdown
## Error Handling Protocol

Level 1 — Fixable error (compilation, test failure):
  → Read the error message. Fix the code. Re-run. Up to 3 distinct approaches.

Level 2 — Stuck after 3 approaches:
  → Commit with "wip: [task] — [error description], tried [approaches]"
  → Move to the NEXT NUMBERED TASK. Do not abandon remaining work.

Level 3 — Blocking error (can't compile at all, dependency missing, WASM broken):
  → Commit what you have.
  → Write a note in claude-progress.txt: "BLOCKED: [description]"
  → Continue with any tasks that don't depend on the blocked one.

CRITICAL: "Move on" means "go to the next task." It NEVER means "stop all work."
```

**B. Add a "panic commit" instruction.**

```markdown
If you are about to run out of context or time, make an emergency commit immediately:
\`\`\`bash
git add -A && git commit -m "emergency: [group] saving work before context limit — [brief status]"
\`\`\`
This ensures no work is lost even if you crash.
```

---

## 10. Orchestrator-Level Improvements

### A. Parallel Stage Failure Should Not Be All-or-Nothing

Currently, if one group in a parallel stage fails, the entire stage is considered failed. But groups work on independent files — Group H's failure shouldn't block Group I's merge.

```bash
# Instead of:
wait  # waits for all, fails if any fail

# Use:
for pid in "${pids[@]}"; do
  wait "$pid" || failed_groups+=("${pid_to_group[$pid]}")
done

# Merge successful groups, skip failed ones
for i in "${!groups[@]}"; do
  if [[ ! " ${failed_groups[*]} " =~ " ${groups[$i]} " ]]; then
    merge_branch "${branches[$i]}" "${messages[$i]}"
  fi
done
```

This maximizes the work that lands on `main` even when some agents fail.

### B. Add a Pre-Flight Check

Before launching agents, verify the environment is sane:

```bash
preflight_check() {
  # Verify WASM builds
  npm run build:wasm || { err "WASM build broken before launch — fix first"; exit 1; }
  # Verify tests pass on main
  npx vitest run || { err "Tests failing on main before launch — fix first"; exit 1; }
  # Verify clean git state
  [[ -z "$(git status --porcelain)" ]] || { err "Dirty git state — commit first"; exit 1; }
}
```

Launching agents into a broken environment guarantees they'll waste time diagnosing pre-existing issues.

### C. Add `--model` Selection Per Task Complexity

Not every agent needs the most expensive model:

```bash
# Simple tasks (formatting, renaming, trivial fixes)
MODEL="sonnet" run_agent groupH "$workdir_H"

# Complex tasks (algorithm design, debugging)
MODEL="opus" run_agent groupI "$workdir_I"
```

In `run_agent`:
```bash
local model_flag=""
[[ -n "${MODEL:-}" ]] && model_flag="--model $MODEL"
echo "$full_prompt" | claude --dangerously-skip-permissions $model_flag -p -
```

---

## 11. Testing the Orchestration Itself

### The Problem

The orchestration system has never been tested independently. If `launch-phase.sh` has a bug in worktree cleanup, merge logic, or retry context construction, it manifests as a mysterious agent failure.

### Recommendations

**Create a dry-run / smoke-test mode:**

```bash
# scripts/launch-phase.sh dry-run
# Creates worktrees, injects a trivial prompt ("echo 'hello' && exit 0"),
# verifies merge, cleanup, and retry logic work correctly
```

**Add integration tests for the retry context builder:**

```bash
test_retry_context() {
  # Set up a worktree with known commits
  # Run the context injection logic
  # Assert the output contains expected commit messages and log tails
}
```

---

## Summary: Priority Order

| Priority | Recommendation | Impact | Effort |
|----------|---------------|--------|--------|
| **P0** | Rich retry context (log tails, not just commits) | High | Low |
| **P0** | Anti-pattern axioms in CLAUDE.md | High | Low |
| **P0** | Progress file (`claude-progress.txt`) | High | Low |
| **P1** | Success/failure criteria at top of prompts | High | Medium |
| **P1** | `--max-turns` and `--max-budget-usd` flags | Medium | Low |
| **P1** | Pre-commit hook for anti-patterns | Medium | Low |
| **P1** | Richer merge conflict context (diffs, not just file list) | Medium | Low |
| **P2** | Agent-aware hooks (AGENT_SCOPE) | Medium | Medium |
| **P2** | Structured `.agent-status.json` | Medium | Medium |
| **P2** | Partial stage success (don't block on one failure) | Medium | Medium |
| **P2** | Two-pass validation structure | Medium | Medium |
| **P3** | Preflight checks before launch | Low | Low |
| **P3** | Model selection per task complexity | Low | Low |
| **P3** | Just-in-time context loading | Medium | High |
| **P3** | Orchestrator dry-run tests | Low | Medium |
