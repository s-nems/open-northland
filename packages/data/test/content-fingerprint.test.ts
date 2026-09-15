import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contentFingerprint, IR_VERSION, jsonFingerprint, parseContentSet } from '../src/index.js';

function content() {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { mod: '/owner/game' } },
    goods: [
      { typeId: 1, id: 'water' },
      { typeId: 2, id: 'wood' },
    ],
    jobs: [],
    buildings: [],
  });
}

describe('content fingerprints', () => {
  it('ignores local paths and display names while retaining row order', () => {
    const original = content();
    const moved = structuredClone(original);
    moved.manifest.generatedFrom.mod = '/another/installation';
    moved.manifest.locale = 'pol';
    moved.goods = moved.goods.map((good) => ({ ...good, name: 'translated' }));
    expect(contentFingerprint(moved)).toBe(contentFingerprint(original));
    moved.goods.reverse();
    expect(contentFingerprint(moved)).not.toBe(contentFingerprint(original));
  });

  it('detects id remapping and balance changes', () => {
    const original = content();
    for (const patch of [{ id: 'stone' }, { typeId: 7 }, { weight: 11 }]) {
      const changed = { ...original, goods: original.goods.map((good) => ({ ...good, ...patch })) };
      expect(contentFingerprint(changed)).not.toBe(contentFingerprint(original));
    }
  });

  it('hashes canonical JSON with standard SHA-256 and keeps array order', () => {
    const expected = createHash('sha256').update('{"a":"żółw","b":[1,2]}').digest('hex');
    expect(jsonFingerprint({ b: [1, 2], a: 'żółw' })).toBe(expected);
    expect(jsonFingerprint({ a: 'żółw', b: [2, 1] })).not.toBe(expected);
    expect(() => jsonFingerprint({ b: Number.NaN })).toThrow();
    expect(() => jsonFingerprint(new Map())).toThrow();
  });
});
