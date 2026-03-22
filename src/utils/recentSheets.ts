export type RecentSheet = { sheetId: string; title: string; lastOpened: number };

const STORAGE_KEY = 'ganttlet-recent-sheets';
const MAX_ENTRIES = 10;

export function getRecentSheets(): RecentSheet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentSheet[];
  } catch {
    return [];
  }
}

export function addRecentSheet(sheet: RecentSheet): void {
  const sheets = getRecentSheets().filter((s) => s.sheetId !== sheet.sheetId);
  sheets.unshift(sheet);
  if (sheets.length > MAX_ENTRIES) {
    sheets.length = MAX_ENTRIES;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sheets));
  } catch {
    /* localStorage may be unavailable */
  }
}

export function removeRecentSheet(sheetId: string): void {
  const sheets = getRecentSheets().filter((s) => s.sheetId !== sheetId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sheets));
  } catch {
    /* localStorage may be unavailable */
  }
}
