// Token state
export interface AuthState {
  accessToken: string | null;
  userEmail: string | null;
  userName: string | null;
  userPicture: string | null;
  expiresAt: number;
}

const STORAGE_KEY = 'ganttlet_auth';

let authState: AuthState = {
  accessToken: null,
  userEmail: null,
  userName: null,
  userPicture: null,
  expiresAt: 0,
};

let tokenClient: google.accounts.oauth2.TokenClient | null = null;
let renewalTimer: ReturnType<typeof setTimeout> | null = null;
const authChangeListeners = new Set<(state: AuthState) => void>();

export function setAuthChangeCallback(cb: (state: AuthState) => void) {
  authChangeListeners.add(cb);
}

export function removeAuthChangeCallback(cb: (state: AuthState) => void) {
  authChangeListeners.delete(cb);
}

function notifyAuthChange() {
  for (const cb of authChangeListeners) {
    cb(authState);
  }
}

function persistAuth() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      accessToken: authState.accessToken,
      userEmail: authState.userEmail,
      userName: authState.userName,
      userPicture: authState.userPicture,
      expiresAt: authState.expiresAt,
    }));
  } catch { /* localStorage may be unavailable */ }
}

function clearPersistedAuth() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

function restoreSession(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as AuthState;
    if (!stored.accessToken || Date.now() >= stored.expiresAt) {
      clearPersistedAuth();
      return false;
    }
    authState = { ...stored };
    scheduleRenewal();
    return true;
  } catch {
    clearPersistedAuth();
    return false;
  }
}

function scheduleRenewal() {
  if (renewalTimer) clearTimeout(renewalTimer);
  const msUntilExpiry = authState.expiresAt - Date.now();
  // Renew 60s before expiry, but at least 10s from now
  const renewIn = Math.max(msUntilExpiry - 60_000, 10_000);
  renewalTimer = setTimeout(() => {
    if (tokenClient) {
      // prompt: '' = silent renewal (no popup if consent already granted)
      tokenClient.requestAccessToken({ prompt: '' });
    }
  }, renewIn);
}

export function getAuthState(): AuthState {
  return authState;
}

export function getAccessToken(): string | null {
  if (authState.accessToken && Date.now() < authState.expiresAt) {
    return authState.accessToken;
  }
  return null;
}

export function isSignedIn(): boolean {
  return !!getAccessToken();
}

export function initOAuth(): void {
  const clientId = window.__ganttlet_config?.googleClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.warn('Google OAuth client ID not configured');
    return;
  }

  // Wait for GIS library to load
  if (typeof google === 'undefined' || !google.accounts) {
    console.warn('Google Identity Services not loaded');
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    callback: handleTokenResponse,
  });

  // Restore session from localStorage (survives page refresh)
  if (restoreSession()) {
    notifyAuthChange();
  }
}

function handleTokenResponse(response: google.accounts.oauth2.TokenResponse) {
  if (response.error) {
    console.error('OAuth error:', response.error);
    return;
  }

  authState = {
    ...authState,
    accessToken: response.access_token,
    expiresAt: Date.now() + (parseInt(response.expires_in) * 1000),
  };

  scheduleRenewal();

  // Fetch user info
  fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${response.access_token}` },
  })
    .then(res => res.json())
    .then(info => {
      authState = {
        ...authState,
        userEmail: info.email || null,
        userName: info.name || null,
        userPicture: info.picture || null,
      };
      persistAuth();
      notifyAuthChange();
    })
    .catch(() => {
      persistAuth();
      notifyAuthChange();
    });
}

export function signIn(): void {
  if (!tokenClient) {
    initOAuth();
  }
  if (tokenClient) {
    tokenClient.requestAccessToken();
  }
}

export function signOut(): void {
  if (renewalTimer) clearTimeout(renewalTimer);
  clearPersistedAuth();
  if (authState.accessToken) {
    google.accounts.oauth2.revoke(authState.accessToken, () => {
      authState = {
        accessToken: null,
        userEmail: null,
        userName: null,
        userPicture: null,
        expiresAt: 0,
      };
      notifyAuthChange();
    });
  }
}

// Expose test auth setter in development mode for E2E testing
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ganttlet_setTestAuth = (token: string) => {
    authState = {
      accessToken: token,
      userEmail: `test-${token}@example.com`,
      userName: `Test User ${token}`,
      userPicture: null,
      expiresAt: Date.now() + 3600000,
    };
    notifyAuthChange();
  };
}

// Exported for unit testing only
export const _testing = {
  persistAuth,
  clearPersistedAuth,
  restoreSession,
  resetState: () => {
    authState = { accessToken: null, userEmail: null, userName: null, userPicture: null, expiresAt: 0 };
    tokenClient = null;
    if (renewalTimer) clearTimeout(renewalTimer);
    renewalTimer = null;
    authChangeListeners.clear();
  },
  STORAGE_KEY,
};
