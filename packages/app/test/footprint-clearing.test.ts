import { type Entity, positionOfNode, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { bindFootprintClearing, type FootprintBuildingType } from '../src/view/footprint-clearing.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/** The static-layer half of a building's landscape clearing: which placed sprites leave the layer when
 *  a building stands on their node. Sprites are opaque handles, so the fixtures name themselves. */

const HOUSE = 2;
const HALL = 3;
/** A house blocks its anchor node and the nodes in front of and behind it; a hall its anchor and
 *  the node beside it. */
const TYPES: readonly FootprintBuildingType[] = [
  {
    typeId: HOUSE,
    footprint: {
      blocked: [
        { dx: 0, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ],
    },
  },
  {
    typeId: HALL,
    footprint: {
      blocked: [
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
      ],
    },
  },
];

/** A type the content does not know. */
const UNKNOWN_TYPE = 99;

/** `[hx, hy, typeIndex]` placements around a house anchored on the odd row 11, where its odd-`dy`
 *  cells stamp one node to +x; the type index is irrelevant to the clearing. */
const PLACEMENTS = [
  [10, 11, 0], // ordinal 0: on the house anchor
  [11, 12, 0], // ordinal 1: the shifted cell in front of it
  [11, 10, 0], // ordinal 2: the shifted cell behind it
  [10, 10, 0], // ordinal 3: the unshifted cell behind it, which the house does not cover
  [20, 20, 0], // ordinal 4: elsewhere
  [20, 20, 1], // ordinal 5: a second sprite on the same node
].flat();
const SPRITES = new Map([
  [0, 'anchor-grass'],
  [1, 'front-grass'],
  [2, 'back-bush'],
  [3, 'unshifted-fern'],
  [4, 'far-grass'],
  [5, 'far-mushroom'],
]);

/** A building entity anchored at half-cell node `(hx, hy)`. */
function buildingAt(id: number, typeId: number, hx: number, hy: number): Ent {
  return { id, components: { Building: { buildingType: typeId }, Position: positionOfNode(hx, hy) } };
}

function bind(entities: readonly Ent[]) {
  const removed: string[] = [];
  let snapshot = snapshotOf(entities);
  const onEvents = bindFootprintClearing(
    { removeMapObject: (sprite: string) => removed.push(sprite) },
    PLACEMENTS,
    SPRITES,
    { buildings: TYPES },
    () => snapshot,
  );
  return { removed, onEvents, setSnapshot: (next: WorldSnapshot) => (snapshot = next) };
}

const placed = (entity: number, hx: number, hy: number): SimEvent => ({
  kind: 'buildingPlaced',
  entity: entity as Entity,
  at: { hx, hy },
});
const upgraded = (entity: number): SimEvent => ({
  kind: 'buildingUpgraded',
  entity: entity as Entity,
  level: 1,
});

describe('footprint clearing of static landscape sprites', () => {
  it('clears the walk-block cells of every building standing when bound, with the odd-row shift', () => {
    const { removed } = bind([buildingAt(1, HOUSE, 10, 11)]);
    expect(removed.sort()).toEqual(['anchor-grass', 'back-bush', 'front-grass']);
  });

  it('clears under a building as its placement event arrives, and every sprite on a covered node', () => {
    const { removed, onEvents, setSnapshot } = bind([]);
    expect(removed).toEqual([]);
    setSnapshot(snapshotOf([buildingAt(1, HALL, 19, 20)]));
    onEvents([placed(1, 19, 20)]);
    expect(removed.sort()).toEqual(['far-grass', 'far-mushroom']);
  });

  it('clears the grown footprint when an upgrade swaps the building type', () => {
    const { removed, onEvents, setSnapshot } = bind([buildingAt(1, HALL, 10, 11)]);
    expect(removed).toEqual(['anchor-grass']);
    setSnapshot(snapshotOf([buildingAt(1, HOUSE, 10, 11)]));
    onEvents([upgraded(1)]);
    expect(removed.sort()).toEqual(['anchor-grass', 'back-bush', 'front-grass']);
  });

  it('removes each sprite once and ignores events for entities the snapshot no longer holds', () => {
    const { removed, onEvents } = bind([buildingAt(1, HOUSE, 10, 11)]);
    onEvents([placed(1, 10, 11), placed(7, 10, 11), upgraded(1)]);
    expect(removed.sort()).toEqual(['anchor-grass', 'back-bush', 'front-grass']);
  });

  it('leaves a footprint-less type and other events alone', () => {
    const { removed, onEvents, setSnapshot } = bind([]);
    setSnapshot(snapshotOf([buildingAt(1, UNKNOWN_TYPE, 10, 11)]));
    onEvents([placed(1, 10, 11), { kind: 'buildingFinished', entity: 1 as Entity }]);
    expect(removed).toEqual([]);
  });
});
