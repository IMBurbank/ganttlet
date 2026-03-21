// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../agent-runner.js';

const requiredArgs = [
  '--group',
  'test-group',
  '--workdir',
  '/tmp/work',
  '--prompt',
  'prompt.md',
  '--log',
  '/tmp/log.txt',
  '--phase',
  'test-phase',
];

describe('parseCliArgs', () => {
  it('parses all required flags', () => {
    const opts = parseCliArgs(requiredArgs);
    expect(opts.group).toBe('test-group');
    expect(opts.workdir).toBe('/tmp/work');
    expect(opts.prompt).toBe('prompt.md');
    expect(opts.logFile).toBe('/tmp/log.txt');
    expect(opts.phase).toBe('test-phase');
  });

  it('missing required flag throws with usage', () => {
    expect(() => parseCliArgs(['--group', 'test'])).toThrow('Missing required flag');
    expect(() => parseCliArgs(['--group', 'test'])).toThrow('--workdir');
  });

  it('missing --group throws', () => {
    const args = requiredArgs.filter((a) => a !== '--group' && a !== 'test-group');
    expect(() => parseCliArgs(args)).toThrow('--group');
  });

  it('unknown flag throws', () => {
    expect(() => parseCliArgs([...requiredArgs, '--unknown', 'val'])).toThrow(
      'Unknown flag: --unknown'
    );
  });

  it('--prompt-var KEY=VALUE accumulates', () => {
    const opts = parseCliArgs([
      ...requiredArgs,
      '--prompt-var',
      'SKILL=hooks',
      '--prompt-var',
      'ANGLE=accuracy',
    ]);
    expect(opts.promptVars).toEqual({ SKILL: 'hooks', ANGLE: 'accuracy' });
  });

  it('--prompt-var with = in value splits on first =', () => {
    const opts = parseCliArgs([...requiredArgs, '--prompt-var', 'FOO=bar=baz']);
    expect(opts.promptVars).toEqual({ FOO: 'bar=baz' });
  });

  it('--max-turns parsed as number', () => {
    const opts = parseCliArgs([...requiredArgs, '--max-turns', '50']);
    expect(opts.maxTurns).toBe(50);
  });

  it('--max-budget parsed as number', () => {
    const opts = parseCliArgs([...requiredArgs, '--max-budget', '5.5']);
    expect(opts.maxBudget).toBe(5.5);
  });

  it('--max-crash-retries parsed as number', () => {
    const opts = parseCliArgs([...requiredArgs, '--max-crash-retries', '3']);
    expect(opts.maxCrashRetries).toBe(3);
  });

  it('--crash-retry-delay parsed as number', () => {
    const opts = parseCliArgs([...requiredArgs, '--crash-retry-delay', '2000']);
    expect(opts.crashRetryDelayMs).toBe(2000);
  });

  it('NaN number throws', () => {
    expect(() => parseCliArgs([...requiredArgs, '--max-turns', 'abc'])).toThrow('must be a number');
  });

  it('--policy defaults to "default"', () => {
    const opts = parseCliArgs(requiredArgs);
    expect(opts.policy).toBe('default');
  });

  it('--policy can be overridden', () => {
    const opts = parseCliArgs([...requiredArgs, '--policy', 'reviewer']);
    expect(opts.policy).toBe('reviewer');
  });

  it('--agent optional, undefined when not provided', () => {
    const opts = parseCliArgs(requiredArgs);
    expect(opts.agent).toBeUndefined();
  });

  it('--agent set when provided', () => {
    const opts = parseCliArgs([...requiredArgs, '--agent', 'skill-reviewer']);
    expect(opts.agent).toBe('skill-reviewer');
  });

  it('all flags present returns full RunnerOptions', () => {
    const opts = parseCliArgs([
      ...requiredArgs,
      '--policy',
      'reviewer',
      '--max-turns',
      '50',
      '--max-budget',
      '10',
      '--model',
      'opus',
      '--max-crash-retries',
      '3',
      '--crash-retry-delay',
      '2000',
      '--output-file',
      '/tmp/out.md',
      '--agent',
      'skill-reviewer',
      '--prompt-var',
      'SKILL=hooks',
    ]);
    expect(opts).toEqual({
      group: 'test-group',
      phase: 'test-phase',
      workdir: '/tmp/work',
      prompt: 'prompt.md',
      logFile: '/tmp/log.txt',
      policy: 'reviewer',
      maxTurns: 50,
      maxBudget: 10,
      model: 'opus',
      maxCrashRetries: 3,
      crashRetryDelayMs: 2000,
      outputFile: '/tmp/out.md',
      agent: 'skill-reviewer',
      promptVars: { SKILL: 'hooks' },
    });
  });
});
