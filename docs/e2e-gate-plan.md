# E2E Gate Plan

## Problem
E2E tests run locally during agent work but there's no CI enforcement preventing
merge to main without passing E2E. The existing `e2e.yml` workflow runs on PRs but
isn't required.

## Design

### Single status check: `e2e-verified`
Two producers can post it:
1. **CI** — the `e2e.yml` workflow runs E2E, then posts `e2e-verified` commit status on success
2. **Agent** — after running `full-verify.sh` locally, agent calls `scripts/attest-e2e.sh` which posts the same `e2e-verified` status for HEAD SHA

A GitHub **Ruleset** (not legacy branch protection) requires `e2e-verified` to pass before merge to main.

### Deduplication
The `e2e.yml` workflow checks at startup whether `e2e-verified` already exists for the PR HEAD SHA. If yes, it skips the expensive WASM+relay+Playwright build and just re-posts the status.

### Bypass
Repo admins are bypass actors on the ruleset (native, auditable).

### Evaluate mode
Ruleset starts in `evaluate` (dry-run) mode. Switch to `active` after confirming it works.

## Edge cases

| Scenario | Behavior | Correct? |
|----------|----------|----------|
| Agent attests, then force-pushes | New SHA → no status → CI runs normally | Yes |
| Agent attests SHA A, adds commit B | SHA B has no status → CI runs for B | Yes |
| Both attestation and CI run | CI sees existing status, skips E2E job | Yes |
| PR from fork | Fork can't post status → CI runs normally | Yes |
| Admin needs to merge without E2E | Bypass actor on ruleset | Yes |

## Files

| # | File | Action | What |
|---|------|--------|------|
| 1 | `scripts/attest-e2e.sh` | Create | Posts `e2e-verified` commit status for HEAD |
| 2 | `.github/workflows/e2e.yml` | Modify | Add attestation check, conditional skip, status posting |
| 3 | `scripts/setup-e2e-ruleset.sh` | Create | One-time admin script to create ruleset via API |
| 4 | `scripts/full-verify.sh` | Modify | Optional `ATTEST_E2E=1` auto-attest at end |
| 5 | `CLAUDE.md` | Modify | Document new commands |

## Sequence
1. Create `attest-e2e.sh`
2. Modify `e2e.yml` (three-job structure: check-attestation → e2e → post-status)
3. Create `setup-e2e-ruleset.sh`
4. Modify `full-verify.sh`
5. Update CLAUDE.md
6. After merge, admin runs `setup-e2e-ruleset.sh` once
