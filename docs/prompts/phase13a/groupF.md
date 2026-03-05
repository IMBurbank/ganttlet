# Phase 13a Group F — Skill Enrichment

You are implementing Phase 13a Group F for the Ganttlet project.
Read `docs/phase13-review.md` (Gaps section) for context on why these skills need enrichment.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Success Criteria (you're done when ALL of these are true):
1. `.claude/skills/google-sheets-sync/SKILL.md` has a "Gotchas" or "Known Issues" section with at least 4 specific, actionable items
2. `.claude/skills/cloud-deployment/SKILL.md` has a "Gotchas" or "Known Issues" section with at least 4 specific, actionable items
3. Both skills reference actual source files with correct paths
4. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- Either skill has fewer than 4 gotchas
- Gotchas are generic filler (not referencing specific files, patterns, or failure modes)
- Uncommitted changes

## Your files (ONLY modify these):
- `.claude/skills/google-sheets-sync/SKILL.md`
- `.claude/skills/cloud-deployment/SKILL.md`

Do NOT modify `CLAUDE.md`, `scripts/`, `.github/`, `docs/`, or any source code files.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.

## Tasks — execute in order:

### F1: Enrich google-sheets-sync skill

1. Read the current `.claude/skills/google-sheets-sync/SKILL.md`.
2. Read the actual source files to understand the implementation:
   - `src/sync/sheetsClient.ts` — API client
   - `src/sync/sheetsMapper.ts` — data mapping
   - `src/sync/sheetsSync.ts` — sync orchestration
   - Look for the actual column mappings, date formats, and sync patterns
3. Add a **"Gotchas & Known Issues"** section with specific, actionable items. Research the
   code to find real patterns. Examples of what to document:
   - How dates are serialized between Ganttlet and Sheets (format, timezone handling)
   - Column name conventions and what happens if columns are reordered
   - How concurrent edits from multiple clients are handled (last-write-wins? merge?)
   - Token expiry behavior during long sync operations
   - Rate limiting from Google Sheets API (429 responses, backoff strategy)
   - What happens when a Sheet has more rows than expected or missing columns
   - The polling interval for external changes and its implications
4. Add a **"Data Mapping"** subsection with the actual field-to-column mapping if it's
   defined in sheetsMapper.ts.
5. Verify the existing content is still accurate — update if needed.
6. Commit: `"docs: enrich google-sheets-sync skill with gotchas and data mapping details"`

### F2: Enrich cloud-deployment skill

1. Read the current `.claude/skills/cloud-deployment/SKILL.md`.
2. Read the deployment infrastructure to understand the actual patterns:
   - `.github/workflows/deploy.yml` — full deploy pipeline
   - `Dockerfile.server` — relay server container
   - `deploy/frontend/Dockerfile` — frontend container
   - `scripts/cloud-smoke-test.sh` — smoke test script (if it exists)
   - `docs/cloud-verification-plan.md` — verification stages
3. Add a **"Gotchas & Known Issues"** section with specific, actionable items:
   - WIF (Workload Identity Federation) auth — what secrets are needed, what permissions
   - Artifact Registry image path format (`REGION-docker.pkg.dev/PROJECT/ganttlet/SERVICE:SHA`)
   - Cloud Run deploy flags that matter (platform, region, format for URL extraction)
   - The dev → production promotion pattern (same image SHA, different deploy target)
   - Health check endpoints and what they verify (`/health` on relay, root div on frontend)
   - WebSocket upgrade verification pattern (curl with upgrade headers)
   - Environment variables injected at deploy time vs build time
   - The smoke test and E2E test stages — what GCP SA keys they need and why
4. Add a **"Deploy Pipeline Stages"** subsection documenting the actual job dependency chain
   from deploy.yml (ci → build-and-push → deploy-dev → verify-dev → smoke-test-dev → e2e-dev).
5. Verify the existing content is still accurate — update if needed.
6. Commit: `"docs: enrich cloud-deployment skill with gotchas and pipeline details"`

### F3: Final verification

1. `git status` — everything committed
2. `git diff --stat HEAD~2..HEAD` — review all your changes
3. Verify no files outside your scope were modified
4. Update `claude-progress.txt` with final status
