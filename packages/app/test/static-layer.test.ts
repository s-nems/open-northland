import type { Entity, SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { bindStaticLayer, type HarvestableSpawn } from '../src/view/static-layer.js';
import { building, snapshotOf } from './support/snapshot.js';

/** The static layer's two sim bindings composed: a harvestable's quad belongs to the handover, so a
 *  building standing on a bush leaves the bush to the sim's razing rather than clearing it as scenery. */

const HOUSE = 2;
const TYPES = [
  {
    typeId: HOUSE,
    footprint: {
      blocked: [
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
      ],
    },
  },
];
/** Ordinal 0 is grass on the house anchor node, ordinal 1 a bush on the node beside it. */
const PLACEMENTS = [
  [8, 8, 0],
  [9, 8, 1],
].flat();
const SPRITES = new Map([
  [0, 'grass'],
  [1, 'bush'],
]);
const BUSH = 30 as Entity;

function bind(harvestables: HarvestableSpawn) {
  const removed: string[] = [];
  const ghosts: number[] = [];
  let refs: ReadonlySet<number> = new Set();
  const onEvents = bindStaticLayer(
    {
      setStaticallyDrawnRefs: (next: ReadonlySet<number>) => {
        refs = next;
      },
      removeMapObject: (sprite: string) => removed.push(sprite),
      adoptFogGhost: (entity: number) => ghosts.push(entity),
    },
    { placements: PLACEMENTS, byPlacement: SPRITES },
    harvestables,
    { buildings: TYPES },
    () => snapshotOf([building(1, HOUSE, 4, 4)]),
  );
  return { removed, ghosts, refs: () => refs, onEvents };
}

const razed: SimEvent = { kind: 'berryBushRazed', bush: BUSH, at: { hx: 9, hy: 8 } };

describe('bindStaticLayer', () => {
  it('clears scenery under a standing building but leaves a bush to its handover', () => {
    const { removed, refs, onEvents } = bind({
      kind: 'fresh',
      placementByEntity: [[BUSH, 1]],
      pooledPlacements: [],
    });
    expect(removed).toEqual(['grass']);
    expect([...refs()]).toEqual([BUSH]);
    onEvents([razed]);
    expect(removed).toEqual(['grass', 'bush']);
    expect([...refs()]).toEqual([]);
  });

  it("retires a fresh world's pooled placements up front, so a chest is a sim item from the first frame", () => {
    const { removed, refs } = bind({ kind: 'fresh', placementByEntity: [], pooledPlacements: [1] });
    expect(removed.sort()).toEqual(['bush', 'grass']);
    expect([...refs()]).toEqual([]);
  });

  it("retires a restored world's harvestables up front and still clears the scenery", () => {
    const { removed, refs, onEvents } = bind({ kind: 'restored', placements: [1] });
    expect(removed.sort()).toEqual(['bush', 'grass']);
    expect([...refs()]).toEqual([]);
    onEvents([razed]);
    expect(removed).toHaveLength(2);
  });
});
