#!/usr/bin/env bash
# Shell function aliases for bizday — matches code function names.
# Usage: source this file or add to .bashrc.
# Agents call taskEndDate/task_end_date/taskDuration/task_duration directly.

taskEndDate()    { bizday "$1" "$2"; }
task_end_date()  { bizday "$1" "$2"; }
taskDuration()   { bizday "$1" "$2"; }
task_duration()  { bizday "$1" "$2"; }
