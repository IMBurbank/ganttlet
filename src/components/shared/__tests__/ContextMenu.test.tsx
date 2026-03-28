import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import ContextMenu from '../ContextMenu';

describe('ContextMenu', () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(document, 'addEventListener');
    removeSpy = vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    cleanup();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('attaches mousedown listener once on mount', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={100} y={200} items={[]} onClose={onClose} />);

    const mousedownCalls = addSpy.mock.calls.filter(
      ([type]: [string, ...unknown[]]) => type === 'mousedown'
    );
    expect(mousedownCalls).toHaveLength(1);
  });

  it('does not re-attach listener when onClose changes', () => {
    const onClose1 = vi.fn();
    const { rerender } = render(<ContextMenu x={100} y={200} items={[]} onClose={onClose1} />);

    const initialCount = addSpy.mock.calls.filter(
      ([type]: [string, ...unknown[]]) => type === 'mousedown'
    ).length;

    // Re-render with a new onClose function reference
    const onClose2 = vi.fn();
    rerender(<ContextMenu x={100} y={200} items={[]} onClose={onClose2} />);

    const afterCount = addSpy.mock.calls.filter(
      ([type]: [string, ...unknown[]]) => type === 'mousedown'
    ).length;
    expect(afterCount).toBe(initialCount); // No new listener attached
  });

  it('calls the latest onClose when clicking outside (ref pattern)', () => {
    const onClose1 = vi.fn();
    const { rerender } = render(<ContextMenu x={100} y={200} items={[]} onClose={onClose1} />);

    // Update to a new onClose
    const onClose2 = vi.fn();
    rerender(<ContextMenu x={100} y={200} items={[]} onClose={onClose2} />);

    // Click outside the menu
    fireEvent.mouseDown(document.body);

    // The LATEST onClose should be called, not the stale one
    expect(onClose1).not.toHaveBeenCalled();
    expect(onClose2).toHaveBeenCalledTimes(1);
  });

  it('calls item onClick and onClose when a menu item is clicked', () => {
    const onClose = vi.fn();
    const itemClick = vi.fn();
    const items = [{ label: 'Delete', onClick: itemClick, danger: true }];

    const { getByRole } = render(<ContextMenu x={100} y={200} items={items} onClose={onClose} />);

    fireEvent.click(getByRole('button', { name: 'Delete' }));

    expect(itemClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('removes listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(<ContextMenu x={100} y={200} items={[]} onClose={onClose} />);

    unmount();

    const mousedownRemoves = removeSpy.mock.calls.filter(
      ([type]: [string, ...unknown[]]) => type === 'mousedown'
    );
    expect(mousedownRemoves).toHaveLength(1);
  });
});
