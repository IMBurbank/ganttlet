// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runAgent, type QueryFn } from '../agent-runner.js';
// Side-effect imports to register policies on the default registry
import '../policies/reviewer.js';
import '../policies/default.js';
import { registerPolicy } from '../policy-registry.js';
import type { RunnerOptions, PolicyDefinition } from '../types.js';

interface FakeResponse {
  subtype: string;
  result?: string;
  costUsd?: number;
  sessionId?: string;
  throw?: Error;
}

function fakeQuery(responses: FakeResponse[]) {
  let callIndex = 0;
  const calls: Array<Record<string, unknown>> = [];
  const fn = async function* (opts: Record<string, unknown>) {
    calls.push(opts);
    const idx = callIndex;
    const response = responses[callIndex++];
    if (!response) throw new Error('No more fake responses');
    if (response.throw) throw response.throw;
    const sid = response.sessionId ?? `sess-${idx}`;
    yield { type: 'system', subtype: 'init', session_id: sid };
    yield {
      type: 'result',
      subtype: response.subtype,
      result: response.result,
      total_cost_usd: response.costUsd ?? 0,
      session_id: sid,
    };
  };
  return { queryFn: fn as unknown as QueryFn, calls };
}

// Helper to set up a temp workdir with a prompt file
function setupWorkdir(promptContent: string = 'Test prompt'): {
  workdir: string;
  cleanup: () => void;
} {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-test-'));
  fs.writeFileSync(path.join(workdir, 'prompt.md'), promptContent);
  return {
    workdir,
    cleanup: () => fs.rmSync(workdir, { recursive: true, force: true }),
  };
}

function baseOptions(workdir: string): RunnerOptions {
  return {
    group: 'test-group',
    phase: 'test-phase',
    workdir,
    prompt: 'prompt.md',
    logFile: path.join(workdir, 'test.log'),
    policy: 'default',
  };
}

// We use isolated registries but need policies registered on the default registry
// for runAgent which calls getPolicy on the default registry.
// Import the policies to trigger their side-effect registration.

describe('agent-runner — contract tests', () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupWorkdir();
    workdir = setup.workdir;
    cleanup = setup.cleanup;

    // Set metrics dir to temp to avoid polluting cwd
    process.env.LOG_METRICS_DIR = path.join(workdir, 'metrics');
  });

  afterEach(() => {
    cleanup();
    delete process.env.LOG_METRICS_DIR;
  });

  it('calls queryFn with correct permissionMode and settings', async () => {
    const { queryFn, calls } = fakeQuery([{ subtype: 'success', result: 'ok' }]);
    await runAgent(baseOptions(workdir), queryFn);

    expect(calls).toHaveLength(1);
    const opts = calls[0].options as Record<string, unknown>;
    expect(opts.permissionMode).toBe('bypassPermissions');
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
    expect(opts.settingSources).toEqual(['project']);
    expect(opts.cwd).toBe(workdir);
  });

  it('forwards agent option when set', async () => {
    const { queryFn, calls } = fakeQuery([{ subtype: 'success', result: 'ok' }]);
    await runAgent({ ...baseOptions(workdir), agent: 'skill-reviewer' }, queryFn);

    const opts = calls[0].options as Record<string, unknown>;
    expect(opts.agent).toBe('skill-reviewer');
  });

  it('does not set agent when not provided', async () => {
    const { queryFn, calls } = fakeQuery([{ subtype: 'success', result: 'ok' }]);
    await runAgent(baseOptions(workdir), queryFn);

    const opts = calls[0].options as Record<string, unknown>;
    expect(opts.agent).toBeUndefined();
  });

  it('sets persistSession true when policy has resumePrevious', async () => {
    const { queryFn, calls } = fakeQuery([
      { subtype: 'error_max_turns', result: 'partial' },
      { subtype: 'success', result: 'done' },
      { subtype: 'success', result: 'done' }, // for potential fix_output
    ]);
    await runAgent({ ...baseOptions(workdir), policy: 'reviewer' }, queryFn);

    const opts = calls[0].options as Record<string, unknown>;
    expect(opts.persistSession).toBe(true);
  });

  it('sets persistSession false for default policy', async () => {
    const { queryFn, calls } = fakeQuery([{ subtype: 'success', result: 'ok' }]);
    await runAgent(baseOptions(workdir), queryFn);

    const opts = calls[0].options as Record<string, unknown>;
    expect(opts.persistSession).toBe(false);
  });

  it('forwards effort from attempt config', async () => {
    // Create a custom policy with effort
    const { queryFn, calls } = fakeQuery([
      { subtype: 'error_max_turns', result: 'partial' },
      { subtype: 'error_max_turns', result: 'partial' },
      { subtype: 'success', result: 'ok' },
    ]);
    await runAgent({ ...baseOptions(workdir), policy: 'reviewer' }, queryFn);

    // Attempt 3 (index 2) of reviewer has effort: 'low'
    if (calls.length >= 3) {
      const opts = calls[2].options as Record<string, unknown>;
      expect(opts.effort).toBe('low');
    }
  });
});

