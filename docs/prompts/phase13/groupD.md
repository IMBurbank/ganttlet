# Phase 13 Group D — GitHub Pipeline (Workflows + Issue Templates)

You are implementing Phase 13 Group D for the Ganttlet project.
Read CLAUDE.md and `docs/agent-orchestration-recommendations.md` (Section 12) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

## Success Criteria (you're done when ALL of these are true):
1. `.github/ISSUE_TEMPLATE/agent-task.yml` exists with required fields: summary, acceptance criteria, scope boundaries, relevant files, complexity
2. `.github/workflows/agent-gate.yml` exists and validates issues before agent launch
3. `.github/workflows/agent-work.yml` has: rich prompt construction, retry loop (2 attempts), `--max-turns`, `--max-budget-usd`, `.agent-summary.md` output, complexity-based config
4. All YAML files are valid (no syntax errors)
5. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- Any YAML file has syntax errors
- Issue template is missing required fields
- agent-work.yml doesn't have retry logic
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool. It uses a GitHub Actions workflow
(`.github/workflows/agent-work.yml`) to automatically dispatch Claude Code agents when issues
are labeled `agent-ready`. The current workflow is thin — it passes only the issue title/body
with 5 generic instructions, has no retry, no issue quality validation, and produces generic PR bodies.

## Your files (ONLY modify these):
- `.github/ISSUE_TEMPLATE/agent-task.yml` (new)
- `.github/workflows/agent-gate.yml` (new)
- `.github/workflows/agent-work.yml` (overhaul)

Do NOT modify `CLAUDE.md`, `scripts/`, `.claude/`, or any source code files.
Other agents own those files.

## Progress Tracking

After completing each major task (D1, D2, etc.), append a status line to `claude-progress.txt`
in the worktree root:

```
D1: DONE — created issue template with all required fields
D2: IN PROGRESS — building quality gate workflow
```

On restart, read `claude-progress.txt` FIRST to understand where you left off.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK (not "stop all work").
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.
- Emergency: If running out of context, `git add -A && git commit -m "emergency: groupD saving work"`.

## Tasks — execute in order:

### D1: Create issue template for agent tasks

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
      description: One paragraph — what needs to be built or fixed. Be specific about the expected behavior change.
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
      description: Files the agent should focus on (optional but highly recommended — helps the agent start faster)
      placeholder: |
        - src/components/gantt/TaskBar.tsx (main component)
        - crates/scheduler/src/cascade.rs (if scheduling related)

  - type: dropdown
    id: complexity
    attributes:
      label: Estimated Complexity
      description: Controls agent resource allocation (turns, budget)
      options:
        - Small (1-2 files, straightforward fix)
        - Medium (3-5 files, some design decisions)
        - Large (5+ files, architectural impact)
    validations:
      required: true

  - type: textarea
    id: context
    attributes:
      label: Additional Context
      description: Any extra information that would help the agent (links, screenshots, error messages, related issues)
```

Commit: `"feat: add GitHub issue template for agent tasks"`

### D2: Create issue quality gate workflow

Create `.github/workflows/agent-gate.yml`:

```yaml
name: Agent Issue Quality Gate

on:
  issues:
    types: [labeled]

jobs:
  validate-issue:
    if: github.event.label.name == 'agent-ready'
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const body = context.payload.issue.body || '';
            const warnings = [];

            // Check for acceptance criteria (checklist)
            if (!body.includes('- [ ]') && !body.includes('- [x]')) {
              warnings.push('**Missing acceptance criteria.** Add a checklist of testable outcomes so the agent knows when it is done.');
            }

            // Check for scope boundaries
            const hasScope = body.toLowerCase().includes('scope') ||
                             body.toLowerCase().includes('do not modify') ||
                             body.toLowerCase().includes('do not change') ||
                             body.toLowerCase().includes('only modify');
            if (!hasScope) {
              warnings.push('**No scope boundaries specified.** Without boundaries, the agent may modify unrelated files. Add a "Do NOT modify..." section.');
            }

            // Check minimum detail
            if (body.length < 200) {
              warnings.push('**Issue body is very short** (< 200 chars). The agent needs enough context to work autonomously. Add more detail about what needs to change and why.');
            }

            // Check for relevant files
            const hasFiles = body.toLowerCase().includes('.ts') ||
                             body.toLowerCase().includes('.tsx') ||
                             body.toLowerCase().includes('.rs') ||
                             body.toLowerCase().includes('src/') ||
                             body.toLowerCase().includes('crates/');
            if (!hasFiles) {
              warnings.push('**No relevant files mentioned.** Listing specific files helps the agent start faster and stay focused.');
            }

            if (warnings.length > 0) {
              const comment = [
                '⚠️ **Agent readiness check found issues:**',
                '',
                ...warnings.map(w => `- ${w}`),
                '',
                'Please update the issue with the missing information, then remove and re-add the `agent-ready` label.',
                '',
                '---',
                '*This check runs automatically when the `agent-ready` label is added. See `.github/ISSUE_TEMPLATE/agent-task.yml` for the recommended issue format.*'
              ].join('\n');

              await github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: comment
              });

              // Remove the label to prevent premature agent launch
              try {
                await github.rest.issues.removeLabel({
                  issue_number: context.issue.number,
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  name: 'agent-ready'
                });
              } catch (e) {
                // Label might already be removed
                console.log('Could not remove label:', e.message);
              }
            } else {
              // Issue passes quality gate — add a confirmation comment
              await github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: '✅ **Agent readiness check passed.** The agent workflow will begin shortly.'
              });
            }
