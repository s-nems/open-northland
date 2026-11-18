import { BUILDING_KIND, BuildingType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  type BuildingDoorInfo,
  computeRoadEntrances,
  takesSettlersIn,
} from '../../../src/view/projections/index.js';
import { building, buildingInfoOf, type Ent, snapshotOf } from '../../support/snapshot.js';

const SIDE = 2;
const RIVAL = 3;
const HOUSE = 7;
const DOORLESS = 8;
const NOBODY_ENTERS = 9;
const DOOR = { door: { dx: 0, dy: 2 } } as const;
const TYPES = new Map<number, BuildingDoorInfo>([
  [HOUSE, { footprint: DOOR, entered: true }],
  [DOORLESS, { footprint: {}, entered: true }],
  [NOBODY_ENTERS, { footprint: DOOR, entered: false }],
]);
const SCREEN = { minX: 0, minY: 0, maxX: 16, maxY: 16 };
const MAP_SIZE = { width: 16, height: 10 };

function ownedBy(player: number, e: Ent, extra: Record<string, unknown> = {}): Ent {
  return { ...e, components: { ...e.components, Owner: { player }, ...extra } };
}

describe('computeRoadEntrances', () => {
  it("lights the doors of the side's buildings and sites on screen that settlers enter, inside the map", () => {
    const snap = snapshotOf([
      ownedBy(SIDE, building(1, HOUSE, 4, 4)),
      ownedBy(SIDE, building(2, HOUSE, 6, 4), { UnderConstruction: { progress: 0 } }),
      ownedBy(RIVAL, building(3, HOUSE, 8, 4)),
      ownedBy(SIDE, building(4, DOORLESS, 4, 6)),
      ownedBy(SIDE, building(5, NOBODY_ENTERS, 6, 6)),
      // On the last row: its door would stand on node row 20, past the 10-cell map's 20 node rows.
      ownedBy(SIDE, building(6, HOUSE, 8, 9)),
      ownedBy(SIDE, building(7, HOUSE, 200, 200)),
    ]);

    // Tile (x, y) anchors at node (2x, 2y); the door stands two rows in front of it.
    expect(computeRoadEntrances(snap, buildingInfoOf(TYPES), SIDE, SCREEN, MAP_SIZE)).toEqual([
      { col: 8, row: 10 },
      { col: 12, row: 10 },
    ]);
  });
});

describe('takesSettlersIn', () => {
  it('holds for a type that employs, houses, stores, schools, shelters or blesses, never a vehicle yard', () => {
    const type = (fields: Record<string, unknown>): BuildingType =>
      BuildingType.parse({ typeId: 1, id: 'probe', kind: BUILDING_KIND.workplace, ...fields });
    const cases: readonly [string, BuildingType, boolean][] = [
      ['workshop', type({ workers: [{ jobType: 1, count: 1 }] }), true],
      ['home', type({ kind: BUILDING_KIND.home, homeSize: 1 }), true],
      ['store', type({ kind: BUILDING_KIND.storage, stock: [{ goodType: 1, capacity: 10 }] }), true],
      ['school', type({ kind: BUILDING_KIND.training, schoolSize: 5 }), true],
      ['shelter', type({ shelterCapacity: 4 }), true],
      ['temple', type({ prayerSite: 'temple' }), true],
      ['wall piece', type({ kind: BUILDING_KIND.tower }), false],
      ['wonder', type({ kind: BUILDING_KIND.wonder }), false],
      ['vehicle yard', type({ kind: BUILDING_KIND.vehicle, workers: [{ jobType: 1, count: 3 }] }), false],
    ];
    expect(cases.map(([name, t]) => [name, takesSettlersIn(t)])).toEqual(
      cases.map(([name, , expected]) => [name, expected]),
    );
  });
});
