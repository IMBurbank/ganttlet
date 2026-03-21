import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TemplatePicker from '../TemplatePicker';

describe('TemplatePicker', () => {
  it('renders all template cards', () => {
    render(<TemplatePicker onSelect={vi.fn()} />);

    expect(screen.getByTestId('template-picker')).toBeTruthy();
    expect(screen.getByTestId('template-card-blank')).toBeTruthy();
    expect(screen.getByTestId('template-card-software-release')).toBeTruthy();
    expect(screen.getByTestId('template-card-marketing-campaign')).toBeTruthy();
    expect(screen.getByTestId('template-card-event-planning')).toBeTruthy();
  });

  it('displays template name, description, and task count', () => {
    render(<TemplatePicker onSelect={vi.fn()} />);

    expect(screen.getByText('Software Release')).toBeTruthy();
    expect(screen.getByText('Marketing Campaign')).toBeTruthy();
    expect(screen.getByText('Event Planning')).toBeTruthy();
    expect(screen.getByText('Blank Project')).toBeTruthy();
  });

  it('fires onSelect with template id when card is clicked', () => {
    const onSelect = vi.fn();
    render(<TemplatePicker onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('template-card-marketing-campaign'));
    expect(onSelect).toHaveBeenCalledWith('marketing-campaign');
  });

  it('renders close button when onClose provided', () => {
    const onClose = vi.fn();
    render(<TemplatePicker onSelect={vi.fn()} onClose={onClose} />);

    const closeBtn = screen.getByTestId('template-picker-close');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking backdrop', () => {
    const onClose = vi.fn();
    render(<TemplatePicker onSelect={vi.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('template-picker'));
    expect(onClose).toHaveBeenCalled();
  });
});
