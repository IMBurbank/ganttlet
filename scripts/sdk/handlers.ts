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

// ── Fix agent seam ──────────────────────────────────────────────────

/**
 * Narrow seam for fix agents — only exposes what handlers need.
 * The pipeline runner constructs this from runAgentWithInlinePrompt.
 */
export type FixAgentFn = (
  prompt: string,
  workdir: string,
  logFile: string,
  onEvent: AgentEventCallback,
  model?: string
) => Promise<{ failed: boolean }>;

// ── Handler factories ───────────────────────────────────────────────

const MAX_MERGE_ATTEMPTS = 3;

export function createMergeHandler(
  gitOps: GitOps,
  fixAgent: FixAgentFn,
  logDir: string
): Handlers['merge'] {
  return async (worktree, branch, onEvent) => {
    const result = gitOps.mergeBranch(worktree, branch);
    if (result !== 'conflict') return 'merged';

    const safeBranch = branch.replace(/\//g, '-');
    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
      const logFile = `${logDir}/fix-merge-${safeBranch}-attempt${attempt}.log`;
      const model = attempt >= 2 ? 'claude-opus-4-6' : undefined;
      let fixFailed = true;
      try {
        const fixResult = await fixAgent(FIX_MERGE_PROMPT, worktree, logFile, onEvent, model);
        fixFailed = fixResult.failed;
      } catch {
        // fix agent crashed — treat as failed, continue to abort+retry
      }

      if (!fixFailed && gitOps.isMergeClean(worktree)) {
        return 'merged';
      }

      gitOps.mergeAbort(worktree);

      if (attempt < MAX_MERGE_ATTEMPTS - 1) {
        const retry = gitOps.mergeBranch(worktree, branch);
        if (retry !== 'conflict') return 'merged';
      }
    }
    return 'failed';
  };
}

export function createVerifyHandler(
  gitOps: GitOps,
  fixAgent: FixAgentFn,
  logDir: string
): Handlers['verify'] {
  return async (node, worktree, onEvent) => {
    const level = node.level ?? 'full';
    const checks = { tsc: true, vitest: true, cargo: level === 'full' };
    const result = gitOps.verify(worktree, checks);
    if (result.passed) return { status: 'success' as const };

    const logFile = `${logDir}/fix-verify-${node.id}.log`;
    let fixFailed = true;
    try {
      const fixResult = await fixAgent(FIX_VERIFY_PROMPT, worktree, logFile, onEvent);
      fixFailed = fixResult.failed;
    } catch {
      // fix agent crashed — treat as failed
    }
    if (fixFailed) {
      return { status: 'failure' as const, failureReason: 'verify_failed' as const };
    }

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
