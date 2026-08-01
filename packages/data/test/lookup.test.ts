import { describe, expect, it } from 'vitest';
import { firstByTypeId, lastByTypeId } from '../src/index.js';

/**
 * The two duplicate-key rules a `typeId` table can be read under. No schema enforces typeId
 * uniqueness, and the two rules resolve a duplicate to different rows, so the pair must stay
 * distinguishable: the sim's read tables resolve first-wins, its command boundary last-wins.
 */
describe('typeId indexes', () => {
  const base = { typeId: 6, id: 'base' };
  const shadow = { typeId: 6, id: 'shadow' };
  const other = { typeId: 7, id: 'other' };

  it('keeps the first source-order row per typeId', () => {
    const map = firstByTypeId([base, shadow, other]);
    expect(map.get(base.typeId)).toBe(base);
    expect(map.get(other.typeId)).toBe(other);
  });

  it('keeps the last source-order row per typeId', () => {
    const map = lastByTypeId([base, shadow, other]);
    expect(map.get(shadow.typeId)).toBe(shadow);
    expect(map.get(other.typeId)).toBe(other);
  });
});
