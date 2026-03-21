/**
 * Extract a Google Sheets spreadsheet ID from a URL.
 * Returns null if the URL does not match the expected pattern.
 */
export function parseSheetUrl(url: string): string | null {
  const match = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
