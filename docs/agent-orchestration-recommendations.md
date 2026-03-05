# Agent Orchestration & Context Management: Recommendations

Based on a deep analysis of Ganttlet's current multi-agent system (12 completed phases, `launch-phase.sh`, prompt structure, hooks, retry logic) and current best practices from Anthropic's engineering team, production multi-agent systems, and the broader agentic coding ecosystem.

**Sources consulted:** Anthropic's "Effective harnesses for long-running agents" and "Effective context engineering for AI agents" engineering posts, the `claude-code-action` GitHub Action docs, Claude Code CLI documentation (costs, skills, agent teams, common workflows), JetBrains Research on context management, Chroma Research on context rot, and production multi-agent frameworks (ccswarm, ruflo, Coder Tasks).

---

## Executive Summary

Ganttlet's orchestration is already ahead of most projects — file-ownership isolation, worktree parallelism, staged merge gating, and a validation loop are all solid foundations. The gaps are concentrated in seven areas: **retry context poverty**, **agent behavioral guardrails**, **context window management**, **progress persistence**, **failure diagnostics**, **GitHub issue-to-agent pipeline**, and **CLAUDE.md context density**. Addressing these will dramatically reduce the rate of agents giving up, going off-rails, or producing hollow implementations — especially as you shift from orchestrated phases to issue-driven single-agent work.

### How to Use This Document

