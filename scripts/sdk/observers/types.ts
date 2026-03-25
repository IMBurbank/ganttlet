import type {
  AgentEvent,
  DAGNode,
  NodeState,
  PipelineState,
  RunIdentity,
  VerifyResult,
} from '../types.js';

/**
 * Observer interface — receives pipeline lifecycle events.
 * Implementations are read-only (no intervention, just observation).
 */
export interface Observer {
  onPipelineStart(run: RunIdentity): void;
  onNodeStart(id: string, node: DAGNode): void;
  onAgentEvent(id: string, event: AgentEvent): void;
  onNodeComplete(id: string, state: NodeState): void;
  onMerge(triggeringNodeId: string, branch: string, result: string): void;
  onVerify(result: VerifyResult): void;
  onStall(id: string, idleSeconds: number, severity: 'warning' | 'critical'): void;
  onPipelineComplete(state: PipelineState): void;
}

/** Dispatch to multiple observers. */
export function createCompositeObserver(observers: Observer[]): Observer {
  return {
    onPipelineStart: (run) => observers.forEach((o) => o.onPipelineStart(run)),
    onNodeStart: (id, node) => observers.forEach((o) => o.onNodeStart(id, node)),
    onAgentEvent: (id, event) => observers.forEach((o) => o.onAgentEvent(id, event)),
    onNodeComplete: (id, state) => observers.forEach((o) => o.onNodeComplete(id, state)),
    onMerge: (nodeId, branch, result) =>
      observers.forEach((o) => o.onMerge(nodeId, branch, result)),
    onVerify: (result) => observers.forEach((o) => o.onVerify(result)),
    onStall: (id, seconds, severity) => observers.forEach((o) => o.onStall(id, seconds, severity)),
    onPipelineComplete: (state) => observers.forEach((o) => o.onPipelineComplete(state)),
  };
}
