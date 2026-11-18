import { describe, expect, it } from 'vitest';
import { type BuildingDoorInfo, computeRoadEntrances } from '../../../src/view/projections/index.js';
import { building, buildingInfoOf, type Ent, snapshotOf } from '../../support/snapshot.js';

const SIDE = 2;
const RIVAL = 3;
const HOUSE = 7;
const DOORLESS = 8;
const TYPES = new Map<number, BuildingDoorInfo>([
  [HOUSE, { footprint: { door: { dx: 0, dy: 2 } } }],
  [DOORLESS, { footprint: {} }],
]);
const SCREEN = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function ownedBy(player: number, e: Ent, extra: Record<string, unknown> = {}): Ent {
  return { ...e, components: { ...e.components, Owner: { player }, ...extra } };
}

describe('computeRoadEntrances', () => {
  it("lights the door of each of the side's buildings and sites on screen, never a doorless one", () => {
    const snap = snapshotOf([
      ownedBy(SIDE, building(1, HOUSE, 4, 4)),
      ownedBy(SIDE, building(2, HOUSE, 6, 4), { UnderConstruction: { progress: 0 } }),
      ownedBy(RIVAL, building(3, HOUSE, 8, 4)),
      ownedBy(SIDE, building(4, DOORLESS, 4, 8)),
      ownedBy(SIDE, building(5, HOUSE, 200, 200)),
    ]);

    // Tile (x, y) anchors at node (2x, 2y); the door stands two rows in front of it.
    expect(computeRoadEntrances(snap, buildingInfoOf(TYPES), SIDE, SCREEN)).toEqual([
      { col: 8, row: 10 },
      { col: 12, row: 10 },
    ]);
  });
});
