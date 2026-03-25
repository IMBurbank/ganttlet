import type { DAGNode, GroupSpec } from './types.js';

// ── Raw config types (YAML-parsed, snake_case) ──────────────────────

export interface RawGroupSpec {
  id: string;
  prompt: string;
  prompt_vars?: Record<string, string>;
  policy?: string;
  agent?: string;
  branch?: string;
  merge_message?: string;
  output?: string;
  verify?: 'full' | 'quick' | 'none';
  max_retries?: number;
  depends_on?: string[];
}

export interface RawStage {
  name: string;
  groups: RawGroupSpec[];
}

export interface RawGroupTemplate {
  template: string;
  prompt: string;
  policy?: string;
  agent?: string;
  branch?: string;
  merge_message?: string;
  output_pattern?: string;
  verify?: 'full' | 'quick' | 'none';
  max_retries?: number;
  depends_on?: string[];
  id_pattern: string;
  expand: Record<string, string>[];
}

export interface RawConfig {
  phase: string;
  merge_target: string;
  max_parallel?: number;
  groups?: RawGroupSpec[];
  stages?: RawStage[];
  group_templates?: RawGroupTemplate[];
}

// ── Parsed config output ────────────────────────────────────────────

export interface ParsedConfig {
  phase: string;
  mergeTarget: string;
  maxParallel?: number;
  groups: GroupSpec[];
  nodes: DAGNode[];
}

// ── Parser ──────────────────────────────────────────────────────────

export function parseConfig(raw: RawConfig): ParsedConfig {
  if (!raw.phase) throw new Error('Config missing required field: phase');
  if (!raw.merge_target) throw new Error('Config missing required field: merge_target');

  let groups: GroupSpec[] = [];

  // 1. Expand group_templates
  if (raw.group_templates) {
    for (const tmpl of raw.group_templates) {
      groups.push(...expandTemplate(tmpl));
    }
  }

  // 2. Desugar stages OR use flat groups
  if (raw.stages && raw.groups) {
    throw new Error('Config cannot have both "stages" and "groups" at top level');
  }

  if (raw.stages) {
    groups.push(...desugarStages(raw.stages));
  } else if (raw.groups) {
    groups.push(...raw.groups.map(convertGroup));
  }

  // 3. Validate
  validateUniqueIds(groups);
  validateDependsOnRefs(groups);

  // 4. Build DAG nodes (auto-insert verify nodes)
  const nodes = buildDAGNodes(groups);

  // 5. Detect cycles
  detectCycles(nodes);

  return {
    phase: raw.phase,
    mergeTarget: raw.merge_target,
    maxParallel: raw.max_parallel,
    groups,
    nodes,
  };
}

// ── Internal helpers ────────────────────────────────────────────────

function convertGroup(raw: RawGroupSpec): GroupSpec {
  if (!raw.id) throw new Error('Group missing required field: id');
  if (!raw.prompt) throw new Error(`Group "${raw.id}" missing required field: prompt`);
  return {
    id: raw.id,
    prompt: raw.prompt,
    promptVars: raw.prompt_vars,
    policy: raw.policy,
    agent: raw.agent,
    branch: raw.branch,
    mergeMessage: raw.merge_message,
    output: raw.output,
    verify: raw.verify,
    maxRetries: raw.max_retries,
    dependsOn: raw.depends_on,
  };
}

function expandTemplate(tmpl: RawGroupTemplate): GroupSpec[] {
  if (!tmpl.id_pattern) throw new Error(`Template "${tmpl.template}" missing id_pattern`);
  if (!tmpl.expand || tmpl.expand.length === 0) {
    throw new Error(`Template "${tmpl.template}" has empty expand list`);
  }

  return tmpl.expand.map((vars) => {
    const id = substitutePattern(tmpl.id_pattern, vars);
    const output = tmpl.output_pattern ? substitutePattern(tmpl.output_pattern, vars) : undefined;
    return {
      id,
      prompt: tmpl.prompt,
      promptVars: { ...vars },
      policy: tmpl.policy,
      agent: tmpl.agent,
      branch: tmpl.branch,
      mergeMessage: tmpl.merge_message,
      output,
      verify: tmpl.verify,
      maxRetries: tmpl.max_retries,
      dependsOn: tmpl.depends_on,
    };
  });
}

