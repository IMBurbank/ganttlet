import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const mockUIState = {
  syncError: null as import('../../../types').SyncError | null,
  dataSource: 'loading' as string | undefined,
};

vi.mock('../../../hooks', () => ({
  useUIStore: (selector: (s: typeof mockUIState) => unknown) => selector(mockUIState),
}));

vi.mock('../../../sheets/sheetsMapper', () => ({
  SHEET_COLUMNS: ['id', 'name', 'startDate', 'endDate', 'duration'],
}));

import HeaderMismatchError from '../HeaderMismatchError';

describe('HeaderMismatchError', () => {
  beforeEach(() => {
    mockUIState.syncError = null;
    mockUIState.dataSource = 'loading';
  });

  it('renders nothing when no header_mismatch error', () => {
    const { container } = render(<HeaderMismatchError />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when header_mismatch but dataSource is not loading', () => {
    mockUIState.syncError = { type: 'header_mismatch', message: 'Mismatch', since: Date.now() };
    mockUIState.dataSource = 'sheet';
    const { container } = render(<HeaderMismatchError />);
    expect(container.firstChild).toBeNull();
  });

  it('renders mismatch screen when header_mismatch + loading', () => {
    mockUIState.syncError = { type: 'header_mismatch', message: 'Mismatch', since: Date.now() };
    render(<HeaderMismatchError />);
    expect(screen.getByTestId('header-mismatch-error')).toBeTruthy();
    expect(screen.getByText('Column Mismatch')).toBeTruthy();
  });

  it('shows expected columns', () => {
    mockUIState.syncError = { type: 'header_mismatch', message: 'Mismatch', since: Date.now() };
    render(<HeaderMismatchError />);
    const list = screen.getByTestId('expected-columns');
    expect(list.textContent).toContain('id');
    expect(list.textContent).toContain('name');
    expect(list.textContent).toContain('startDate');
  });

  it('has Create a new sheet button', () => {
    mockUIState.syncError = { type: 'header_mismatch', message: 'Mismatch', since: Date.now() };
    render(<HeaderMismatchError />);
    expect(screen.getByTestId('create-new-sheet-btn')).toBeTruthy();
  });

  it('has Download header template button that creates CSV', () => {
    mockUIState.syncError = { type: 'header_mismatch', message: 'Mismatch', since: Date.now() };

    const mockUrl = 'blob:test';
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn().mockReturnValue(mockUrl);
    (globalThis as Record<string, unknown>).URL = {
      ...globalThis.URL,
      createObjectURL,
      revokeObjectURL,
    };

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    });

    render(<HeaderMismatchError />);
    fireEvent.click(screen.getByTestId('download-template-btn'));

    expect(createObjectURL).toHaveBeenCalled();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith(mockUrl);
  });
});
