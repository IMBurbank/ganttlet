import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createFileLogObserver } from '../observers/file-log.js';
import { createStdoutObserver } from '../observers/stdout.js';
import { createCompositeObserver, type Observer } from '../observers/types.js';
import type { DAGNode, RunIdentity, NodeState, PipelineState } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function mockRun(): RunIdentity {
  return {
    phase: 'test',
    baseRef: 'abc',
    suffix: '12345678',
    mergeTarget: 'feature/test',
    logDir: '/tmp/logs',
    launchDir: '/tmp/launch',
    configPath: 'config.yaml',
  };
}

function mockNodeState(overrides: Partial<NodeState> = {}): NodeState {
  return { status: 'success', attempt: 1, maxRetries: 1, costUsd: 2.5, turns: 10, ...overrides };
}

function mockPipelineState(): PipelineState {
  return {
    run: mockRun(),
    nodes: {
      A: mockNodeState(),
      B: mockNodeState({ status: 'failure', failureReason: 'timeout', costUsd: 1.0, turns: 5 }),
    },
    status: 'partial',
    createdAt: '',
    updatedAt: '',
  };
}

// ── FileLogObserver ─────────────────────────────────────────────────

describe('FileLogObserver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync('/tmp/obs-test-');
  });
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates log directory on pipeline start', () => {
    const logDir = path.join(tmpDir, 'logs');
    const obs = createFileLogObserver(logDir);
    obs.onPipelineStart(mockRun());
    expect(fs.existsSync(logDir)).toBe(true);
  });

  it('writes pipeline.log with timestamped entries', () => {
    const obs = createFileLogObserver(tmpDir);
    obs.onPipelineStart(mockRun());
    const log = fs.readFileSync(path.join(tmpDir, 'pipeline.log'), 'utf-8');
    expect(log).toContain('Pipeline started');
    expect(log).toContain('phase=test');
  });

  it('writes agent events to node-specific log files', () => {
    const obs = createFileLogObserver(tmpDir);
    obs.onAgentEvent('mynode', { type: 'turn', turn: 1 });
    obs.onAgentEvent('mynode', { type: 'tool', name: 'Read', path: '/foo.ts' });
    obs.onAgentEvent('mynode', { type: 'text', content: 'hello world' });
    obs.onAgentEvent('mynode', { type: 'result', status: 'success', turns: 5, costUsd: 1.5 });

    const log = fs.readFileSync(path.join(tmpDir, 'mynode.log'), 'utf-8');
    expect(log).toContain('[turn 1]');
    expect(log).toContain('[tool] Read /foo.ts');
    expect(log).toContain('[text] hello world');
    expect(log).toContain('[result] success turns=5 cost=$1.50');
  });

  it('logs node completion to pipeline.log', () => {
    const obs = createFileLogObserver(tmpDir);
    obs.onNodeComplete('A', mockNodeState());
    const log = fs.readFileSync(path.join(tmpDir, 'pipeline.log'), 'utf-8');
    expect(log).toContain('Node complete: A');
    expect(log).toContain('status=success');
  });

  it('logs merge results', () => {
    const obs = createFileLogObserver(tmpDir);
    obs.onMerge('B', 'feature/test', 'merged');
    const log = fs.readFileSync(path.join(tmpDir, 'pipeline.log'), 'utf-8');
    expect(log).toContain('Merge: feature/test → merged');
  });

  it('logs pipeline completion summary', () => {
    const obs = createFileLogObserver(tmpDir);
    obs.onPipelineComplete(mockPipelineState());
    const log = fs.readFileSync(path.join(tmpDir, 'pipeline.log'), 'utf-8');
    expect(log).toContain('partial');
    expect(log).toContain('1 success');
    expect(log).toContain('1 failed');
  });
});

// ── StdoutObserver ──────────────────────────────────────────────────

describe('StdoutObserver', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('writes pipeline start', () => {
    const obs = createStdoutObserver();
    obs.onPipelineStart(mockRun());
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('started phase=test'));
  });

  it('writes node completion with details', () => {
    const obs = createStdoutObserver();
    obs.onNodeComplete('A', mockNodeState({ status: 'failure', failureReason: 'timeout' }));
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('node:failure');
    expect(output).toContain('reason=timeout');
  });

  it('writes pipeline summary', () => {
    const obs = createStdoutObserver();
    obs.onPipelineComplete(mockPipelineState());
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('partial');
    expect(output).toContain('1/2 success');
  });

  it('suppresses agent events (too verbose for CI)', () => {
    const obs = createStdoutObserver();
    obs.onAgentEvent('A', { type: 'turn', turn: 1 });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

// ── CompositeObserver ───────────────────────────────────────────────

describe('CompositeObserver', () => {
  it('dispatches to all observers', () => {
    const obs1: Observer = {
      onPipelineStart: vi.fn(),
      onNodeStart: vi.fn(),
      onAgentEvent: vi.fn(),
      onNodeComplete: vi.fn(),
      onMerge: vi.fn(),
      onVerify: vi.fn(),
      onPipelineComplete: vi.fn(),
      onStall: vi.fn(),
    };
    const obs2: Observer = {
      onPipelineStart: vi.fn(),
      onNodeStart: vi.fn(),
      onAgentEvent: vi.fn(),
      onNodeComplete: vi.fn(),
      onMerge: vi.fn(),
      onVerify: vi.fn(),
      onPipelineComplete: vi.fn(),
      onStall: vi.fn(),
    };

    const composite = createCompositeObserver([obs1, obs2]);
    const run = mockRun();
    composite.onPipelineStart(run);

    expect(obs1.onPipelineStart).toHaveBeenCalledWith(run);
    expect(obs2.onPipelineStart).toHaveBeenCalledWith(run);
  });

  it('dispatches node events to all', () => {
    const obs1: Observer = {
      onPipelineStart: vi.fn(),
      onNodeStart: vi.fn(),
      onAgentEvent: vi.fn(),
      onNodeComplete: vi.fn(),
      onMerge: vi.fn(),
      onVerify: vi.fn(),
      onPipelineComplete: vi.fn(),
      onStall: vi.fn(),
    };
    const obs2: Observer = {
      onPipelineStart: vi.fn(),
      onNodeStart: vi.fn(),
      onAgentEvent: vi.fn(),
      onNodeComplete: vi.fn(),
      onMerge: vi.fn(),
      onVerify: vi.fn(),
      onPipelineComplete: vi.fn(),
      onStall: vi.fn(),
    };

    const composite = createCompositeObserver([obs1, obs2]);
    const node: DAGNode = { id: 'A', type: 'agent', dependsOn: [] };
    composite.onNodeStart('A', node);

    expect(obs1.onNodeStart).toHaveBeenCalledWith('A', node);
    expect(obs2.onNodeStart).toHaveBeenCalledWith('A', node);
  });
});
