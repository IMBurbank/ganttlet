import type { SyncError } from '../types';

export function classifySyncError(err: unknown): SyncError {
  if (err instanceof Response) {
    switch (err.status) {
      case 401:
        return { type: 'auth', message: 'Session expired', since: Date.now() };
      case 403:
        return { type: 'forbidden', message: 'Access denied', since: Date.now() };
      case 404:
        return { type: 'not_found', message: 'Sheet not found', since: Date.now() };
      case 429:
        return { type: 'rate_limit', message: 'Rate limited', since: Date.now() };
      default:
        return { type: 'network', message: `HTTP ${err.status}`, since: Date.now() };
    }
  }
  if (err instanceof TypeError) {
    return { type: 'network', message: 'Network error', since: Date.now() };
  }
  if (err instanceof Error && err.message === 'HEADER_MISMATCH') {
    return {
      type: 'header_mismatch',
      message: 'Sheet headers do not match expected format',
      since: Date.now(),
    };
  }
  return { type: 'network', message: String(err), since: Date.now() };
}
