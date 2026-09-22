import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetSetFor, presentationPack } from '../../src/custom/pack.js';

afterEach(() => vi.unstubAllGlobals());

function stubStorage(initial: string | null) {
  let value = initial;
  vi.stubGlobal('localStorage', {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  });
  return () => value;
}

describe('custom asset set selection', () => {
  it('defaults to the custom art and remembers an explicit choice', () => {
    const stored = stubStorage(null);
    expect(assetSetFor(new URLSearchParams())).toBe('custom');
    expect(assetSetFor(new URLSearchParams('assets=original'))).toBe('original');
    expect(stored()).toBe('original');
    expect(assetSetFor(new URLSearchParams())).toBe('original');
    expect(assetSetFor(new URLSearchParams('assets=invalid'))).toBe('original');
  });

  it('draws the original art only when development asks for it', () => {
    stubStorage(null);
    expect(presentationPack(new URLSearchParams())).not.toBeNull();
    expect(presentationPack(new URLSearchParams('assets=original'))).toBeNull();
  });

  it('survives unavailable storage', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    expect(assetSetFor(new URLSearchParams('assets=original'))).toBe('original');
    expect(assetSetFor(new URLSearchParams())).toBe('custom');
  });
});
