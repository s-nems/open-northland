import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  DeferredOrder,
  JobAssignment,
  Owner,
  PlayerOrder,
  Production,
  Resting,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { playerCommand, Simulation } from '../../src/index.js';
import { atomicSystem, plannerSystem, productionSystem } from '../../src/systems/index.js';
import { startCraftAtomic } from '../../src/systems/settlers/drives/economy/workshop/craft.js';
import { testContent } from '../fixtures/content.js';
import {
  buildingAt,
  CARPENTER,
  ctxOf,
  grassMap,
  KITCHEN,
  PLANK,
  settlerAt,
  TWIN_MILL,
  WOOD,
} from './producer-supply/support.js';

/**
 * The craft clip a workshop operator performs while its batch runs - what the render draws a baker doing
 * inside his bakery. The clip is a view of the workplace's batch: it carries the product's
 * `atomicForProduction` id and the batch's own clock, and applies nothing of its own, since the goods
 * still land through the production system.
 */

/** The fixture kitchen's ware (`bread` = good 7, `atomicForProduction 47`) and its recipe time. */
const BREAD = 7;
const PRODUCE_BREAD_ATOMIC = 47;
const KITCHEN_RECIPE_TICKS = 20;

interface Shop {
  readonly sim: Simulation;
  readonly shop: Entity;
  readonly cook: Entity;
}

/** The twin mill's recipe time (fixture 8: 1 wood -> 1 plank). */
const TWIN_MILL_RECIPE_TICKS = 20;
/** A stand-in production atomic for plank, which the golden slice deliberately leaves unbound. */
const PRODUCE_PLANK_ATOMIC = 47;

/** The fixture content with plank made a craft ware, so a two-seat workshop can be watched at work. */
function craftablePlankContent(): ContentSet {
  const base = testContent();
  return {
    ...base,
    goods: base.goods.map((g) =>
      g.typeId === PLANK ? { ...g, atomics: { ...g.atomics, produce: PRODUCE_PLANK_ATOMIC } } : g,
    ),
  };
}

/** A staffed kitchen holding `stock` wood, with its operator standing on the door. */
function staffedKitchen(stock: number): Shop {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
  const shop = buildingAt(sim, KITCHEN, 1, 0, stock > 0 ? [[WOOD, stock]] : []);
  const cook = settlerAt(sim, 1, 0, CARPENTER, shop);
  return { sim, shop, cook };
}

/** One whole tick of the three systems this mechanic spans, in `SYSTEM_ORDER`. */
function tick({ sim }: Shop): void {
  const ctx = ctxOf(sim);
  plannerSystem(sim.world, ctx);
  atomicSystem(sim.world, ctx);
  productionSystem(sim.world, ctx);
}

