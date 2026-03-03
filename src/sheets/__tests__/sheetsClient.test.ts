import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff } from '../sheetsClient';

describe('retryWithBackoff', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { initialDelay: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { initialDelay: 1, maxDelay: 10, jitterFactor: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, initialDelay: 1, jitterFactor: 0 }),
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('increases delay exponentially', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms && ms > 0) delays.push(ms);
      return originalSetTimeout(fn, 0); // Execute immediately in tests
    }) as typeof setTimeout);

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockRejectedValueOnce(new Error('fail3'))
      .mockResolvedValue('ok');

    await retryWithBackoff(fn, { initialDelay: 100, maxDelay: 10000, jitterFactor: 0 });

    expect(delays).toHaveLength(3);
    // With jitterFactor=0: delays should be exactly 100, 200, 400
    expect(delays[0]).toBe(100);
    expect(delays[1]).toBe(200);
    expect(delays[2]).toBe(400);

    vi.restoreAllMocks();
  });

  it('respects maxDelay cap', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms && ms > 0) delays.push(ms);
      return originalSetTimeout(fn, 0);
    }) as typeof setTimeout);

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockRejectedValueOnce(new Error('fail3'))
      .mockResolvedValue('ok');

    await retryWithBackoff(fn, { initialDelay: 500, maxDelay: 600, jitterFactor: 0 });

    // 500, min(1000, 600)=600, min(2000, 600)=600
    expect(delays[0]).toBe(500);
    expect(delays[1]).toBe(600);
    expect(delays[2]).toBe(600);

    vi.restoreAllMocks();
  });
});
