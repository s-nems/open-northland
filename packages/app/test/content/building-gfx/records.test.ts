import { houseRecordKey } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { buildingBinding, houseRecordDraws } from '../../../src/content/building-gfx/index.js';
import type { BuildingBobRow, ContentIr } from '../../../src/content/ir/rows.js';

const VIKING = 1;
const SARACEN = 4;
const HEADQUARTERS = 1;
const SHIP = 'viking headquarters';
const HALL = 'viking headquarters house';
const SHIP_BOB = 34;
const HALL_BOB = 44;
const HALL_FLAG = { x: 5, y: -60 };

function bob(typeId: number, bobId: number, editName: string): BuildingBobRow {
  return {
    tribeId: VIKING,
    typeId,
    level: 0,
    bmd: 'data/engine2d/bin/bobs/ls_houses_viking.bmd',
    paletteName: 'house01',
    bobId,
    editName,
  };
}

/** The viking headquarters as its ship and as its hall, the hall on a body of its own. */
const ir: ContentIr = {
  buildings: [
    {
      typeId: HEADQUARTERS,
      recordFootprints: [
        {
          tribe: VIKING,
          editName: HALL,
          footprint: { blocked: [], familyBody: [], reserved: [], workArea: [] },
          mapOnly: false,
        },
      ],
    },
  ],
  buildingBobs: [bob(HEADQUARTERS, SHIP_BOB, SHIP), bob(HEADQUARTERS, HALL_BOB, HALL)],
  buildingFlagPoints: [{ tribeId: VIKING, typeId: HEADQUARTERS, level: 0, editName: HALL, ...HALL_FLAG }],
};

describe('houseRecordDraws', () => {
  it('draws each record a type stands on a body of its own as that record, flag point and all', () => {
    expect([...houseRecordDraws(ir, [VIKING], [])]).toEqual([
      [
        houseRecordKey(VIKING, HEADQUARTERS, HALL),
        {
          typeId: HEADQUARTERS,
          tribe: VIKING,
          level: 0,
          body: HALL_BOB,
          landscapeOverlays: [],
          flagPoint: HALL_FLAG,
        },
      ],
    ]);
    // Only the fielded tribes' records: a world without vikings draws none of theirs.
    expect(houseRecordDraws(ir, [SARACEN], []).size).toBe(0);
  });

  it('rides the building binding beside the type keeping its default body', () => {
    const binding = buildingBinding(ir, [VIKING], []);
    expect(binding.byType[HEADQUARTERS]).toBe(SHIP_BOB);
    expect(binding.byRecord?.get(houseRecordKey(VIKING, HEADQUARTERS, HALL))?.body).toBe(HALL_BOB);
  });
});
