import { parseContentSet } from '@open-northland/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Building,
  Carrying,
  discoverTechnology,
  JobAssignment,
  PickupClaim,
  Position,
  Production,
  SupplyRun,
  setSettlerJob,
  setStockAmount,
  Upgrading,
} from '../../../../src/components/index.js';
import type { Entity, World } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import { productionSystem } from '../../../../src/systems/index.js';
import { stockCapacity } from '../../../../src/systems/stores/index.js';
import { workshopWorkforce } from '../../../../src/systems/stores/workshop-workforce.js';
import { testContent } from '../../../fixtures/content.js';
import { nextTickCtxOf } from '../../../fixtures/context.js';
import {
  BAKEHOUSE,
  buildingAt,
  CARPENTER,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  PLANK,
  SAWMILL,
  settlerAt,
  VIKING,
  WHEAT,
  WOOD,
  WOODCUTTER,
} from './producer-supply/support.js';

afterEach(() => vi.restoreAllMocks());

/** The fixture catalog with every tribe under an open technology table: the kept indexes key their
 *  unlock reads on it, while a tribe without one is re-read on every tick. */
function technologyContent(bakers = 1, plankLocked = false) {
  const base = testContent();
  const bakehouse = base.buildings.find((building) => building.typeId === BAKEHOUSE);
  if (bakehouse === undefined) throw new Error('missing fixture bakehouse');
  bakehouse.workers = [{ jobType: CARPENTER, count: bakers }];
  return parseContentSet({
    ...base,
    tribes: base.tribes.map((tribe) => ({
      ...tribe,
      technology: { houses: [] },
      jobEnables: plankLocked ? [{ jobType: CARPENTER, kind: 'good' as const, targetId: PLANK }] : [],
      jobRequirements: [],
    })),
  });
}

/** Every entity the world is asked about while `run` executes. */
function entitiesRead(world: World, run: () => void): Set<Entity> {
  const read = new Set<Entity>();
  for (const method of ['get', 'tryGet', 'has', 'mut', 'tryMut', 'revisionOf'] as const) {
    const original = world[method].bind(world) as (e: Entity, c: never) => unknown;
    vi.spyOn(world, method).mockImplementation(((e: Entity, c: never) => {
      read.add(e);
      return original(e, c);
    }) as never);
  }
  run();
  vi.restoreAllMocks();
  return read;
}