```

Commit: `"feat: add agent issue quality gate workflow"`

### D3: Overhaul agent-work.yml

Read the current `.github/workflows/agent-work.yml` (102 lines).

**Known issues in current file to fix:**
- Uses `claude --print` which is not a valid flag — the correct flag is `-p` (print/pipe mode)
- Uses `${{ github.event.issue.body }}` directly in a heredoc, which is a shell injection risk
- No retry logic — if claude fails, the whole workflow fails
- No `--max-turns` or `--max-budget-usd` — agents can spin indefinitely
- PR body is generic boilerplate, not derived from agent output

Keep the existing setup steps (checkout, Node.js, Rust, wasm-pack, npm install, WASM build,
Claude Code install) and the success/failure comment steps. Rewrite the middle section with:

1. **Rich prompt construction** using environment variables (not `${{ }}` interpolation for security):
```yaml
      - name: Run Claude Code (with retry)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          ISSUE_TITLE: ${{ github.event.issue.title }}
          ISSUE_BODY: ${{ github.event.issue.body }}
        run: |
          # Build structured prompt
          cat > /tmp/agent-prompt.md <<'PROMPT_DELIMITER'
          You are working on a GitHub issue for the Ganttlet project.

          ## Instructions

          1. Read CLAUDE.md for project context, architecture constraints, and behavioral rules.
          2. Identify the relevant files. If the issue lists them, start there. Otherwise, search.
          3. Write or update tests FIRST that verify the expected behavior.
          4. Implement the changes to make the tests pass.
          5. Run verification: ./scripts/full-verify.sh
          6. If verification fails, fix the issues. Do not skip tests or weaken assertions.
          7. Commit with descriptive messages using conventional commits (feat:, fix:, etc.).

          ## Scope Rules
          - ONLY modify files directly relevant to this issue.
          - Do NOT refactor unrelated code.
          - Do NOT modify CI/CD workflows, Dockerfile, or package.json unless the issue requires it.
          - If you need to change a shared file (lib.rs, types.ts), keep changes minimal.

          ## Error Handling
          - Level 1 (fixable): Read error, fix code, re-run. Up to 3 distinct approaches.
          - Level 2 (stuck): Commit WIP with message explaining what's broken.
          - Level 3 (blocked): Commit, continue with non-dependent tasks.

          ## When Done
          Write `.agent-summary.md` in the repo root containing:
          - What you changed and why
          - What tests you added or modified
          - What you were unable to complete (if anything) and why
          - The output of ./scripts/full-verify.sh
          PROMPT_DELIMITER

          # Prepend issue context (using env vars for security)
          {
            echo "# Issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}"
            echo ""
            echo "## Issue Description"
            echo "${ISSUE_BODY}"
            echo ""
            echo "---"
            echo ""
            cat /tmp/agent-prompt.md
          } > /tmp/full-prompt.md
```

2. **Retry loop** (2 attempts with error context injection):
```yaml
          MAX_ATTEMPTS=2
          for attempt in $(seq 1 $MAX_ATTEMPTS); do
            echo "=== Agent attempt ${attempt}/${MAX_ATTEMPTS} ==="

            if [[ $attempt -gt 1 ]]; then
              PREV_LOG=$(tail -80 /tmp/agent-attempt-$((attempt-1)).log 2>/dev/null || echo "(no log)")
              RECENT_COMMITS=$(git log --oneline -5 2>/dev/null || echo "(none)")
              {
                echo "NOTE: Previous attempt failed. This is attempt ${attempt}/${MAX_ATTEMPTS}."
                echo ""
                echo "Recent commits (your previous progress):"
                echo "${RECENT_COMMITS}"
                echo ""
                echo "Last output from previous attempt:"
                echo '```'
                echo "${PREV_LOG}"
                echo '```'
                echo ""
                echo "Continue from where you left off. Do not redo completed work."
                echo ""
                echo "---"
                echo ""
                cat /tmp/full-prompt.md
              } > /tmp/retry-prompt.md
              PROMPT_FILE=/tmp/retry-prompt.md
            else
              PROMPT_FILE=/tmp/full-prompt.md
            fi

            set +e
            claude -p "$(cat $PROMPT_FILE)" \
              --dangerously-skip-permissions \
              --max-turns ${{ steps.config.outputs.max_turns }} \
              --max-budget-usd ${{ steps.config.outputs.max_budget }} \
              > /tmp/agent-attempt-${attempt}.log 2>&1
            EXIT_CODE=$?
            set -e

            if [[ $EXIT_CODE -eq 0 ]]; then
              echo "Agent succeeded on attempt ${attempt}"
              break
            fi
            echo "Attempt ${attempt} failed (exit code ${EXIT_CODE})"
          done
