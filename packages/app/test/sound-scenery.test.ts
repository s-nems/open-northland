import { describe, expect, it } from 'vitest';
import { soundScenery } from '../src/content/sound-scenery.js';

/**
 * The map's scenery for the object ambience: every placement the sim holds no entity for, by the
 * `[GfxLandscape]` record its edit name joins.
 */

const SIREN_RECORD = 9;
const STONE_RECORD = 12;
const ir = {
  landscapeGfx: [
    { index: SIREN_RECORD, editName: 'sirens 01', logicType: 0 },
    { index: STONE_RECORD, editName: 'stone grey 01', logicType: 0 },
  ],
};

describe('soundScenery', () => {
  it('yields the placements the sim does not hold, with their record and node', () => {
    const objects = {
      types: ['sirens 01', 'stone grey 01', 'no record'],
      // `[hx, hy, typeIndex]` triples: a siren, a stone the sim spawned, an unknown name, a second siren.
      placements: [4, 6, 0, 8, 10, 1, 2, 2, 2, 12, 14, 0],
    };
    const simHeld = [1];
    expect([...soundScenery(objects, ir, simHeld)]).toEqual([
      { id: 0, record: SIREN_RECORD, hx: 4, hy: 6 },
      { id: 3, record: SIREN_RECORD, hx: 12, hy: 14 },
    ]);
  });
});
