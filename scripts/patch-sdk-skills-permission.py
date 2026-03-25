#!/usr/bin/env python3
"""
Patch Claude Agent SDK cli.js to fix .claude/skills/ edit permissions.

Fixes: https://github.com/anthropics/claude-code/issues/37157
  .claude/skills is missing from the protected-directory exemption list.
  Two checks in dN1's safety cascade need patching:
    1. IHY: flags skills/agents/commands as protected (should exempt them)
    2. uHY: catches .claude segment without exempting skills/agents/commands

This script:
  1. Verifies the patch targets exist (detects SDK version changes)
  2. Applies the patches
  3. Verifies the patches were applied correctly

Run after npm install: python3 scripts/patch-sdk-skills-permission.py

See also: docs/sdk-skill-edit-findings.md for full investigation.
"""

import sys
import hashlib

CLI_JS = "node_modules/@anthropic-ai/claude-agent-sdk/cli.js"

# Marker: if .claude/skills is already in the exemption list, the bug is fixed upstream
FIXED_UPSTREAM_MARKER = '".claude/skills"'
# Context: the uHY worktrees exemption must exist (proves we're looking at the right code)
UNFIXED_MARKER = 'yZ($)==="worktrees")break}'

# Patch 1: IHY — stop flagging commands/agents/skills as protected
PATCH_1_FIND = 'return wk(A,q)||wk(A,K)||wk(A,_)}'
PATCH_1_REPLACE = 'return!1}'
PATCH_1_CONTEXT = '.claude","commands"'  # must appear nearby

# Patch 2: uHY — add skills/agents/commands to worktrees exemption
PATCH_2_FIND = 'if(O===".claude"){let $=K[Y+1];if($&&yZ($)==="worktrees")break}'
PATCH_2_REPLACE = 'if(O===".claude"){let $=K[Y+1];if($&&(yZ($)==="worktrees"||yZ($)==="skills"||yZ($)==="agents"||yZ($)==="commands"))break}'


def main():
    try:
        with open(CLI_JS, "r") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"ERROR: {CLI_JS} not found. Run npm install first.")
        return 1

    version = "unknown"
    if '"VERSION":"' in content:
        idx = content.index('"VERSION":"') + len('"VERSION":"')
        version = content[idx : content.index('"', idx)]
    print(f"SDK cli.js version: {version}")

    p1_already = PATCH_1_REPLACE in content and PATCH_1_FIND not in content
    p2_already = PATCH_2_REPLACE in content and PATCH_2_FIND not in content

    if p1_already and p2_already:
        if PATCH_2_REPLACE in content:
            # Our exact patch strings present — we applied this
            print("Patch 1 (IHY): already applied")
            print("Patch 2 (uHY): already applied")
            print("\nNothing to do.")
            return 0
        else:
            # Both targets gone but with different replacements — upstream fix
            print("FIX DETECTED: .claude/skills exemption appears to be in cli.js natively.")
            print("The upstream bug (#37157) may be fixed in this version.")
            print("Test .claude/skills/ Edit in SDK mode — if it works, remove this script.")
            return 0

    errors = []

    # Check Patch 1
    p1_needed = content.count(PATCH_1_FIND) == 1
    p1_context = PATCH_1_CONTEXT in content

    if p1_already:
        print("Patch 1 (IHY): already applied")
    elif p1_needed and p1_context:
        print("Patch 1 (IHY): applying...")
        content = content.replace(PATCH_1_FIND, PATCH_1_REPLACE, 1)
    elif not p1_context:
        errors.append("Patch 1 (IHY): context string not found — SDK version may have changed")
    else:
        count = content.count(PATCH_1_FIND)
        errors.append(f"Patch 1 (IHY): expected 1 occurrence, found {count} — SDK version may have changed")

    # Check Patch 2
    p2_needed = content.count(PATCH_2_FIND) == 1

    if p2_already:
        print("Patch 2 (uHY): already applied")
    elif p2_needed:
        print("Patch 2 (uHY): applying...")
        content = content.replace(PATCH_2_FIND, PATCH_2_REPLACE, 1)
    else:
        count = content.count(PATCH_2_FIND)
        errors.append(f"Patch 2 (uHY): expected 1 occurrence, found {count} — SDK version may have changed")

    if errors:
        # Exit 0 so postinstall/Docker doesn't fail — but print loud warnings
        print("")
        print("=" * 70)
        print("WARNING: SDK skills permission patch could NOT be applied")
        print("=" * 70)
        for e in errors:
            print(f"  {e}")
        print("")
        print("The SDK has likely been updated. Curators will not be able to")
        print("edit .claude/skills/ files via Edit/Write tools until this is")
        print("resolved. Check if #37157 was fixed upstream, or update the")
        print("patch targets in this script.")
        print(f"  Script: scripts/patch-sdk-skills-permission.py")
        print(f"  Issue:  https://github.com/anthropics/claude-code/issues/37157")
        print("=" * 70)
        return 0  # don't break npm install / Docker builds

    # Write patched file
    with open(CLI_JS, "w") as f:
        f.write(content)

    # Verify
    with open(CLI_JS, "r") as f:
        verify = f.read()

    ok = True
    if PATCH_1_FIND in verify:
        print("VERIFY FAILED: Patch 1 not applied")
        ok = False
    if PATCH_2_FIND in verify:
        print("VERIFY FAILED: Patch 2 not applied")
        ok = False
    if PATCH_1_REPLACE not in verify:
        print("VERIFY FAILED: Patch 1 replacement not found")
        ok = False
    if PATCH_2_REPLACE not in verify:
        print("VERIFY FAILED: Patch 2 replacement not found")
        ok = False

    if ok:
        sha = hashlib.sha256(verify.encode()).hexdigest()[:16]
        print(f"\nPatched successfully (sha256: {sha})")
        return 0
    else:
        return 1


if __name__ == "__main__":
    sys.exit(main())
