# Phase 20 Supervisor Prompt

You are orchestrating Phase 20: Frontend Redesign for the Ganttlet project.

## Context

Read these files first:
- `docs/plans/frontend-redesign.md` — the architecture specification (500 lines, fully reviewed)
- `docs/prompts/phase20/launch-config.yaml` — stage/group definitions
- `docs/prompts/phase20/validate.md` — validation checks

The phase redesigns the frontend from first principles: Y.Doc as live session state,
per-task O(1) store subscriptions, mutation functions, three-way Sheets merge, SVG
virtualization, per-client undo, crash recovery, and full documentation update.

## Phase Structure

10 groups, 7 stages. Each stage gate-checks (tsc + vitest + merge) before the next starts.

```
Stage 1 (parallel): A (stores + hooks) + B (Y.Doc schema + mutations)
Stage 2 (serial):   C (observation handler + providers)
Stage 3 (parallel): D (gantt/table migration) + E (onboarding migration + old code deletion)
Stage 4 (serial):   F (Sheets Adapter + three-way merge + conflict UI)
Stage 5 (parallel): G (SVG virtualization + React Compiler) + H (Pointer Events + CSS drag)
Stage 6 (serial):   I (Y.UndoManager + y-indexeddb + error boundaries)
Stage 7 (serial):   J (all docs/skills/agents/comments updated)
Validate:           12-check validation (stale refs, build, O(1), mutations, E2E, full-verify)
```

## How to Run

```bash
./scripts/launch-phase.sh docs/prompts/phase20/launch-config.yaml stage 1
# Wait for completion, then:
./scripts/launch-phase.sh docs/prompts/phase20/launch-config.yaml merge 1
./scripts/launch-phase.sh docs/prompts/phase20/launch-config.yaml stage 2
# ... repeat for stages 2-7, then:
./scripts/launch-phase.sh docs/prompts/phase20/launch-config.yaml validate
./scripts/launch-phase.sh docs/prompts/phase20/launch-config.yaml create-pr
```

Or use the supervisor script for automated orchestration:
```bash
./scripts/launch-supervisor.sh docs/prompts/phase20/launch-config.yaml
```

## Key Design Decisions (hard-won, do not revisit)

1. **Y.Doc schema**: `Y.Map<Y.Map>` keyed by task ID (O(1) lookup). NOT Y.Array.
2. **Stable UUIDs**: task IDs never change on reparent. Display prefixes derived at render time.
3. **Store**: `useSyncExternalStore` with per-task event emitter. NOT Zustand (it's worse for this data shape — selectors evaluate O(N) per state change).
4. **MutateContext**: created in `src/hooks/useMutate.ts` (Group A), provided by `TaskStoreProvider` (Group C). Import path: `../../hooks/useMutate`.
5. **Conflict resolution**: three-way merge (AppSheet model). NOT "Sheet always wins" (causes silent data loss).
6. **Drag**: commit-on-drop. Zero Y.Doc writes during drag. CSS transform on `<g>`. One transaction on mouseup = one undo step.
7. **Observation handler**: `event.target` identity (NOT `event.path.length`). Local mutations synchronous, remote batched via RAF. Sheets origin skips cold derivations.
8. **Phase scope**: Stage 3 delivers sandbox mode (27/29 E2E). Stage 4 adds Sheets (29/29). Stages 5-7 add perf/undo/docs.

## Known Gotchas

- Group E must stub broken imports in `sheetsSync.ts` and `sheetCreation.ts` BEFORE deleting `actions.ts`/`yjsBinding.ts` — otherwise tsc fails at Stage 3 gate.
- Group G must `npm install --save-dev babel-plugin-react-compiler` before modifying `vite.config.ts`.
- Group E must migrate `HeaderMismatchError.tsx` (it imports useGanttState which E deletes).
- `MutateAction` type lives in `src/types/index.ts` (Group A appends only — Group B reads in parallel).
- After Stage 3: 2 Sheets-error E2E tests are `test.skip`'d. Group F un-skips them in Stage 4.

## Verification After Each Stage

After every merge, run:
```bash
npx tsc --noEmit && npx vitest run && echo "STAGE PASS"
```

After the final validate:
```bash
./scripts/full-verify.sh
```
