import { describe, expect, it } from 'vitest';
import {
  Owner,
  ownerOf,
  ownersCompatible,
  StorageMinimums,
  setStockAmount,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { nearestByCell } from '../../../src/systems/settlers/targets/cell-index.js';
import {
  collectTargets,
  interactionCell,
  nearestStoreHolding,
  nearestStoreHoldingAnywhere,
  unclaimedStockOf,
} from '../../../src/systems/settlers/targets/index.js';
import { collectSupplyTally } from '../../../src/systems/stores/index.js';
import { isStorehouseType } from '../../../src/systems/stores/workplace.js';
import { buildingAt, ctxOf, grassMap } from './production/producer-supply/support.js';
import { utilityContent, WAREHOUSE, WATER } from './production/utility-content.js';

// The store-holding searches skip a side whose stores lend no unit past the storage minimum. Against a
// plain scan over every store, under random stock, owners and minimums.

const PLAYERS = 2;
const STORES = 12;
const ROUNDS = 150;
const MAX_UNITS = 3;
const MAX_MINIMUM = 6;

/** A deterministic LCG, so a failure replays. */
function lcg(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

describe('nearestStoreHolding under storage minimums', () => {
  it.each([1, 2, 3])('picks the plain scan winner whether or not a side lends anything (seed %i)', (seed) => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(24, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('fixture map missing');
    const ctx = ctxOf(sim);
    expect(isStorehouseType(ctx.content, WAREHOUSE)).toBe(true);
    const roll = lcg(seed);
    const stores: Entity[] = [];
    for (let i = 0; i < STORES; i++) {
      const store = buildingAt(sim, WAREHOUSE, 1 + roll(46), roll(12));
      const player = roll(PLAYERS + 1);
      if (player < PLAYERS) sim.world.add(store, Owner, { player });
      stores.push(store);
    }
    const minimums = sim.world.create();
    sim.world.add(minimums, StorageMinimums, { player: 0, minimums: new Map() });

    for (let round = 0; round < ROUNDS; round++) {
      setStockAmount(sim.world, stores[roll(STORES)] as Entity, WATER, roll(MAX_UNITS + 1));
      const minimum = roll(MAX_MINIMUM + 1);
      const held = sim.world.get(minimums, StorageMinimums).minimums;
      if (minimum !== (held.get(WATER) ?? 0)) {
        const next = new Map(held);
        if (minimum === 0) next.delete(WATER);
        else next.set(WATER, minimum);
        sim.world.mut(minimums, StorageMinimums).minimums = next;
      }
      const bands = collectTargets(sim.world, ctx, terrain).bands;
      const supply = collectSupplyTally(sim.world);
      const here = terrain.nodeAt(roll(terrain.width), roll(terrain.height));
      for (const owner of [0, 1, undefined]) {
        const lends = (e: Entity, side: (e: Entity) => boolean) =>
          side(e) && unclaimedStockOf(sim.world, ctx, supply, e, WATER) > 0
            ? { cell: interactionCell(sim.world, ctx, terrain, e, here), payload: null }
            : null;
        const sameSide = (e: Entity) => ownersCompatible(owner, ownerOf(sim.world, e));
        const ownOnly = (e: Entity) => ownerOf(sim.world, e) === owner;
        expect(
          nearestStoreHolding(bands, sim.world, here, here, WATER, owner, supply),
          `round ${round} owner ${owner}`,
        ).toBe(nearestByCell(terrain, stores, here, (e) => lends(e, sameSide))?.entity ?? null);
        expect(
          nearestStoreHoldingAnywhere(bands, sim.world, here, WATER, owner, supply),
          `anywhere round ${round} owner ${owner}`,
        ).toBe(nearestByCell(terrain, stores, here, (e) => lends(e, ownOnly))?.entity ?? null);
      }
    }
  });
});
