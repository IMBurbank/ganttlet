import * as path from 'node:path';
import type {
  AgentEventCallback,
  DAGNode,
  GroupSpec,
  NodeResult,
  RunIdentity,
  RunnerOptions,
} from './types.js';
import type { GitOps } from './git-ops.js';

// ── Handler interfaces ──────────────────────────────────────────────

export interface Handlers {
  agent: (
    spec: GroupSpec,
    run: RunIdentity,
    workdir: string,
    onEvent: AgentEventCallback
  ) => Promise<NodeResult>;
  merge: (
    worktree: string,
    branch: string,
    onEvent: AgentEventCallback
  ) => Promise<'merged' | 'failed'>;
  verify: (node: DAGNode, worktree: string, onEvent: AgentEventCallback) => Promise<NodeResult>;
}

// ── Fix agent prompts (inline constants, owned by handlers) ─────────

const FIX_MERGE_PROMPT = `You are resolving a git merge conflict in this worktree.
Run \`git diff --name-only --diff-filter=U\` to find conflicted files.
For each file, read it, resolve the conflict markers, and stage with \`git add\`.
When all conflicts are resolved, run \`git commit --no-edit\` to complete the merge.
Do not enter plan mode — execute immediately.`;

const FIX_VERIFY_PROMPT = `Verification failed in this worktree. Run the failing checks:
- TypeScript: \`npx tsc --noEmit\`
- Tests: \`npx vitest run\`
- Rust: \`cargo test -p scheduler\`
Read the errors, fix the code, and commit. Do not enter plan mode — execute immediately.`;

// ── Agent execution function type ───────────────────────────────────

/**
 * Runs an agent with an inline prompt string (not a file path).
 * Used by fix agents for merge conflicts and verify failures.
 */
export type RunAgentFn = (
  opts: RunnerOptions,
  inlinePrompt: string,
  onEvent: AgentEventCallback
) => Promise<{ failed: boolean }>;

// ── Handler factories ───────────────────────────────────────────────

const MAX_MERGE_ATTEMPTS = 3;

export function createMergeHandler(
  gitOps: GitOps,
  runAgent: RunAgentFn,
  run: RunIdentity
): Handlers['merge'] {
  return async (worktree, branch, onEvent) => {
    const result = gitOps.mergeBranch(worktree, branch);
    if (result !== 'conflict') return 'merged';

    // Conflict — retry with escalating fix agents
    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
      const fixOpts: RunnerOptions = {
        group: `fix-merge-${branch}-${attempt}`,
        phase: run.phase,
        workdir: worktree,
        prompt: '__inline__',
        logFile: path.join(
          run.logDir,
          `fix-merge-${branch.replace(/\//g, '-')}-attempt${attempt}.log`
        ),
        policy: 'default',
        model: attempt >= 2 ? 'claude-opus-4-6' : undefined,
      };
      const fixResult = await runAgent(fixOpts, FIX_MERGE_PROMPT, onEvent);

      if (!fixResult.failed) {
        // Verify merge state is clean
        if (gitOps.isMergeClean(worktree)) {
          return 'merged';
        }
        // Fix agent didn't fully resolve — abort and retry
      }

      // Abort the merge to leave worktree clean for next attempt
      gitOps.mergeAbort(worktree);

      if (attempt < MAX_MERGE_ATTEMPTS - 1) {
        // Re-attempt the merge (starts fresh)
        const retry = gitOps.mergeBranch(worktree, branch);
        if (retry !== 'conflict') return 'merged';
      }
    }
    return 'failed';
  };
}

export function createVerifyHandler(
  gitOps: GitOps,
  runAgent: RunAgentFn,
  run: RunIdentity
): Handlers['verify'] {
  return async (node, worktree, onEvent) => {
    const level = node.level ?? 'full';
    const checks = { tsc: true, vitest: true, cargo: level === 'full' };
    const result = gitOps.verify(worktree, checks);
    if (result.passed) return { status: 'success' as const };

    // Failure — spawn fix agent
    const fixOpts: RunnerOptions = {
      group: `fix-verify-${node.id}`,
      phase: run.phase,
      workdir: worktree,
      prompt: '__inline__',
      logFile: path.join(run.logDir, `fix-verify-${node.id}.log`),
      policy: 'default',
    };
    const fixResult = await runAgent(fixOpts, FIX_VERIFY_PROMPT, onEvent);
    if (fixResult.failed) {
      return { status: 'failure' as const, failureReason: 'verify_failed' as const };
    }

    // Re-verify after fix
    const recheck = gitOps.verify(worktree, checks);
    return recheck.passed
      ? { status: 'success' as const }
      : { status: 'failure' as const, failureReason: 'verify_failed' as const };
  };
}

// ── GroupSpec → RunnerOptions adapter ────────────────────────────────

export function toRunnerOptions(spec: GroupSpec, run: RunIdentity, workdir: string): RunnerOptions {
  return {
    group: spec.id,
    phase: run.phase,
    workdir,
    prompt: spec.prompt,
    logFile: path.join(run.logDir, `${spec.id}.log`),
    policy: spec.policy ?? 'default',
    outputFile: spec.output ? path.join(run.logDir, spec.output) : undefined,
    promptVars: spec.promptVars,
    agent: spec.agent,
  };
}