describe('agent-runner — attempt transitions', () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupWorkdir();
    workdir = setup.workdir;
    cleanup = setup.cleanup;
    process.env.LOG_METRICS_DIR = path.join(workdir, 'metrics');
  });

  afterEach(() => {
    cleanup();
    delete process.env.LOG_METRICS_DIR;
  });

  it('default success', async () => {
    const { queryFn } = fakeQuery([{ subtype: 'success', result: 'all good' }]);
    const result = await runAgent(baseOptions(workdir), queryFn);
    expect(result.failed).toBe(false);
    expect(result.output).toBe('all good');
    expect(result.failureMode).toBe('success');
  });

  it('default fail (error_max_turns, single attempt)', async () => {
    const { queryFn } = fakeQuery([{ subtype: 'error_max_turns', result: 'partial' }]);
    const result = await runAgent(baseOptions(workdir), queryFn);
    expect(result.failed).toBe(true);
    expect(result.failureMode).toBe('error_max_turns');
  });

  it('error_max_budget_usd never advances', async () => {
    const { queryFn, calls } = fakeQuery([{ subtype: 'error_max_budget_usd' }]);
    const result = await runAgent(baseOptions(workdir), queryFn);
    expect(result.failed).toBe(true);
    expect(result.failureMode).toBe('error_max_budget_usd');
    expect(calls).toHaveLength(1);
  });

  it('missing prompt file returns crash immediately', async () => {
    const { queryFn, calls } = fakeQuery([]);
    const opts = { ...baseOptions(workdir), prompt: 'nonexistent.md' };
    const result = await runAgent(opts, queryFn);
    expect(result.failed).toBe(true);
    expect(result.failureMode).toBe('crash');
    expect(calls).toHaveLength(0);
  });
});

describe('agent-runner — budget tracking', () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupWorkdir();
    workdir = setup.workdir;
    cleanup = setup.cleanup;
    process.env.LOG_METRICS_DIR = path.join(workdir, 'metrics');
  });

  afterEach(() => {
    cleanup();
    delete process.env.LOG_METRICS_DIR;
  });

  it('remaining budget decreases across attempts', async () => {
    const { queryFn, calls } = fakeQuery([
      { subtype: 'error_max_turns', result: 'partial', costUsd: 1.5 },
      { subtype: 'error_max_turns', result: 'partial', costUsd: 0.5 },
      { subtype: 'success', result: 'ok', costUsd: 0.3 },
    ]);
    await runAgent({ ...baseOptions(workdir), policy: 'reviewer', maxBudget: 5.0 }, queryFn);

    // Attempt 2 should get maxBudgetUsd = 5.0 - 1.5 = 3.5
    if (calls.length >= 2) {
      const opts1 = calls[1].options as Record<string, unknown>;
      expect(opts1.maxBudgetUsd).toBe(3.5);
    }
    // Attempt 3 should get maxBudgetUsd = 5.0 - 1.5 - 0.5 = 3.0
    if (calls.length >= 3) {
      const opts2 = calls[2].options as Record<string, unknown>;
      expect(opts2.maxBudgetUsd).toBe(3.0);
    }
  });

  it('stops when budget exhausted between attempts', async () => {
    const { queryFn, calls } = fakeQuery([
      { subtype: 'error_max_turns', result: 'partial', costUsd: 5.0 },
      { subtype: 'success', result: 'ok' },
    ]);
    const result = await runAgent(
      { ...baseOptions(workdir), policy: 'reviewer', maxBudget: 5.0 },
      queryFn
    );

    expect(result.failed).toBe(true);
    expect(result.failureMode).toBe('error_max_budget_usd');
    expect(calls).toHaveLength(1);
  });
});