This is designed as planning input. Each section follows the pattern: **problem** (what's broken or missing) → **recommendation** (what to do, with code) → **priority** (in the summary table at the end). Sections are ordered by logical dependency, not priority — see the Summary table (Section 16) for implementation order. Cross-references between sections use `(→ Section N)` notation.

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

Instead of embedding full architectural context in every prompt, tell agents *what to read* rather than repeating the content inline. This becomes even more powerful when combined with the skills pattern (→ Section 15), which provides a structured framework for progressive context loading:

```markdown
# Phase 12 Group I — Fix Critical Path

Read CLAUDE.md for project context. Read the scheduling-engine skill for domain knowledge.
Read `crates/scheduler/src/cpm.rs` before starting.

## Your files (ONLY modify these):
- `crates/scheduler/src/cpm.rs`
- `crates/scheduler/src/graph.rs`
- `crates/scheduler/src/lib.rs` (only the `compute_critical_path_scoped` binding)

## Tasks:
[... keep tasks concise ...]
```

Move the "What this project is" and "Current state of critical path" sections into skill files or reference docs that the agent reads on demand.

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

## 12. GitHub Issue-to-Agent Pipeline — Current Gaps and Overhaul

### The Problem

The current `agent-work.yml` has several issues that will cause increasing pain as you scale up issue-driven agent work:

**A. The prompt is too thin.** The agent receives only the issue title, body, and five generic instructions. There's no structured context about scope boundaries, acceptance criteria, or what files to focus on. Compare this to phase prompts (which get ~7,500 words of carefully crafted context) — issue-driven agents are starting nearly blind.

**B. No issue quality gate.** Any issue labeled `agent-ready` triggers the workflow immediately, regardless of whether the issue has enough context for autonomous work. Vague issues like "fix the scheduling bug" will produce vague PRs.

**C. No retry on failure.** If the Claude step fails, the workflow comments "failed" and stops. There's no attempt to retry with error context — unlike `launch-phase.sh` which retries 3 times.

**D. The PR body is generic.** It says "This PR was generated by Claude Code" but doesn't describe what was changed, what tests were added, or what the agent couldn't do. Reviewers must read the diff cold.

**E. No `--max-turns` or `--max-budget-usd`.** A confused agent can spin for the full 30-minute timeout burning tokens.

**F. No issue templates exist.** There's no `.github/ISSUE_TEMPLATE/` directory, so issues have no guided structure.

### Recommendations

**A. Create structured issue templates.**

Create `.github/ISSUE_TEMPLATE/agent-task.yml`:

```yaml
name: Agent Task
description: Task for Claude Code to implement autonomously
labels: ["needs-review"]
body:
  - type: textarea
    id: summary
    attributes:
      label: Task Summary
      description: One paragraph — what needs to be built or fixed
    validations:
      required: true

  - type: textarea
    id: acceptance-criteria
    attributes:
      label: Acceptance Criteria
      description: Checklist of testable outcomes. The agent uses this to know when it's done.
      placeholder: |
        - [ ] Tests pass for the new behavior
        - [ ] Existing tests still pass
        - [ ] No clippy/tsc warnings
      value: |
        - [ ] All existing tests still pass (`./scripts/full-verify.sh`)
        - [ ]
    validations:
      required: true

  - type: textarea
    id: scope
    attributes:
      label: Scope Boundaries
      description: What should NOT be changed. Prevents agent scope creep.
      placeholder: |
        - Do NOT modify the relay server
        - Do NOT change public WASM bindings
        - Do NOT refactor unrelated code
    validations:
      required: true

  - type: textarea
    id: files
    attributes:
      label: Relevant Files
      description: Files the agent should focus on (optional but helps a lot)
      placeholder: |
        - src/components/TaskBar.tsx (main component)
        - crates/scheduler/src/cascade.rs (if scheduling related)

  - type: dropdown
    id: complexity
    attributes:
      label: Estimated Complexity
      options:
        - Small (1-2 files, straightforward)
        - Medium (3-5 files, some design decisions)
        - Large (5+ files, architectural impact)
    validations:
      required: true
```

**B. Add an issue quality gate workflow.**

Create `.github/workflows/agent-gate.yml` that runs *before* the agent:

```yaml
name: Agent Issue Gate
on:
  issues:
    types: [labeled]

jobs:
  validate:
    if: github.event.label.name == 'agent-ready'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const body = context.payload.issue.body || '';
            const warnings = [];

            // Check for acceptance criteria
            if (!body.includes('- [ ]') && !body.includes('- [x]')) {
              warnings.push('No acceptance criteria checklist found.');
            }

            // Check for scope boundaries
            const hasScope = body.toLowerCase().includes('scope') ||
                             body.toLowerCase().includes('not modify') ||
                             body.toLowerCase().includes('not change');
            if (!hasScope) {
              warnings.push('No scope boundaries specified — risk of agent scope creep.');
            }

            // Check minimum detail
            if (body.length < 200) {
              warnings.push('Issue body is very short (< 200 chars). Agent may lack context.');
            }

            if (warnings.length > 0) {
              await github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: '⚠️ **Agent readiness check:**\n\n' +
                  warnings.map(w => `- ${w}`).join('\n') +
                  '\n\nConsider adding more detail before the agent starts. ' +
                  'Remove and re-add the `agent-ready` label after updating.'
              });
              // Remove the label to prevent premature agent launch
              await github.rest.issues.removeLabel({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                name: 'agent-ready'
              });
            }
```

**C. Overhaul `agent-work.yml` with rich context injection and retry logic.**

There are two approaches for invoking Claude Code in GitHub Actions:

1. **`anthropics/claude-code-action@v1`** — Anthropic's official action. Handles token setup, @claude comment interaction, and auto-mode detection. Best for interactive workflows where humans and agents collaborate in issue/PR comments.
2. **Raw `claude -p` CLI** — More control over flags (`--max-turns`, `--max-budget-usd`, `--model`), retry logic, and prompt construction. Better for fully autonomous workflows.

For Ganttlet's issue-to-PR pipeline, the raw CLI approach gives more control. Here are the key changes:

```yaml
      - name: Run Claude Code (with retry)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          ISSUE_TITLE: ${{ github.event.issue.title }}
          ISSUE_BODY: ${{ github.event.issue.body }}
        run: |
          # Build the prompt with structured context
          # NOTE: Use env vars (not ${{ }} interpolation) to avoid shell injection
          cat > /tmp/agent-prompt.md <<PROMPT_END
          # Issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}

          ## Issue Description
          ${ISSUE_BODY}

          ## Instructions

          1. Read CLAUDE.md for project context, architecture constraints, and behavioral rules.
          2. Identify the relevant files. If the issue lists them, start there. Otherwise, use
             grep/find to locate the relevant code.
          3. Write or update tests FIRST that verify the expected behavior.
          4. Implement the changes to make the tests pass.
          5. Run full verification: ./scripts/full-verify.sh
          6. If verification fails, fix the issues. Do not skip tests or weaken assertions.
          7. Commit with descriptive messages. Use conventional commits (feat:, fix:, etc.).

          ## Scope Rules
          - ONLY modify files directly relevant to this issue.
          - Do NOT refactor unrelated code.
          - Do NOT modify CI/CD workflows, Dockerfile, or package.json unless the issue
            specifically requires it.
          - If you need to change a shared file (lib.rs, types.ts), keep changes minimal.

          ## When Done
          Write a file called .agent-summary.md in the repo root containing:
          - What you changed and why
          - What tests you added or modified
          - What you were unable to complete (if anything) and why
          - The output of ./scripts/full-verify.sh
          PROMPT_END

          # Retry loop (mirrors launch-phase.sh pattern)
          MAX_ATTEMPTS=2
          for attempt in $(seq 1 $MAX_ATTEMPTS); do
            echo "=== Agent attempt ${attempt}/${MAX_ATTEMPTS} ==="

            if [[ $attempt -gt 1 ]]; then
              # Inject error context from previous attempt
              PREV_LOG=$(tail -80 /tmp/agent-attempt-$((attempt-1)).log 2>/dev/null || echo "(no log)")
              RECENT_COMMITS=$(git log --oneline -5 2>/dev/null || echo "(none)")
              cat > /tmp/retry-context.md <<RETRY
          NOTE: Previous attempt failed. This is attempt ${attempt}/${MAX_ATTEMPTS}.

          Recent commits (your previous progress):
          ${RECENT_COMMITS}

          Last output from previous attempt:
          \`\`\`
          ${PREV_LOG}
          \`\`\`

          Continue from where the previous attempt left off. Do not redo completed work.

          ---

          RETRY
              cat /tmp/agent-prompt.md >> /tmp/retry-context.md
              PROMPT_FILE=/tmp/retry-context.md
            else
              PROMPT_FILE=/tmp/agent-prompt.md
            fi

            claude -p "$(cat $PROMPT_FILE)" \
              --dangerously-skip-permissions \
              --max-turns 50 \
              --max-budget-usd 8.00 \
              > /tmp/agent-attempt-${attempt}.log 2>&1 && break

            echo "Attempt ${attempt} failed (exit code $?)"
          done

      - name: Build PR body from agent summary
        run: |
          if [[ -f .agent-summary.md ]]; then
            PR_BODY=$(cat .agent-summary.md)
          else
            PR_BODY="Agent did not produce a summary. Review the diff carefully."
          fi
          echo -e "Closes #${{ github.event.issue.number }}\n\n${PR_BODY}" > /tmp/pr-body.md

      - name: Push and create PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # Don't create PR if agent made no commits
          if [[ -z "$(git log origin/main..HEAD --oneline)" ]]; then
            echo "Agent made no commits — skipping PR creation"
            exit 1
          fi
          git push -u origin "$BRANCH"
          gh pr create \
            --title "Agent: ${{ github.event.issue.title }}" \
            --body-file /tmp/pr-body.md \
            --head "$BRANCH" \
            --base main
```

Note the security improvement: issue content is passed via environment variables (`${ISSUE_BODY}`) rather than `${{ }}` template interpolation, which avoids shell injection if an issue body contains backticks or `$()` constructs.

**D. Add a triage label system.**

Use labels to route issues to the right agent configuration:

| Label | Agent Config |
|-------|-------------|
| `agent-ready` + `rust` | `AGENT_SCOPE=rust`, higher `--max-turns` |
| `agent-ready` + `frontend` | `AGENT_SCOPE=ts`, standard turns |
| `agent-ready` + `small` | `--max-turns 25`, `--max-budget-usd 3.00` |
| `agent-ready` + `complex` | `--max-turns 80`, `--max-budget-usd 15.00` |

This prevents small issues from consuming excessive resources and gives complex issues room to breathe.

---

## 13. Context Management Deep Dive

Context is the single most important factor determining whether an agent succeeds or fails. Every token matters — wasted context is wasted capability. This section goes deeper than the earlier Section 3 with specific strategies for the Ganttlet project.

### Understanding the Context Budget

A Claude agent session has a finite context window. Here's approximately how it gets consumed in Ganttlet:

| Component | Est. Tokens | Notes |
|-----------|-------------|-------|
| System prompt + tool definitions | ~4,000 | Fixed overhead, unavoidable |
| CLAUDE.md (current: ~500 lines) | ~5,000 | Read on every session start |
| Group prompt (e.g., groupI.md) | ~4,000 | The mission brief |
| Each file read by agent | 500-3,000 | Per file, depends on size |
| Each tool output (test run, compile) | 200-2,000 | Grows with verbosity |
| Agent's own reasoning/output | 1,000+ per turn | Accumulates rapidly |
| PostToolUse hook output (verify.sh) | 300-800 | Per invocation |

A session that reads 5 files, runs tests 10 times, and edits 8 files can easily consume 80-100K tokens. Auto-compaction kicks in when approaching limits, but compaction is lossy — it summarizes earlier turns, which can cause the agent to forget critical details about what it tried and why.

### Recommendation: Restructure CLAUDE.md for Agents

The current CLAUDE.md is ~500 lines and contains everything from project overview to git workflow to CLI reference to Docker instructions. An agent working on a single issue doesn't need most of this. But CLAUDE.md is read automatically at session start, so every line costs tokens for every agent session.

**Split CLAUDE.md into a lean core + reference files** (see also → Section 14 for structural rationale and → Section 15 for how skills complement this):

Keep the core CLAUDE.md under 150 lines. Here's a concrete example with the behavioral rules and error protocol filled in:

```markdown
# Ganttlet

## What This Is
Collaborative Gantt chart. Rust→WASM scheduling engine + React frontend + CRDT sync.
Google Sheets is the durable store. No app database. Relay server is stateless.

## Agent Behavioral Rules (Non-Negotiable)
1. NEVER delete or skip tests to make a build pass.
2. NEVER produce empty or stub implementations (todo!(), unimplemented!(), // TODO).
3. NEVER comment out working code to "fix" a compilation error.
4. If stuck after 3 distinct approaches, commit WIP with honest message explaining what's broken.
5. Every commit message must reflect actual code state (wip: not fix: if tests fail).
6. Run verification for your area before declaring any task complete.

## Error Handling Protocol
- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP, move to NEXT TASK (not "stop all work").
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.
- Emergency: If running out of context, `git add -A && git commit -m "emergency: saving work"`.

## Commands
- `npm run dev` — WASM + Vite dev server
- `npm run test` — unit tests
- `./scripts/full-verify.sh` — full verification (tsc + vitest + cargo + E2E)
- `cd crates/scheduler && cargo test` — Rust scheduler tests

## Architecture Constraints
- Thin server: relay only forwards CRDT messages
- All business logic runs in browser
- Minimal dependencies
- No test-specific code paths in production builds

## For More Context
- Architecture details: `docs/architecture.md`
- Completed work: `docs/completed-phases.md`
- Multi-agent workflow: `docs/multi-agent-guide.md`
- Cloud deployment: `docs/cloud-verification-plan.md`
```

Move everything else (Docker setup, CLI reference, multi-agent orchestration details, git workflow, E2E testing instructions) into dedicated files under `docs/`. Agents that need this context can read it on demand. Agents that don't (which is most issue-driven agents) save ~3,500 tokens.

### Recommendation: Prompt Agents to Front-Load File Reads

Agents that read files early in their session — before starting to edit — make better decisions and waste fewer turns on wrong approaches. But agents working from issues often start editing immediately without understanding the codebase.

Add this to the issue-driven agent prompt:

```markdown
## Before Writing Any Code

1. Read the files listed in the issue (or find the relevant files via grep).
2. Read any test files for those modules.
3. Understand the CURRENT behavior before changing anything.
4. Only then start writing code.

This upfront investment prevents wasted turns from misunderstanding the code.
```

### Recommendation: Control PostToolUse Output Volume

The current `verify.sh` pipes up to 50 lines of output into the agent's context on every edit. Over a session with 20 edits, that's up to 1,000 lines of test/compile output — much of it repetitive.

Strategies to reduce this:

1. **Truncate more aggressively for repeated runs.** If the same error appears 3 times, the agent has already seen it. Show only new/changed errors:

```bash
# In verify.sh: diff against previous run
PREV_OUTPUT="${TMPDIR:-/tmp}/.verify-prev-$(basename "$workdir")"
CURR_OUTPUT=$(npx vitest run --reporter=dot 2>&1)

if [[ -f "$PREV_OUTPUT" ]] && diff -q <(echo "$CURR_OUTPUT") "$PREV_OUTPUT" > /dev/null 2>&1; then
  echo "[vitest: same result as previous run — no change]"
else
  echo "$CURR_OUTPUT" | tail -20
  echo "$CURR_OUTPUT" > "$PREV_OUTPUT"
fi
```

2. **Use `--reporter=dot` for vitest** (you already do this — good). But also consider `--reporter=json` piped through a minimal formatter that shows only failures:

```bash
npx vitest run --reporter=json 2>/dev/null | node -e "
  let d=''; process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    const r=JSON.parse(d);
    const failed=r.testResults.filter(t=>t.status==='failed');
    if(failed.length===0) console.log('All tests pass (' + r.numPassedTests + ')');
    else failed.forEach(t=>console.log('FAIL: '+t.name+': '+t.message?.slice(0,200)));
  });
"
```

This reduces a 30-line test output to 1 line on success or a few targeted lines on failure.

3. **For `tsc --noEmit`**, show only the error count + first 5 errors instead of all errors:

```bash
TSC_OUTPUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?
if [[ $TSC_EXIT -ne 0 ]]; then
  ERROR_COUNT=$(echo "$TSC_OUTPUT" | grep -c "error TS")
  echo "[tsc: ${ERROR_COUNT} errors]"
  echo "$TSC_OUTPUT" | grep "error TS" | head -5
else
  echo "[tsc: clean]"
fi
```

### Recommendation: Use Subagents for Expensive Operations

When a main agent needs to do something expensive that generates lots of context (like running the full test suite, reading a large file, or debugging a complex error), it can spawn a subagent via the Task tool. The subagent runs in its own context, does the work, and returns a concise summary. The main agent's context stays clean.

For issue-driven work, add this guidance to the prompt:

```markdown
## Context Conservation

If you need to investigate a complex error or read many files to understand a pattern,
consider using the Task tool to spawn a focused subagent. The subagent does the research
and returns a summary, keeping your main context clean for implementation work.

Example: Instead of reading 10 files yourself, spawn: "Read the authentication middleware
chain in src/middleware/ and summarize how requests are validated."
```

### Recommendation: Detect and Respond to Auto-Compaction

When Claude Code auto-compacts, earlier conversation turns are summarized. This can cause the agent to lose track of what it already tried. Add this to CLAUDE.md:

```markdown
## If You Lose Track of Previous Work

If you're unsure what you've already done (this can happen in long sessions):
1. Check `git log --oneline -10` to see your recent commits
2. Check `claude-progress.txt` if it exists
3. Run `git diff --stat HEAD~5..HEAD` to see what files you've changed
4. Run tests to see current state: `cargo test` or `npm run test`

Do NOT re-implement something you've already committed.
```

### Recommendation: Right-Size Context for Issue Complexity

Not all issues need the same context budget. A typo fix needs 10 turns; an algorithm rewrite needs 80. The workflow should adapt:

```yaml
      - name: Determine agent configuration
        id: config
        run: |
          LABELS='${{ join(github.event.issue.labels.*.name, ',') }}'
          if echo "$LABELS" | grep -q "complex"; then
            echo "max_turns=80" >> $GITHUB_OUTPUT
            echo "max_budget=15.00" >> $GITHUB_OUTPUT
          elif echo "$LABELS" | grep -q "small"; then
            echo "max_turns=25" >> $GITHUB_OUTPUT
            echo "max_budget=3.00" >> $GITHUB_OUTPUT
          else
            echo "max_turns=50" >> $GITHUB_OUTPUT
            echo "max_budget=8.00" >> $GITHUB_OUTPUT
          fi

      - name: Run Claude Code
        run: |
          claude -p "$(cat /tmp/agent-prompt.md)" \
            --dangerously-skip-permissions \
            --max-turns ${{ steps.config.outputs.max_turns }} \
            --max-budget-usd ${{ steps.config.outputs.max_budget }}
```

---

## 14. CLAUDE.md as Agent Operating System

CLAUDE.md isn't just documentation — it's the operating system for every agent that touches the codebase. For issue-driven agents that don't get hand-crafted prompts, CLAUDE.md is often the *only* structured guidance they receive. This makes its design critical.

### Current Issues

1. **Too long for its role.** At ~500 lines, it consumes ~5,000 tokens on every session. Most of that content (Docker setup, multi-agent CLI reference, deployment details) is irrelevant to a single-issue agent. See the context budget table in → Section 13 for the full breakdown.

2. **Behavioral rules are buried (or missing).** The most important content for agent correctness (what not to do, how to handle errors) doesn't exist yet. When you add it (→ Section 2), it needs to be near the top — not buried after 200 lines of architecture notes.

3. **No recovery guidance.** When an agent gets confused or loses context (→ Section 13, auto-compaction), there's nothing telling it how to re-orient. This is when agents go off-rails.

4. **Missing operational patterns.** Issue-driven agents need to know: how to create branches, how to structure commits, how to write PR summaries, how to handle blocked work. The current "Single-Agent Issue Work" section is 6 lines. The skills pattern (→ Section 15) provides a natural home for these expanded instructions without bloating CLAUDE.md.

### Recommended CLAUDE.md Structure

```
1. Agent Behavioral Rules (Non-Negotiable)     ← ~20 lines, TOP of file
2. Commands Quick Reference                      ← ~15 lines
3. Architecture Constraints                      ← ~10 lines
4. Single-Agent Issue Workflow                   ← ~30 lines (expanded)
5. Error Handling Protocol                       ← ~15 lines
6. Context Conservation Guide                    ← ~10 lines
7. Pointers to Reference Docs                   ← ~10 lines
                                          TOTAL: ~110 lines (~1,200 tokens)
```

Everything else moves to reference files that agents read on demand. The multi-agent orchestration section, Docker instructions, CLI reference, and deployment details are only needed by specific workflows — not by every agent on every issue.

### Expand the Single-Agent Issue Workflow

The current section is:

```
- Branch naming: `agent/issue-{number}`
- Full verification: `./scripts/full-verify.sh`
- Open a PR with `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}` for auto-closing
- Commit often with descriptive messages
```

