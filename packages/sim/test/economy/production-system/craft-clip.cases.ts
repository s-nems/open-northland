import { DEFAULT_RECIPE_TICKS, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, JobAssignment, Position, Production, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { productionSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { CARPENTER, CYCLE_TICKS, ctxOf, spawnSettler, WOOD } from './support.js';

/**
 * A staffed batch lasts one playthrough of the produce clip its operator's tribe and trade bind for the
 * good, whatever the recipe's own `ticks` say. The ids and lengths are the viking rows of the mod's
 * `jobtypes.ini`, `goodtypes.ini` (`atomicForProduction`) and `atomicanimations.ini`.
 */

const VIKING = 1;
const BAKER = 20;
const BREWER = 21;
/** The fixture's `bread` already carries the real `atomicForProduction 47`; `mead` gains its real 50. */
const BREAD = 7;
const MEAD = 13;
const PRODUCE_BREAD_ATOMIC = 47;
const PRODUCE_MEAD_ATOMIC = 50;
const BREAD_CLIP_TICKS = 200;
const MEAD_CLIP_TICKS = 50;
/** Building type ids the base fixture leaves free. */
const BAKERY = 30;
const BREWERY = 31;
/** The fixture kitchen: bread from wood, staffed by a carpenter whose trade binds no bread clip. */
const KITCHEN = 21;
const SHELF = 20;

function workshopType(typeId: number, id: string, jobType: number, product: number) {
  return {
    typeId,
    id,
    kind: 'workplace',
    workers: [{ jobType, count: 1 }],
    stock: [
      { goodType: WOOD, capacity: SHELF, initial: 0 },
      { goodType: product, capacity: SHELF, initial: 0 },
    ],
    recipes: [
      {
        inputs: [{ goodType: WOOD, amount: 1 }],
        outputs: [{ goodType: product, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
    ],
  };
}

function clipContent() {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: base.goods.map((g) =>
      g.typeId === MEAD ? { ...g, atomics: { ...g.atomics, produce: PRODUCE_MEAD_ATOMIC } } : g,
    ),
    jobs: [...base.jobs, { typeId: BAKER, id: 'baker' }, { typeId: BREWER, id: 'brewer' }],
    buildings: [
      ...base.buildings,
      workshopType(BAKERY, 'work_bakery_00', BAKER, BREAD),
      workshopType(BREWERY, 'work_brewery', BREWER, MEAD),
    ],
    tribes: base.tribes.map((t) =>
      t.typeId === VIKING
        ? {
            ...t,
            atomicBindings: [
              ...t.atomicBindings,
              { jobType: BAKER, atomicId: PRODUCE_BREAD_ATOMIC, animation: 'viking_baker_produce_bread' },
              { jobType: BREWER, atomicId: PRODUCE_MEAD_ATOMIC, animation: 'viking_brewer_produce_mead' },
            ],
          }
        : t,
    ),
    atomicAnimations: [
      ...base.atomicAnimations,
      { id: 'viking_baker_produce_bread', name: 'viking_baker_produce_bread', length: BREAD_CLIP_TICKS },
      { id: 'viking_brewer_produce_mead', name: 'viking_brewer_produce_mead', length: MEAD_CLIP_TICKS },
    ],
  });
}

/** A built `buildingType` holding two wood, its `jobType` operator standing on the door. */
function staffedShop(sim: Simulation, buildingType: number, jobType: number): Entity {
  const shop = sim.world.create();
  sim.world.add(shop, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(shop, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(shop, Stockpile, { amounts: new Map([[WOOD, 2]]) });
  const operator = spawnSettler(sim, jobType, 0, 0);
  sim.world.add(operator, JobAssignment, { workplace: shop });
  return shop;
}

/** The tick, counted from the one that starts the first batch, on which `product` first lands. */
function ticksToFirst(sim: Simulation, shop: Entity, product: number, limit: number): number {
  for (let tick = 1; tick <= limit; tick++) {
    productionSystem(sim.world, ctxOf(sim));
    if ((sim.world.get(shop, Stockpile).amounts.get(product) ?? 0) > 0) return tick;
  }
  return -1;
}

describe('productionSystem - a batch lasts its operator’s produce clip', () => {
  it.each([
    ['a brewer’s mead', BREWERY, BREWER, MEAD, MEAD_CLIP_TICKS],
    ['a baker’s bread', BAKERY, BAKER, BREAD, BREAD_CLIP_TICKS],
  ])('runs %s for the clip’s length, not the recipe’s', (_label, type, job, product, clipTicks) => {
    const sim = new Simulation({ seed: 1, content: clipContent() });
    const shop = staffedShop(sim, type, job);

    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(shop, Production).cycles[0]?.duration).toBe(clipTicks);
    // The start tick plus `clipTicks` advances, the last of which deposits.
    expect(ticksToFirst(sim, shop, product, DEFAULT_RECIPE_TICKS * 2)).toBe(clipTicks);
  });

  it('keeps the recipe’s time for an operator whose trade binds no clip for the good', () => {
    const sim = new Simulation({ seed: 1, content: clipContent() });
    const shop = staffedShop(sim, KITCHEN, CARPENTER);

    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(shop, Production).cycles[0]?.duration).toBe(CYCLE_TICKS);
  });
});
