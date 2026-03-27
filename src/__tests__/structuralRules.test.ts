/**
 * Structural rule enforcement — the TypeScript equivalent of Rust's #[deny(...)].
 *
 * These tests scan source code for patterns that are structurally wrong.
 * They fail with prescriptive messages explaining what to do instead.
 * This catches mistakes BEFORE they reach code review or production.
 *
 * These are NOT lint rules (which agents can ignore) or documentation
 * (which agents might not read). They're tests that run in the same
 * vitest suite the agent already runs after every change.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC_DIR = join(__dirname, '..');

/** Recursively find all .ts/.tsx files in a directory, excluding tests and node_modules. */
function findSourceFiles(dir: string, pattern?: RegExp): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (entry === 'node_modules' || entry === '__tests__' || entry === 'test-results') continue;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findSourceFiles(fullPath, pattern));
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      if (!pattern || pattern.test(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// ─── Rule 1: Hooks must not return ref.current to consumers ─────────
//
// Why: useRef doesn't trigger re-renders. If a hook returns ref.current,
// the consuming component never sees updates. This caused the awareness
// bug (always null) and the SheetsAdapter stale-reference bug.
//
// Fix: Use useState for values that consumers need to react to.
// Refs are fine for internal state (e.g., cleanup tracking, imperative handles).
//
// Pattern caught: `return { ... someRef.current ... }` or `return someRef.current`
// in files matching use*.ts/use*.tsx.

describe('Rule: hooks must not expose refs as return values', () => {
  it('no hook return type includes RefObject, and no hook returns a bare ref', () => {
    const hookDirs = [join(SRC_DIR, 'state', 'hooks'), join(SRC_DIR, 'hooks')];

    const violations: string[] = [];

    for (const dir of hookDirs) {
      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => /^use.*\.tsx?$/.test(f));
      } catch {
        continue;
      }

      for (const file of files) {
        const fullPath = join(dir, file);
        const content = readFileSync(fullPath, 'utf-8');

        // Check the function signature's return type for RefObject
        // This catches: ): RefObject<...> { and ): { ...; ref: RefObject<...>; ... }
        if (/\):\s*(?:.*RefObject|.*MutableRefObject)/.test(content)) {
          const rel = relative(SRC_DIR, fullPath);
          violations.push(
            `${rel}: hook return type includes RefObject — use useState instead.\n` +
              `  RefObject doesn't trigger re-renders. Consumers will see stale values.\n` +
              `  If you need both imperative access AND reactive updates, return the\n` +
              `  value via useState and keep the ref internal.\n` +
              `  See: awareness bug (useCollabConnection), adapter bug (useSheetsSync).`
          );
        }

        // Also check: return someRef; (returning the ref object itself)
        // Exclude: return { someRef, ... } where someRef is alongside state values
        // (that pattern is OK — e.g., useUndoManager returns { undoManagerRef, canUndo, canRedo })
        const returnRefPattern = /return\s+\w+Ref\s*;/;
        if (returnRefPattern.test(content)) {
          const rel = relative(SRC_DIR, fullPath);
          violations.push(
            `${rel}: hook returns a bare ref — use useState for reactive values.\n` +
              `  If consumers need to trigger re-renders on value change, use useState.\n` +
              `  Returning a ref alongside state values (e.g., { ref, canUndo }) is OK.`
          );
        }
      }
    }

    expect(violations, violations.join('\n\n')).toEqual([]);
  });
});

// ─── Rule 2: No .getState() in component JSX (render-time reads) ────
//
// Why: .getState() bypasses useSyncExternalStore. The React Compiler
// can't track it, so components won't re-render when the value changes.
// This caused the TaskRow collapse-chevron bug.
//
// Fix: Use useUIStore(s => s.field) at the top of the component.
// .getState() is fine in event handlers (onClick, onChange, etc.) —
// the test only flags it inside JSX template expressions.
//
// Pattern caught: `.getState()` inside JSX expressions (between { and }).

describe('Rule: no .getState() in JSX render-time expressions', () => {
  it('component files do not call .getState() in JSX attributes that evaluate during render', () => {
    const componentDir = join(SRC_DIR, 'components');
    const files = findSourceFiles(componentDir);
    const violations: string[] = [];

    for (const fullPath of files) {
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (!line.includes('.getState()')) continue;

        // .getState() inside event handlers (onClick, onChange, etc.) is fine —
        // event handlers run at event time, not render time.
        // Check: is this line inside an event handler callback?
        // Heuristic: look backwards for the nearest `on[A-Z]` prop or function keyword
        const context = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
        const inEventHandler = /on[A-Z]\w*\s*=\s*\{|on[A-Z]\w*\s*=\s*\(\)|function\s+handle/.test(
          context
        );
        // Also check: is the line itself inside a function body (not the render return)?
        const inFunctionBody =
          /^\s*(?:const|let|var|function|if|for|while|switch|return\s+\w)/.test(line) &&
          !/^\s*return\s*\(/.test(line);

        if (!inEventHandler && !inFunctionBody) {
          // This .getState() is likely in a JSX attribute (className, style, etc.)
          const rel = relative(SRC_DIR, fullPath);
          violations.push(
            `${rel}:${i + 1}: .getState() in render expression — use useUIStore hook.\n` +
              `  Direct store reads during render bypass useSyncExternalStore\n` +
              `  and are invisible to the React Compiler.\n` +
              `  Fix: const value = useUIStore(s => s.field) at component top.\n` +
              `  Note: .getState() in onClick/onChange handlers is fine.`
          );
        }
      }
    }

    expect(violations, violations.join('\n\n')).toEqual([]);
  });
});

// ─── Rule 3: No raw origin strings in doc.transact() ────────────────
//
// Why: Transaction origins control observer routing, undo tracking, and
// Sheets writeback. A raw string ('local', 'sheets') bypasses the type-safe
// ORIGIN constants and could cause silent misrouting.
//
// Fix: Import ORIGIN from src/collab/origins.ts and use ORIGIN.LOCAL,
// ORIGIN.SHEETS, or ORIGIN.INIT.
//
// Pattern caught: doc.transact(..., 'string-literal') in production code.

describe('Rule: no raw origin strings in doc.transact()', () => {
  it('all transact calls use ORIGIN constants, not string literals', () => {
    const files = findSourceFiles(SRC_DIR);
    const violations: string[] = [];

    for (const fullPath of files) {
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match: }, 'local') or }, 'sheets') or }, 'init') or any string literal as transact origin
        if (
          /},\s*['"][a-zA-Z]+['"]\s*\)/.test(line) &&
          /transact/.test(
            content.slice(
              Math.max(0, content.indexOf(line) - 500),
              content.indexOf(line) + line.length
            )
          )
        ) {
          // Verify this is actually a transact call by checking nearby context
          const contextStart = Math.max(0, i - 10);
          const context = lines.slice(contextStart, i + 1).join('\n');
          if (/\.transact\s*\(/.test(context)) {
            const rel = relative(SRC_DIR, fullPath);
            violations.push(
              `${rel}:${i + 1}: raw string origin in transact() — use ORIGIN constant.\n` +
                `  Import { ORIGIN } from 'src/collab/origins' and use\n` +
                `  ORIGIN.LOCAL, ORIGIN.SHEETS, or ORIGIN.INIT.`
            );
          }
        }
      }
    }

    expect(violations, violations.join('\n\n')).toEqual([]);
  });
});
