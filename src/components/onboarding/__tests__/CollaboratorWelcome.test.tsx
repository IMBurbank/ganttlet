import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CollaboratorWelcome from '../CollaboratorWelcome';

vi.mock('../../../sheets/oauth', () => ({
  signIn: vi.fn(),
}));

describe('CollaboratorWelcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders invitation message', () => {
    render(<CollaboratorWelcome />);
    expect(screen.getByTestId('collaborator-title').textContent).toContain(
      "You've been invited to collaborate on a project"
    );
  });

  it('renders sign in button only', () => {
    render(<CollaboratorWelcome />);
    expect(screen.getByTestId('collaborator-sign-in-button')).toBeTruthy();
    // No demo or new project buttons
    expect(screen.queryByTestId('try-demo-button')).toBeNull();
    expect(screen.queryByTestId('new-project-button')).toBeNull();
  });

  it('calls signIn when button is clicked', async () => {
    const oauth = await import('../../../sheets/oauth');
    render(<CollaboratorWelcome />);

    fireEvent.click(screen.getByTestId('collaborator-sign-in-button'));
    expect(oauth.signIn).toHaveBeenCalled();
  });
});
