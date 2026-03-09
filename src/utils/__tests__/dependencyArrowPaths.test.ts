import { describe, it, expect } from 'vitest';
import { createBezierPath, createArrowHead } from '../dependencyUtils';

/** Parse first L command's x-coordinate from an SVG path string */
function firstLx(path: string): number {
  const match = path.match(/L\s+([-\d.]+)/);
  if (!match) throw new Error('No L command found in path: ' + path);
  return parseFloat(match[1]);
}

describe('createBezierPath', () => {
  const start = { x: 100, y: 50 };
  const endFar = { x: 200, y: 80 };   // dx=100 > 10, forward
  const endNear = { x: 105, y: 80 };   // dx=5 <= 10, backward

  it('SF forward (dx > 10) returns simple bezier', () => {
    const path = createBezierPath(start, endFar, 'SF');
    expect(path).toMatch(/^M .* C /);
    expect(path).not.toMatch(/L /);
  });

  it('SF backward (dx <= 10) routes LEFT from start, RIGHT to end', () => {
    const path = createBezierPath(start, endNear, 'SF');
    const lx = firstLx(path);
    // First L should go left from start (x < start.x)
    expect(lx).toBeLessThan(start.x);
  });

  it('FS backward (dx <= 10) routes RIGHT from start, LEFT to end (regression)', () => {
    const path = createBezierPath(start, endNear, 'FS');
    const lx = firstLx(path);
    // First L should go right from start (x > start.x)
    expect(lx).toBeGreaterThan(start.x);
  });

  it('FF routes right (same direction)', () => {
    const path = createBezierPath(start, endFar, 'FF');
    const lx = firstLx(path);
    // FF goes right — farX is max(start.x, end.x) + outset
    expect(lx).toBeGreaterThan(Math.max(start.x, endFar.x));
  });

  it('SS routes left (same direction)', () => {
    const path = createBezierPath(start, endFar, 'SS');
    const lx = firstLx(path);
    // SS goes left — farX is min(start.x, end.x) - outset
    expect(lx).toBeLessThan(Math.min(start.x, endFar.x));
  });
});

describe('createArrowHead', () => {
  const end = { x: 200, y: 50 };

  it('SF arrowhead tip points left (toward bar end)', () => {
    const path = createArrowHead(end, 'SF');
    // Tip is at end.x - size = 195
    expect(path).toMatch(/^M 195 50/);
  });

  it('FS arrowhead tip points right (toward bar start)', () => {
    const path = createArrowHead(end, 'FS');
    // Tip is at end.x + size = 205
    expect(path).toMatch(/^M 205 50/);
  });
});