describe('a workshop operator performing its craft', () => {
  it('takes up the product’s production atomic once a batch is in flight, clocked by that batch', () => {
    const shop = staffedKitchen(2);
    // The seat claim steps the cook inside; production then starts the batch it will perform.
    tick(shop);
    expect(shop.sim.world.has(shop.cook, CurrentAtomic)).toBe(false); // nothing in flight to perform yet
    expect(shop.sim.world.get(shop.cook, Resting).at).toBe(shop.shop);

    plannerSystem(shop.sim.world, ctxOf(shop.sim));
    const atomic = shop.sim.world.get(shop.cook, CurrentAtomic);
    expect(atomic.atomicId).toBe(PRODUCE_BREAD_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'produce', recipeOutput: BREAD });
    expect(atomic.targetEntity).toBe(shop.shop);
    expect(atomic.duration).toBe(KITCHEN_RECIPE_TICKS);
    // The cook stays inside its workplace while performing; the render decides what that looks like.
    expect(shop.sim.world.get(shop.cook, Resting).at).toBe(shop.shop);
  });

  it('follows the batch clock instead of restarting whenever the planner re-runs', () => {
    const shop = staffedKitchen(2);
    for (let i = 0; i < 4; i++) tick(shop);
    // The planner re-derives the clip from the batch each tick and the executor advances it once, which
    // lands it exactly on the batch's own progress rather than back at frame zero.
    const elapsed = shop.sim.world.get(shop.shop, Production).cycles[0]?.elapsed;
    expect(elapsed).toBe(3);
    expect(shop.sim.world.get(shop.cook, CurrentAtomic).elapsed).toBe(elapsed);
  });

  it('performs nothing while the shop is starved, leaving the operator waiting inside', () => {
    const shop = staffedKitchen(0);
    for (let i = 0; i < 3; i++) tick(shop);
    expect(shop.sim.world.has(shop.shop, Production)).toBe(false);
    expect(shop.sim.world.has(shop.cook, CurrentAtomic)).toBe(false);
    expect(shop.sim.world.get(shop.cook, Resting).at).toBe(shop.shop);
  });

  it('leaves the goods to the production system: the clip itself deposits nothing', () => {
    const shop = staffedKitchen(1);
    const bread = (): number => shop.sim.world.get(shop.shop, Stockpile).amounts.get(BREAD) ?? 0;
    for (let i = 0; i < KITCHEN_RECIPE_TICKS; i++) tick(shop);
    expect(bread()).toBe(0); // the batch has not run its whole time yet
    tick(shop);
    expect(bread()).toBe(1);
    // With the input spent and the batch banked, nothing is left to perform.
    tick(shop);
    expect(shop.sim.world.has(shop.cook, CurrentAtomic)).toBe(false);
  });

  it('drops the clip the moment the operator is no longer working the seat', () => {
    const shop = staffedKitchen(2);
    for (let i = 0; i < 3; i++) tick(shop);
    expect(shop.sim.world.has(shop.cook, CurrentAtomic)).toBe(true);
    // Unemployed mid-batch: the producer drive stops re-deriving the clip, so the re-plan that releases
    // the indoor hold must take the clip with it rather than leave it free-running against a batch it
    // no longer tracks.
    shop.sim.world.remove(shop.cook, JobAssignment);
    plannerSystem(shop.sim.world, ctxOf(shop.sim));
    expect(shop.sim.world.has(shop.cook, CurrentAtomic)).toBe(false);
  });

  it('shows each seat its own batch, and gives a hand beyond them nothing to perform', () => {
    const shop = staffedKitchen(2);
    const world = shop.sim.world;
    world.add(shop.shop, Production, {
      cycles: [
        { elapsed: 3, duration: KITCHEN_RECIPE_TICKS, goodType: BREAD },
        { elapsed: 11, duration: KITCHEN_RECIPE_TICKS, goodType: BREAD },
      ],
    });
    const seatOf = (seat: number): number | null => {
      world.remove(shop.cook, CurrentAtomic);
      startCraftAtomic(world, ctxOf(shop.sim), shop.cook, shop.shop, seat);
      return world.tryGet(shop.cook, CurrentAtomic)?.elapsed ?? null;
    };
    expect(seatOf(0)).toBe(3);
    expect(seatOf(1)).toBe(11);
    // More hands than batches: the spare performs nothing rather than doubling a co-worker's motion.
    expect(seatOf(2)).toBeNull();
  });

  it('gives the operator standing inside a batch that is actually advancing', () => {
    // Production advances one batch per operator present, so a seat handed out in claim order can point
    // at a batch whose clock never moves while its co-worker is still walking to the door.
    const sim = new Simulation({ seed: 1, content: craftablePlankContent(), map: grassMap(8, 1) });
    const mill = buildingAt(sim, TWIN_MILL, 1, 0, [[WOOD, 4]]);
    const walker = settlerAt(sim, 7, 0, CARPENTER, mill); // lower id: claims first, arrives last
    const inside = settlerAt(sim, 1, 0, CARPENTER, mill);
    const world = sim.world;
    world.add(mill, Production, {
      cycles: [
        { elapsed: 3, duration: TWIN_MILL_RECIPE_TICKS, goodType: PLANK },
        { elapsed: 11, duration: TWIN_MILL_RECIPE_TICKS, goodType: PLANK },
      ],
    });

    plannerSystem(world, ctxOf(sim));

    expect(world.has(walker, Resting)).toBe(false);
    expect(world.has(walker, CurrentAtomic)).toBe(false);
    expect(world.get(inside, CurrentAtomic).elapsed).toBe(3);
  });

  it('lets a player order take the operator over at once instead of parking behind the clip', () => {
    // The craft clip is not a committed swing, so `deferOrderDuringAtomic` must not hold the order for
    // the length of a batch the way it holds one behind a harvest stroke.
    const shop = staffedKitchen(2);
    const world = shop.sim.world;
    world.add(shop.cook, Owner, { player: 0 });
    for (let i = 0; i < 3; i++) tick(shop);
    expect(world.has(shop.cook, CurrentAtomic)).toBe(true);

    shop.sim.enqueue(playerCommand(0, { kind: 'moveUnit', entity: shop.cook, x: 3, y: 0 }));
    shop.sim.step();

    expect(world.has(shop.cook, DeferredOrder)).toBe(false);
    expect(world.has(shop.cook, PlayerOrder)).toBe(true);
  });
});
