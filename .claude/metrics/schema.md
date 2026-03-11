# Agent Performance Metrics Schema

## Metrics from agent-metrics.jsonl (collected automatically via `log_agent_metrics()` in `scripts/lib/agent.sh`)

| Metric | Field | Query |
|--------|-------|-------|
| Agent success rate | `status` | `jq -s '[.[] | .status] | group_by(.) | map({s: .[0], n: length})' .claude/logs/agent-metrics.jsonl` |
| Average duration | `duration_seconds` | `jq -s '(map(.duration_seconds) | add) / length' .claude/logs/agent-metrics.jsonl` |
| Retry rate | `retries` | `jq -s '[.[] | select(.retries > 0)] | length' .claude/logs/agent-metrics.jsonl` |

## Metrics from external sources (collected manually)

| Metric | Source | How |
|--------|--------|-----|
| Merge conflict rate | merge logs | `grep -c "merge-fix" logs/*/merge-fix*.log` |
| Issue-to-PR time | GitHub API | `gh api` timestamps on issue + PR |
| Review iterations | PR comments | Count code-review comments per PR |

## When to build a dashboard

Defer `scripts/agent-metrics-report.sh` until >=20 data points exist in
agent-metrics.jsonl. Until then, use the jq queries above directly.