Expand to:

```markdown
### Single-Agent Issue Work

When working from a GitHub issue (via `agent-ready` label or manual assignment):

**Setup:**
- Branch: `agent/issue-{number}`
- Read the issue carefully. Identify acceptance criteria and scope boundaries.
- If the issue lacks acceptance criteria, write your own based on the description.

**Implementation:**
- Read relevant files BEFORE editing. Understand current behavior first.
- Write/update tests FIRST, then implement.
- Commit after each logical change (not just at the end).
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`

**Verification:**
- Run `./scripts/full-verify.sh` before declaring done.
- If E2E tests fail but unit tests pass, note this in your summary.

**PR Creation:**
- `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}`
- Write a summary: what changed, what tests added, what couldn't be done

**If Stuck:**
- Follow the Error Handling Protocol (see above)
- Commit WIP with clear status message
- Write `.agent-summary.md` explaining where you got stuck
- The PR will be created even with partial work — human reviewers can help
```

---

## 15. Apply the Skills Pattern for Progressive Context Disclosure

Anthropic's skills architecture is a three-level lazy-loading system that solves exactly the context bloat problem Ganttlet faces. Rather than stuffing everything into CLAUDE.md or monolithic prompts, skills let agents discover what's available cheaply and load detailed instructions only when needed.

### How the Pattern Works

1. **Level 1 — Metadata (always loaded, ~100 tokens per skill):** A short name + description that tells the agent what the skill does and when to use it. This is the only part that consumes context on every session.

2. **Level 2 — Instructions (loaded on demand, ~2,000 tokens):** The full SKILL.md body with step-by-step guidance. Only loaded when the agent decides the skill is relevant to the current task.

3. **Level 3 — Referenced files (as needed, unlimited):** Scripts, templates, reference docs. Only consumed when the instructions point to them and the task actually requires them.

This is the architectural principle behind the 54% context reduction that Anthropic has documented in production workloads.

### Applying This to Ganttlet

Instead of one massive CLAUDE.md, restructure project knowledge into skills that agents load on demand:

```
.claude/
├── CLAUDE.md                          # Lean core (~110 lines)
└── skills/
    ├── scheduling-engine/
    │   └── SKILL.md                   # CPM, cascade, constraints context
    ├── e2e-testing/
    │   └── SKILL.md                   # Playwright setup, relay, collab tests
    ├── multi-agent-orchestration/
    │   └── SKILL.md                   # launch-phase.sh, prompts, worktrees
    ├── google-sheets-sync/
    │   └── SKILL.md                   # Sheets API, OAuth, sync module
    ├── cloud-deployment/
    │   └── SKILL.md                   # Cloud Run, GCP, staging/prod
    ├── issue-workflow/
    │   └── SKILL.md                   # Single-agent issue work procedures
    └── rust-wasm/
        └── SKILL.md                   # WASM build, wasm-pack, Rust patterns
