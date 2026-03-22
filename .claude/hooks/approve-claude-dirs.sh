#!/usr/bin/env bash
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[[ "$TOOL" != "Edit" && "$TOOL" != "Write" ]] && exit 0
case "$FILE" in
    */.claude/skills/*|*/.claude/commands/*|*/.claude/agents/*)
        jq -n '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"skills/commands/agents auto-approved per docs"}}'
        exit 0
        ;;
esac
exit 0
