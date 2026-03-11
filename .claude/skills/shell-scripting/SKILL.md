---
name: shell-scripting
description: "Use when writing or modifying bash scripts (launch-phase.sh, verify.sh, full-verify.sh, CI scripts). Covers pipe exit codes, heredoc quoting, set flags, and common gotchas."
---

# Shell Scripting Guide

## Pipe Exit Codes
`$?` in a pipeline returns the LAST command's exit code. Use `${PIPESTATUS[0]}` for the
first command, `${PIPESTATUS[1]}` for the second, etc.

```bash
cmd1 | tee log.txt
echo ${PIPESTATUS[0]}  # cmd1's exit code, not tee's
```

## Heredoc Quoting
- `<<'DELIM'` (single-quoted): prevents ALL variable expansion inside the heredoc. Use for wrapper scripts executed later.
- `<<DELIM` (unquoted): expands variables at write time. Use `\$` to escape variables that should expand at runtime.

## set Flags
- `set -uo pipefail` — always use in scripts
  - `pipefail`: pipes return the first non-zero exit code
  - `set -u`: catches undefined variables
- Omit `set -e` in scripts with intentional non-zero exits (like retry loops)

## sed Placeholder Substitution
When generating a script file with `cat <<'DELIM'`, use placeholder strings and
`sed -i 's|PLACEHOLDER|value|g'` to inject values — avoids quoting hell.

## stdout Pollution in Functions
If a function returns a value via `echo`, ALL other output inside it must go to
`>/dev/null` or `>&2`. Stray output corrupts the return value.

```bash
my_func() {
  git checkout -b feature >/dev/null 2>&1  # suppress output
  npm install >&2                           # redirect to stderr
  echo "/path/to/result"                    # only this goes to stdout
}
result=$(my_func)
```

## Logging: script vs tee
- `script -q -c` wraps a command in a pseudo-TTY for logging but is fragile across platforms
- Prefer `cmd 2>&1 | tee -a logfile` with `PIPESTATUS` for exit code capture

## SIGPIPE in Pipelines
Piping a long-running process through `head`, `less`, or any command that closes early
sends SIGPIPE to the writer, killing it silently:
```bash
# DANGEROUS — kills the script after head reads 30 lines:
./my-long-script.sh | head -30

# SAFE — capture full output, read later:
./my-long-script.sh 2>&1 | tee output.log
tail -30 output.log
```
This is especially dangerous with orchestration scripts that manage child processes —
SIGPIPE kills the parent, orphaning all children.

## Syntax Checking
Always run `bash -n scriptname.sh` after editing any bash script to catch syntax errors
before committing.

## Lessons Learned
<!-- Agents: append here ONLY after confirming the behavior by reading source or running a test. Format: YYYY-MM-DD: description -->
- 2026-03-09: Never chain `cd` with `&&` — if a later command fails, the `cd` does not persist and subsequent calls run in the wrong directory.
- 2026-03-09: `grep -oP` is not portable. Use `sed` or `node -e` instead.
- 2026-03-09: Always capture `PIPESTATUS` immediately — it's overwritten by the next command.
- 2026-03-11: `((var++))` returns exit code 1 when var is 0 (because `((0))` is falsy in bash). Under `set -e` this kills the script. Use `var=$((var + 1))` instead.
- 2026-03-11: PreToolUse hooks that read `/dev/stdin` must passthrough ENXIO/EAGAIN/ENOENT errors via `process.exit(0)` — these are infrastructure failures (stdin unavailable), not logic errors. Fail-closed on infrastructure errors bricks the entire session with no self-recovery path.
