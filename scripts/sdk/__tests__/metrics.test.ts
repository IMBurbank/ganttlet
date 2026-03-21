// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logMetrics } from '../metrics.js';
import type { AgentMetrics } from '../types.js';

function sampleMetrics(overrides: Partial<AgentMetrics> = {}): AgentMetrics {
  return {
    timestamp: '2026-03-21T10:00:00Z',
    phase: 'test-phase',
    group: 'test-group',
    duration_seconds: 42.5,
    retries: 0,
    exit_code: 0,
    status: 'success',
    attempt: 1,
    totalAttempts: 1,
    failureMode: 'success',
    resumeCount: 0,
    model: 'sonnet',
    sessionId: 'sess-1',
    policy: 'default',
    totalCostUsd: 0.5,
    ...overrides,
  };
}

describe('logMetrics', () => {
  let tmpDir: string;
  const origEnv = process.env.LOG_METRICS_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-test-'));
    process.env.LOG_METRICS_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origEnv !== undefined) {
      process.env.LOG_METRICS_DIR = origEnv;
    } else {
      delete process.env.LOG_METRICS_DIR;
    }
  });

  it('writes valid JSONL', () => {
    logMetrics(sampleMetrics());
    const filePath = path.join(tmpDir, 'agent-metrics.jsonl');
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.phase).toBe('test-phase');
  });

  it('contains backward-compatible fields', () => {
    logMetrics(sampleMetrics());
    const filePath = path.join(tmpDir, 'agent-metrics.jsonl');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8').trim());
    expect(parsed).toHaveProperty('timestamp');
    expect(parsed).toHaveProperty('phase');
    expect(parsed).toHaveProperty('group');
    expect(parsed).toHaveProperty('duration_seconds');
    expect(parsed).toHaveProperty('retries');
    expect(parsed).toHaveProperty('exit_code');
    expect(parsed).toHaveProperty('status');
  });

  it('contains new fields', () => {
    logMetrics(sampleMetrics());
    const filePath = path.join(tmpDir, 'agent-metrics.jsonl');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8').trim());
    expect(parsed).toHaveProperty('attempt');
    expect(parsed).toHaveProperty('totalAttempts');
    expect(parsed).toHaveProperty('failureMode');
    expect(parsed).toHaveProperty('resumeCount');
    expect(parsed).toHaveProperty('model');
    expect(parsed).toHaveProperty('sessionId');
    expect(parsed).toHaveProperty('policy');
    expect(parsed).toHaveProperty('totalCostUsd');
  });

  it('appends multiple entries', () => {
    logMetrics(sampleMetrics({ group: 'a' }));
    logMetrics(sampleMetrics({ group: 'b' }));
    const filePath = path.join(tmpDir, 'agent-metrics.jsonl');
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).group).toBe('a');
    expect(JSON.parse(lines[1]).group).toBe('b');
  });

  it('creates directory if missing', () => {
    const nested = path.join(tmpDir, 'nested', 'dir');
    process.env.LOG_METRICS_DIR = nested;
    logMetrics(sampleMetrics());
    expect(fs.existsSync(path.join(nested, 'agent-metrics.jsonl'))).toBe(true);
  });
});
