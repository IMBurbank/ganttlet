# Unplanned Issues

Triage buffer for issues not yet assigned to a phase. A planning agent picks
items from **Backlog**, moves them to **Claimed**, and once planned into
`TASKS.md` + `CLAUDE.md`, moves them to **Planned**.

## Rules (agents MUST follow these)
1. Claim up to 3 items at a time by moving them to **Claimed** with your agent ID.
2. Plan each item into `TASKS.md` under the appropriate phase.
3. Move planned items to **Planned** with a reference to the phase/group/task.
4. Do not modify items claimed by another agent.
5. A user may add new items to **Backlog** at any time.

---

## Backlog
<!-- Add new issues here. One per line, prefixed with `- [ ]`. -->
- [ ] Bug: Changing duration of a task can sometimes cause the duration of tasks that depend on it to change when making their cascading updates. Dependent task durations shouldn't change, just the start and end dates
 
## Claimed
<!-- Agents move items here while planning. Format: `- [AGENT_ID] description` -->


## Planned
<!-- Agents move items here after planning into TASKS.md. Format: `- [x] description → Phase X, Group Y, Task Z` -->


---

## Archive

### Phase 9: Deployment Hardening, Cascade Bug Fix & UX Polish

| # | Issue | Group | Task(s) |
|---|-------|-------|---------|
| 1 | Replace Firebase Hosting with Go static file server | C | C1 |
| 2 | Replace reqwest with hyper in relay server | C | C3 |
| 3 | Add IAP configuration | C | C4 |
| 4 | Configure Cloud Armor WAF rules | C | C5 |
| 5 | Add health check / readiness probe endpoints | C | C2 |
| 6 | Add share button | A | A1 |
| 7 | Fix cascade on duration/end-date changes | B | B1-B4 |
| 8 | Remove fake user presence icons | A | A2 |

### Phase 8: Bug Fixes, OKR Enhancement, Cascade UX & Deployment

| # | Issue | Priority | Group | Task(s) |
|---|-------|----------|-------|---------|
| 1 | Automatic UI verification (E2E/visual tests) | P3 | C | C1, C2 |
| 2 | Major bug: most cells no longer editable | P0 | A | A1, A4 |
| 3 | OKR selection for tasks + seed data | P2 | A | A2, A3, A4 |
| 4 | Bug: critical path not highlighting full chain | P1 | B | B1, B3, B5 |
| 5 | Major bug: workstream critical path crashes app | P0 | B | B2, B3, B5 |
| 6 | Cascade highlighting jittery → shadow trail | P2 | B | B4, B5 |
| 7 | Deploy to Google Cloud | P4 | C | C3, C4 |

### Phase 7: Hierarchy Enforcement, Task Movement & UX Improvements

| # | Issue | Group | Task(s) |
|---|-------|-------|---------|
| 1 | Workstream added within project should auto-assign to that project | A | A3 |
| 2 | Task created within workstream should inherit workStream + okrs | A | A3 |
| 3 | New task IDs should use workstream prefix (e.g. `pe-10`) | A | A3 |
| 4 | Tasks can be moved between workstreams; ID + deps updated | A+B | A6, B4 |
| 5 | Add Task button should focus the new task for immediate editing | A+B | A3, B1 |
| 6 | Tasks editable from Gantt chart task bars (not just table cells) | B | B2 |
| 7 | Shortcut to collapse/expand the left table pane | A+B | A7, B3 |
| 8 | Enforce project > workstream > task hierarchy + field consistency | A | A1, A2, A4, A5, A8 |
| 9 | Block moves that would create dependency on own project/workstream | A+B | A2, A6, B4 |
| 10 | Critical path scoped to projects/workstreams only (remove "All") | A+C+B | A7, C1-C4, B7 |
