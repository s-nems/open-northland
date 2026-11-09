import type { Entity, SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { bindStaticLayer, type HarvestableSpawn } from '../../../src/view/map-objects/static-layer.js';
import { testSight } from '../../support/sight.js';
import { building, snapshotOf } from '../../support/snapshot.js';

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
    tribeVariants: [],
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
/** The map's width in half-cell nodes. */
const NODE_WIDTH = 64;

/** The bush as the map placed it, ripe. */
const BUSH_ENTITY = { id: BUSH, components: { BerryBush: { stage: 'ripe' } } };

function bind(
  harvestables: HarvestableSpawn,
  seesNode: (hx: number, hy: number) => boolean = () => true,
  bush: readonly (typeof BUSH_ENTITY)[] = [],
) {
  const removed: string[] = [];
  let refs: ReadonlySet<number> = new Set();
  const sight = testSight(seesNode);
  const { onEvents, onSight, harvestableSpriteOf, memory } = bindStaticLayer(
    {
      setStaticallyDrawnRefs: (next: ReadonlySet<number>) => {
        refs = next;
      },
      removeMapObject: (sprite: string) => removed.push(sprite),
    },
    { placements: PLACEMENTS, byPlacement: SPRITES },
    harvestables,
    { buildings: TYPES },
    () => snapshotOf([building(1, HOUSE, 4, 4), ...bush]),
    NODE_WIDTH,
    sight,
  );
  const look = (): void => {
    sight.look();
    onSight();
  };
  return { removed, refs: () => refs, onEvents, look, harvestableSpriteOf, memory };
}

const razed: SimEvent = { kind: 'berryBushRazed', bush: BUSH, at: { hx: 9, hy: 8 } };

describe('bindStaticLayer', () => {
  it('clears scenery under a standing building but leaves a bush to its handover', () => {
    const { removed, refs, onEvents, harvestableSpriteOf } = bind({
      kind: 'fresh',
      placementByEntity: [[BUSH, 1]],
      pooledPlacements: [],
    });
    expect(removed).toEqual(['grass']);
    expect([...refs()]).toEqual([BUSH]);
    expect(harvestableSpriteOf(BUSH)).toBe('bush');
    onEvents([razed]);
    expect(removed).toEqual(['grass', 'bush']);
    expect([...refs()]).toEqual([]);
    expect(harvestableSpriteOf(BUSH)).toBeUndefined();
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

  it('keeps what a save remembers, and retires a held quad worked since only once it is seen', () => {
    let watching = false;
    const fresh = bind(
      { kind: 'fresh', placementByEntity: [[BUSH, 1]], pooledPlacements: [] },
      () => watching,
      [BUSH_ENTITY],
    );
    const saved = fresh.memory();
    expect(saved).toEqual({ removed: [0], held: [[BUSH, 1, 'ripe']] });

    // Unchanged when the world restores: the quad stays bound, as fresh.
    const intact = bind({ kind: 'restored', placements: [1], memory: saved }, () => watching, [BUSH_ENTITY]);
    intact.look();
    expect(intact.removed).toEqual(['grass']);
    expect(intact.harvestableSpriteOf(BUSH)).toBe('bush');

    // Razed after the memory was taken: the quad holds in the fog and leaves once seen.
    const razedSince = bind({ kind: 'restored', placements: [1], memory: saved }, () => watching);
    razedSince.look();
    expect([...razedSince.refs()]).toEqual([BUSH]);
    watching = true;
    razedSince.look();
    expect(razedSince.removed).toEqual(['grass', 'bush']);
    expect([...razedSince.refs()]).toEqual([]);
  });

  it('keeps a change made in the fog before the save waiting for sight after the restore', () => {
    let watching = false;
    const fresh = bind(
      { kind: 'fresh', placementByEntity: [[BUSH, 1]], pooledPlacements: [] },
      () => watching,
      [BUSH_ENTITY],
    );
    fresh.onEvents([{ kind: 'berryForaged', bush: BUSH, at: { hx: 9, hy: 8 } }]);
    const saved = fresh.memory();

    const restored = bind({ kind: 'restored', placements: [1], memory: saved }, () => watching, [
      BUSH_ENTITY,
    ]);
    restored.look();
    expect(restored.harvestableSpriteOf(BUSH)).toBe('bush');
    watching = true;
    restored.look();
    expect(restored.harvestableSpriteOf(BUSH)).toBeUndefined();
  });
});
