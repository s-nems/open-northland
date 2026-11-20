import { describe, expect, it } from 'vitest';
import { chimneyLookup } from '../../../src/content/building-gfx/chimneys.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';

const VIKING_BODIES = 'data/engine2d/bin/bobs/ls_houses_viking.bmd';
const WORKSHOP_BODIES = 'data/engine2d/bin/bobs/ls_houses_viking2.bmd';
/** A workshop body of its own bob set. */
const SMITHY_BOB = 150;
/** A body of the default building atlas. */
const HOME_BOB = 11;
const WELL_BOB = 131;

const IR: ContentIr = {
  buildingChimneyPoints: [
    { bmd: WORKSHOP_BODIES, bobId: SMITHY_BOB, x: -80, y: -120, smoke: 'forge' },
    { bmd: WORKSHOP_BODIES, bobId: SMITHY_BOB, x: 12, y: -90, smoke: 'forge' },
    { bmd: VIKING_BODIES, bobId: HOME_BOB, x: -5, y: -119, smoke: 'hearth' },
  ],
};

describe('chimneyLookup', () => {
  it('gives a body every one of its chimneys, under any palette', () => {
    const lookup = chimneyLookup(IR);
    const plain = lookup('ls_houses_viking2.house01', SMITHY_BOB);
    expect(plain).toEqual([
      { x: -80, y: -120, smoke: 'forge' },
      { x: 12, y: -90, smoke: 'forge' },
    ]);
    expect(lookup('ls_houses_viking2.player_03', SMITHY_BOB)).toBe(plain);
  });

  it('reads a body without a layer from the default building atlas', () => {
    const lookup = chimneyLookup(IR);
    expect(lookup(undefined, HOME_BOB)).toEqual([{ x: -5, y: -119, smoke: 'hearth' }]);
    expect(lookup(undefined, WELL_BOB)).toBeUndefined();
  });

  it('finds no chimney without content', () => {
    expect(chimneyLookup(null)(undefined, HOME_BOB)).toBeUndefined();
  });
});
