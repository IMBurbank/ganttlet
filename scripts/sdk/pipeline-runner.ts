import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type {
  DAGNode,
  NodeResult,
  NodeState,
  PipelineState,
  PipelineStatus,
  RunIdentity,
} from './types.js';
import { nextActions } from './scheduler.js';
import type { Handlers } from './handlers.js';
import type { GitOps } from './git-ops.js';
import type { Observer } from './observers/types.js';
import { createCompositeObserver } from './observers/types.js';

// ── State management ────────────────────────────────────────────────

export function loadOrCreateState(
  statePath: string,
  dag: DAGNode[],
  run: RunIdentity
): PipelineState {
  if (fs.existsSync(statePath)) {
    const loaded = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as PipelineState;
    // Validate DAG hasn't changed
    const stateIds = new Set(Object.keys(loaded.nodes));
    const dagIds = new Set(dag.map((n) => n.id));
    if (stateIds.size !== dagIds.size || [...dagIds].some((id) => !stateIds.has(id))) {
      throw new Error(
        'DAG changed since last run — cannot resume. Remove state file to start fresh.'
      );
    }
    // Crash recovery and merge-conflict retry
    for (const ns of Object.values(loaded.nodes)) {
      if (ns.status === 'running') ns.status = 'ready';
      if (ns.status === 'skipped') ns.status = 'blocked';
      if (ns.status === 'failure' && ns.failureReason === 'merge_conflict') {
        ns.status = 'blocked';
      }
    }
    loaded.status = 'running';
    return loaded;
  }
  const nodes: Record<string, NodeState> = {};
  for (const node of dag) {
    nodes[node.id] = {
      status: node.dependsOn.length === 0 ? 'ready' : 'blocked',
      attempt: 0,
      maxRetries: node.maxRetries ?? (node.type === 'verify' ? 3 : 1),
      costUsd: 0,
      turns: 0,
    };
  }
  return {
    run,
    nodes,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: '',
  };
}

export function saveState(statePath: string, state: PipelineState): void {
  state.updatedAt = new Date().toISOString();
  const tmp = statePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
}

function updateNodeState(state: PipelineState, nodeId: string, result: NodeResult): void {
  const ns = state.nodes[nodeId];
  ns.status = result.status === 'success' ? 'success' : 'failure';
  ns.failureReason = result.failureReason;
  if (result.sessionId) ns.sessionId = result.sessionId;
  ns.costUsd += result.costUsd ?? 0;
  ns.turns += result.turns ?? 0;
  ns.attempt++;
  if (result.status === 'failure' && result.failureReason) {
    ns.lastError = `${result.failureReason}${result.sessionId ? ` (session: ${result.sessionId})` : ''}`;
  }
}

// ── Run identity derivation ─────────────────────────────────────────

export function deriveRunIdentity(
  configPath: string,
  phase: string,
  mergeTarget: string,
  baseRef?: string
): RunIdentity {
  const ref = baseRef ?? 'HEAD';
  const suffix = crypto
    .createHash('sha256')
    .update(configPath + ':' + ref)
    .digest('hex')
    .slice(0, 8);
  const logBase = process.env.LOG_DIR ?? '/tmp/ganttlet-logs';
  const logDir = path.join(logBase, `${phase}-${suffix}`);

  return {
    phase,
    baseRef: ref,
    suffix,
    mergeTarget,
    logDir,
    launchDir: process.cwd(),
    configPath,
  };
}

// ── Branch resolution ───────────────────────────────────────────────

/** Walk through verify nodes to find the originating agent's branch. */
export function findBranchForDep(dag: DAGNode[], depId: string): string | undefined {
  const dep = dag.find((n) => n.id === depId);
  if (!dep) return undefined;
  if (dep.spec?.branch) return dep.spec.branch;
  if (dep.type === 'verify' && dep.dependsOn.length > 0) {
    return findBranchForDep(dag, dep.dependsOn[0]);
  }
  return undefined;
}

// ── Write queue (serialize state writes) ────────────────────────────

function createWriteQueue(): { enqueue: (fn: () => void) => Promise<void> } {
  let pending: Promise<void> = Promise.resolve();
  return {
    enqueue(fn: () => void): Promise<void> {
      pending = pending.then(fn, fn);
      return pending;
    },
  };
}

// ── Pipeline runner ─────────────────────────────────────────────────

export interface PipelineOptions {
  maxParallel: number;
  stallThresholdSeconds?: number;
}

