import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@/lib/clipboard';

/*
 * UX audit #18: the packaged app has no console (lib/utils.ts), so clipboard
 * failures must NEVER end in "logged to console". copyText reports honestly —
 * callers open the manual-copy modal when it returns false.
 */

describe('copyText', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves true via the async clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    vi.unstubAllGlobals();
  });

  it('falls back to execCommand when the async clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('window not focused'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('hello')).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    vi.unstubAllGlobals();
  });

  it('resolves false (never throws) when both mechanisms fail', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    document.execCommand = vi.fn(() => {
      throw new Error('unsupported');
    });
    expect(await copyText('hello')).toBe(false);
    vi.unstubAllGlobals();
  });
});