```

**Example: `scheduling-engine/SKILL.md`**

```yaml
---
name: scheduling-engine
description: "Use when working on CPM (critical path), cascade, constraints, or any scheduling
  logic in crates/scheduler/. Covers the Rust→WASM scheduling engine architecture, known
  issues, test patterns, and debugging approaches."
---

# Scheduling Engine Guide

## Architecture
The scheduling engine is a pure Rust→WASM module in `crates/scheduler/`.
All scheduling computations are deterministic. The engine exposes functions
via wasm-bindgen in `src/lib.rs`.

## Module Map
- `src/cpm.rs` — Critical path method (forward/backward pass, float, scoping)
- `src/cascade.rs` — Cascade propagation (date changes ripple to successors)
- `src/constraints.rs` — Scheduling constraints (ASAP, SNET, etc.)
- `src/graph.rs` — Dependency graph traversal (topological sort, cycle detection)
- `src/types.rs` — Shared types (Task, Dependency, ScheduleDirection)
- `src/date_utils.rs` — Date arithmetic helpers
- `src/lib.rs` — WASM bindings (public API surface)

## Testing
- `cargo test` in `crates/scheduler/` runs all unit tests
- `cargo clippy` must pass with no warnings
- Tests use in-memory task graphs — no I/O, no browser dependencies

