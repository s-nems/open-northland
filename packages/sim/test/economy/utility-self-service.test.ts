import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Carrying, CurrentAtomic, MoveGoal } from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { aiSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { buildingAt, cell, ctxOf, grassMap, settlerAt } from './producer-supply/support.js';

// Consumer self-service at shared utility buildings (the well, the hive): a producer worker — or its bound
// carrier — short a recipe input that NO store holds draws its own from an input-less utility that mints it
// (MODE 1, the draw), and a carrier POSTED to a utility feeds nearby recipe consumers before central storage
// (MODE 2, the delivery preference). The utility goods/buildings live in a LOCAL content extension (not the
// shared fixture, whose typeIds 10..14 the placement tests already claim for footprinted houses).

const WATER = 7;
const BREAD = 8;
const HONEY = 9;
const ALE = 10;
const OPERATOR = 2; // the bakery/brewery craftsman (the fixture's carpenter job, reused as the operator)
const CARRIER = 24;
const WELL = 10;
const HIVE = 11;
const BAKERY = 12;
const BREWERY = 13;
const WAREHOUSE = 7; // testContent's general storage — extended below to stock the utility outputs
const PICKUP_ATOMIC = 22; // water binds no produce atomic → the draw falls back to the pickup gesture
const HONEY_PRODUCE_ATOMIC = 45; // honey binds this produce atomic → the draw uses it

const DRAW_TICKS = 4; // the well/hive recipe's own work time (small, so a self-service run closes fast)

/** testContent extended with the utility goods and the well/hive/bakery/brewery — a shared utility that
 *  mints its good from no inputs (water/honey), the consumers that need it (bakery/brewery), and utility-good
 *  slots on the warehouse so a posted carrier has a central-storage fallback sink. */
function utilityContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: WATER, id: 'water', weight: 1 }, // no produce atomic — a draw of it uses the fallback gesture
      { typeId: BREAD, id: 'bread', weight: 1 },
      { typeId: HONEY, id: 'honey', weight: 1, atomics: { produce: HONEY_PRODUCE_ATOMIC } },
      { typeId: ALE, id: 'ale', weight: 1 },
    ],
    buildings: [
      ...base.buildings.map((b) =>
        b.id === 'warehouse'
          ? {
              ...b,
              stock: [
                ...b.stock,
                { goodType: WATER, capacity: 150, initial: 0 },
                { goodType: BREAD, capacity: 150, initial: 0 },
                { goodType: HONEY, capacity: 150, initial: 0 },
                { goodType: ALE, capacity: 150, initial: 0 },
              ],
            }
          : b,
      ),
      // The well: a carrier-only slot and an INPUT-LESS water recipe — unstaffed-by-design; a consumer
      // draws its own by running the recipe in place.
      {
        typeId: WELL,
        id: 'well',
        kind: 'workplace',
        workers: [{ jobType: CARRIER, count: 1 }],
        stock: [{ goodType: WATER, capacity: 1, initial: 0 }],
        produces: [WATER],
        recipes: [{ inputs: [], outputs: [{ goodType: WATER, amount: 1 }], ticks: DRAW_TICKS }],
      },
      {
        typeId: HIVE,
        id: 'hive',
        kind: 'workplace',
        workers: [{ jobType: CARRIER, count: 1 }],
        stock: [{ goodType: HONEY, capacity: 1, initial: 0 }],
        produces: [HONEY],
        recipes: [{ inputs: [], outputs: [{ goodType: HONEY, amount: 1 }], ticks: DRAW_TICKS }],
      },
      // The bakery: a baker (the carpenter job as operator) + a carrier, water → bread. Its water input has
      // no field/harvest source — it comes only from the well's self-service draw.
      {
        typeId: BAKERY,
        id: 'bakery',
        kind: 'workplace',
        workers: [
          { jobType: OPERATOR, count: 1 },
          { jobType: CARRIER, count: 1 },
        ],
        stock: [
          { goodType: WATER, capacity: 10, initial: 0 },
          { goodType: BREAD, capacity: 10, initial: 0 },
        ],
        produces: [BREAD],
        recipes: [
          { inputs: [{ goodType: WATER, amount: 1 }], outputs: [{ goodType: BREAD, amount: 1 }], ticks: 6 },
        ],
      },
      {
        typeId: BREWERY,
        id: 'brewery',
        kind: 'workplace',
        workers: [
          { jobType: OPERATOR, count: 1 },
          { jobType: CARRIER, count: 1 },
        ],
        stock: [
          { goodType: HONEY, capacity: 10, initial: 0 },
          { goodType: ALE, capacity: 10, initial: 0 },
        ],
        produces: [ALE],
        recipes: [
          { inputs: [{ goodType: HONEY, amount: 1 }], outputs: [{ goodType: ALE, amount: 1 }], ticks: 6 },
        ],
      },
    ],
  });
}

