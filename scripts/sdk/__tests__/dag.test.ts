import { describe, it, expect } from 'vitest';
import { parseConfig } from '../dag.js';
import type { RawConfig } from '../dag.js';

// ── Helpers ──────────────────────────────────────────────────────────

function minimalConfig(overrides: Partial<RawConfig> = {}): RawConfig {
  return {
    phase: 'test',
    merge_target: 'feature/test',
    groups: [{ id: 'A', prompt: 'a.md' }],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('dag parser', () => {
  describe('minimal valid config', () => {
    it('parses phase and mergeTarget', () => {
      const result = parseConfig(minimalConfig());
      expect(result.phase).toBe('test');
      expect(result.mergeTarget).toBe('feature/test');
    });

    it('creates agent node for each group', () => {
      const result = parseConfig(minimalConfig());
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toMatchObject({ id: 'A', type: 'agent', dependsOn: [] });
    });

    it('attaches spec to agent node', () => {
      const result = parseConfig(minimalConfig());
      expect(result.nodes[0].spec).toMatchObject({ id: 'A', prompt: 'a.md' });
    });
  });

  describe('required field validation', () => {
    it('throws on missing phase', () => {
      expect(() => parseConfig({ ...minimalConfig(), phase: '' })).toThrow('phase');
    });

    it('throws on missing merge_target', () => {
      expect(() => parseConfig({ ...minimalConfig(), merge_target: '' })).toThrow('merge_target');
    });

    it('throws on group missing id', () => {
      expect(() => parseConfig(minimalConfig({ groups: [{ id: '', prompt: 'a.md' }] }))).toThrow(
        'id'
      );
    });

    it('throws on group missing prompt', () => {
      expect(() => parseConfig(minimalConfig({ groups: [{ id: 'A', prompt: '' }] }))).toThrow(
        'prompt'
      );
    });
  });

  describe('snake_case → camelCase conversion', () => {
    it('converts prompt_vars to promptVars', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [{ id: 'A', prompt: 'a.md', prompt_vars: { SKILL: 'x' } }],
        })
      );
      expect(result.groups[0].promptVars).toEqual({ SKILL: 'x' });
    });

    it('converts depends_on to dependsOn', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [
            { id: 'A', prompt: 'a.md' },
            { id: 'B', prompt: 'b.md', depends_on: ['A'] },
          ],
        })
      );
      expect(result.groups[1].dependsOn).toEqual(['A']);
    });

    it('converts merge_message to mergeMessage', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [{ id: 'A', prompt: 'a.md', merge_message: 'feat: test' }],
        })
      );
      expect(result.groups[0].mergeMessage).toBe('feat: test');
    });

    it('converts max_retries to maxRetries', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [{ id: 'A', prompt: 'a.md', max_retries: 5 }],
        })
      );
      expect(result.groups[0].maxRetries).toBe(5);
    });

    it('converts max_parallel at config level', () => {
      const result = parseConfig(minimalConfig({ max_parallel: 10 }));
      expect(result.maxParallel).toBe(10);
    });
  });

  describe('depends_on validation', () => {
    it('throws on reference to unknown group', () => {
      expect(() =>
        parseConfig(
          minimalConfig({
            groups: [{ id: 'A', prompt: 'a.md', depends_on: ['NONEXISTENT'] }],
          })
        )
      ).toThrow('unknown group "NONEXISTENT"');
    });

    it('accepts valid depends_on references', () => {
      expect(() =>
        parseConfig(
          minimalConfig({
            groups: [
              { id: 'A', prompt: 'a.md' },
              { id: 'B', prompt: 'b.md', depends_on: ['A'] },
            ],
          })
        )
      ).not.toThrow();
    });
  });

  describe('duplicate ID detection', () => {
    it('throws on duplicate group IDs', () => {
      expect(() =>
        parseConfig(
          minimalConfig({
            groups: [
              { id: 'A', prompt: 'a.md' },
              { id: 'A', prompt: 'b.md' },
            ],
          })
        )
      ).toThrow('Duplicate group ID: "A"');
    });
  });

  describe('cycle detection', () => {
    it('throws on direct cycle', () => {
      expect(() =>
        parseConfig(
          minimalConfig({
            groups: [
              { id: 'A', prompt: 'a.md', depends_on: ['B'] },
              { id: 'B', prompt: 'b.md', depends_on: ['A'] },
            ],
          })
        )
      ).toThrow('Cycle detected');
    });

    it('throws on indirect cycle', () => {
      expect(() =>
        parseConfig(
          minimalConfig({
            groups: [
              { id: 'A', prompt: 'a.md', depends_on: ['C'] },
              { id: 'B', prompt: 'b.md', depends_on: ['A'] },
              { id: 'C', prompt: 'c.md', depends_on: ['B'] },
            ],
          })
        )
      ).toThrow('Cycle detected');
    });

    it('accepts valid DAG', () => {
      expect(() =>
        parseConfig(
          minimalConfig({
            groups: [
              { id: 'A', prompt: 'a.md' },
              { id: 'B', prompt: 'b.md', depends_on: ['A'] },
              { id: 'C', prompt: 'c.md', depends_on: ['A'] },
              { id: 'D', prompt: 'd.md', depends_on: ['B', 'C'] },
            ],
          })
        )
      ).not.toThrow();
    });
  });

  describe('verify node auto-insertion', () => {
    it('inserts verify node for branched groups (default: full)', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [{ id: 'A', prompt: 'a.md', branch: 'feature/A' }],
        })
      );
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[1]).toMatchObject({
        id: 'verify:A',
        type: 'verify',
        dependsOn: ['A'],
        level: 'full',
        maxRetries: 3,
      });
    });

    it('does not insert verify node for unbranched groups', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [{ id: 'A', prompt: 'a.md' }],
        })
      );
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('A');
    });

    it('does not insert verify node when verify=none', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [{ id: 'A', prompt: 'a.md', branch: 'feature/A', verify: 'none' }],
        })
      );
      expect(result.nodes).toHaveLength(1);
    });

    it('inserts quick verify when verify=quick', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [{ id: 'A', prompt: 'a.md', branch: 'feature/A', verify: 'quick' }],
        })
      );
      expect(result.nodes[1]).toMatchObject({ level: 'quick' });
    });

    it('downstream depends on verify node, not agent node', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [
            { id: 'A', prompt: 'a.md', branch: 'feature/A' },
            { id: 'B', prompt: 'b.md', depends_on: ['A'] },
          ],
        })
      );
      const nodeB = result.nodes.find((n) => n.id === 'B')!;
      expect(nodeB.dependsOn).toEqual(['verify:A']);
    });

    it('downstream depends on agent directly when verify=none', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [
            { id: 'A', prompt: 'a.md', branch: 'feature/A', verify: 'none' },
            { id: 'B', prompt: 'b.md', depends_on: ['A'] },
          ],
        })
      );
      const nodeB = result.nodes.find((n) => n.id === 'B')!;
      expect(nodeB.dependsOn).toEqual(['A']);
    });

    it('propagates custom maxRetries to verify node', () => {
      const result = parseConfig(
        minimalConfig({
          groups: [{ id: 'A', prompt: 'a.md', branch: 'feature/A', max_retries: 5 }],
        })
      );
      expect(result.nodes.find((n) => n.id === 'verify:A')!.maxRetries).toBe(5);
    });
  });

  describe('stages desugar', () => {
    it('stage 2 groups depend on all stage 1 groups', () => {
      const result = parseConfig({
        phase: 'test',
        merge_target: 'feature/test',
        stages: [
          {
            name: 'Review',
            groups: [
              { id: 'A', prompt: 'a.md' },
              { id: 'B', prompt: 'b.md' },
            ],
          },
          { name: 'Curate', groups: [{ id: 'C', prompt: 'c.md' }] },
        ],
      });
      expect(result.groups.find((g) => g.id === 'C')!.dependsOn).toEqual(['A', 'B']);
    });

    it('3-stage chain: stage 3 depends on stage 2 only (transitive)', () => {
      const result = parseConfig({
        phase: 'test',
        merge_target: 'feature/test',
        stages: [
          { name: 'S1', groups: [{ id: 'A', prompt: 'a.md' }] },
          { name: 'S2', groups: [{ id: 'B', prompt: 'b.md' }] },
          { name: 'S3', groups: [{ id: 'C', prompt: 'c.md' }] },
        ],
      });
      expect(result.groups.find((g) => g.id === 'B')!.dependsOn).toEqual(['A']);
      expect(result.groups.find((g) => g.id === 'C')!.dependsOn).toEqual(['B']);
    });

    it('unions explicit depends_on with stage deps', () => {
      const result = parseConfig({
        phase: 'test',
        merge_target: 'feature/test',
        stages: [
          {
            name: 'S1',
            groups: [
              { id: 'A', prompt: 'a.md' },
              { id: 'B', prompt: 'b.md' },
            ],
          },
          {
            name: 'S2',
            groups: [{ id: 'C', prompt: 'c.md', depends_on: ['A'] }],
          },
        ],
      });
      // C already had depends_on: [A], plus stage adds [A, B] → union is [A, B] (A deduplicated)
      expect(result.groups.find((g) => g.id === 'C')!.dependsOn).toEqual(['A', 'B']);
    });

    it('throws if both stages and groups are provided', () => {
      expect(() =>
        parseConfig({
          phase: 'test',
          merge_target: 'feature/test',
          groups: [{ id: 'A', prompt: 'a.md' }],
          stages: [{ name: 'S1', groups: [{ id: 'B', prompt: 'b.md' }] }],
        })
      ).toThrow('both "stages" and "groups"');
    });
  });

  describe('group templates', () => {
    it('expands template into individual groups', () => {
      const result = parseConfig({
        phase: 'test',
        merge_target: 'feature/test',
        groups: [],
        group_templates: [
          {
            template: 'reviewer',
            prompt: 'reviewer.md',
            policy: 'reviewer',
            agent: 'skill-reviewer',
            id_pattern: '{SKILL}-{ANGLE}',
            output_pattern: 'reviews/{SKILL}/{ANGLE}.md',
            expand: [
              { SKILL: 'sched', ANGLE: 'accuracy' },
              { SKILL: 'sched', ANGLE: 'structure' },
            ],
          },
        ],
      });
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].id).toBe('sched-accuracy');
      expect(result.groups[0].output).toBe('reviews/sched/accuracy.md');
      expect(result.groups[0].promptVars).toEqual({ SKILL: 'sched', ANGLE: 'accuracy' });
      expect(result.groups[1].id).toBe('sched-structure');
    });

    it('templates combined with stages', () => {
      const result = parseConfig({
        phase: 'test',
        merge_target: 'feature/test',
        group_templates: [
          {
            template: 'reviewer',
            prompt: 'r.md',
            id_pattern: '{X}',
            expand: [{ X: 'R1' }, { X: 'R2' }],
          },
        ],
        stages: [{ name: 'Curate', groups: [{ id: 'C', prompt: 'c.md' }] }],
      });
      // Templates are added first, then stages. Stage 1 (Curate) has no previous stage.
      // Templates have no stage — they're flat groups added before stages.
      expect(result.groups.map((g) => g.id)).toEqual(['R1', 'R2', 'C']);
    });

    it('throws on duplicate IDs from template expansion', () => {
      expect(() =>
        parseConfig({
          phase: 'test',
          merge_target: 'feature/test',
          groups: [],
          group_templates: [
            {
              template: 'dup',
              prompt: 'x.md',
              id_pattern: 'same',
              expand: [{ X: '1' }, { X: '2' }],
            },
          ],
        })
      ).toThrow('Duplicate group ID: "same"');
    });

    it('throws on empty expand list', () => {
      expect(() =>
        parseConfig({
          phase: 'test',
          merge_target: 'feature/test',
          groups: [],
          group_templates: [{ template: 'empty', prompt: 'x.md', id_pattern: '{X}', expand: [] }],
        })
      ).toThrow('empty expand');
    });
  });

  describe('full DAG with depends_on', () => {
    it('builds correct node graph for phase19 config', () => {
      const result = parseConfig({
        phase: 'phase19',
        merge_target: 'feature/phase19',
        groups: [
          { id: 'A', prompt: 'a.md', branch: 'feature/A' },
          { id: 'B', prompt: 'b.md', branch: 'feature/B' },
          { id: 'D', prompt: 'd.md', branch: 'feature/D', depends_on: ['A', 'B'] },
        ],
      });

      // A + verify:A + B + verify:B + D + verify:D = 6 nodes
      expect(result.nodes).toHaveLength(6);

      // D depends on verify:A and verify:B (not A and B directly)
      const nodeD = result.nodes.find((n) => n.id === 'D')!;
      expect(nodeD.dependsOn.sort()).toEqual(['verify:A', 'verify:B']);
    });
  });

  describe('maxRetries propagation', () => {
    it('agent node gets maxRetries from GroupSpec', () => {
      const result = parseConfig(
        minimalConfig({ groups: [{ id: 'A', prompt: 'a.md', max_retries: 5 }] })
      );
      expect(result.nodes[0].maxRetries).toBe(5);
    });

    it('agent node has undefined maxRetries when not specified', () => {
      const result = parseConfig(minimalConfig());
      expect(result.nodes[0].maxRetries).toBeUndefined();
    });

    it('verify node defaults to maxRetries=3 when not specified', () => {
      const result = parseConfig(
        minimalConfig({ groups: [{ id: 'A', prompt: 'a.md', branch: 'feature/A' }] })
      );
      expect(result.nodes.find((n) => n.id === 'verify:A')!.maxRetries).toBe(3);
    });
  });
});
