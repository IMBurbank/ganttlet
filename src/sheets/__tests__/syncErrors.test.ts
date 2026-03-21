import { describe, it, expect } from 'vitest';
import { classifySyncError } from '../syncErrors';

describe('classifySyncError', () => {
  it('classifies 401 as auth error', () => {
    const err = new Response(null, { status: 401 });
    const result = classifySyncError(err);
    expect(result.type).toBe('auth');
    expect(result.message).toBe('Session expired');
    expect(result.since).toBeGreaterThan(0);
  });

  it('classifies 403 as forbidden', () => {
    const err = new Response(null, { status: 403 });
    expect(classifySyncError(err).type).toBe('forbidden');
  });

  it('classifies 404 as not_found', () => {
    const err = new Response(null, { status: 404 });
    expect(classifySyncError(err).type).toBe('not_found');
  });

  it('classifies 429 as rate_limit', () => {
    const err = new Response(null, { status: 429 });
    expect(classifySyncError(err).type).toBe('rate_limit');
  });

  it('classifies other HTTP status as network', () => {
    const err = new Response(null, { status: 500 });
    const result = classifySyncError(err);
    expect(result.type).toBe('network');
    expect(result.message).toBe('HTTP 500');
  });

  it('classifies TypeError as network error', () => {
    const err = new TypeError('Failed to fetch');
    const result = classifySyncError(err);
    expect(result.type).toBe('network');
    expect(result.message).toBe('Network error');
  });

  it('classifies unknown errors as network with string message', () => {
    const result = classifySyncError('something went wrong');
    expect(result.type).toBe('network');
    expect(result.message).toBe('something went wrong');
  });
});
