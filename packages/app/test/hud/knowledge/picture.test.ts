import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { buildingPicture } from '../../../src/hud/knowledge/picture.js';

const VIKING = 1;
const WONDER_TRIBE = 5;
const COLOSSUS = 49;
const LIGHT_BOB = 6;

const row = (level: number, bobId: number) => ({
  tribeId: WONDER_TRIBE,
  typeId: COLOSSUS,
  level,
  bmd: 'bobs/ls_wonders3.bmd',
  paletteName: 'oxcart',
  bobId,
  editName: 'wonder',
});

describe('buildingPicture', () => {
  it('draws a wonder at its last stage, under any tribe', () => {
    const ir = { buildingBobs: [row(0, 3), row(1, 2), row(3, 0)] } as unknown as ContentIr;
    expect(buildingPicture(ir, COLOSSUS, VIKING)).toEqual([
      { stem: 'ls_wonders3.oxcart', bob: 0, x: 0, y: 0 },
    ]);
  });

  it("adds the landscape parts its body's record names", () => {
    const ir = {
      buildingBobs: [row(1, 2)],
      buildingLandscapeOverlays: [
        {
          tribeId: WONDER_TRIBE,
          typeId: COLOSSUS,
          level: 1,
          slot: 0,
          x: 4,
          y: 5,
          landscape: 'light',
          editName: 'wonder',
        },
        {
          tribeId: WONDER_TRIBE,
          typeId: COLOSSUS,
          level: 1,
          slot: 1,
          x: 0,
          y: 0,
          landscape: 'other',
          editName: 'else',
        },
      ],
      landscapeGfx: [
        {
          editName: 'light',
          bmd: 'bobs/ls_wonders3.bmd',
          paletteName: 'light',
          frames: [{ state: 1, bobIds: [LIGHT_BOB] }],
        },
        { editName: 'other', bmd: 'bobs/x.bmd', paletteName: 'y', frames: [{ state: 1, bobIds: [1] }] },
      ],
    } as unknown as ContentIr;
    expect(buildingPicture(ir, COLOSSUS, VIKING)?.[1]).toEqual({
      stem: 'ls_wonders3.light',
      bob: LIGHT_BOB,
      x: 4,
      y: 5,
    });
    expect(buildingPicture(ir, COLOSSUS, VIKING)).toHaveLength(2);
  });

  it('takes the view of a level whose parts resolve', () => {
    const ir = {
      buildingBobs: [row(1, 2), { ...row(1, 4), editName: 'front' }],
      buildingLandscapeOverlays: [
        {
          tribeId: WONDER_TRIBE,
          typeId: COLOSSUS,
          level: 1,
          slot: 0,
          x: 0,
          y: 0,
          landscape: 'lost',
          editName: 'wonder',
        },
        {
          tribeId: WONDER_TRIBE,
          typeId: COLOSSUS,
          level: 1,
          slot: 0,
          x: 0,
          y: 0,
          landscape: 'plants',
          editName: 'front',
        },
      ],
      landscapeGfx: [
        {
          editName: 'plants',
          bmd: 'bobs/a.bmd',
          paletteName: 'b',
          frames: [{ state: 1, bobIds: [LIGHT_BOB] }],
        },
      ],
    } as unknown as ContentIr;
    expect(buildingPicture(ir, COLOSSUS, VIKING)?.map((layer) => layer.bob)).toEqual([4, LIGHT_BOB]);
  });

  it('gives a type nothing draws no picture', () => {
    expect(buildingPicture({} as ContentIr, COLOSSUS, VIKING)).toBeNull();
  });
});