describe('utility self-service — MODE 1: a consumer draws a missing input from a shared utility', () => {
  it('walks to the well when no store holds its water input', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0); // needs water for its water → bread recipe; holds none
    buildingAt(sim, WELL, 3, 0); // the shared utility that mints water from nothing
    const baker = settlerAt(sim, 0, 0, OPERATOR, bakery); // on its bakery, no water anywhere

    aiSystem(sim.world, ctxOf(sim));

    // No store holds water and the bakery can't bake — the baker heads for the well to draw its own.
    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('draws water in place when standing on the well (the fallback gesture, no produce atomic bound)', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const bakery = buildingAt(sim, BAKERY, 3, 0); // the bakery, elsewhere
    const well = buildingAt(sim, WELL, 0, 0);
    const baker = settlerAt(sim, 0, 0, OPERATOR, bakery); // standing on the well already

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(baker, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'draw', goodType: WATER, utility: well });
    expect(atomic.duration).toBe(DRAW_TICKS); // the well recipe's own work time
  });

  it('draws honey from the hive with the same neutral gesture (ignoring the good’s produce atomic)', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const brewery = buildingAt(sim, BREWERY, 3, 0);
    const hive = buildingAt(sim, HIVE, 0, 0);
    const brewer = settlerAt(sim, 0, 0, OPERATOR, brewery); // on the hive

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(brewer, CurrentAtomic);
    // Honey binds a produce atomic (HONEY_PRODUCE_ATOMIC) but the draw uses the neutral pickup gesture
    // for every good and worker — the drawer's trade is not the utility's (no beekeeper-only animation).
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'draw', goodType: HONEY, utility: hive });
  });

  it('a bound CARRIER self-serves the bakery’s water too', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const bakery = buildingAt(sim, BAKERY, 3, 0);
    const well = buildingAt(sim, WELL, 0, 0);
    const porter = settlerAt(sim, 0, 0, CARRIER, bakery); // the bakery's carrier, on the well

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(porter, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'draw', goodType: WATER, utility: well });
  });

  it('fetches from a nearer store rather than drawing from a farther well', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    buildingAt(sim, WAREHOUSE, 3, 0, [[WATER, 2]]); // a nearer warehouse that holds water
    buildingAt(sim, WELL, 5, 0); // a farther well
    const baker = settlerAt(sim, 0, 0, OPERATOR, bakery);

    aiSystem(sim.world, ctxOf(sim));

    // The nearer source wins — here the stocked warehouse at cell 3, not the farther well at cell 5.
    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('draws from a nearer well rather than fetching from a farther stocked store (the user’s case)', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(7, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    buildingAt(sim, WELL, 1, 0); // the well is right beside the bakery
    buildingAt(sim, WAREHOUSE, 6, 0, [[WATER, 5]]); // a far HQ/warehouse that also holds water
    const baker = settlerAt(sim, 0, 0, OPERATOR, bakery);

    aiSystem(sim.world, ctxOf(sim));

    // The adjacent well wins over the distant stocked warehouse — the baker draws its own water at cell 1
    // instead of trekking to cell 6.
    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 1, 0));
  });

  it('end to end: an UNSTAFFED well feeds the bakery — bread is baked with nobody posted at the well', () => {
    const sim = new Simulation({ seed: 2, content: utilityContent(), map: grassMap(6, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    buildingAt(sim, WELL, 1, 0); // built, but NO settler is ever posted to it
    settlerAt(sim, 0, 0, OPERATOR, bakery); // the lone baker: draws its own water, then bakes

    let bread = 0;
    for (let i = 0; i < 200; i++) {
      sim.step();
      for (const ev of sim.events.current())
        if (ev.kind === 'goodProduced' && ev.goodType === BREAD) bread += ev.amount;
    }

    expect(bread).toBeGreaterThan(0); // the self-service water chain closed with an unstaffed well
  });

  it('is deterministic: the same seed drives the draw→carry→bake loop to a byte-identical state', () => {
    // A run-twice tripwire for the new `draw` atomic (the fuzz catalog has no input-less utility, so the
    // draw path would otherwise get no seeded run-twice coverage — engine review 2026-07-19).
    const run = (): string => {
      const sim = new Simulation({ seed: 4, content: utilityContent(), map: grassMap(6, 1) });
      const bakery = buildingAt(sim, BAKERY, 0, 0);
      buildingAt(sim, WELL, 1, 0);
      settlerAt(sim, 0, 0, OPERATOR, bakery);
      for (let i = 0; i < 120; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('utility self-service — MODE 2: a posted utility carrier feeds nearby consumers first', () => {
  it('routes the well’s water to a nearby bakery before central storage', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const well = buildingAt(sim, WELL, 5, 0);
    buildingAt(sim, BAKERY, 2, 0); // a recipe consumer of water, with room
    buildingAt(sim, WAREHOUSE, 1, 0); // a NEARER warehouse that could also stock water
    const porter = settlerAt(sim, 5, 0, CARRIER, well); // the well's posted carrier, holding drawn water
    sim.world.add(porter, Carrying, { goodType: WATER, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));

    // The water goes to the bakery (cell 2), NOT the nearer warehouse (cell 1) — consumers before storage.
    expect(sim.world.get(porter, MoveGoal).cell).toBe(cell(sim, 2, 0));
  });

  it('falls back to central storage when no consumer has room', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const well = buildingAt(sim, WELL, 5, 0);
    buildingAt(sim, BAKERY, 2, 0, [[WATER, 10]]); // its water slot is FULL (cap 10) — no room
    buildingAt(sim, WAREHOUSE, 1, 0); // the warehouse fallback
    const porter = settlerAt(sim, 5, 0, CARRIER, well);
    sim.world.add(porter, Carrying, { goodType: WATER, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));

    // The bakery can't take it, so the load banks in the warehouse (cell 1) instead.
    expect(sim.world.get(porter, MoveGoal).cell).toBe(cell(sim, 1, 0));
  });
});
