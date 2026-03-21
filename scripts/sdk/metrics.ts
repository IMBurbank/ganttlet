import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentMetrics } from './types.js';

export function logMetrics(metrics: AgentMetrics): void {
  const metricsDir = process.env.LOG_METRICS_DIR ?? '.claude/logs';
  const filePath = path.join(metricsDir, 'agent-metrics.jsonl');

  try {
    fs.mkdirSync(metricsDir, { recursive: true });
  } catch {
    // best-effort
  }

  fs.appendFileSync(filePath, JSON.stringify(metrics) + '\n');
}
