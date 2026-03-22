# SDK `.claude/skills/` Edit Permission — Exhaustive Findings

## Problem

Curator agents need to edit `.claude/skills/*/SKILL.md` files programmatically via the Claude Agent SDK `query()` function. The Edit/Write tools are blocked for all paths under `.claude/` in SDK mode, despite documentation stating this should work.

## What Works

| Context | Edit `.claude/skills/` | Mechanism |
|---|---|---|
| Interactive CLI session | ✅ | `.claude/skills/` exemption in CLI |
| CLI pipe mode (`-p`) + Agent tool + scoped subagent | ✅ | Scope processed by Agent tool |
| SDK `query()` + `canUseTool` + **Bash** tool | ✅ | Bash bypasses Edit/Write hardcheck |

## What Doesn't Work (All Tested)

Every combination below was tested from a worktree with `permissions.allow: ["Edit(.claude/skills/**)", "Write(.claude/skills/**)"]` in `.claude/settings.json`.

### Permission Modes

| Mode | `settingSources` | Result |
|---|---|---|
| `bypassPermissions` | `['project']` | ❌ Blocked |
| `acceptEdits` | `['project']` | ❌ Blocked (works for non-`.claude/` files) |
| `default` | `['project']` | ❌ Blocked |
| `acceptEdits` | `['project', 'user', 'local']` | ❌ Blocked |

### Additional Options

| Option | Result |
|---|---|
| `allowedTools: ['Edit(.claude/skills/**)']` | ❌ Blocked |
| `allowDangerouslySkipPermissions: true` | ❌ Blocked |
| `pathToClaudeCodeExecutable: '/home/node/.local/bin/claude'` | ❌ Blocked |
| `agent: 'test-curator'` (with `scope.modify: [".claude/skills/**"]`) | ❌ Blocked |
| Agent tool spawning scoped subagent from SDK top-level | ❌ Blocked |

### Hook-Based Approaches

| Approach | Result |
|---|---|
| PreToolUse hook returning `{"permissionDecision": "allow"}` | ❌ Blocked (hook runs, allow returned, edit still blocked) |
| `canUseTool` callback returning `{behavior: 'allow'}` | ❌ Edit blocked (but Bash allowed) |
| `canUseTool` + `updatedPermissions` from suggestions | ❌ Blocked |

### Plugin-Based Approaches

| Approach | Result |
|---|---|
| `skill-creator` plugin installed + `enabledPlugins` in settings.json | ❌ Plugin visible but Edit still blocked |
| Loading skill-creator via Skill tool then editing | ❌ Blocked |

### Session Management

| Approach | Result |
|---|---|
| Fresh session (restart + resume) | ❌ Blocked |
| Settings committed to git | ❌ Blocked |

## Key Observations

### 1. The block is in Edit/Write tool implementation, not the permission system

Evidence: `canUseTool` IS called for `.claude/` Edit calls, returns `allow`, but the edit still fails. The permission system processes and approves the request — something AFTER the permission decision blocks execution.

### 2. Bash is not subject to the same block

Evidence: `canUseTool` callback + `bypassPermissions` allows Bash commands that write to `.claude/skills/` paths. The hardcheck only exists in the Edit/Write tool implementations.

### 3. The CLI has an exemption the SDK doesn't

Evidence: Interactive CLI sessions can edit `.claude/skills/`, `.claude/agents/`, `.claude/commands/` — documented as exempt directories. The SDK's bundled `cli.js` (same version 2.1.81) doesn't implement this exemption.

### 4. Scope works in CLI subagents but not SDK

Evidence: `claude -p` → Agent tool → subagent with `scope.modify: [".claude/skills/**"]` → Edit succeeds. SDK `query()` → same Agent tool → same subagent → Edit blocked. The difference is the top-level session's trust model.

### 5. `permissions.allow` is loaded but not effective

Evidence: The SDK loads `settingSources: ['project']`, reads `.claude/settings.json`, and processes `permissions.allow`. The `canUseTool` callback confirms Edit calls reach the permission system. But the `.claude/` hardcheck overrides the allow decision.

## Architecture Analysis

The Edit/Write check appears to be:

```
Agent calls Edit(file_path)
  → canUseTool (if defined) → returns allow ✅
  → PreToolUse hooks (guard) → returns pass ✅
  → permissions.allow check → matches ✅
  → .claude/ directory hardcheck → BLOCKS ❌
  → (Edit execution never reached)
```

In the interactive CLI, the `.claude/` hardcheck has exemptions for `skills/`, `agents/`, `commands/`. In the SDK, these exemptions don't exist — all `.claude/` writes are blocked regardless of permissions.

## Working Workaround: `canUseTool` + Bash

The only SDK path that works:

```typescript
const autoApprove: CanUseTool = async (toolName, input, options) => {
  return {
    behavior: 'allow',
    toolUseID: options.toolUseID,
    updatedPermissions: options.suggestions ?? []
  };
};

const stream = query({
  prompt: 'Edit .claude/skills/foo/SKILL.md...',
  options: {
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    canUseTool: autoApprove,
    // ...
  },
});
```

The agent must be instructed to use Bash (cat/sed/heredoc) instead of Edit/Write for `.claude/skills/` paths. The `canUseTool` callback approves the Bash command. This works on the first try when the prompt instruction is clear.

### Downsides of Bash Workaround

- Guard hooks don't protect Bash writes to `.claude/` paths the same way as Edit/Write
- PostToolUse verification hooks don't fire for Bash
- Content escaping in heredocs is fragile for files containing code blocks
- Agent instruction compliance is not guaranteed (may try Edit first)

## Recommendation

This appears to be a gap in the SDK where the CLI's `.claude/skills/` write exemption was not ported. The fix should be in the SDK's Edit/Write tool implementation — applying the same exemption for `.claude/skills/`, `.claude/agents/`, and `.claude/commands/` that the interactive CLI has.

## Environment

- Claude Code version: 2.1.81 (both system `claude` and SDK `cli.js`)
- SDK: `@anthropic-ai/claude-agent-sdk` (npm)
- OS: Linux (Docker)
- Node: v20.20.0
- Test date: 2026-03-22

## Reproduction

From any project with `.claude/skills/` files:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const stream = query({
  prompt: 'Use Edit to add "# TEST" to .claude/skills/any-skill/SKILL.md',
  options: {
    permissionMode: 'acceptEdits',
    settingSources: ['project'],
    cwd: process.cwd(),
    maxTurns: 5,
    model: 'haiku',
  },
});

for await (const msg of stream) {
  if ((msg as any).type === 'result') {
    console.log((msg as any).result); // Will report permission blocked
  }
}
```
