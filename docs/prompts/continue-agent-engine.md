You are continuing work on the Agent Engine — a general-purpose agent orchestration engine.

## Context Recovery

1. Read the memory file: `/home/node/.claude/projects/-workspace/memory/project_agent_engine.md`
2. Read the plan: `docs/plans/orchestration-redesign.md` (v16, 399 lines — read the whole thing)
3. Check the current code: `scripts/sdk/` (533 tests, all passing)
4. Check git log: `git log --oneline -20` on the worktree branch

## Current State

The plan is COMPLETE and reviewed. The prototype implementation (Phase 1-2) is built
and tested but uses the OLD architecture (in-process handlers, Phase 1/2 loop,
Promise.race). The plan describes the TARGET architecture (worker subprocesses,
StepExecutor, resource pools, single poll loop).

## What Needs Doing

**The restructuring from prototype → target architecture.** Key changes:

1. **Worker model**: Replace in-process `Handlers` with subprocess workers that read
   `step-config.json`, try attempt sequences, write `{id}.log` + `{id}-result.json`.
   Workers spawned with `setsid`. Kill = `kill(-pgid)`.

2. **StepExecutor interface**: Replace `Handlers { agent, merge, verify }` with
   `StepExecutor { execute, resume?, preflight?, loadsProjectContext?, getContext? }`.
   Shell and Claude executors as separate implementations.

3. **Single poll loop**: Replace Phase 1/2 + Promise.race with:
   `readdir → processWorkers → signals → save → schedule → dispatch → sleep(1s)`

4. **Resource pools**: Replace `maxParallel` with named slots + budgets.

5. **Config unification**: `steps:` everywhere (no `groups:`). Sequential default.
   `parallel:` blocks. Labels. `context:` + `skills:` for prompt composition.

6. **New features**: Stall detection, start-to-close timeout, commands (cancel/adjust/hint),
   config watching, JSONL logs, completion report, health field, engine context injection,
   default diagnosis step, validate command, init with patterns, web dashboard.

## Approach

- Keep the scheduler (pure, 29 tests) — unchanged
- Keep DAG parser core — add fields (attempts, resources, labels, skills, context)
- Keep observer pattern — change implementations (JSONL, Report, Inline, Web)
- Keep state management — add fields (health, attemptHistory, lastEventAt)
- Keep E2E test patterns — update for new architecture
- DELETE handlers.ts, Phase 1/2 loop logic, runAgentWithInlinePrompt
- Build incrementally, test at each step

## Important Design Decisions (don't revisit)

- Engine is runner-agnostic (StepExecutor interface, zero SDK deps in core)
- Files are the IPC for everything (state, logs, commands, results, hints)
- Worker subprocesses with setsid (not in-process)
- 5-layer prompt composition (engine/project/skills/executor/task)
- Good citizen: reference existing project knowledge, don't duplicate
- `steps:` only config (no `groups:`)
- 5 failure types: timeout, agent, infra, budget, blocked
- SDK packages ship default workers
- Desugar functions as parser extension (git module, not parser)

## Worktree

Branch: `worktree-curation-test-run`
Path: `/workspace/.claude/worktrees/curation-test-run`