## Common Patterns
- Forward pass: topological BFS, compute ES/EF from predecessors
- Backward pass: reverse topological, compute LS/LF from successors
- Float = LS - ES; zero float = critical
- Cascade: propagate date delta to FS successors only (asymmetric — forward only)

## Known Gotchas
- ES must be computed from dependencies, NOT from stored task dates
- Scoped CPM must run on full graph then filter results (not filter-then-compute)
- `float.abs() < 1` is wrong for integer-day scheduling — use `float == 0`
```

**Example: `issue-workflow/SKILL.md`**

```yaml
---
name: issue-workflow
description: "Use when working from a GitHub issue (agent-ready label, single-agent work).
  Covers branch naming, commit conventions, PR creation, verification, and what to do
  when stuck."
---

# Single-Agent Issue Workflow

## Setup
- Branch: `agent/issue-{number}`
- Read the issue carefully. Identify acceptance criteria and scope boundaries.
- If the issue lacks acceptance criteria, write your own based on the description.

## Implementation Order
1. Read relevant files BEFORE editing. Understand current behavior first.
2. Write/update tests FIRST that verify the expected behavior.
3. Implement the changes to make tests pass.
4. Commit after each logical change with conventional commits (feat:, fix:, etc.).

## Verification
Run `./scripts/full-verify.sh` before declaring done. This runs:
- `npx tsc --noEmit` (TypeScript type check)
- `npx vitest run` (unit tests)
- `cd crates/scheduler && cargo test` (Rust tests)
- `E2E_RELAY=1 npx playwright test` (E2E with relay)