function substitutePattern(pattern: string, vars: Record<string, string>): string {
  let result = pattern;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}

function desugarStages(stages: RawStage[]): GroupSpec[] {
  const allGroups: GroupSpec[] = [];
  let prevStageIds: string[] = [];

  for (const stage of stages) {
    const stageGroups: GroupSpec[] = [];
    for (const raw of stage.groups) {
      const group = convertGroup(raw);
      // Union: explicit depends_on + all groups from previous stage
      if (prevStageIds.length > 0) {
        const explicit = group.dependsOn ?? [];
        const combined = [...explicit, ...prevStageIds.filter((id) => !explicit.includes(id))];
        group.dependsOn = combined;
      }
      stageGroups.push(group);
    }
    allGroups.push(...stageGroups);
    prevStageIds = stageGroups.map((g) => g.id);
  }

  return allGroups;
}

function validateUniqueIds(groups: GroupSpec[]): void {
  const seen = new Set<string>();
  for (const g of groups) {
    if (seen.has(g.id)) {
      throw new Error(`Duplicate group ID: "${g.id}"`);
    }
    seen.add(g.id);
  }
}

function validateDependsOnRefs(groups: GroupSpec[]): void {
  const ids = new Set(groups.map((g) => g.id));
  for (const g of groups) {
    for (const dep of g.dependsOn ?? []) {
      if (!ids.has(dep)) {
        throw new Error(`Group "${g.id}" depends on unknown group "${dep}"`);
      }
    }
  }
}

function buildDAGNodes(groups: GroupSpec[]): DAGNode[] {
  const nodes: DAGNode[] = [];
  // Map from original group ID → the node ID that downstream should depend on
  // (either the group itself, or its verify node if verify is enabled)
  const effectiveNodeId = new Map<string, string>();

  for (const group of groups) {
    const verifyLevel = group.verify ?? (group.branch ? 'full' : 'none');

    // Agent node — dependsOn references resolved through effectiveNodeId
    const agentDeps = (group.dependsOn ?? []).map((dep) => effectiveNodeId.get(dep) ?? dep);
    const agentNode: DAGNode = {
      id: group.id,
      type: 'agent',
      dependsOn: agentDeps,
      spec: group,
      maxRetries: group.maxRetries,
    };
    nodes.push(agentNode);

    if (verifyLevel !== 'none') {
      const verifyId = `verify:${group.id}`;
      const verifyNode: DAGNode = {
        id: verifyId,
        type: 'verify',
        dependsOn: [group.id],
        level: verifyLevel as 'full' | 'quick',
        maxRetries: group.maxRetries ?? 3,
      };
      nodes.push(verifyNode);
      effectiveNodeId.set(group.id, verifyId);
    } else {
      effectiveNodeId.set(group.id, group.id);
    }
  }

  return nodes;
}

function detectCycles(nodes: DAGNode[]): void {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string, path: string[]): void {
    if (inStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      const cycle = [...path.slice(cycleStart), nodeId].join(' → ');
      throw new Error(`Cycle detected in dependency graph: ${cycle}`);
    }
    if (visited.has(nodeId)) return;

    inStack.add(nodeId);
    path.push(nodeId);

    const node = nodeMap.get(nodeId);
    if (node) {
      for (const dep of node.dependsOn) {
        dfs(dep, path);
      }
    }

    path.pop();
    inStack.delete(nodeId);
    visited.add(nodeId);
  }

  for (const node of nodes) {
    dfs(node.id, []);
  }
}
