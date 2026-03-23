import * as fs from 'node:fs';
import * as path from 'node:path';
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
 * FileLogObserver — writes structured log files.
 * Always active (the audit trail). Other observers compose on top.
 */
export function createFileLogObserver(logDir: string): Observer {
  function log(file: string, line: string): void {
    const filePath = path.join(logDir, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, line + '\n');
  }

  function pipelineLog(line: string): void {
    log('pipeline.log', `[${new Date().toISOString()}] ${line}`);
  }

  return {
    onPipelineStart(run: RunIdentity): void {
      fs.mkdirSync(logDir, { recursive: true });
      pipelineLog(
        `Pipeline started: phase=${run.phase} merge=${run.mergeTarget} suffix=${run.suffix}`
      );
    },

    onNodeStart(id: string, node: DAGNode): void {
      pipelineLog(`Node started: ${id} (${node.type})`);
    },

    onAgentEvent(id: string, event: AgentEvent): void {
      switch (event.type) {
        case 'turn':
          log(`${id}.log`, `[turn ${event.turn}]`);
          break;
        case 'tool':
          log(`${id}.log`, `[tool] ${event.name}${event.path ? ' ' + event.path : ''}`);
          break;
        case 'text':
          log(`${id}.log`, `[text] ${event.content}`);
          break;
        case 'result':
          log(
            `${id}.log`,
            `[result] ${event.status} turns=${event.turns} cost=$${event.costUsd.toFixed(2)}`
          );
          break;
      }
    },

    onNodeComplete(id: string, state: NodeState): void {
      const detail = state.status === 'failure' ? ` reason=${state.failureReason}` : '';
      pipelineLog(
        `Node complete: ${id} status=${state.status}${detail} attempt=${state.attempt} turns=${state.turns} cost=$${state.costUsd.toFixed(2)}`
      );
    },

    onMerge(triggeringNodeId: string, branch: string, result: string): void {
      pipelineLog(`Merge: ${branch} → ${result} (for node ${triggeringNodeId})`);
    },

    onVerify(result: VerifyResult): void {
      const checks = Object.entries(result.checks)
        .map(([k, v]) => `${k}=${v ? 'pass' : 'FAIL'}`)
        .join(' ');
      pipelineLog(
        `Verify: ${result.passed ? 'PASSED' : 'FAILED'} ${checks} fixAttempts=${result.fixAttempts}`
      );
    },

    onStall(id: string, idleSeconds: number): void {
      pipelineLog(`STALL: ${id} idle for ${idleSeconds}s`);
    },

    onPipelineComplete(state: PipelineState): void {
      const nodeStats = Object.values(state.nodes);
      const success = nodeStats.filter((n) => n.status === 'success').length;
      const failed = nodeStats.filter((n) => n.status === 'failure').length;
      const skipped = nodeStats.filter((n) => n.status === 'skipped').length;
      const totalCost = nodeStats.reduce((sum, n) => sum + n.costUsd, 0);
      const totalTurns = nodeStats.reduce((sum, n) => sum + n.turns, 0);
      pipelineLog(
        `Pipeline ${state.status}: ${success} success, ${failed} failed, ${skipped} skipped | ` +
          `turns=${totalTurns} cost=$${totalCost.toFixed(2)}`
      );
    },
  };
}