## PR Creation
- `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}`
- Write `.agent-summary.md`: what changed, tests added, what couldn't be done

## Error Handling
- Level 1 (fixable): Read error, fix code, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with message explaining what's broken and why.
  Move to next task — do NOT stop all work.
- Level 3 (blocked): Commit, write BLOCKED note in claude-progress.txt,
  continue with non-dependent tasks.

## Context Conservation
- Commit early and often (progress survives crashes)
- Use Task tool subagents for expensive investigation
- Check `git log --oneline -10` if you lose track of previous work
```

### Why This Is Better Than a Monolithic CLAUDE.md

| Approach | Tokens at Session Start | Tokens When Needed | Wasted Tokens on Irrelevant Tasks |
|----------|------------------------|--------------------|----------------------------------|
| Current CLAUDE.md (500 lines) | ~5,000 | N/A (already loaded) | ~3,500 (Docker, CLI ref, multi-agent) |
| Lean CLAUDE.md + Skills | ~1,200 + ~700 (skill descriptions) | ~2,000 per activated skill | ~0 (only relevant skills load) |

For a typical issue-driven agent that only needs the issue-workflow and scheduling-engine skills, you save ~3,000 tokens of irrelevant context. That's roughly 2-3 extra file reads or 5-6 additional fix-and-test cycles worth of headroom.

### How This Interacts With Multi-Agent Prompts

For orchestrated phase work (launch-phase.sh), the group prompts already contain task-specific context. Skills complement this — agents can load the `scheduling-engine` skill for domain knowledge that the prompt assumes but doesn't repeat. This lets you write leaner prompts:

**Before (prompt embeds all context):**
```markdown
The scheduling engine runs as a Rust→WASM module in each user's browser.
The CPM currently doesn't work. The forward pass initializes ES/EF from stored dates
instead of computing from dependencies. The backward pass initializes ALL tasks' LF
to the project end...
[40 more lines of context]

