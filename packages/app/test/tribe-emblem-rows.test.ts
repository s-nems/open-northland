import { describe, expect, it } from 'vitest';
import { tribeEmblemRows } from '../src/content/building-gfx/emblems.js';
import type { BuildingBobRow } from '../src/content/ir/rows.js';

/** A civilization's lobby emblem is its headquarters in the skin the world draws it in. */

const VIKING = 1;
const FRANK = 2;
const BYZANTINE = 3;
const HEADQUARTERS = 1;
const STORE = 9;
const VIKING_HQ_BOB = 34;
const VIKING_HQ_HOUSE_BOB = 44;
const FRANK_HQ_BOB = 4;
const FRANK_STORE_BOB = 2;

const row = (tribeId: number, typeId: number, paletteName: string, bobId: number, editName: string) =>
  ({
    tribeId,
    typeId,
    level: 0,
    bmd: `data/x/ls_houses_${tribeId}.bmd`,
    paletteName,
    bobId,
    editName,
  }) satisfies BuildingBobRow;

const buildings = [
  { typeId: HEADQUARTERS, id: 'headquarters' },
  { typeId: STORE, id: 'store' },
];

describe('tribeEmblemRows', () => {
  it("takes each tribe's canonical headquarters in its first listed skin", () => {
    const bobs = [
      row(VIKING, HEADQUARTERS, 'house02', VIKING_HQ_BOB, 'viking headquarters'),
      row(VIKING, HEADQUARTERS, 'house01', VIKING_HQ_HOUSE_BOB, 'viking headquarters house'),
      row(VIKING, HEADQUARTERS, 'house01', VIKING_HQ_BOB, 'viking headquarters'),
      row(FRANK, STORE, 'caves', FRANK_STORE_BOB, 'frank store'),
      row(FRANK, HEADQUARTERS, 'caves', FRANK_HQ_BOB, 'frank headquarters'),
    ];
    // Rows keep the `GfxPalette` line's file order, so the first row names the first skin.
    for (const [buildingBobs, skin] of [
      [bobs, 'house02'],
      [[...bobs].reverse(), 'house01'],
    ] as const) {
      const emblems = tribeEmblemRows({ buildings, buildingBobs }, [VIKING, FRANK, BYZANTINE]);
      expect(emblems.get(VIKING)).toMatchObject({ paletteName: skin, bobId: VIKING_HQ_BOB });
      expect(emblems.get(FRANK)).toMatchObject({ typeId: HEADQUARTERS, bobId: FRANK_HQ_BOB });
      // No headquarters row, no emblem.
      expect(emblems.has(BYZANTINE)).toBe(false);
    }
  });

  it('draws none when the content names no headquarters building', () => {
    const buildingBobs = [row(FRANK, HEADQUARTERS, 'caves', FRANK_HQ_BOB, 'frank headquarters')];
    expect(tribeEmblemRows({ buildings: [], buildingBobs }, [FRANK]).size).toBe(0);
  });
});
