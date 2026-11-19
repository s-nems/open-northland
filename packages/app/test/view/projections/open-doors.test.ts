import { positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type BuildingDoorInfo, computeOpenDoors } from '../../../src/view/projections/index.js';
import { building, buildingInfoOf, type Ent, snapshotOf } from '../../support/snapshot.js';

const SIDE = 2;
const RIVAL = 3;
const HOUSE = 7;
const COW_TRIBE = 9;
const TYPES = new Map<number, BuildingDoorInfo>([[HOUSE, { footprint: { door: { dx: 0, dy: 2 } } }]]);
const SCREEN = { minX: 0, minY: 0, maxX: 40, maxY: 40 };
const isLivestock = (tribe: number): boolean => tribe === COW_TRIBE;

function house(id: number, x: number, extra: Record<string, unknown> = {}): Ent {
  const e = building(id, HOUSE, x, 4);
  return { ...e, components: { ...e.components, Owner: { player: SIDE }, ...extra } };
}

/** A person of `player` standing `steps` nodes east of the door of the house at tile `x`: the house
 *  anchors at node (2x, 8) and its door stands two rows in front of it. */
function person(
  id: number,
  x: number,
  steps: number,
  player = SIDE,
  extra: Record<string, unknown> = {},
): Ent {
  return {
    id,
    components: {
      Settler: { tribe: 1 },
      Owner: { player },
      Position: positionOfNode(2 * x + steps, 10),
      ...extra,
    },
  };
}

describe('computeOpenDoors', () => {
  it('opens a finished house while a drawn person of its own player stands on or beside its door', () => {
    const snap = snapshotOf([
      house(1, 4),
      person(101, 4, 0),
      house(2, 8),
      person(102, 8, 1),
      house(3, 12),
      person(103, 12, 2), // two nodes off
      house(4, 16),
      person(104, 16, 0, RIVAL),
      house(5, 20),
      person(105, 20, 0, SIDE, { Resting: { at: 5 } }), // inside, so not drawn
      house(6, 24),
      person(106, 24, 0, SIDE, { Settler: { tribe: COW_TRIBE } }),
      house(7, 28, { UnderConstruction: { progress: 0 } }),
      person(107, 28, 0),
    ]);
    expect(computeOpenDoors(snap, buildingInfoOf(TYPES), isLivestock, SCREEN)).toEqual([1, 2]);
  });
});
