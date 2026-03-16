#!/usr/bin/env bash
# Shell function aliases for bizday — matches code function names.
# Usage: source this file or add to .bashrc.
# Agents call taskEndDate/task_end_date/taskDuration/task_duration directly.

taskEndDate()    { bizday "$@" | head -1; }
task_end_date()  { bizday "$@" | head -1; }
taskDuration()   { bizday "$@" | head -1; }
task_duration()  { bizday "$@" | head -1; }