export async function runPipeline(
  dag: DAGNode[],
  run: RunIdentity,
  handlers: Handlers,
  gitOps: GitOps,
  observers: Observer[],
  statePath: string,
  options: PipelineOptions
): Promise<PipelineState> {
  const observer = createCompositeObserver(observers);
  const state = loadOrCreateState(statePath, dag, run);
  const stateWriteQueue = createWriteQueue();
  const mergedBranches = new Set<string>();
  let mergeWorktree: string | null = null;
  const running = new Map<string, Promise<void>>();
  const agentWorktrees = new Map<string, string>();

  // ── SIGINT/SIGTERM handler ──────────────────────────────────────
  let aborted = false;
  const processGroup = process.pid;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      aborted = true;
      try {
        process.kill(-processGroup, signal);
      } catch {
        /* already exiting */
      }
      for (const ns of Object.values(state.nodes)) {
        if (ns.status === 'running') ns.status = 'ready';
      }
      state.status = 'failed';
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2));
      fs.renameSync(statePath + '.tmp', statePath);
      process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
    });
  }

  // ── Preflight ───────────────────────────────────────────────────
  fs.mkdirSync(run.logDir, { recursive: true });
  observer.onPipelineStart(run);

  // ── Two-phase main loop ─────────────────────────────────────────
  while (!aborted) {
    const actions = nextActions(dag, state.nodes);

    const done = actions.find((a) => a.type === 'complete');
    if (done) {
      state.status = done.status as PipelineStatus;
      break;
    }

    const batch = actions
      .filter((a) => a.type === 'execute')
      .map((a) => dag.find((n) => n.id === (a as { nodeId: string }).nodeId)!)
      .filter((n) => !running.has(n.id))
      .slice(0, options.maxParallel - running.size);

    // Transition retry-eligible nodes from failure → ready
    for (const node of batch) {
      if (state.nodes[node.id].status === 'failure') {
        state.nodes[node.id].status = 'ready';
        state.nodes[node.id].failureReason = undefined;
      }
    }

    // ── Phase 1: Serial merge-worktree operations ─────────────────
    for (const node of batch) {
      // Merge unmerged dependency branches
      const unmerged = node.dependsOn
        .map((id) => findBranchForDep(dag, id))
        .filter((b): b is string => !!b && !mergedBranches.has(b));

      if (unmerged.length > 0) {
        if (!mergeWorktree) mergeWorktree = await gitOps.createMergeWorktree(run.mergeTarget);
        for (const branch of unmerged) {
          const mergeResult = await handlers.merge(mergeWorktree, branch, (e) =>
            observer.onAgentEvent(`merge-${branch}`, e)
          );
          observer.onMerge(node.id, branch, mergeResult);
          if (mergeResult === 'failed') {
            state.nodes[node.id].status = 'failure';
            state.nodes[node.id].failureReason = 'merge_conflict';
            saveState(statePath, state);
            break;
          }
          mergedBranches.add(branch);
        }
      }

      // Verify nodes execute here (serial, in merge worktree)
      if (node.type === 'verify' && state.nodes[node.id].status !== 'failure') {
        if (!mergeWorktree) mergeWorktree = await gitOps.createMergeWorktree(run.mergeTarget);
        state.nodes[node.id].status = 'running';
        observer.onNodeStart(node.id, node);
        const result = await handlers.verify(node, mergeWorktree, (e) =>
          observer.onAgentEvent(node.id, e)
        );
        updateNodeState(state, node.id, result);
        observer.onNodeComplete(node.id, state.nodes[node.id]);
        await stateWriteQueue.enqueue(() => saveState(statePath, state));
      }
    }

    // ── Phase 2: Parallel agent dispatch ──────────────────────────
    for (const node of batch) {
      if (node.type !== 'agent') continue;
      if (state.nodes[node.id].status === 'failure') continue;
      if (running.has(node.id)) continue;

      state.nodes[node.id].status = 'running';

      const promise = (async () => {
        let result: NodeResult = { status: 'failure', failureReason: 'infra' };
        try {
          const spec = node.spec!;
          const workdir = spec.branch
            ? await gitOps.createWorktree(spec.branch, run.mergeTarget)
            : run.launchDir;
          if (spec.branch) agentWorktrees.set(node.id, workdir);

          state.nodes[node.id].logFile = path.join(run.logDir, `${spec.id}.log`);
          observer.onNodeStart(node.id, node);
          result = await handlers.agent(spec, run, workdir, (e) =>
            observer.onAgentEvent(node.id, e)
          );
        } catch {
          // result stays as default infra failure
        }

        updateNodeState(state, node.id, result);

        if (result.status === 'success' && agentWorktrees.has(node.id)) {
          gitOps.removeWorktree(agentWorktrees.get(node.id)!);
          agentWorktrees.delete(node.id);
        }

        observer.onNodeComplete(node.id, state.nodes[node.id]);
        await stateWriteQueue.enqueue(() => saveState(statePath, state));
        running.delete(node.id);
      })();

      running.set(node.id, promise);
    }

    if (running.size > 0) await Promise.race(running.values());
  }

  // ── Cleanup and PR creation ─────────────────────────────────────
  try {
    if (mergeWorktree && state.status !== 'failed') {
      gitOps.rebaseOnMain(mergeWorktree);
      const verifyResult = gitOps.verify(mergeWorktree, { tsc: true, vitest: true, cargo: true });
      observer.onVerify(verifyResult);
      if (!verifyResult.passed) {
        state.status = 'partial';
      }
    }
  } finally {
    if (mergeWorktree) gitOps.removeMergeWorktree(mergeWorktree);
    for (const [, wt] of agentWorktrees) gitOps.removeWorktree(wt);
    observer.onPipelineComplete(state);
    await stateWriteQueue.enqueue(() => saveState(statePath, state));
  }

  // Exit code for orchestrator
  const exitCodes: Record<PipelineStatus, number> = {
    running: 0,
    complete: 0,
    partial: 1,
    failed: 2,
    deadlock: 3,
  };
  process.exitCode = exitCodes[state.status] ?? 2;
  return state;
}
