import { describe, expect, it } from 'vitest';
import { stateIndexForLevel, unshadedLogicTypeIds } from '../src/content/objects.js';

/**
 * The landscape/object render bindings: the lmlv growth level → GfxFrames state-list index
 * (stateIndexForLevel) and the tree full-bright exemption resolved by name (unshadedLogicTypeIds).
 */

describe('stateIndexForLevel — the lmlv level → GfxFrames state-list index', () => {
  it('counts levels up from the lowest state onto the highest-first lists', () => {
    // A 3-state tree (full-grown, mid, sapling in file order): level 3 = full-grown, level 1 = sapling.
    expect(stateIndexForLevel(3, 3)).toBe(0);
    expect(stateIndexForLevel(2, 3)).toBe(1);
    expect(stateIndexForLevel(1, 3)).toBe(2);
    // A 5-state deposit: level 5 = the full pile (first list), level 1 = the dregs (last).
    expect(stateIndexForLevel(5, 5)).toBe(0);
    expect(stateIndexForLevel(1, 5)).toBe(4);
  });

  it('falls back to the first (full) list for out-of-range levels, incl. the wall intact sentinel', () => {
    expect(stateIndexForLevel(100, 5)).toBe(0);
    expect(stateIndexForLevel(0, 3)).toBe(0);
    expect(stateIndexForLevel(4, 3)).toBe(0);
  });
});

describe('unshadedLogicTypeIds — the tree full-bright exemption resolves by NAME', () => {
  it('collects exactly the tree logic-type ids from the IR landscape table', () => {
    const ids = unshadedLogicTypeIds([
      { typeId: 1, name: 'void' },
      { typeId: 4, name: 'tree' },
      { typeId: 5, name: 'tree falling' },
      { typeId: 6, name: 'trunk' }, // a felled trunk lies ON the ground — shaded like stones
      { typeId: 15, name: 'stones' },
    ]);
    expect([...ids].sort((a, b) => a - b)).toEqual([4, 5]);
  });

  it('is empty for an absent/nameless table (every object then shades — the safe default)', () => {
    expect(unshadedLogicTypeIds(undefined).size).toBe(0);
    expect(unshadedLogicTypeIds([{ typeId: 4 }]).size).toBe(0);
  });
});
