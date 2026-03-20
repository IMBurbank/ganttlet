#!/usr/bin/env bash
# Claude Code status line: model, context bar, git branch, worktree
input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // "Unknown"')

used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -n "$used" ]; then
  used_int=$(printf "%.0f" "$used")
  bar_len=10
  filled=$(( used_int * bar_len / 100 ))
  empty=$(( bar_len - filled ))
  bar=""
  for i in $(seq 1 $filled); do bar="${bar}█"; done
  for i in $(seq 1 $empty); do bar="${bar}░"; done
  if [ "$used_int" -ge 80 ]; then
    bar_color=$'\033[31m'
  elif [ "$used_int" -ge 50 ]; then
    bar_color=$'\033[33m'
  else
    bar_color=$'\033[32m'
  fi
  reset=$'\033[0m'
  ctx_display="${bar_color}${bar}${reset} ${used_int}%"
else
  ctx_display="░░░░░░░░░░ --%"
fi

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
branch=""
worktree_name=""

if [ -n "$cwd" ] && command -v git >/dev/null 2>&1; then
  branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  toplevel=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)
  common_dir=$(git -C "$cwd" rev-parse --git-common-dir 2>/dev/null || true)
  git_dir=$(git -C "$cwd" rev-parse --git-dir 2>/dev/null || true)
  if [ -n "$git_dir" ] && [ -n "$common_dir" ] && [ "$git_dir" != "$common_dir" ]; then
    worktree_name=$(basename "$toplevel")
  fi
fi

# Colors
cyan=$'\033[36m'
magenta=$'\033[35m'
dim=$'\033[2m'
reset=$'\033[0m'

# Line 1: model + context bar
echo "${dim}${model}${reset}  ${ctx_display}"

# Line 2: git branch + worktree
line2=""
if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
  branch_icon=$'\xee\x82\xa0'  # nerd font git branch symbol (U+E0A0)
  line2="${branch_icon} ${cyan}${branch}${reset}"
fi
if [ -n "$worktree_name" ]; then
  line2="${line2}  📂 ${magenta}${worktree_name}${reset}"
fi
if [ -n "$line2" ]; then
  echo "${line2}"
fi
