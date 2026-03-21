// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { stripFrontmatter, substituteVars } from '../prompts.js';

describe('stripFrontmatter', () => {
  it('strips frontmatter', () => {
    const input = '---\nfoo: bar\n---\nContent here';
    expect(stripFrontmatter(input)).toBe('Content here');
  });

  it('returns original when no frontmatter', () => {
    const input = 'No frontmatter here';
    expect(stripFrontmatter(input)).toBe('No frontmatter here');
  });

  it('returns original when no closing delimiter', () => {
    const input = '---\nfoo: bar\nContent here';
    expect(stripFrontmatter(input)).toBe(input);
  });

  it('handles empty content after frontmatter', () => {
    const input = '---\nfoo: bar\n---\n';
    expect(stripFrontmatter(input)).toBe('');
  });

  it('handles multi-line frontmatter', () => {
    const input = '---\nfoo: bar\nbaz: qux\nskip-plan-mode: true\n---\nBody';
    expect(stripFrontmatter(input)).toBe('Body');
  });
});

describe('substituteVars', () => {
  it('single var replacement', () => {
    expect(substituteVars('Hello {NAME}', { NAME: 'World' })).toBe('Hello World');
  });

  it('multiple vars', () => {
    expect(substituteVars('{A} and {B}', { A: 'foo', B: 'bar' })).toBe('foo and bar');
  });

  it('unmatched vars left alone', () => {
    expect(substituteVars('{A} and {B}', { A: 'foo' })).toBe('foo and {B}');
  });

  it('empty vars map is no-op', () => {
    expect(substituteVars('{A}', {})).toBe('{A}');
  });

  it('does not match ${...} bash syntax', () => {
    const content = '${HOME} and {NAME}';
    expect(substituteVars(content, { HOME: 'replaced', NAME: 'yes' })).toBe('${HOME} and yes');
  });

  it('does not match $(...) bash syntax', () => {
    const content = '$(echo hi) and {CMD}';
    expect(substituteVars(content, { CMD: 'replaced' })).toBe('$(echo hi) and replaced');
  });

  it('works with reviewer template placeholders', () => {
    const template =
      'Review angle: {ANGLE}\n\nTarget skill: .claude/skills/{SKILL}/SKILL.md\n\nRun `find docs -name "*.md"`';
    const result = substituteVars(template, { SKILL: 'hooks', ANGLE: 'accuracy' });
    expect(result).toBe(
      'Review angle: accuracy\n\nTarget skill: .claude/skills/hooks/SKILL.md\n\nRun `find docs -name "*.md"`'
    );
  });

  it('replaces all occurrences of same key', () => {
    expect(substituteVars('{X} {X} {X}', { X: 'a' })).toBe('a a a');
  });
});
