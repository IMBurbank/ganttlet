export interface SheetInfo {
  id: string;
  name: string;
  modifiedTime: string; // ISO 8601
  iconLink: string;
}

export async function listUserSheets(token: string): Promise<SheetInfo[]> {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id,name,modifiedTime,iconLink)',
    orderBy: 'modifiedTime desc',
    pageSize: '20',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Drive API error: ${res.status}`);
  }

  const data = (await res.json()) as { files?: SheetInfo[] };
  return data.files ?? [];
}
