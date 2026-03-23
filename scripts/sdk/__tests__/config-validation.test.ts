/**
 * Validates that real project YAML configs parse correctly with the new DAG parser.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseConfig, type RawConfig } from '../dag.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('real config validation', () => {
  it('parses skill-curation-dag.yaml correctly', () => {
    const configPath = path.join(REPO_ROOT, 'docs/prompts/curation/skill-curation-dag.yaml');
    if (!fs.existsSync(configPath)) {
      console.log('Skipping: config file not found (may be on different branch)');
      return;
    }

    const raw = parseYaml(fs.readFileSync(configPath, 'utf-8')) as RawConfig;
    const config = parseConfig(raw);

    // 40 reviewer templates + 8 curators = 48 groups
    expect(config.groups).toHaveLength(48);

    // 40 reviewers (no branch, no verify) + 8 curators + 8 verify:curator = 56 nodes
    expect(config.nodes).toHaveLength(56);

    // All reviewer nodes are agents with no branch
    const reviewers = config.nodes.filter(
      (n) =>
        n.id.includes('-accuracy') ||
        n.id.includes('-structure') ||
        n.id.includes('-scope') ||
        n.id.includes('-history') ||
        n.id.includes('-adversarial')
    );
    expect(reviewers).toHaveLength(40);
    for (const r of reviewers) {
      expect(r.type).toBe('agent');
      expect(r.spec?.branch).toBeUndefined();
      expect(r.dependsOn).toEqual([]);
    }

    // All curator nodes depend on their 5 reviewer nodes
    const schedCurator = config.nodes.find((n) => n.id === 'scheduling-engine')!;
    expect(schedCurator.dependsOn.sort()).toEqual([
      'scheduling-engine-accuracy',
      'scheduling-engine-adversarial',
      'scheduling-engine-history',
      'scheduling-engine-scope',
      'scheduling-engine-structure',
    ]);

    // Curator has branch → verify node exists
    expect(config.nodes.find((n) => n.id === 'verify:scheduling-engine')).toBeDefined();

    // Phase and merge target
    expect(config.phase).toBe('skill-curation');
    expect(config.mergeTarget).toBe('curation/run');
  });
});
