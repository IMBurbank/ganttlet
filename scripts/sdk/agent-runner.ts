import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentResult, AttemptResultType, RunnerOptions } from './types.js';
import { getPolicy, applyOverrides } from './policy-registry.js';
import { nextAction } from './attempt-machine.js';
import { stripFrontmatter, substituteVars } from './prompts.js';
import { logMetrics } from './metrics.js';

export type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk').query;

export async function runAgent(options: RunnerOptions, queryFn: QueryFn): Promise<AgentResult> {
  const policy = getPolicy(options.policy);
  applyOverrides(policy, {
    maxTurns: options.maxTurns,
    model: options.model,
  });

  const persistSession =
    policy.attempts.some((a) => a.resumePrevious) || policy.outputValidation !== undefined;

  // Read and prepare prompt
  const promptPath = path.resolve(options.workdir, options.prompt);
  if (!fs.existsSync(promptPath)) {
    return {
      group: options.group,
      phase: options.phase,
      attempt: 0,
      totalAttempts: policy.attempts.length,
      partial: false,
      failed: true,
      output: null,
      sessionId: null,
      failureMode: 'crash',
      totalCostUsd: 0,
    };
  }

  const rawPrompt = fs.readFileSync(promptPath, 'utf-8');
  let basePrompt = stripFrontmatter(rawPrompt);
  if (options.promptVars) {
    basePrompt = substituteVars(basePrompt, options.promptVars);
  }

  const maxCrashRetries = options.maxCrashRetries ?? 2;
  const crashRetryDelayMs = options.crashRetryDelayMs ?? 1000;
  let cumulativeCostUsd = 0;
  let crashCount = 0;
  let attemptIndex = 0;
  let resultType: AttemptResultType = 'success';
  let lastOutput: string | null = null;
  let lastNonNullOutput: string | null = null;
  let lastSessionId: string | null = null;
  let outputValid: boolean | null = policy.outputValidation ? null : true;
  let outputFixAttempted = false;
  let totalAttempts = 0;
  const startTime = Date.now();

  // Start with the first attempt — the state machine drives all subsequent decisions
  let action: ReturnType<typeof nextAction> = {
    kind: 'call',
    attemptIndex: 0,
    resume: false,
  };

  while (action.kind !== 'done') {
    if (action.kind === 'validate_output') {
      const valid = policy.outputValidation!.isValid(lastOutput);
      outputValid = valid;
      action = nextAction(
        policy.attempts,
        action.attemptIndex,
        resultType,
        crashCount,
        maxCrashRetries,
        outputValid,
        outputFixAttempted
      );
      continue;
    }

    if (action.kind === 'fix_output') {
      // Check budget before fix call
      if (options.maxBudget !== undefined && cumulativeCostUsd >= options.maxBudget) {
        action = { kind: 'done', failed: true, failureMode: 'error_max_budget_usd' };
        break;
      }
      const fixRemainingBudget =
        options.maxBudget !== undefined ? options.maxBudget - cumulativeCostUsd : undefined;
      const fixPrompt = policy.outputValidation!.fixPrompt;
      try {
        const fixResult = await callQuery(queryFn, {
          prompt: fixPrompt,
          cwd: options.workdir,
          resume: lastSessionId ?? undefined,
          persistSession,
          maxTurns: 5,
          maxBudgetUsd: fixRemainingBudget,
          model: policy.attempts[action.attemptIndex].model,
          agent: options.agent,
          logFile: options.logFile
            ? `${options.logFile.replace(/\.log$/, '')}-attempt${attemptIndex + 1}-fix.log`
            : undefined,
        });
        outputFixAttempted = true; // Only mark after fix call completes
        cumulativeCostUsd += fixResult.costUsd;
        if (fixResult.output !== null) {
          lastOutput = fixResult.output;
          lastNonNullOutput = fixResult.output;
        }
        if (fixResult.sessionId) lastSessionId = fixResult.sessionId;
        resultType = fixResult.resultType;
        crashCount = 0; // Reset crash count on successful fix call
      } catch {
        crashCount++;
        if (crashCount < maxCrashRetries) {
          const delay = crashRetryDelayMs * Math.pow(2, crashCount - 1);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      outputValid = policy.outputValidation!.isValid(lastOutput);
      action = nextAction(
        policy.attempts,
        action.attemptIndex,
        resultType,
        crashCount,
        maxCrashRetries,
        outputValid,
        outputFixAttempted
      );
      continue;
    }

    // action.kind === 'call'
    attemptIndex = action.attemptIndex;
    const attemptConfig = policy.attempts[attemptIndex];

    // Check budget before calling
    if (options.maxBudget !== undefined && cumulativeCostUsd >= options.maxBudget) {
      action = { kind: 'done', failed: true, failureMode: 'error_max_budget_usd' };
      break;
    }

    totalAttempts++;

    const remainingBudget =
      options.maxBudget !== undefined ? options.maxBudget - cumulativeCostUsd : undefined;

    // Determine prompt for this call
    let taskPrompt: string;
    if (action.prompt) {
      taskPrompt = substituteVars(action.prompt, {
        OUTPUT: lastNonNullOutput ?? '',
      });
    } else {
      taskPrompt = basePrompt;
    }

    // Determine resume
    const resumeSessionId = action.resume && lastSessionId ? lastSessionId : undefined;

    // Reset validation state for new attempt
    if (!action.resume) {
      outputValid = policy.outputValidation ? null : true;
      outputFixAttempted = false;
    }

    try {
      const callResult = await callQuery(queryFn, {
        prompt: taskPrompt,
        cwd: options.workdir,
        resume: resumeSessionId,
        persistSession,
        maxTurns: attemptConfig.maxTurns,
        model: attemptConfig.model,
        effort: attemptConfig.effort,
        maxBudgetUsd: remainingBudget,
        agent: options.agent,
        logFile: options.logFile
          ? `${options.logFile.replace(/\.log$/, '')}-attempt${attemptIndex + 1}.log`
          : undefined,
      });

      cumulativeCostUsd += callResult.costUsd;
      if (callResult.output !== null) {
        lastOutput = callResult.output;
        lastNonNullOutput = callResult.output;
      }
      if (callResult.sessionId) lastSessionId = callResult.sessionId;
      resultType = callResult.resultType;
      crashCount = 0; // Reset crash count on successful call

      // Fire onAttemptComplete hook
      if (policy.onAttemptComplete) {
        try {
          await policy.onAttemptComplete({
            attemptIndex,
            config: attemptConfig,
            resultType,
            output: lastOutput,
            sessionId: lastSessionId,
            durationMs: callResult.durationMs,
            costUsd: callResult.costUsd,
          });
        } catch {
          // swallow hook errors
        }
      }

      action = nextAction(
        policy.attempts,
        attemptIndex,
        resultType,
        crashCount,
        maxCrashRetries,
        outputValid,
        outputFixAttempted
      );
    } catch {
      crashCount++;
      // Delay before retry (state machine decides whether to retry or give up)
      if (crashCount < maxCrashRetries) {
        const delay = crashRetryDelayMs * Math.pow(2, crashCount - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
      action = nextAction(
        policy.attempts,
        attemptIndex,
        resultType,
        crashCount,
        maxCrashRetries,
        outputValid,
        outputFixAttempted
      );
    }
  }

  const result: AgentResult = {
    group: options.group,
    phase: options.phase,
    attempt: totalAttempts,
    totalAttempts: policy.attempts.length,
    partial: totalAttempts > 1 && !action.failed,
    failed: action.kind === 'done' ? action.failed : false,
    output: lastOutput,
    sessionId: lastSessionId,
    failureMode: action.kind === 'done' ? action.failureMode : 'success',
    totalCostUsd: cumulativeCostUsd,
  };

  // Log metrics
  const durationSeconds = (Date.now() - startTime) / 1000;
  try {
    logMetrics({
      timestamp: new Date().toISOString(),
      phase: options.phase,
      group: options.group,
      duration_seconds: durationSeconds,
      retries: totalAttempts - 1,
      exit_code: result.failed ? 1 : 0,
      status: result.failed ? 'failure' : 'success',
      attempt: totalAttempts,
      totalAttempts: policy.attempts.length,
      failureMode: result.failureMode,
      resumeCount: policy.attempts.filter((a) => a.resumePrevious).length,
      model: policy.attempts[0]?.model ?? 'unknown',
      sessionId: lastSessionId,
      policy: options.policy,
      totalCostUsd: cumulativeCostUsd,
    });
  } catch {
    // metrics are non-critical
  }

  // Write output file if configured
  if (options.outputFile && result.output !== null) {
    try {
      fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
      fs.writeFileSync(options.outputFile, result.output);
    } catch (e) {
      process.stderr.write(`Warning: failed to write output file ${options.outputFile}: ${e}\n`);
    }
  }

  return result;
}

interface CallQueryOpts {
  prompt: string;
  cwd: string;
  resume?: string;
  persistSession: boolean;
  maxTurns: number;
  model: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  maxBudgetUsd?: number;
  agent?: string;
  logFile?: string;
}

interface CallQueryResult {
  resultType: AttemptResultType;
  output: string | null;
  sessionId: string | null;
  costUsd: number;
  durationMs: number;
}

async function callQuery(queryFn: QueryFn, opts: CallQueryOpts): Promise<CallQueryResult> {
  const start = Date.now();
  const queryOpts: Record<string, unknown> = {
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: ['project'],
    cwd: opts.cwd,
    persistSession: opts.persistSession,
    maxTurns: opts.maxTurns,
    model: opts.model,
    includePartialMessages: true,
    // Auto-approve permission prompts (needed for .claude/skills/ edits
    // until upstream fixes #37157). Also approves Bash commands targeting
    // .claude/ paths when bypassPermissions mode is active.
    canUseTool: async (
      _toolName: string,
      _input: Record<string, unknown>,
      options: Record<string, unknown>
    ) => ({
      behavior: 'allow' as const,
      toolUseID: (options as { toolUseID?: string }).toolUseID,
      updatedPermissions: (options as { suggestions?: unknown[] }).suggestions ?? [],
    }),
  };

  if (opts.effort) queryOpts.effort = opts.effort;
  if (opts.maxBudgetUsd !== undefined) queryOpts.maxBudgetUsd = opts.maxBudgetUsd;
  if (opts.agent) queryOpts.agent = opts.agent;
  if (opts.resume) queryOpts.resume = opts.resume;

  const stream = queryFn({
    prompt: opts.prompt,
    options: queryOpts as Parameters<QueryFn>[0]['options'],
  });

  let sessionId: string | null = null;
  let resultType: AttemptResultType = 'success';
  let output: string | null = null;
  let costUsd = 0;
  let gotResult = false;

  for await (const message of stream) {
    const msg = message as Record<string, unknown>;
    if (msg.type === 'system' && msg.subtype === 'init' && !sessionId) {
      sessionId = msg.session_id as string;
    }
    // Log stream events to the log file for monitoring/debugging
    if (opts.logFile) {
      if (msg.type === 'assistant') {
        const content = (
          msg as { message?: { content?: Array<{ type: string; name?: string; text?: string }> } }
        ).message?.content;
        if (content) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              fs.appendFileSync(opts.logFile, `[tool] ${block.name}\n`);
            } else if (block.type === 'text' && block.text) {
              fs.appendFileSync(opts.logFile, `[text] ${block.text.substring(0, 200)}\n`);
            }
          }
        }
      } else if (msg.type === 'tool_use_summary') {
        fs.appendFileSync(
          opts.logFile,
          `[summary] ${(msg as { summary?: string }).summary?.substring(0, 200)}\n`
        );
      }
    }
    if (msg.type === 'result') {
      gotResult = true;
      const subtype = msg.subtype as string;
      if (subtype === 'success') {
        resultType = 'success';
      } else {
        resultType = subtype as AttemptResultType;
      }
      // Capture output from any result type (partial output on error)
      if (msg.result !== undefined) {
        output = (msg.result as string) ?? null;
      }
      costUsd = (msg.total_cost_usd as number) ?? 0;
    }
  }

  if (!gotResult) {
    throw new Error('No result message from query');
  }

  return {
    resultType,
    output,
    sessionId,
    costUsd,
    durationMs: Date.now() - start,
  };
}

export function buildRetryContext(workdir: string, previousOutput: string | null): string {
  const sections: string[] = ['## Retry Context\n'];

  try {
    const log = execSync('git log --oneline -5 2>/dev/null', {
      cwd: workdir,
      encoding: 'utf-8',
    }).trim();
    if (log) {
      sections.push(`### Recent commits\n\`\`\`\n${log}\n\`\`\`\n`);
    }
  } catch {
    // no git repo or no commits
  }

  const statusPath = path.join(workdir, '.agent-status.json');
  try {
    if (fs.existsSync(statusPath)) {
      const status = fs.readFileSync(statusPath, 'utf-8');
      sections.push(`### Agent status\n\`\`\`json\n${status}\n\`\`\`\n`);
    }
  } catch {
    // ignore
  }

  if (previousOutput) {
    const tail = previousOutput.slice(-200);
    sections.push(`### Previous output (last 200 chars)\n\`\`\`\n${tail}\n\`\`\`\n`);
  }

  return sections.join('\n');
}

export function parseCliArgs(argv: string[]): RunnerOptions {
  const args = new Map<string, string>();
  const promptVars: Record<string, string> = {};
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
    const flag = arg.slice(2);
    if (flag === 'prompt-var') {
      const val = argv[++i];
      if (!val) throw new Error('--prompt-var requires KEY=VALUE');
      const eqIdx = val.indexOf('=');
      if (eqIdx === -1) throw new Error(`--prompt-var value must contain '=': ${val}`);
      promptVars[val.slice(0, eqIdx)] = val.slice(eqIdx + 1);
    } else {
      const val = argv[++i];
      if (val === undefined) throw new Error(`Flag --${flag} requires a value`);
      if (args.has(flag)) throw new Error(`Duplicate flag: --${flag}`);
      args.set(flag, val);
    }
    i++;
  }

  const required = ['group', 'workdir', 'prompt', 'log', 'phase'] as const;
  for (const name of required) {
    if (!args.has(name)) {
      throw new Error(
        `Missing required flag: --${name}\nRequired: ${required.map((r) => `--${r}`).join(', ')}`
      );
    }
  }

  function parseNum(flag: string): number | undefined {
    const val = args.get(flag);
    if (val === undefined) return undefined;
    const num = Number(val);
    if (Number.isNaN(num)) {
      throw new Error(`--${flag} must be a number, got: ${val}`);
    }
    return num;
  }

  // Check for unknown flags
  const known = new Set([
    'group',
    'workdir',
    'prompt',
    'log',
    'phase',
    'policy',
    'max-turns',
    'max-budget',
    'model',
    'max-crash-retries',
    'crash-retry-delay',
    'output-file',
    'agent',
  ]);
  for (const key of args.keys()) {
    if (!known.has(key)) {
      throw new Error(`Unknown flag: --${key}`);
    }
  }

  return {
    group: args.get('group')!,
    phase: args.get('phase')!,
    workdir: args.get('workdir')!,
    prompt: args.get('prompt')!,
    logFile: args.get('log')!,
    policy: args.get('policy') ?? 'default',
    maxTurns: parseNum('max-turns'),
    maxBudget: parseNum('max-budget'),
    model: args.get('model'),
    maxCrashRetries: parseNum('max-crash-retries'),
    crashRetryDelayMs: parseNum('crash-retry-delay'),
    outputFile: args.get('output-file'),
    agent: args.get('agent'),
    promptVars: Object.keys(promptVars).length > 0 ? promptVars : undefined,
  };
}

