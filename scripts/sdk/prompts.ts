/**
 * Strip YAML frontmatter (---...---) from prompt file content.
 * Returns content after the closing --- delimiter.
 * If no frontmatter found, returns original content unchanged.
 */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\n/, '');
}

/**
 * Replace {KEY} placeholders in a prompt with values from a vars map.
 * Only replaces keys present in the map. Unmatched {KEY} patterns are
 * left as-is. Uses split/join (no regex) to avoid injection.
 * Does NOT match ${...} or $(...) bash syntax — only bare {KEY}.
 */
export function substituteVars(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split('{' + key + '}').join(value);
  }
  return result;
}
