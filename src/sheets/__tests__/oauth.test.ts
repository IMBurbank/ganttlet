import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAuthState,
  getAccessToken,
  isSignedIn,
  setAuthChangeCallback,
  removeAuthChangeCallback,
  _testing,
} from '../oauth';

const { persistAuth, clearPersistedAuth, restoreSession, resetState, STORAGE_KEY } = _testing;

describe('oauth token persistence', () => {
  beforeEach(() => {
    resetState();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('persistAuth / restoreSession', () => {
    it('persists auth state to localStorage', () => {
      // Manually set state via the test helper, then persist
      ((window as unknown as Record<string, (t: string) => void>).__ganttlet_setTestAuth)('tok-1');
      persistAuth();

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.accessToken).toBe('tok-1');
      expect(stored.userEmail).toBe('test-tok-1@example.com');
      expect(stored.expiresAt).toBeGreaterThan(Date.now());
    });

    it('restores valid session from localStorage', () => {
      const future = Date.now() + 3600000;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        accessToken: 'restored-token',
        userEmail: 'user@example.com',
        userName: 'Test User',
        userPicture: null,
        expiresAt: future,
      }));

      resetState();
      const restored = restoreSession();
      expect(restored).toBe(true);

      const state = getAuthState();
      expect(state.accessToken).toBe('restored-token');
      expect(state.userEmail).toBe('user@example.com');
      expect(getAccessToken()).toBe('restored-token');
      expect(isSignedIn()).toBe(true);
    });

    it('rejects expired tokens from localStorage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        accessToken: 'expired-token',
        userEmail: 'user@example.com',
        userName: 'Test',
        userPicture: null,
        expiresAt: Date.now() - 1000, // expired
      }));

      resetState();
      const restored = restoreSession();
      expect(restored).toBe(false);
      expect(getAccessToken()).toBeNull();
      expect(isSignedIn()).toBe(false);
      // Should have cleared the expired entry
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('handles missing localStorage gracefully', () => {
      resetState();
      const restored = restoreSession();
      expect(restored).toBe(false);
      expect(getAccessToken()).toBeNull();
    });

    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem(STORAGE_KEY, 'not-json');
      resetState();
      const restored = restoreSession();
      expect(restored).toBe(false);
      // Should have cleared the corrupted entry
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('clearPersistedAuth', () => {
    it('removes auth from localStorage', () => {
      localStorage.setItem(STORAGE_KEY, '{"accessToken":"x"}');
      clearPersistedAuth();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('getAccessToken', () => {
    it('returns null when no token', () => {
      expect(getAccessToken()).toBeNull();
    });

    it('returns token when valid and not expired', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        accessToken: 'valid',
        userEmail: null,
        userName: null,
        userPicture: null,
        expiresAt: Date.now() + 60000,
      }));
      restoreSession();
      expect(getAccessToken()).toBe('valid');
    });
  });

  describe('auth change listeners', () => {
    it('notifies listeners on state change', () => {
      const listener = vi.fn();
      setAuthChangeCallback(listener);

      // Trigger via test auth hook
      ((window as unknown as Record<string, (t: string) => void>).__ganttlet_setTestAuth)('notify-test');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        accessToken: 'notify-test',
      }));

      removeAuthChangeCallback(listener);
      ((window as unknown as Record<string, (t: string) => void>).__ganttlet_setTestAuth)('after-remove');
      expect(listener).toHaveBeenCalledTimes(1); // not called again
    });
  });
});