function printUsage(): void {
  const usage = `SDK Agent Runner

Usage: npx tsx scripts/sdk/agent-runner.ts [options]

Required:
  --group <id>            Group ID
  --workdir <path>        Working directory (absolute path)
  --prompt <path>         Prompt file path (relative to workdir)
  --log <path>            Log file path
  --phase <name>          Phase name for metrics

Optional:
  --policy <name>         Policy name (default: "default")
  --max-turns <n>         Override attempt 1 maxTurns
  --max-budget <usd>      USD budget cap shared across attempts
  --model <id>            Override attempt 1 model
  --max-crash-retries <n> Max crash retries (default: 2)
  --crash-retry-delay <ms> Initial backoff delay (default: 1000)
  --output-file <path>    Write agent text output to this path
  --prompt-var KEY=VALUE  Substitute {KEY} in prompt (repeatable)
  --agent <name>          Agent definition name
  --help                  Show this help message`;

  process.stdout.write(usage + '\n');
}

// CLI entry point
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`
) {
  (async () => {
    // Check for --help before loading policies
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      printUsage();
      process.exit(0);
    }

    await import('./policies/default.js');
    await import('./policies/reviewer.js');
    await import('./policies/curator.js');

    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const opts = parseCliArgs(process.argv.slice(2));
    const result = await runAgent(opts, sdk.query);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(result.failed ? 1 : 0);
  })();
}