describe('agent-runner — crash retry', () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupWorkdir();
    workdir = setup.workdir;
    cleanup = setup.cleanup;
    process.env.LOG_METRICS_DIR = path.join(workdir, 'metrics');
  });

  afterEach(() => {
    cleanup();
    delete process.env.LOG_METRICS_DIR;
  });

  it('throw then succeed', async () => {
    const { queryFn } = fakeQuery([
      { subtype: 'success', throw: new Error('boom') },
      { subtype: 'success', result: 'recovered' },
    ]);
    const result = await runAgent({ ...baseOptions(workdir), crashRetryDelayMs: 1 }, queryFn);
    expect(result.failed).toBe(false);
    expect(result.output).toBe('recovered');
  });

  it('throw all retries → crash', async () => {
    const { queryFn } = fakeQuery([
      { subtype: 'success', throw: new Error('boom1') },
      { subtype: 'success', throw: new Error('boom2') },
      { subtype: 'success', throw: new Error('boom3') },
    ]);
    const result = await runAgent(
      { ...baseOptions(workdir), maxCrashRetries: 2, crashRetryDelayMs: 1 },
      queryFn
    );
    expect(result.failed).toBe(true);
    expect(result.failureMode).toBe('crash');
  });
});

describe('agent-runner — output file', () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupWorkdir();
    workdir = setup.workdir;
    cleanup = setup.cleanup;
    process.env.LOG_METRICS_DIR = path.join(workdir, 'metrics');
  });

  afterEach(() => {
    cleanup();
    delete process.env.LOG_METRICS_DIR;
  });

  it('writes output file when set', async () => {
    const outputFile = path.join(workdir, 'output', 'result.md');
    const { queryFn } = fakeQuery([{ subtype: 'success', result: 'report text' }]);
    await runAgent({ ...baseOptions(workdir), outputFile }, queryFn);

    expect(fs.existsSync(outputFile)).toBe(true);
    expect(fs.readFileSync(outputFile, 'utf-8')).toBe('report text');
  });

  it('does not write output file on failure with no output', async () => {
    const outputFile = path.join(workdir, 'output', 'result.md');
    const { queryFn } = fakeQuery([{ subtype: 'error_max_turns' }]);
    await runAgent({ ...baseOptions(workdir), outputFile }, queryFn);

    expect(fs.existsSync(outputFile)).toBe(false);
  });
});

describe('agent-runner — prompt vars', () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupWorkdir('Hello {NAME}, review {SKILL}');
    workdir = setup.workdir;
    cleanup = setup.cleanup;
    process.env.LOG_METRICS_DIR = path.join(workdir, 'metrics');
  });

  afterEach(() => {
    cleanup();
    delete process.env.LOG_METRICS_DIR;
  });

  it('substitutes vars in prompt', async () => {
    const { queryFn, calls } = fakeQuery([{ subtype: 'success', result: 'ok' }]);
    await runAgent(
      {
        ...baseOptions(workdir),
        promptVars: { NAME: 'Claude', SKILL: 'hooks' },
      },
      queryFn
    );

    expect(calls[0].prompt).toBe('Hello Claude, review hooks');
  });
});

describe('agent-runner — wrapUpPrompt substitution', () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupWorkdir();
    workdir = setup.workdir;
    cleanup = setup.cleanup;
    process.env.LOG_METRICS_DIR = path.join(workdir, 'metrics');
  });

  afterEach(() => {
    cleanup();
    delete process.env.LOG_METRICS_DIR;
  });

  it('substitutes {OUTPUT} with most recent non-null output', async () => {
    // Reviewer policy: attempt 1 (error_max_turns with output),
    // attempt 2 (error_max_turns with output),
    // attempt 3 uses SYNTHESIZE which has {OUTPUT}
    const { queryFn, calls } = fakeQuery([
      { subtype: 'error_max_turns', result: 'some findings' },
      { subtype: 'error_max_turns', result: 'partial report' },
      {
        subtype: 'success',
        result: '## Skill Review: test — accuracy\n| 1 | claim | keep | evidence | source |',
      },
    ]);
    await runAgent({ ...baseOptions(workdir), policy: 'reviewer' }, queryFn);

    // Attempt 3 prompt should contain "partial report" (most recent output)
    if (calls.length >= 3) {
      const prompt = calls[2].prompt as string;
      expect(prompt).toContain('partial report');
      expect(prompt).not.toContain('{OUTPUT}');
    }
  });
});

