import type { Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { buildingModels } from '../src/view/runtime/read-models.js';

type ContentBuilding = Simulation['content']['buildings'][number];

const FOOTPRINT = { blocked: [], familyBody: [], reserved: [] };

/** A content building with only the fields the index reads set; the rest are the empty defaults a
 *  building with no crew, stock, recipes or construction stage carries. */
const building = (typeId: number, id: string): ContentBuilding => ({
  typeId,
  id,
  kind: 'workplace',
  homeSize: 0,
  workers: [],
  stock: [],
  produces: [],
  recipes: [],
  construction: [],
  buildOnBioPattern: false,
  canEnableDefenceMode: false,
  shelterCapacity: 0,
  footprint: FOOTPRINT,
});

/** An IR carrying just the flag-point lanes the index reads. */
function ir(
  flag: readonly { tribeId: number; typeId: number; x: number; y: number }[],
  mast: readonly { tribeId: number; typeId: number; x: number; y: number }[] = [],
): ContentIr {
  const row = (r: { tribeId: number; typeId: number; x: number; y: number }) => ({ ...r, level: 0 });
  return { buildingFlagPoints: flag.map(row), buildingSoldierFlagPoints: mast.map(row) };
}

const VIKING = 1;
const FRANK = 2;

describe('view building models', () => {
  it('carries the extracted sign-post anchor of the drawing tribe', () => {
    const SMITHY = 23;
    const FARM = 31;
    const { infoOf } = buildingModels(
      [building(SMITHY, 'smithy'), building(FARM, 'farm')],
      ir([{ tribeId: VIKING, typeId: SMITHY, x: 12, y: -4 }]),
      [VIKING],
    );
    expect(infoOf(SMITHY, VIKING)?.flagPoint).toEqual({ x: 12, y: -4 });
    // A type with no flag-point row still resolves - the sign chain just has nothing to anchor on.
    expect(infoOf(FARM, VIKING)).toEqual({ id: 'farm', footprint: FOOTPRINT });
  });

  it('gives each tribe its own anchor for the same type, and falls back to the base tribe', () => {
    // The frank tower authors a different mast height on the typeId the viking tower uses, so a
    // building must resolve its anchors through its own skin.
    const TOWER = 40;
    const { infoOf } = buildingModels(
      [building(TOWER, 'tower_00')],
      ir(
        [
          { tribeId: VIKING, typeId: TOWER, x: -6, y: 29 },
          { tribeId: FRANK, typeId: TOWER, x: 4, y: 31 },
        ],
        [
          { tribeId: VIKING, typeId: TOWER, x: -6, y: -239 },
          { tribeId: FRANK, typeId: TOWER, x: -6, y: -180 },
        ],
      ),
      [VIKING, FRANK],
    );
    expect(infoOf(TOWER, VIKING)?.mastPoint).toEqual({ x: -6, y: -239 });
    expect(infoOf(TOWER, FRANK)?.mastPoint).toEqual({ x: -6, y: -180 });
    expect(infoOf(TOWER, FRANK)?.flagPoint).toEqual({ x: 4, y: 31 });
    // A tribe whose art was never loaded draws the base tribe's body, so it takes its anchors too.
    expect(infoOf(TOWER, 7)?.mastPoint).toEqual({ x: -6, y: -239 });
  });

  it('gives a tribe drawing its own body no anchor rather than the base tribe pixel offsets', () => {
    // The saracen skins the tower with a body of its own but authors no `gfxsoldierflagpoint`. The
    // viking mast is measured against the viking roof, so borrowing it would hang the flag off this one;
    // the caller's derived anchor is the honest answer.
    const TOWER = 40;
    const SARACEN = 4;
    const SARACEN_BMD = 'data/engine2d/bin/bobs/ls_houses_saracen.bmd';
    const withSkins: ContentIr = {
      ...ir(
        [{ tribeId: VIKING, typeId: TOWER, x: -6, y: 29 }],
        [{ tribeId: VIKING, typeId: TOWER, x: -6, y: -239 }],
      ),
      buildingBobs: [
        {
          tribeId: SARACEN,
          typeId: TOWER,
          level: 0,
          bmd: SARACEN_BMD,
          paletteName: 'house_saracen01',
          bobId: 90,
        },
      ],
    };
    const { infoOf } = buildingModels([building(TOWER, 'tower_00')], withSkins, [VIKING, SARACEN, FRANK]);
    expect(infoOf(TOWER, SARACEN)?.mastPoint).toBeUndefined();
    expect(infoOf(TOWER, SARACEN)?.flagPoint).toBeUndefined();
    // The frank is loaded but skins no tower, so it draws the base body and its anchors apply.
    expect(infoOf(TOWER, FRANK)?.mastPoint).toEqual({ x: -6, y: -239 });
    expect(infoOf(TOWER, FRANK)?.flagPoint).toEqual({ x: -6, y: 29 });
  });

  it('keeps the last building when two share a typeId', () => {
    // No schema enforces typeId uniqueness, and the two index rules resolve a duplicate differently
    // (packages/data/test/lookup.test.ts). This index reads last-wins.
    const DUPLICATE = 7;
    const { byType, infoOf } = buildingModels(
      [building(DUPLICATE, 'base'), building(DUPLICATE, 'mod')],
      ir([]),
      [VIKING],
    );
    expect(byType.size).toBe(1);
    expect(infoOf(DUPLICATE, VIKING)?.id).toBe('mod');
  });

  it('resolves nothing for an unknown or absent type', () => {
    const { infoOf } = buildingModels([], ir([]), [VIKING]);
    expect(infoOf(7, VIKING)).toBeUndefined();
    expect(infoOf(undefined, VIKING)).toBeUndefined();
  });
});
