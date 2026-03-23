/**
 * CLI entry point for the DAG-based pipeline runner.
 *
 * Usage:
 *   npx tsx scripts/sdk/cli.ts config.yaml [options]
 *
 * Options:
 *   --resume            Retry from existing state file
 *   --max-parallel N    Max concurrent agents (default: 5)
 *   --ci                Add stdout observer (CI mode)
 *   --only a,b          Run subset + transitive deps
 *   --base-ref REF      Override base ref for run identity
 *   --help              Show usage
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseConfig, type RawConfig } from './dag.js';
import { createGitOps, findMainRepoRoot } from './git-ops.js';
import {
  createMergeHandler,
  createVerifyHandler,
  toRunnerOptions,
  type Handlers,
  type FixAgentFn,
} from './handlers.js';
import { runPipeline, deriveRunIdentity } from './pipeline-runner.js';
import { runAgentWithInlinePrompt, runAgent, type QueryFn } from './agent-runner.js';
import { createFileLogObserver } from './observers/file-log.js';
import { createStdoutObserver } from './observers/stdout.js';
import type { Observer } from './observers/types.js';
import type { AgentEventCallback, DAGNode, GroupSpec, NodeResult, RunIdentity } from './types.js';

// ── CLI argument parsing ────────────────────────────────────────────

interface CliArgs {
  configPath: string;
  resume: boolean;
  maxParallel: number;
  ci: boolean;
  only?: string[];
  baseRef?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const configPath = args[0];
  if (configPath.startsWith('--')) {
    process.stderr.write(`Error: first argument must be config file path, got: ${configPath}\n`);
    process.exit(1);
  }

  let resume = false;
  let maxParallel = 5;
  let ci = false;
  let only: string[] | undefined;
  let baseRef: string | undefined;

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--resume':
        resume = true;
        break;
      case '--max-parallel':
        maxParallel = parseInt(args[++i], 10);
        if (isNaN(maxParallel) || maxParallel < 1) {
          process.stderr.write('Error: --max-parallel must be a positive integer\n');
          process.exit(1);
        }
        break;
      case '--ci':
        ci = true;
        break;
      case '--only':
        only = args[++i]?.split(',').map((s) => s.trim());
        break;
      case '--base-ref':
        baseRef = args[++i];
        break;
      default:
        process.stderr.write(`Unknown flag: ${args[i]}\n`);
        process.exit(1);
    }
  }

  return { configPath, resume, maxParallel, ci, only, baseRef };
}

function printUsage(): void {
  process.stdout.write(`DAG Pipeline Runner

Usage: npx tsx scripts/sdk/cli.ts <config.yaml> [options]

Options:
  --resume            Retry from existing pipeline-state.json
  --max-parallel N    Max concurrent agents (default: 5)
  --ci                Add stdout observer for CI output
  --only a,b          Run subset of nodes + transitive deps
  --base-ref REF      Override git ref for run identity
  --help              Show this message
`);
}

// ── Transitive dependency filter ────────────────────────────────────

function filterTransitiveDeps(nodes: DAGNode[], ids: string[]): DAGNode[] {
  const needed = new Set<string>();
  function collect(id: string): void {
    if (needed.has(id)) return;
    needed.add(id);
    const node = nodes.find((n) => n.id === id);
    if (node) {
      for (const dep of node.dependsOn) collect(dep);
    }
  }
  for (const id of ids) collect(id);
  return nodes.filter((n) => needed.has(n.id));
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cliArgs = parseArgs(process.argv);

  // Load and parse config
  const configAbsPath = path.resolve(cliArgs.configPath);
  if (!fs.existsSync(configAbsPath)) {
    process.stderr.write(`Error: config file not found: ${configAbsPath}\n`);
    process.exit(1);
  }
  const rawYaml = fs.readFileSync(configAbsPath, 'utf-8');
  const rawConfig = parseYaml(rawYaml) as RawConfig;
  const config = parseConfig(rawConfig);

  // Derive run identity
  const run = deriveRunIdentity(configAbsPath, config.phase, config.mergeTarget, cliArgs.baseRef);

  // Filter nodes if --only
  let nodes = config.nodes;
  if (cliArgs.only) {
    nodes = filterTransitiveDeps(nodes, cliArgs.only);
  }

  // Set up GitOps
  const mainRepoRoot = findMainRepoRoot();
  const gitOps = createGitOps({
    worktreeBase: path.join(mainRepoRoot, '.claude', 'worktrees'),
    mainRepoRoot,
    logDir: run.logDir,
  });

  // Set up SDK query function
  await import('./policies/default.js');
  await import('./policies/reviewer.js');
  await import('./policies/curator.js');
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const queryFn: QueryFn = sdk.query;

  // Build fix agent function (narrow seam for handlers)
  const fixAgent: FixAgentFn = async (prompt, workdir, logFile, onEvent, model) => {
    const result = await runAgentWithInlinePrompt(
      queryFn,
      {
        group: 'fix-agent',
        phase: run.phase,
        workdir,
        prompt: '__inline__',
        logFile,
        policy: 'default',
        model,
      },
      prompt,
      onEvent
    );
    return { failed: result.failed };
  };

  // Build handlers
  const handlers: Handlers = {
    agent: async (
      spec: GroupSpec,
      r: RunIdentity,
      workdir: string,
      onEvent: AgentEventCallback
    ): Promise<NodeResult> => {
      const opts = toRunnerOptions(spec, r, workdir);
      const result = await runAgent(opts, queryFn);
      // Fire a result event for the observer
      onEvent({
        type: 'result',
        status: result.failureMode,
        turns: result.attempt,
        costUsd: result.totalCostUsd,
      });
      return {
        status: result.failed ? 'failure' : 'success',
        failureReason: result.failed
          ? result.failureMode === 'error_max_turns'
            ? 'timeout'
            : result.failureMode === 'error_max_budget_usd'
              ? 'budget'
              : 'agent'
          : undefined,
        sessionId: result.sessionId ?? undefined,
        costUsd: result.totalCostUsd,
        turns: result.attempt,
      };
    },
    merge: createMergeHandler(gitOps, fixAgent, run.logDir),
    verify: createVerifyHandler(gitOps, fixAgent, run.logDir),
  };

  // Set up observers
  const observers: Observer[] = [createFileLogObserver(run.logDir)];
  if (cliArgs.ci) {
    observers.push(createStdoutObserver());
  }

  // Run pipeline
  const statePath = path.join(run.logDir, 'pipeline-state.json');
  await runPipeline(nodes, run, handlers, gitOps, observers, statePath, {
    maxParallel: cliArgs.maxParallel,
  });
}

main().catch((err) => {
  process.stderr.write(`Pipeline error: ${err.message}\n`);
  process.exit(2);
});
