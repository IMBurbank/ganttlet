// ── Generic agent result ─────────────────────────────────────────────

export interface AgentResult {
  group: string;
  phase: string;
  attempt: number;
  totalAttempts: number;
  partial: boolean;
  failed: boolean;
  output: string | null;
  sessionId: string | null;
  failureMode: FailureMode;
  totalCostUsd: number;
  totalTurns: number;
}

export type FailureMode =
  | 'success'
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_during_execution'
  | 'crash';

/** SDK result subtypes — excludes "crash" which is a thrown exception. */
export type AttemptResultType = Exclude<FailureMode, 'crash'>;

// ── Attempt configuration ────────────────────────────────────────────

export interface AttemptConfig {
  maxTurns: number;
  model: string;
  resumePrevious: boolean;
  wrapUpPrompt?: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
}

// ── Output validation ────────────────────────────────────────────────

export interface OutputValidation {
  isValid: (output: string | null) => boolean;
  fixPrompt: string;
}

// ── Attempt lifecycle hook ───────────────────────────────────────────

export interface AttemptContext {
  attemptIndex: number;
  config: AttemptConfig;
  resultType: FailureMode;
  output: string | null;
  sessionId: string | null;
  durationMs: number;
  costUsd: number;
}

// ── Policy definition ────────────────────────────────────────────────

export interface PolicyDefinition {
  attempts: AttemptConfig[];
  outputValidation?: OutputValidation;
  onAttemptComplete?: (context: AttemptContext) => void | Promise<void>;
}

// ── Runner options ───────────────────────────────────────────────────

export interface RunnerOptions {
  group: string;
  phase: string;
  workdir: string;
  prompt: string;
  logFile: string;
  policy: string;
  maxTurns?: number;
  maxBudget?: number;
  model?: string;
  maxCrashRetries?: number;
  crashRetryDelayMs?: number;
  outputFile?: string;
  promptVars?: Record<string, string>;
  agent?: string;
  sessionAncestor?: string;
}

// ── Pipeline orchestration ───────────────────────────────────────────

export interface GroupSpec {
  id: string;
  prompt: string;
  promptVars?: Record<string, string>;
  policy?: string;
  agent?: string;
  branch?: string;
  mergeMessage?: string;
  output?: string;
  verify?: 'full' | 'quick' | 'none';
  maxRetries?: number;
  dependsOn?: string[];
}

export type NodeType = 'agent' | 'verify';

export interface DAGNode {
  id: string;
  type: NodeType;
  dependsOn: string[];
  spec?: GroupSpec;
  level?: 'full' | 'quick';
  maxRetries?: number;
}

export type FailureReason =
  | 'agent'
  | 'merge_conflict'
  | 'verify_failed'
  | 'timeout'
  | 'budget'
  | 'dependency'
  | 'infra';

export interface NodeState {
  status: 'blocked' | 'ready' | 'running' | 'success' | 'failure' | 'skipped';
  failureReason?: FailureReason;
  attempt: number;
  maxRetries: number;
  sessionId?: string;
  costUsd: number;
  turns: number;
  logFile?: string;
  lastError?: string;
  lastEventAt?: string;
}

export interface NodeResult {
  status: 'success' | 'failure';
  failureReason?: FailureReason;
  sessionId?: string;
  costUsd?: number;
  turns?: number;
}

export interface RunIdentity {
  phase: string;
  baseRef: string;
  suffix: string;
  mergeTarget: string;
  logDir: string;
  launchDir: string;
  configPath: string;
  sessionAncestor?: string;
}

export type PipelineStatus = 'running' | 'complete' | 'partial' | 'failed' | 'deadlock';

export interface PipelineState {
  run: RunIdentity;
  nodes: Record<string, NodeState>;
  status: PipelineStatus;
  createdAt: string;
  updatedAt: string;
}

export type AgentEvent =
  | { type: 'turn'; turn: number }
  | { type: 'tool'; name: string; path?: string }
  | { type: 'text'; content: string }
  | { type: 'result'; status: string; turns: number; costUsd: number };

export type AgentEventCallback = (event: AgentEvent) => void;

export interface RetryContext {
  attempt: number;
  maxRetries: number;
  previousFailure?: FailureReason;
}

export interface VerifyResult {
  passed: boolean;
  checks: { tsc: boolean; vitest: boolean; cargo: boolean };
  fixAttempts: number;
  stdout?: string;
}

export type SchedulerAction =
  | { type: 'execute'; nodeId: string }
  | { type: 'complete'; status: 'complete' | 'partial' | 'failed' | 'deadlock' };

// ── Metrics ──────────────────────────────────────────────────────────

export interface AgentMetrics {
  timestamp: string;
  phase: string;
  group: string;
  duration_seconds: number;
  retries: number;
  exit_code: number;
  status: 'success' | 'failure';
  attempt: number;
  totalAttempts: number;
  failureMode: FailureMode;
  resumeCount: number;
  model: string;
  sessionId: string | null;
  policy: string;
  totalCostUsd: number;
}
