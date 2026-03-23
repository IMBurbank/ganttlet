import type { DAGNode, NodeState, SchedulerAction } from './types.js';

/**
 * Pure scheduler — given DAG nodes and their current state, returns the next
 * actions to take. No I/O, no side effects. Same pattern as attempt-machine.ts.
 */
export function nextActions(nodes: DAGNode[], state: Record<string, NodeState>): SchedulerAction[] {
  const actions: SchedulerAction[] = [];
  let allTerminal = true;

  for (const node of nodes) {
    const ns = state[node.id];
    if (!ns) continue;

    // Apply state transitions
    switch (ns.status) {
      case 'blocked': {
        const depStates = node.dependsOn.map((id) => state[id]?.status);
        if (depStates.every((s) => s === 'success')) {
          ns.status = 'ready';
        } else if (depStates.some((s) => s === 'failure' || s === 'skipped')) {
          ns.status = 'skipped';
        }
        break;
      }

      case 'skipped': {
        // Re-evaluate: if all deps that were failure/skipped are now ready or
        // better, transition back to blocked for re-evaluation
        const depStates = node.dependsOn.map((id) => state[id]?.status);
        const hasFailedOrSkipped = depStates.some((s) => s === 'failure' || s === 'skipped');
        if (!hasFailedOrSkipped) {
          ns.status = 'blocked';
          // Re-check if now ready (deps may all be success)
          if (depStates.every((s) => s === 'success')) {
            ns.status = 'ready';
          }
        }
        break;
      }

      case 'failure': {
        // Auto-retry if attempts remaining AND not a merge conflict
        // (merge conflicts are terminal within a run — recovery via --resume)
        if (ns.attempt < ns.maxRetries && ns.failureReason !== 'merge_conflict') {
          ns.status = 'ready';
          ns.failureReason = undefined;
        }
        break;
      }

      default:
        break;
    }

    // Check terminality
    if (ns.status !== 'success' && ns.status !== 'failure' && ns.status !== 'skipped') {
      allTerminal = false;
    }

    // Emit execute actions for ready nodes
    if (ns.status === 'ready') {
      actions.push({ type: 'execute', nodeId: node.id });
    }
  }

  // Pipeline completion
  if (allTerminal && actions.length === 0) {
    const statuses = nodes.map((n) => state[n.id]?.status);
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
    return [{ type: 'complete', status }];
  }

  // Deadlock: no actions possible and not all terminal
  if (actions.length === 0 && !allTerminal) {
    // Check if there are running nodes — if so, we're just waiting, not deadlocked
    const hasRunning = nodes.some((n) => state[n.id]?.status === 'running');
    if (!hasRunning) {
      return [{ type: 'complete', status: 'deadlock' }];
    }
  }

  return actions;
}
