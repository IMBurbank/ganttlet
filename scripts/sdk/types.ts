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
}

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
