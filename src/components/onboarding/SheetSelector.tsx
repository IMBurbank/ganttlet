import React, { useState, useEffect, useCallback } from 'react';
import { getAccessToken } from '../../sheets/oauth';
import { listUserSheets, type SheetInfo } from '../../sheets/sheetsBrowser';
import { parseSheetUrl } from '../../utils/parseSheetUrl';

interface SheetSelectorProps {
  onSelectSheet: (sheetId: string) => void;
}

export default function SheetSelector({ onSelectSheet }: SheetSelectorProps) {
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      setError('Not signed in');
      return;
    }
    listUserSheets(token)
      .then((result) => {
        setSheets(result);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load sheets');
        setLoading(false);
      });
  }, []);

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUrlInput(value);
    if (!value.trim()) {
      setUrlError(null);
      setSelectedId(null);
      return;
    }
    const id = parseSheetUrl(value);
    if (id) {
      setUrlError(null);
      setSelectedId(id);
    } else {
      setUrlError("Couldn't find a spreadsheet ID in this URL");
      setSelectedId(null);
    }
  }, []);

  const handleSelectFromList = useCallback((id: string) => {
    setSelectedId(id);
    setUrlInput('');
    setUrlError(null);
  }, []);

  const handleConnect = useCallback(() => {
    if (selectedId) {
      onSelectSheet(selectedId);
    }
  }, [selectedId, onSelectSheet]);

  return (
    <div className="flex flex-col gap-6 p-6 bg-surface-base rounded-xl max-w-lg w-full shadow-lg">
      <h2 className="text-xl font-semibold text-text-primary">Select a spreadsheet</h2>

      {/* Drive listing */}
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-text-muted mb-1">Your spreadsheets</h3>
        <div className="max-h-64 overflow-y-auto border border-border-default rounded-lg">
          {loading && (
            <p className="p-4 text-text-muted text-sm" data-testid="sheets-loading">
              Loading…
            </p>
          )}
          {error && (
            <p className="p-4 text-red-500 text-sm" data-testid="sheets-error">
              {error}
            </p>
          )}
          {!loading && !error && sheets.length === 0 && (
            <p className="p-4 text-text-muted text-sm">No spreadsheets found</p>
          )}
          {sheets.map((sheet) => (
            <button
              key={sheet.id}
              onClick={() => handleSelectFromList(sheet.id)}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface-hover transition-colors ${
                selectedId === sheet.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
              }`}
              data-testid={`sheet-item-${sheet.id}`}
            >
              {sheet.iconLink && <img src={sheet.iconLink} alt="" className="w-5 h-5" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary truncate">{sheet.name}</div>
                <div className="text-xs text-text-muted">
                  {new Date(sheet.modifiedTime).toLocaleDateString()}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* URL paste */}
      <div className="flex flex-col gap-1">
        <label htmlFor="sheet-url-input" className="text-sm font-medium text-text-muted">
          Or paste a spreadsheet URL
        </label>
        <input
          id="sheet-url-input"
          type="text"
          value={urlInput}
          onChange={handleUrlChange}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className="px-3 py-2 border border-border-default rounded-lg text-sm bg-surface-base text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="url-input"
        />
        {urlError && (
          <p className="text-red-500 text-xs mt-1" data-testid="url-error">
            {urlError}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleConnect}
          disabled={!selectedId}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          data-testid="connect-button"
        >
          Connect
        </button>
        <button
          disabled
          className="px-4 py-2 border border-border-default text-text-muted rounded-lg opacity-50 cursor-not-allowed text-sm font-medium"
          data-testid="create-new-button"
        >
          Create New Sheet
        </button>
      </div>
    </div>
  );
}
