import { type Entity, positionOfNode, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { bindFootprintClearing, type FootprintBuildingType } from '../src/view/footprint-clearing.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/** The static-layer half of a building's landscape clearing: which placed sprites leave the layer when
 *  a building stands on their node. Sprites are opaque handles, so the fixtures name themselves. */

const HOUSE = 2;
const HALL = 3;
const VIKING = 1;
const SARACEN = 4;
/** A house blocks its anchor node and the nodes in front of and behind it, a saracen's only its anchor; a
 *  hall its anchor and the node beside it. */
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
    tribeVariants: [{ tribe: SARACEN, footprint: { blocked: [{ dx: 0, dy: 0 }] } }],
  },
  {
    typeId: HALL,
    footprint: {
      blocked: [
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
      ],
    },
    tribeVariants: [],
  },
];

/** The map's width in half-cell nodes, the stride of a road node id. */
const NODE_WIDTH = 64;

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

/** A road shard carrier holding the given half-cell nodes. */
function roadShard(id: number, nodes: readonly (readonly [number, number])[]): Ent {
  return {
    id,
    components: {
      RoadShard: { block: 0, nodes: nodes.map(([hx, hy]) => hy * NODE_WIDTH + hx), revision: 1 },
    },
  };
}

/** A building entity anchored at half-cell node `(hx, hy)`. */
function buildingAt(id: number, typeId: number, hx: number, hy: number, tribe = VIKING): Ent {
  return { id, components: { Building: { buildingType: typeId, tribe }, Position: positionOfNode(hx, hy) } };
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
    NODE_WIDTH,
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

  it("clears only the walk-block cells of the building's own tribe", () => {
    const { removed } = bind([buildingAt(1, HOUSE, 10, 11, SARACEN)]);
    expect(removed).toEqual(['anchor-grass']);
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

  it('clears the scenery on every road node laid when bound, and only on the node itself', () => {
    const { removed } = bind([
      roadShard(1, [
        [10, 11],
        [20, 20],
      ]),
    ]);
    expect(removed.sort()).toEqual(['anchor-grass', 'far-grass', 'far-mushroom']);
  });

  it('clears the scenery on the nodes a road is laid over as the event arrives', () => {
    const { removed, onEvents } = bind([]);
    onEvents([
      {
        kind: 'roadLaid',
        nodes: [
          { hx: 11, hy: 12 },
          { hx: 10, hy: 10 },
        ],
      },
    ]);
    expect(removed.sort()).toEqual(['front-grass', 'unshifted-fern']);
  });
});