## Tasks:
...
```

**After (prompt references skill):**
```markdown
Read the scheduling-engine skill for domain context before starting.

## Tasks:
...
```

The agent reads the skill on demand, getting the same information but without baking it into the prompt. If the agent doesn't need to reference it again (it's done understanding the architecture), auto-compaction can reclaim those tokens.

### Implementation Steps

1. Create `.claude/skills/` directory structure
2. Extract domain knowledge from CLAUDE.md into skill files
3. Write concise descriptions for each skill (these are the Level 1 metadata)
4. Trim CLAUDE.md to the lean ~110-line core
5. Test with a few issue-driven agents to verify skills are being discovered and loaded

### Skill Discovery Verification

After creating skills, verify they're being found by agents. Add this to your first test issue prompt:

```markdown
Before starting work, list the available skills you can see. Then load any
that are relevant to this task. Report which skills you loaded in your summary.
```

If agents aren't discovering skills, check that the directory structure matches what Claude Code expects (`.claude/skills/<name>/SKILL.md`) and that skill descriptions contain the right trigger words.

---

## 16. Observed Failure Modes — Lessons From Phases 0-12

The recommendations above aren't theoretical. They're grounded in patterns observed across 12 completed phases of multi-agent development. This section catalogs the failure modes that informed each recommendation, so future planning can prioritize accordingly.

### Failure Mode: Agent Repeats the Same Broken Fix

**What happens:** Agent writes code that doesn't compile. Gets restarted. Has no error context. Writes the same broken code again. Repeats for all 3 retry attempts.

**Root cause:** Retry context only includes git commit titles, not error output (→ Section 1).

**Frequency:** Common in Rust-focused groups where compilation errors are precise but not captured.

### Failure Mode: Agent Declares "Done" With Failing Tests

**What happens:** Agent implements a feature, tests fail, agent writes "fix: implement feature X" as the commit message despite tests still failing. Validation agent later catches this, but the original agent's work is incomplete.

**Root cause:** No behavioral guardrails requiring honest commit messages (→ Section 2). No pre-commit hook to catch this (→ Section 2B).

**Frequency:** Occasional, especially late in long sessions when context is tight.

### Failure Mode: Agent Gives Up After First Failure

**What happens:** Agent encounters a compilation error. Instead of fixing it, commits a WIP and stops working on all remaining tasks — even those unrelated to the error.

**Root cause:** "move on" is ambiguous (→ Section 9). Agent interprets it as "stop all work" rather than "proceed to next task."

**Frequency:** Rare in orchestrated phases (prompts are explicit), but expected to be common in issue-driven work where prompts are thinner.

### Failure Mode: Agent Runs Out of Context Mid-Task

**What happens:** Agent is working on task I3 out of I5. Context fills up. Auto-compaction summarizes earlier turns. Agent loses track of what it already tried for I3 and starts over, wasting more context. Eventually crashes with no useful commits.

**Root cause:** No progress file on disk (→ Section 1B, Section 4). No emergency commit instruction (→ Section 9B). CLAUDE.md is too large (→ Section 14, Section 15).

**Frequency:** Occurs on complex multi-step tasks (5+ subtasks per group).

### Failure Mode: PostToolUse Hook Drowns Agent in Noise

**What happens:** Agent editing TypeScript files triggers `verify.sh` on every edit. Each invocation dumps 30-50 lines of test output. After 10 edits, the agent has 300-500 lines of repetitive test output in its context — much of it identical ("3 tests passing, 1 failing" repeated 8 times).

**Root cause:** No output deduplication or rate limiting in hooks (→ Section 8, Section 13).

**Frequency:** Every session with TypeScript edits.

### Failure Mode: Merge Conflict Agent Produces Wrong Resolution

**What happens:** Two parallel groups modify `lib.rs` (per interface contract). Merge produces conflict. Conflict resolution agent gets only the file list, not the intent of each side. Resolves by keeping one side and discarding the other.

**Root cause:** Merge conflict prompt lacks diffs and branch summaries (→ Section 6). Agent can't infer intent from conflict markers alone.

**Frequency:** Occurred in Phase 12 (Stage 1 → merge) where Groups I and L both modified `lib.rs` per the interface contract.

### Failure Mode: Validation Agent Fixes One Thing, Breaks Another

**What happens:** Validation runs 9 checks. V2 (Rust tests) fails. Agent fixes it. But the fix breaks V4 (unit tests). Agent doesn't notice because it's already moved past V4.

**Root cause:** Single-pass validation with no regression check (→ Section 7). Agent doesn't re-run all checks after each fix.

**Frequency:** Occurred at least once when a Rust fix changed a WASM binding that TypeScript tests depended on.

### How These Map to Priorities

| Failure Mode | Sections | Priority |
|-------------|----------|----------|
| Repeats same broken fix | 1, 1A | P0 |
| Declares "done" with failing tests | 2, 2A, 2B | P0 |
| Gives up after first failure | 9, 9A | P1 |
| Runs out of context | 1B, 4, 14, 15 | P0 |
| Hook noise drowns agent | 8, 13 | P1-P2 |
| Wrong merge resolution | 6 | P1 |
| Validation fix-break cycle | 7 | P2 |

---

## Summary: Priority Order

Items are ordered by implementation priority. Each references the section with full details.

### P0 — Do These First (High Impact, Blocks Other Work)

| Recommendation | Section | Impact | Effort |
|---------------|---------|--------|--------|
| Rich retry context (log tails + progress file, not just commits) | §1 | High | Low |
| Anti-pattern axioms in CLAUDE.md (behavioral guardrails) | §2 | High | Low |
| Progress file (`claude-progress.txt`) in all agent prompts | §1B, §4 | High | Low |
| Restructure CLAUDE.md (lean core ~110 lines) + adopt skills pattern | §14, §15 | High | Medium |
| Overhaul `agent-work.yml` (rich prompt, retry, guardrails, `.agent-summary.md`) | §12 | High | Medium |

### P1 — High Value, Do Soon

| Recommendation | Section | Impact | Effort |
|---------------|---------|--------|--------|
| GitHub issue templates (`.github/ISSUE_TEMPLATE/agent-task.yml`) | §12A | High | Low |
| Issue quality gate workflow (reject vague issues) | §12B | Medium | Low |
| Success/failure criteria at top of every agent prompt | §5A | High | Medium |
| `--max-turns` and `--max-budget-usd` on all agent invocations | §3B, §3C | Medium | Low |
| Pre-commit hook rejecting `todo!()`, commented-out tests | §2B | Medium | Low |
| Richer merge conflict context (diffs + branch summary) | §6 | Medium | Low |
| Control PostToolUse output volume (dedup, truncate, JSON reporters) | §13 | Medium | Medium |
| Explicit error escalation levels in all prompts | §9 | Medium | Low |

### P2 — Medium Term

| Recommendation | Section | Impact | Effort |
|---------------|---------|--------|--------|
| Agent-aware hooks via AGENT_SCOPE env var | §8 | Medium | Medium |
| Structured `.agent-status.json` for orchestrator polling | §4A | Medium | Medium |
| Partial stage success (merge successful groups, skip failed) | §10A | Medium | Medium |
| Two-pass validation (diagnose all → fix → re-check) | §7 | Medium | Medium |
| Right-size context budget via issue complexity labels | §12D, §13 | Medium | Low |
| Subagent guidance for expensive investigation in prompts | §13 | Medium | Low |

### P3 — Nice to Have

| Recommendation | Section | Impact | Effort |
|---------------|---------|--------|--------|
| Preflight checks before launching agent stages | §10B | Low | Low |
| Model selection per task complexity (`--model`) | §10C | Low | Low |
| Orchestrator dry-run / smoke-test mode | §11 | Low | Medium |
| Auto-compaction recovery guidance in CLAUDE.md | §13 | Low | Low |
| Stall detection watchdog in orchestrator | §4C | Low | Medium |
