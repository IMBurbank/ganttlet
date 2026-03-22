# SDK `.claude/skills/` Edit Permission — Exhaustive Findings

## Problem

Curator agents need to edit `.claude/skills/*/SKILL.md` files programmatically via the Claude Agent SDK `query()` function. The Edit/Write tools are blocked for all paths under `.claude/` in SDK mode, despite documentation stating this should work.

## Related Issues

- [#37157](https://github.com/anthropics/claude-code/issues/37157) — `.claude/skills/` not exempt despite documentation (v2.1.81)
- [#36396](https://github.com/anthropics/claude-code/issues/36396) — Regression since v2.1.78: `.claude/skills/` writes prompt in `bypassPermissions`
- [#36044](https://github.com/anthropics/claude-code/issues/36044) — Feature request for opt-in full bypass; contains `PermissionRequest` hook workaround

### Root Cause (from #37157)

`.claude/skills` is missing from the exemption function `sXT()` in the v2.1.81 binary. The function exempts `.claude/commands` and `.claude/agents` but not `.claude/skills`:

```javascript
// v2.1.81 (decompiled):
function sXT() {
    return [...nCK.filter(d => d !== ".git"), ".claude/commands", ".claude/agents"]
}
// MISSING: ".claude/skills"
```

## What Works

| Context | Edit `.claude/skills/` | Mechanism |
|---|---|---|
| Interactive CLI session | ✅ | User clicks "allow" at the ask prompt |
| CLI pipe mode (`-p`) + Agent tool + scoped subagent | ✅ | Scope processed by Agent tool |
| SDK `query()` + `canUseTool` + **Bash** tool | ✅ | Bash bypasses Edit/Write protected-directory check |

## What Doesn't Work in SDK `query()` Mode

Every combination below was tested from a worktree with `permissions.allow: ["Edit(.claude/skills/**)", "Write(.claude/skills/**)"]` in `.claude/settings.json`. All tests confirmed with fresh session restarts where noted.

### Permission Modes

| Mode | `settingSources` | Result |
|---|---|---|
| `bypassPermissions` | `['project']` | ❌ Blocked |
| `acceptEdits` | `['project']` | ❌ Blocked (works for non-`.claude/` files) |
| `default` | `['project']` | ❌ Blocked |
| `acceptEdits` | `['project', 'user', 'local']` | ❌ Blocked |

### SDK Options

| Option | Result |
|---|---|
| `allowedTools: ['Edit(.claude/skills/**)']` | ❌ Blocked |
| `allowDangerouslySkipPermissions: true` | ❌ Blocked |
| `pathToClaudeCodeExecutable` (system claude binary) | ❌ Blocked |
| `agent: 'test-curator'` (with `scope.modify: [".claude/skills/**"]`) | ❌ Blocked |
| Agent tool spawning scoped subagent from SDK top-level | ❌ Blocked |

### Hook-Based Approaches

| Approach | Hook Fires? | Edit Succeeds? | Notes |
|---|---|---|---|
| `PreToolUse` settings.json hook returning `permissionDecision: "allow"` (yurukusa's workaround from #37157) | ✅ Yes | ❌ No | Tested with hook on worktree settings, main settings, and both. Tested with and without session restarts. Hook fires and returns allow but the protected-directory check overrides it. |
| `PreToolUse` programmatic SDK hook returning `permissionDecision: "allow"` | ✅ Yes | ❌ No | Same result as settings.json hook |
| `PermissionRequest` settings.json hook returning `decision: {behavior: "allow"}` (workaround from #36044) | ❌ No | ❌ No | Hook never fires. Verified with file logging — log file stayed empty. The protected-directory check does not emit a `PermissionRequest` event in SDK subprocess mode. |
| `PermissionRequest` programmatic SDK hook | ❌ No | ❌ No | Same — event never dispatched. `PreToolUse` programmatic hook fires for the same call, confirming programmatic hooks work for other events. |
| `canUseTool` callback returning `{behavior: 'allow'}` | ✅ Yes (called) | ❌ No | Callback fires, returns allow, edit still denied. Confirmed the protected-directory check runs after `canUseTool`. |
| `canUseTool` + `updatedPermissions` from suggestions | ✅ Yes | ❌ No | Suggestions include `addRules` for session — accepted without ZodError but edit still blocked |

### Plugin-Based Approaches

| Approach | Result |
|---|---|
| `skill-creator` plugin installed + `enabledPlugins` in settings.json | ❌ Plugin visible but Edit still blocked |
| Loading skill-creator via Skill tool then editing | ❌ Blocked |

### Session/Settings Placement

| Configuration | Restart? | Result |
|---|---|---|
| Hook in worktree `.claude/settings.json` only | Yes | ❌ Blocked |
| Hook in worktree `.claude/settings.json` only | No | ❌ Blocked |
| Hook in main `/workspace/.claude/settings.json` only | No | ❌ Blocked |
| Hook in BOTH worktree + main settings | Yes | ❌ Blocked |
| Hook in `.claude/settings.local.json` | No | ❌ Blocked |
| `permissions.allow` committed to git | Yes | ❌ Blocked |

## Key Observations

### 1. The block is a protected-directory "ask" prompt, not a hard deny

Per #37157's source analysis, `.claude/` paths trigger `ruleBehavior: "ask"` (a user confirmation prompt). In CLI interactive mode, the user clicks "allow". In CLI pipe mode with `--dangerously-skip-permissions`, the ask is auto-approved. In SDK subprocess mode, there is no user to approve and the ask is treated as a denial.

### 2. `PreToolUse` `permissionDecision: "allow"` fires but doesn't override

The hook fires before the protected-directory check. The allow decision is processed, but the protected-directory check creates a synthetic `policySettings` rule with `ruleBehavior: "ask"` that overrides it. This is consistent with #36044's analysis: "the check short-circuits before bypass is evaluated."

### 3. `PermissionRequest` hooks never fire in SDK subprocess mode

The `PermissionRequest` hook (recommended workaround in #36044) fires at the ask-prompt step in CLI mode. In SDK subprocess mode, the ask prompt is never shown — the denial is immediate. Therefore the `PermissionRequest` event is never dispatched and the hook never executes.

### 4. Bash is not subject to the protected-directory check

Bash commands that write to `.claude/skills/` paths are not intercepted by the Edit/Write protected-directory check. The `canUseTool` callback approves the Bash command, and `bypassPermissions` allows it to execute. This is the only working SDK workaround.

### 5. CLI vs SDK: same binary, different behavior

Both the system `claude` (v2.1.81) and the SDK's bundled `cli.js` (v2.1.81) exhibit the same blocking behavior when invoked via SDK `query()`. The difference is not the binary but the execution context — SDK subprocess mode has no mechanism to auto-approve the "ask" prompt for protected directories (except for the exempted `.claude/commands` and `.claude/agents` paths, per #37157's root cause).

### 6. The missing `.claude/skills` exemption is the root cause

If `.claude/skills` were added to the `sXT()` exemption function (as #37157 proposes), all of the above would work. The hooks, `permissions.allow`, `canUseTool`, and permission modes are all functioning correctly — they just can't override a protected-directory ask that shouldn't be triggered in the first place.

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
- Agent instruction compliance is not guaranteed (may try Edit first, waste turns)

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
    console.log((msg as any).permission_denials); // Will show 1+ denial
  }
}
```
