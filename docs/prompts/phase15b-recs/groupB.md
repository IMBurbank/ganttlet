---
phase: 15b-recs
group: B
stage: 1
agent_count: 1
scope:
  modify:
    - scripts/lib/merge.sh
    - scripts/lib/tmux-supervisor.sh
  read_only:
    - scripts/lib/watch.sh
    - scripts/lib/agent.sh
depends_on: []
tasks:
  - id: B1
    summary: "Read merge.sh and tmux-supervisor.sh"
  - id: B2
    summary: "Skip WASM rebuild when no Rust files changed"
  - id: B3
    summary: "Add log-based stall detection to tmux_wait_stage"
  - id: B4
    summary: "Verify syntax with bash -n"
---

# Phase 15b-recs Group B — WASM Skip + Stall Detection

You are implementing Phase 15b-recs Group B for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

Two issues from Phase 15b:
1. **Unnecessary WASM rebuilds**: merge.sh rebuilds WASM after every branch merge (~20s each). Phase 15b had 4 merges with 0 Rust changes — 80 seconds wasted.
2. **No stall detection in tmux_wait_stage**: The function only checks for exit status and overall timeout. If an agent's log stops growing (stalled), it waits until the full timeout rather than detecting and killing the stalled agent early.

## Your files (ONLY modify these):
- `scripts/lib/merge.sh` — `do_merge()` function (WASM rebuild section around line 285-287)
- `scripts/lib/tmux-supervisor.sh` — `tmux_wait_stage()` function (lines 220-267)

Read-only:
- `scripts/lib/watch.sh` — reference for idle detection patterns (AGENT_IDLE_THRESHOLD, log size polling)
- `scripts/lib/agent.sh` — reference for monitor_agent pattern

## Tasks — execute in order:

### B1: Read and understand

1. Read `scripts/lib/merge.sh` — focus on `do_merge()` (lines 244-318), especially the WASM rebuild at lines 285-287
2. Read `scripts/lib/tmux-supervisor.sh` — focus on `tmux_wait_stage()` (lines 220-267)
3. Read `scripts/lib/watch.sh` lines 107-137 — understand the idle detection pattern (check log file size, track idle seconds)

### B2: Skip WASM rebuild when no Rust files changed

In `scripts/lib/merge.sh`, modify the WASM rebuild section in `do_merge()` (around lines 285-287).

**Current:**
```bash
# Rebuild WASM (Rust source may have changed in this branch)
source "$HOME/.cargo/env" 2>/dev/null || true
npm run build:wasm 2>/dev/null || warn "WASM build failed after merging ${group}"
```

**Replace with:**
```bash
# Only rebuild WASM if Rust source files changed in this merge
if git diff HEAD~1 --name-only 2>/dev/null | grep -q '^crates/'; then
  log "Rust files changed — rebuilding WASM"
  source "$HOME/.cargo/env" 2>/dev/null || true
  npm run build:wasm 2>/dev/null || warn "WASM build failed after merging ${group}"
else
  log "No Rust files changed — skipping WASM rebuild"
fi
```

The check uses `git diff HEAD~1 --name-only` to see what files changed in the last merge commit. If no files under `crates/` were modified, WASM rebuild is skipped.

**Edge case**: If `git diff HEAD~1` fails (e.g., no previous commit), the grep fails silently and the `if` takes the else branch — which is safe because a failed diff means we can't determine changes, but the WASM was already built during preflight.

Wait — actually, failing to detect changes should trigger a rebuild (safe default). Let me adjust:

```bash
# Only rebuild WASM if Rust source files changed in this merge
local rust_changed=false
if git diff HEAD~1 --name-only 2>/dev/null | grep -q '^crates/'; then
  rust_changed=true
fi
if $rust_changed; then
  log "Rust files changed — rebuilding WASM"
  source "$HOME/.cargo/env" 2>/dev/null || true
  npm run build:wasm 2>/dev/null || warn "WASM build failed after merging ${group}"
else
  log "No Rust files changed — skipping WASM rebuild"
fi
```

Commit: `"fix: skip WASM rebuild during merges when no Rust files changed"`

### B3: Add log-based stall detection to tmux_wait_stage

In `scripts/lib/tmux-supervisor.sh`, enhance `tmux_wait_stage()` to track log file sizes and detect stalls.

Add a configurable stall threshold:
```bash
local stall_threshold="${AGENT_STALL_THRESHOLD:-300}"  # 5 minutes default
```

Track last known log sizes using bash associative arrays. On each poll (every 10s), check each running agent's log size. If a log hasn't grown for `stall_threshold` seconds, warn and kill that specific agent.

**Implementation approach:**

Add before the `while true` loop:
```bash
local stall_threshold="${AGENT_STALL_THRESHOLD:-300}"
declare -A last_sizes last_change_times
local now_init
now_init=$(date +%s)
for group in "${groups[@]}"; do
  last_sizes["$group"]=0
  last_change_times["$group"]=$now_init
done
```

Inside the `while true` loop, after the existing status check but before the timeout check, add:
```bash
# Stall detection: check log file growth
for group in "${groups[@]}"; do
  local status
  status=$(tmux_agent_status "$session" "$group" "${log_dir}/${group}.log")
  if [[ "$status" == "running" ]]; then
    local current_size
    current_size=$(stat -c %s "${log_dir}/${group}.log" 2>/dev/null || echo 0)
    if [[ "$current_size" != "${last_sizes[$group]}" ]]; then
      last_sizes["$group"]=$current_size
      last_change_times["$group"]=$now
    fi
    local stall_duration=$(( now - ${last_change_times[$group]} ))
    if [[ $stall_duration -ge $stall_threshold ]]; then
      warn "${group}: log stalled for ${stall_duration}s — killing agent"
      tmux_kill_agent "$session" "$group" "${log_dir}/${group}.log"
    fi
  fi
done
```

Note: `$now` is already computed from the timeout check section. Make sure the `now=$(date +%s)` is computed before both the stall check and the timeout check.

Commit: `"feat: add log-based stall detection to tmux_wait_stage (default 5min threshold)"`

### B4: Verify syntax

Run bash syntax checks:
```bash
bash -n scripts/lib/merge.sh && echo "merge.sh OK" || echo "merge.sh FAILED"
bash -n scripts/lib/tmux-supervisor.sh && echo "tmux-supervisor.sh OK" || echo "tmux-supervisor.sh FAILED"
```

Fix any syntax errors found.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupB saving work"`.
- **Calculations**: NEVER do mental math.
