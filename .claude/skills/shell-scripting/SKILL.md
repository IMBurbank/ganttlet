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

## Syntax Checking
Always run `bash -n scriptname.sh` after editing any bash script to catch syntax errors
before committing.