```

3. **Complexity-based config** using issue labels:
```yaml
      - name: Determine agent configuration
        id: config
        run: |
          LABELS='${{ join(github.event.issue.labels.*.name, ',') }}'
          if echo "$LABELS" | grep -qi "large\|complex"; then
            echo "max_turns=80" >> $GITHUB_OUTPUT
            echo "max_budget=15.00" >> $GITHUB_OUTPUT
          elif echo "$LABELS" | grep -qi "small"; then
            echo "max_turns=25" >> $GITHUB_OUTPUT
            echo "max_budget=3.00" >> $GITHUB_OUTPUT
          else
            echo "max_turns=50" >> $GITHUB_OUTPUT
            echo "max_budget=8.00" >> $GITHUB_OUTPUT
          fi
```

4. **PR body from agent summary**:
```yaml
      - name: Build PR body from agent summary
        run: |
          if [[ -f .agent-summary.md ]]; then
            {
              echo "Closes #${{ github.event.issue.number }}"
              echo ""
              cat .agent-summary.md
            } > /tmp/pr-body.md
          else
            {
              echo "Closes #${{ github.event.issue.number }}"
              echo ""
              echo "Agent did not produce a summary. Review the diff carefully."
              echo ""
              echo "---"
              echo "*Automated by [agent-work workflow](.github/workflows/agent-work.yml)*"
            } > /tmp/pr-body.md
          fi
```

5. **Skip PR creation if no commits**:
```yaml
      - name: Push and create PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          if [[ -z "$(git log origin/main..HEAD --oneline)" ]]; then
            echo "Agent made no commits — skipping PR creation"
            gh issue comment ${{ github.event.issue.number }} \
              --body "Agent completed but made no commits. The issue may need more context or the changes may already be in place."
            exit 1
          fi
          git push -u origin "$BRANCH"
          gh pr create \
            --title "Agent: ${{ github.event.issue.title }}" \
            --body-file /tmp/pr-body.md \
            --head "$BRANCH" \
            --base main
```

6. Keep the existing checkout, Node.js setup, Rust setup, wasm-pack install, npm install, and WASM build steps.

7. Keep the existing success/failure comment steps, but update the success comment to include a link to the PR.

Commit: `"feat: overhaul agent-work.yml with rich prompts, retry logic, and complexity routing"`

### D4: Verify all YAML files

1. Validate each YAML file for syntax errors. Use `node` since it's available:
```bash
node -e "
const yaml = require('yaml');  // or parse manually
const fs = require('fs');
// Read and check basic YAML structure
const files = [
  '.github/ISSUE_TEMPLATE/agent-task.yml',
  '.github/workflows/agent-gate.yml',
  '.github/workflows/agent-work.yml'
];
files.forEach(f => {
  try {
    const content = fs.readFileSync(f, 'utf8');
    // Basic check: ensure it starts with valid YAML
    if (!content.trim()) throw new Error('Empty file');
    console.log(f + ': OK');
  } catch (e) {
    console.error(f + ': ERROR - ' + e.message);
    process.exit(1);
  }
});
"
```

If `yaml` package isn't available, at minimum verify the files are non-empty and have correct indentation by visual inspection.

2. Verify no other workflows were modified:
```bash
git diff --name-only HEAD | grep -E '\.(yml|yaml)$'
```
Should only show agent-task.yml, agent-gate.yml, and agent-work.yml.

3. `git status` — everything committed
4. `git diff --stat HEAD~4..HEAD` — review all changes
5. Update `claude-progress.txt` with final status

### D5: Final verification

1. Verify `.github/ISSUE_TEMPLATE/agent-task.yml` has all required fields
2. Verify `.github/workflows/agent-gate.yml` checks for: acceptance criteria, scope, minimum length, file references
3. Verify `.github/workflows/agent-work.yml` has: retry loop, --max-turns, --max-budget-usd, .agent-summary.md, complexity config
4. Verify existing workflows (`ci.yml`, `deploy.yml`, `e2e.yml`) were NOT modified
5. All changes committed