describe('production tick cost', () => {
  it('reads none of the idle persons while a crewed workshop runs', () => {
    const sim = new Simulation({ seed: 1, content: technologyContent(2), map: grassMap(40, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [
      [WOOD, 10],
      [WHEAT, 10],
    ]);
    settlerAt(sim, 0, 0, CARPENTER, shop);
    settlerAt(sim, 0, 0, CARPENTER, shop);
    const idle = Array.from({ length: 30 }, (_, i) => settlerAt(sim, 5 + i, 0, WOODCUTTER));
    productionSystem(sim.world, nextTickCtxOf(sim)); // the first tick builds the kept indexes
    const read = entitiesRead(sim.world, () => {
      for (let tick = 0; tick < 3; tick++) productionSystem(sim.world, nextTickCtxOf(sim));
    });
    expect(sim.world.get(shop, Production).cycles).toHaveLength(2);
    expect(idle.filter((e) => read.has(e))).toEqual([]);
  });

  it('starts a remembered starved workshop once its stock changes', () => {
    const sim = new Simulation({ seed: 1, content: technologyContent() });
    const mill = buildingAt(sim, SAWMILL, 0, 0, [[WOOD, 0]]);
    settlerAt(sim, 0, 0, CARPENTER, mill);
    productionSystem(sim.world, nextTickCtxOf(sim));
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false);
    setStockAmount(sim.world, mill, WOOD, 2);
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(mill, Production).cycles.map((cycle) => cycle.goodType)).toEqual([PLANK]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('reopens a remembered closed gate once the product is discovered', () => {
    const sim = new Simulation({ seed: 1, content: technologyContent(1, true) });
    const mill = buildingAt(sim, SAWMILL, 0, 0, [[WOOD, 2]]);
    settlerAt(sim, 0, 0, CARPENTER, mill);
    productionSystem(sim.world, nextTickCtxOf(sim));
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // locked, and remembered as closed
    discoverTechnology(sim.world, undefined, VIKING, 'good', PLANK);
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(mill, Production).cycles.map((cycle) => cycle.goodType)).toEqual([PLANK]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('starts a remembered open gate once its away operator is back', () => {
    const sim = new Simulation({ seed: 1, content: technologyContent() });
    const mill = buildingAt(sim, SAWMILL, 0, 0, [[WOOD, 2]]);
    const carpenter = settlerAt(sim, 3, 0, CARPENTER, mill);
    productionSystem(sim.world, nextTickCtxOf(sim));
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false);
    sim.world.add(carpenter, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(mill, Production).cycles).toHaveLength(1);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});

describe('workshopWorkforce', () => {
  it('follows trade, binding and load changes between snapshots', () => {
    const sim = new Simulation({ seed: 1, content: technologyContent(2), map: grassMap(8, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0);
    const first = settlerAt(sim, 0, 0, CARPENTER, shop);
    const second = settlerAt(sim, 0, 0, CARPENTER, shop);
    const ctx = ctxOf(sim);
    const before = workshopWorkforce(sim.world, ctx);
    expect(before.operatorsAt(shop)).toEqual([first, second]);

    setSettlerJob(sim.world, second, WOODCUTTER);
    sim.world.add(first, Carrying, { goodType: WOOD, amount: 1 });
    const after = workshopWorkforce(sim.world, ctx);
    expect(after.operatorsAt(shop)).toEqual([first]);
    expect(after.incomingOf(shop, WOOD)).toBe(1);
    expect(() => before.operatorsAt(shop)).toThrow();

    sim.world.remove(first, JobAssignment);
    expect(workshopWorkforce(sim.world, ctx).operatorsAt(shop)).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it("re-takes a fetched load's source check only at a snapshot after the source changed", () => {
    const sim = new Simulation({ seed: 1, content: technologyContent(), map: grassMap(8, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0);
    const store = buildingAt(sim, HEADQUARTERS, 4, 0, [[WOOD, 1]]);
    const baker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(baker, SupplyRun, { site: shop, goodType: WOOD, amount: 1 });
    sim.world.add(baker, PickupClaim, { source: store, goodType: WOOD, amount: 1 });
    const ctx = ctxOf(sim);
    const snapshot = workshopWorkforce(sim.world, ctx);
    setStockAmount(sim.world, store, WOOD, 0);
    expect(snapshot.incomingOf(shop, WOOD)).toBe(1); // the source held the wood at the snapshot
    expect(workshopWorkforce(sim.world, ctx).incomingOf(shop, WOOD)).toBe(0);
    setStockAmount(sim.world, store, WOOD, 1);
    expect(workshopWorkforce(sim.world, ctx).incomingOf(shop, WOOD)).toBe(1);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  /** A carpenter fetching one wood for a bakehouse from a headquarters holding one, after a snapshot. */
  function fetchFromStore(sim: Simulation): { shop: Entity; store: Entity } {
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0);
    const store = buildingAt(sim, HEADQUARTERS, 4, 0, [[WOOD, 1]]);
    const baker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(baker, SupplyRun, { site: shop, goodType: WOOD, amount: 1 });
    sim.world.add(baker, PickupClaim, { source: store, goodType: WOOD, amount: 1 });
    expect(workshopWorkforce(sim.world, ctxOf(sim)).incomingOf(shop, WOOD)).toBe(1);
    return { shop, store };
  }

  it('verifies a changed source without re-taking its check for the snapshot in hand', () => {
    const sim = new Simulation({ seed: 1, content: technologyContent(), map: grassMap(8, 1) });
    const { shop, store } = fetchFromStore(sim);
    const snapshot = workshopWorkforce(sim.world, ctxOf(sim));
    setStockAmount(sim.world, store, WOOD, 0);
    expect(sim.world.verifyCaches()).toEqual([]);
    expect(snapshot.incomingOf(shop, WOOD)).toBe(1);
    expect(workshopWorkforce(sim.world, ctxOf(sim)).incomingOf(shop, WOOD)).toBe(0);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('drops a fetched load whose source starts an upgrade', () => {
    const sim = new Simulation({ seed: 1, content: technologyContent(), map: grassMap(8, 1) });
    const { shop, store } = fetchFromStore(sim);
    sim.world.add(store, Upgrading, {
      target: sim.world.get(store, Building).buildingType,
      savedStock: new Map(),
      seeded: new Map(),
    });
    expect(workshopWorkforce(sim.world, ctxOf(sim)).incomingOf(shop, WOOD)).toBe(0);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('drops a fetched load whose source is destroyed', () => {
    const sim = new Simulation({ seed: 1, content: technologyContent(), map: grassMap(8, 1) });
    const { shop, store } = fetchFromStore(sim);
    sim.world.destroy(store);
    expect(workshopWorkforce(sim.world, ctxOf(sim)).incomingOf(shop, WOOD)).toBe(0);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('keeps the shelf a workshop had at its first inbound read, and reads nothing stale', () => {
    const sim = new Simulation({ seed: 1, content: technologyContent(), map: grassMap(8, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0);
    const baker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(baker, Carrying, { goodType: WOOD, amount: 1 });
    const ctx = ctxOf(sim);
    const snapshot = workshopWorkforce(sim.world, ctx);
    snapshot.shelveInbound(shop);
    setStockAmount(sim.world, shop, WOOD, stockCapacity(sim.world, ctx, shop, WOOD));
    expect(snapshot.incomingOf(shop, WOOD)).toBe(1);

    const full = workshopWorkforce(sim.world, ctx);
    expect(full.incomingOf(shop, WOOD)).toBe(0);
    expect(() => snapshot.incomingOf(shop, WOOD)).toThrow();
  });
});
