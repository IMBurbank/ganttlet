// @vitest-environment node
/**
 * Bash↔TypeScript boundary integration tests.
 *
 * These tests source agent.sh in a bash subshell with SDK_RUNNER=1 and a
 * mock `npx` function that captures the CLI args passed to the SDK runner.
 * This verifies the naming convention, prompt_vars array, and flag passthrough.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();

/**
 * Run agent.sh's run_agent() in a bash subshell with SDK_RUNNER=1.
 * npx is replaced with a function that writes all args to a capture file.
 * Returns the captured args as a string array.
 */
function runAgentCapture(group: string, env: Record<string, string> = {}): string[] {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-integ-'));
  const captureFile = path.join(tmpDir, 'captured-args.txt');
  const logDir = env.LOG_DIR ?? path.join(tmpDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  // Create a dummy prompt file for non-reviewer groups
  const promptsDir = path.join(tmpDir, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.writeFileSync(path.join(promptsDir, `${group}.md`), '# test prompt');

  // Create reviewer template
  const reviewerDir = path.join(tmpDir, 'docs', 'prompts', 'curation');
  fs.mkdirSync(reviewerDir, { recursive: true });
  fs.writeFileSync(path.join(reviewerDir, 'reviewer-template.md'), '# reviewer template');

  const workdir = tmpDir;
  const scriptFile = path.join(tmpDir, 'run-test.sh');

  const scriptLines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    '# Stubs for logging functions agent.sh depends on',
    'log() { :; }',
    'ok()  { :; }',
    'err() { :; }',
    'warn() { :; }',
    '',
    '# Mock npx to capture args',
    'npx() {',
    `  printf '%s\\n' "$@" > "${captureFile}"`,
    '  return 0',
    '}',
    'export -f npx',
    '',
    `source "${ROOT}/scripts/lib/agent.sh"`,
    '',
    'SDK_RUNNER=1',
    `PHASE="${env.PHASE ?? 'test-phase'}"`,
    'PROMPTS_DIR="prompts"',
    `LOG_DIR="${logDir}"`,
    'DEFAULT_MAX_TURNS=200',
    'DEFAULT_MAX_BUDGET=5',
    `MAX_RETRIES="${env.MAX_RETRIES ?? '3'}"`,
  ];

  if (env.MAX_TURNS) scriptLines.push(`MAX_TURNS="${env.MAX_TURNS}"`);
  if (env.MAX_BUDGET) scriptLines.push(`MAX_BUDGET="${env.MAX_BUDGET}"`);
  if (env.MODEL) scriptLines.push(`MODEL="${env.MODEL}"`);
  if (env.SDK_POLICY) scriptLines.push(`SDK_POLICY="${env.SDK_POLICY}"`);
  if (env.SDK_AGENT) scriptLines.push(`SDK_AGENT="${env.SDK_AGENT}"`);
  if (env.SDK_OUTPUT_FILE) scriptLines.push(`SDK_OUTPUT_FILE="${env.SDK_OUTPUT_FILE}"`);

  scriptLines.push('', `run_agent "${group}" "${workdir}"`);

  fs.writeFileSync(scriptFile, scriptLines.join('\n'), { mode: 0o755 });

  try {
    execSync(`bash "${scriptFile}"`, {
      encoding: 'utf-8',
      env: { ...process.env, PATH: process.env.PATH },
    });
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    if (!fs.existsSync(captureFile)) {
      throw new Error(`Mock npx was never called. Exit: ${err.status}, stderr: ${err.stderr}`);
    }
  }

  const raw = fs.readFileSync(captureFile, 'utf-8').trim();
  const args = raw.split('\n');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return args;
}

/** Extract a flag's value from an args array. */
function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

/** Extract all values for a repeatable flag. */
function getAllFlags(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[i + 1]);
    }
  }
  return values;
}

