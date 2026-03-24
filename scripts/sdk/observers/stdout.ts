import type { Observer } from './types.js';
import type {
  AgentEvent,
  DAGNode,
  NodeState,
  PipelineState,
  RunIdentity,
  VerifyResult,
} from '../types.js';

/**
 * StdoutObserver — CI-friendly summary lines to stdout.
 * Used with --ci flag. Compact, parseable output for GitHub Actions.
 */
export function createStdoutObserver(): Observer {
  function write(line: string): void {
    process.stdout.write(`[pipeline] ${line}\n`);
  }

  return {
    onPipelineStart(run: RunIdentity): void {
      write(`started phase=${run.phase} target=${run.mergeTarget}`);
    },

    onNodeStart(id: string, node: DAGNode): void {
      write(`node:start ${id} type=${node.type}`);
    },

    onAgentEvent(_id: string, _event: AgentEvent): void {
      // Suppress per-event output in CI — too verbose
    },

    onNodeComplete(id: string, state: NodeState): void {
      const parts = [`node:${state.status}`, id, `attempt=${state.attempt}`];
      if (state.turns > 0) parts.push(`turns=${state.turns}`);
      if (state.costUsd > 0) parts.push(`cost=$${state.costUsd.toFixed(2)}`);
      if (state.failureReason) parts.push(`reason=${state.failureReason}`);
      write(parts.join(' '));
    },

    onMerge(_triggeringNodeId: string, branch: string, result: string): void {
      write(`merge ${branch} → ${result}`);
    },

    onVerify(result: VerifyResult): void {
      const checks = Object.entries(result.checks)
        .map(([k, v]) => `${k}=${v ? 'pass' : 'FAIL'}`)
        .join(' ');
      write(`verify ${result.passed ? 'PASSED' : 'FAILED'} ${checks}`);
    },

    onStall(id: string, idleSeconds: number, severity: 'warning' | 'critical'): void {
      write(`stall:${severity} ${id} idle=${Math.round(idleSeconds)}s`);
    },

    onPipelineComplete(state: PipelineState): void {
      const nodes = Object.values(state.nodes);
      const success = nodes.filter((n) => n.status === 'success').length;
      const failed = nodes.filter((n) => n.status === 'failure').length;
      const totalCost = nodes.reduce((s, n) => s + n.costUsd, 0);
      const totalTurns = nodes.reduce((s, n) => s + n.turns, 0);
      write(
        `${state.status} ${success}/${nodes.length} success` +
          ` failed=${failed} turns=${totalTurns} cost=$${totalCost.toFixed(2)}`
      );
    },
  };
}