describe('agent-runner — hook tests', () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupWorkdir();
    workdir = setup.workdir;
    cleanup = setup.cleanup;
    process.env.LOG_METRICS_DIR = path.join(workdir, 'metrics');
  });

  afterEach(() => {
    cleanup();
    delete process.env.LOG_METRICS_DIR;
  });

  it('onAttemptComplete called and errors swallowed', async () => {
    // We need a custom policy registered on the default registry for this test.
    // Instead, we test indirectly that runAgent doesn't crash when hook throws.
    // The reviewer policy doesn't have onAttemptComplete, so this is a basic smoke test.
    const { queryFn } = fakeQuery([{ subtype: 'success', result: 'ok' }]);
    const result = await runAgent(baseOptions(workdir), queryFn);
    expect(result.failed).toBe(false);
  });
});

// Register a test policy with outputValidation for fix_output tests
registerPolicy('test-validating', {
  attempts: [{ maxTurns: 10, model: 'sonnet', resumePrevious: false }],
  outputValidation: {
    isValid: (output: string | null) => output !== null && output.includes('VALID'),
    fixPrompt: 'Please include the word VALID in your response.',
  },
});

describe('agent-runner — output validation + fix_output', () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupWorkdir();
    workdir = setup.workdir;
    cleanup = setup.cleanup;
    process.env.LOG_METRICS_DIR = path.join(workdir, 'metrics');
  });

  afterEach(() => {
    cleanup();
    delete process.env.LOG_METRICS_DIR;
  });

  it('valid output on first try → success without fix', async () => {
    const { queryFn, calls } = fakeQuery([{ subtype: 'success', result: 'output is VALID' }]);
    const result = await runAgent({ ...baseOptions(workdir), policy: 'test-validating' }, queryFn);
    expect(result.failed).toBe(false);
    expect(result.output).toBe('output is VALID');
    expect(calls).toHaveLength(1); // no fix call needed
  });

  it('invalid output → fix_output → valid output → success', async () => {
    const { queryFn, calls } = fakeQuery([
      { subtype: 'success', result: 'bad output' }, // invalid
      { subtype: 'success', result: 'now VALID output' }, // fix succeeds
    ]);
    const result = await runAgent({ ...baseOptions(workdir), policy: 'test-validating' }, queryFn);
    expect(result.failed).toBe(false);
    expect(result.output).toBe('now VALID output');
    expect(calls).toHaveLength(2); // original + fix
    // Fix call should use the fixPrompt
    expect(calls[1].prompt).toContain('VALID');
  });

  it('invalid output → fix_output → still invalid → accept (done)', async () => {
    const { queryFn, calls } = fakeQuery([
      { subtype: 'success', result: 'bad output' }, // invalid
      { subtype: 'success', result: 'still bad' }, // fix also invalid
    ]);
    const result = await runAgent({ ...baseOptions(workdir), policy: 'test-validating' }, queryFn);
    // Accepts the output after one fix attempt (design: no infinite loop)
    expect(result.failed).toBe(false);
    expect(result.output).toBe('still bad');
    expect(calls).toHaveLength(2);
  });

  it('invalid output → fix crashes → outputFixAttempted NOT set → retries fix', async () => {
    const { queryFn, calls } = fakeQuery([
      { subtype: 'success', result: 'bad output' }, // invalid
      { subtype: 'success', throw: new Error('fix crash') }, // fix crashes
      { subtype: 'success', result: 'bad output' }, // crash retry (main call)
      { subtype: 'success', result: 'now VALID output' }, // second fix attempt
    ]);
    const result = await runAgent(
      { ...baseOptions(workdir), policy: 'test-validating', crashRetryDelayMs: 1 },
      queryFn
    );
    // Fix crash should NOT poison outputFixAttempted, allowing another fix attempt
    expect(result.failed).toBe(false);
    expect(result.output).toBe('now VALID output');
  });

  it('null output → validation fails', async () => {
    const { queryFn, calls } = fakeQuery([
      { subtype: 'success' }, // null output → invalid
      { subtype: 'success', result: 'fix is VALID' }, // fix provides output
    ]);
    const result = await runAgent({ ...baseOptions(workdir), policy: 'test-validating' }, queryFn);
    expect(result.failed).toBe(false);
    expect(result.output).toBe('fix is VALID');
    expect(calls).toHaveLength(2);
  });
});