describe('bash↔TypeScript integration: run_agent with SDK_RUNNER=1', () => {
  it('reviewer naming convention: hooks-adversarial → correct CLI args', () => {
    const args = runAgentCapture('hooks-adversarial');

    expect(getFlag(args, '--group')).toBe('hooks-adversarial');
    expect(getFlag(args, '--policy')).toBe('reviewer');
    expect(getFlag(args, '--agent')).toBe('skill-reviewer');

    // Output file should contain reviews/<skill>/<angle>.md
    const outputFile = getFlag(args, '--output-file');
    expect(outputFile).toBeDefined();
    expect(outputFile).toMatch(/reviews\/hooks\/adversarial\.md$/);

    // Prompt vars should be SKILL=hooks and ANGLE=adversarial (not SKILL=hooks-adversarial)
    const promptVars = getAllFlags(args, '--prompt-var');
    expect(promptVars).toContain('SKILL=hooks');
    expect(promptVars).toContain('ANGLE=adversarial');

    // Prompt should point to reviewer template
    const prompt = getFlag(args, '--prompt');
    expect(prompt).toBe('docs/prompts/curation/reviewer-template.md');
  });

  it('reviewer naming convention: multi-word skill (google-sheets-sync-scope)', () => {
    const args = runAgentCapture('google-sheets-sync-scope');

    expect(getFlag(args, '--policy')).toBe('reviewer');
    expect(getFlag(args, '--agent')).toBe('skill-reviewer');

    const promptVars = getAllFlags(args, '--prompt-var');
    expect(promptVars).toContain('SKILL=google-sheets-sync');
    expect(promptVars).toContain('ANGLE=scope');

    const outputFile = getFlag(args, '--output-file');
    expect(outputFile).toMatch(/reviews\/google-sheets-sync\/scope\.md$/);
  });

  it('non-reviewer group: scheduling-engine → generic SKILL, no --agent', () => {
    const args = runAgentCapture('scheduling-engine');

    expect(getFlag(args, '--policy')).toBe('default');
    expect(args).not.toContain('--agent');
    expect(args).not.toContain('--output-file');

    const promptVars = getAllFlags(args, '--prompt-var');
    expect(promptVars).toContain('SKILL=scheduling-engine');
  });

  it('non-reviewer group: some-feature → generic prompt file', () => {
    const args = runAgentCapture('some-feature');

    const prompt = getFlag(args, '--prompt');
    expect(prompt).toBe('prompts/some-feature.md');
    expect(getFlag(args, '--policy')).toBe('default');
    expect(args).not.toContain('--agent');
  });

  it('prompt_file override from reviewer naming convention reaches --prompt', () => {
    const args = runAgentCapture('hooks-accuracy');
    const prompt = getFlag(args, '--prompt');
    expect(prompt).toBe('docs/prompts/curation/reviewer-template.md');
  });

  it('SDK_POLICY env var overrides reviewer default', () => {
    const args = runAgentCapture('hooks-adversarial', {
      SDK_POLICY: 'custom-policy',
    });
    expect(getFlag(args, '--policy')).toBe('custom-policy');
  });

  it('SDK_OUTPUT_FILE env var overrides naming convention default', () => {
    const args = runAgentCapture('hooks-adversarial', {
      SDK_OUTPUT_FILE: '/custom/output.md',
    });
    expect(getFlag(args, '--output-file')).toBe('/custom/output.md');
  });

  it('LOG_DIR env var is passed as prompt var', () => {
    const args = runAgentCapture('scheduling-engine', {
      LOG_DIR: '/tmp/test-override-logs',
    });
    const promptVars = getAllFlags(args, '--prompt-var');
    expect(promptVars).toContain('LOG_DIR=/tmp/test-override-logs');
  });

  it('passes --max-turns, --max-budget, --max-crash-retries from env', () => {
    const args = runAgentCapture('some-feature', {
      MAX_TURNS: '100',
      MAX_BUDGET: '15',
      MAX_RETRIES: '5',
    });
    expect(getFlag(args, '--max-turns')).toBe('100');
    expect(getFlag(args, '--max-budget')).toBe('15');
    expect(getFlag(args, '--max-crash-retries')).toBe('5');
  });

  it('passes --model when MODEL env is set', () => {
    const args = runAgentCapture('some-feature', {
      MODEL: 'claude-sonnet-4-6',
    });
    expect(getFlag(args, '--model')).toBe('claude-sonnet-4-6');
  });

  it('all review angles are detected', () => {
    const angles = ['accuracy', 'structure', 'scope', 'history', 'adversarial'];
    for (const angle of angles) {
      const args = runAgentCapture(`test-skill-${angle}`);
      expect(getFlag(args, '--policy')).toBe('reviewer');
      const promptVars = getAllFlags(args, '--prompt-var');
      expect(promptVars).toContain('SKILL=test-skill');
      expect(promptVars).toContain(`ANGLE=${angle}`);
    }
  });
});
