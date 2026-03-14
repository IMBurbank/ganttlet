#!/usr/bin/env bash
# Verify worktree isolation hooks block and allow correctly.
# Uses node vm module to test hooks extracted from .claude/settings.json
set -euo pipefail

cd "$(dirname "$0")/.."

node -e '
const fs = require("fs");
const vm = require("vm");

const settings = JSON.parse(fs.readFileSync(".claude/settings.json", "utf8"));
let PASS = 0, FAIL = 0;

function getHookCmd(matcherIdx, hookIdx) {
  return settings.hooks.PreToolUse[matcherIdx].hooks[hookIdx].command
    .replace(/^node -e "/, "")
    .replace(/"$/, "");
}

function runHook(matcherIdx, hookIdx, input) {
  const cmd = getHookCmd(matcherIdx, hookIdx);
  const origRead = fs.readFileSync;
  fs.readFileSync = function(p, enc) {
    if (p === "/dev/stdin") return input;
    return origRead.call(fs, p, enc);
  };
  let output = "";
  const origLog = console.log;
  console.log = function(s) { output = s; };
  try {
    vm.runInThisContext(cmd);
  } catch(e) {
    output = "EXCEPTION: " + e.message;
  }
  console.log = origLog;
  fs.readFileSync = origRead;
  return output;
}

function test(desc, matcherIdx, hookIdx, input, expectBlock) {
  const result = runHook(matcherIdx, hookIdx, input);
  const blocked = typeof result === "string" && result.includes("\"decision\":\"block\"");
  if (expectBlock === blocked) {
    PASS++;
    process.stdout.write("  PASS: " + desc + "\n");
  } else {
    FAIL++;
    process.stdout.write("  FAIL: " + desc + (expectBlock ? " (expected block, got: " + result + ")" : " (unexpected block: " + result + ")") + "\n");
  }
}

process.stdout.write("=== Worktree Isolation Hook Tests ===\n\n");

// Edit/Write hooks (matcher 0)
// Hook 0: Protected file guard
process.stdout.write("--- Protected file guard (Edit/Write hook 0) ---\n");
test("Block .env file", 0, 0, JSON.stringify({tool_input:{file_path:"/foo/.env"}}), true);
test("Block package-lock.json", 0, 0, JSON.stringify({tool_input:{file_path:"/workspace/package-lock.json"}}), true);
test("Allow normal TS file", 0, 0, JSON.stringify({tool_input:{file_path:"/workspace/src/App.tsx"}}), false);
test("Fail-closed on bad JSON", 0, 0, "not-json", true);

// Hook 1: Worktree edit guard
process.stdout.write("--- Worktree edit guard (Edit/Write hook 1) ---\n");
test("Block edit to /workspace/src/foo.ts", 0, 1, JSON.stringify({tool_input:{file_path:"/workspace/src/foo.ts"}}), true);
test("Allow edit to worktree file", 0, 1, JSON.stringify({tool_input:{file_path:"/workspace/.claude/worktrees/test/src/foo.ts"}}), false);
test("Block on malformed input (fail-closed)", 0, 1, "not-json", true);
test("Block on empty input (fail-closed)", 0, 1, "", true);

// Bash hooks (matcher 1)
// Hook 0: Push-to-main guard
process.stdout.write("--- Push-to-main guard (Bash hook 0) ---\n");
test("Block git push origin main", 1, 0, JSON.stringify({tool_input:{command:"git push origin main"}}), true);
test("Allow git push origin feature", 1, 0, JSON.stringify({tool_input:{command:"git push origin feature-branch"}}), false);
test("Fail-closed on bad JSON", 1, 0, "not-json", true);

// Hook 1: Checkout/switch guard
process.stdout.write("--- Checkout/switch guard (Bash hook 1) ---\n");
test("Block git checkout main", 1, 1, JSON.stringify({tool_input:{command:"git checkout main"}}), true);
test("Block git switch feature", 1, 1, JSON.stringify({tool_input:{command:"git switch feature"}}), true);
test("Allow git worktree add", 1, 1, JSON.stringify({tool_input:{command:"git worktree add /tmp/test -b branch"}}), false);
test("Fail-closed on bad JSON", 1, 1, "not-json", true);

// Hook 2: Worktree removal guard
process.stdout.write("--- Worktree removal guard (Bash hook 2) ---\n");
test("Block git worktree remove", 1, 2, JSON.stringify({tool_input:{command:"git worktree remove /tmp/test"}}), true);
test("Block git worktree prune", 1, 2, JSON.stringify({tool_input:{command:"git worktree prune"}}), true);
test("Allow git worktree add", 1, 2, JSON.stringify({tool_input:{command:"git worktree add /tmp/test"}}), false);
test("Fail-closed on bad JSON", 1, 2, "not-json", true);

// Hook 3: Bash file-modification guard
process.stdout.write("--- Bash file-modification guard (Bash hook 3) ---\n");
test("Block sed -i on /workspace/", 1, 3, JSON.stringify({tool_input:{command:"sed -i s/foo/bar/ /workspace/src/test.ts"}}), true);
test("Block redirect to /workspace/", 1, 3, JSON.stringify({tool_input:{command:"echo hello > /workspace/src/test.ts"}}), true);
test("Block tee to /workspace/", 1, 3, JSON.stringify({tool_input:{command:"echo hello | tee /workspace/src/test.ts"}}), true);
test("Allow sed -i in worktree", 1, 3, JSON.stringify({tool_input:{command:"sed -i s/foo/bar/ /workspace/.claude/worktrees/test/src/test.ts"}}), false);
test("Allow redirect to worktree", 1, 3, JSON.stringify({tool_input:{command:"echo hello > /workspace/.claude/worktrees/test/src/test.ts"}}), false);
test("Allow normal bash commands", 1, 3, JSON.stringify({tool_input:{command:"git status"}}), false);
test("Fail-closed on bad JSON", 1, 3, "not-json", true);

// Infrastructure error simulation: when /dev/stdin is unavailable, hooks must allow (not block)

function runHookWithStdinError(matcherIdx, hookIdx, errorCode) {
  const cmd = getHookCmd(matcherIdx, hookIdx);
  const origRead = fs.readFileSync;
  fs.readFileSync = function(p, enc) {
    if (p === "/dev/stdin") {
      const err = new Error(errorCode + ": simulated stdin error");
      err.code = errorCode;
      throw err;
    }
    return origRead.call(fs, p, enc);
  };
  let output = "";
  let exitCode = null;
  const origLog = console.log;
  console.log = function(s) { output = s; };
  const origExit = process.exit;
  const EXIT_SENTINEL = Symbol("EXIT");
  process.exit = function(code) { exitCode = code; throw EXIT_SENTINEL; };
  try {
    vm.runInThisContext(cmd);
  } catch(e) {
    if (e !== EXIT_SENTINEL) output = "EXCEPTION: " + e.message;
  }
  console.log = origLog;
  process.exit = origExit;
  fs.readFileSync = origRead;
  return { output, exitCode };
}

function testStdinError(desc, matcherIdx, hookIdx, errorCode) {
  const result = runHookWithStdinError(matcherIdx, hookIdx, errorCode);
  const blocked = typeof result.output === "string" && result.output.includes("\"decision\":\"block\"");
  const exception = typeof result.output === "string" && result.output.startsWith("EXCEPTION:");
  if (!blocked && !exception && result.exitCode === 0) {
    PASS++;
    process.stdout.write("  PASS: " + desc + "\n");
  } else {
    FAIL++;
    let reason = "";
    if (blocked) reason = "caused block — bricks the session";
    else if (exception) reason = "unexpected exception: " + result.output;
    else if (result.exitCode !== 0) reason = "exitCode=" + result.exitCode + ", expected 0";
    process.stdout.write("  FAIL: " + desc + " (" + reason + ")\n");
  }
}

// Test all three infrastructure error codes across all 6 hooks
["ENXIO", "EAGAIN", "ENOENT"].forEach(function(code) {
  process.stdout.write("--- " + code + " passthrough (infrastructure error → allow) ---\n");
  testStdinError(code + " on protected file guard (Edit/Write hook 0)", 0, 0, code);
  testStdinError(code + " on worktree edit guard (Edit/Write hook 1)", 0, 1, code);
  testStdinError(code + " on push-to-main guard (Bash hook 0)", 1, 0, code);
  testStdinError(code + " on checkout guard (Bash hook 1)", 1, 1, code);
  testStdinError(code + " on worktree removal guard (Bash hook 2)", 1, 2, code);
  testStdinError(code + " on bash file-mod guard (Bash hook 3)", 1, 3, code);
});

process.stdout.write("\nResults: " + PASS + " passed, " + FAIL + " failed\n");
if (FAIL > 0) process.exit(1);
'
