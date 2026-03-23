import type { DAGNode, NodeState, SchedulerAction } from './types.js';

export interface SchedulerResult {
  actions: SchedulerAction[];
  state: Record<string, NodeState>;
}

/**
 * Pure scheduler — given DAG nodes and their current state, returns the next
 * actions AND the updated state. Never mutates the input. No I/O, no side effects.
 */
export function nextActions(nodes: DAGNode[], state: Record<string, NodeState>): SchedulerResult {
  // Deep copy state — caller's state is never mutated
  const next: Record<string, NodeState> = {};
  for (const [id, ns] of Object.entries(state)) {
    next[id] = { ...ns };
  }

  const actions: SchedulerAction[] = [];
  let allTerminal = true;

  for (const node of nodes) {
    const ns = next[node.id];
    if (!ns) continue;

    // Apply state transitions
    switch (ns.status) {
      case 'blocked': {
        const depStates = node.dependsOn.map((id) => next[id]?.status);
        if (depStates.every((s) => s === 'success')) {
          ns.status = 'ready';
        } else if (depStates.some((s) => s === 'failure' || s === 'skipped')) {
          ns.status = 'skipped';
        }
        break;
      }

      case 'skipped': {
        const depStates = node.dependsOn.map((id) => next[id]?.status);
        const hasFailedOrSkipped = depStates.some((s) => s === 'failure' || s === 'skipped');
        if (!hasFailedOrSkipped) {
          ns.status = 'blocked';
          if (depStates.every((s) => s === 'success')) {
            ns.status = 'ready';
          }
        }
        break;
      }

      case 'failure': {
        if (ns.attempt < ns.maxRetries && ns.failureReason !== 'merge_conflict') {
          ns.status = 'ready';
          ns.failureReason = undefined;
        }
        break;
      }

      default:
        break;
    }

    if (ns.status !== 'success' && ns.status !== 'failure' && ns.status !== 'skipped') {
      allTerminal = false;
    }

    if (ns.status === 'ready') {
      actions.push({ type: 'execute', nodeId: node.id });
    }
  }

  // Pipeline completion
  if (allTerminal && actions.length === 0) {
    const statuses = nodes.map((n) => next[n.id]?.status);
    const allSuccess = statuses.every((s) => s === 'success');
    const allFailed = statuses.every((s) => s === 'failure' || s === 'skipped');

    let status: 'complete' | 'partial' | 'failed';
    if (allSuccess) {
      status = 'complete';
    } else if (allFailed) {
      status = 'failed';
    } else {
      status = 'partial';
    }
    return { actions: [{ type: 'complete', status }], state: next };
  }

  // Deadlock
  if (actions.length === 0 && !allTerminal) {
    const hasRunning = nodes.some((n) => next[n.id]?.status === 'running');
    if (!hasRunning) {
      return { actions: [{ type: 'complete', status: 'deadlock' }], state: next };
    }
  }

  return { actions, state: next };
}
