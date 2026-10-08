import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  MoveGoal,
  Owner,
  PickupClaim,
  Resting,
  Stockpile,
  SupplyRun,
  setStockAmount,
} from '../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../src/core/loop.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { plannerSystem } from '../../src/systems/index.js';
import { FetchableStock } from '../../src/systems/settlers/targets/index.js';
import { testContent } from '../fixtures/content.js';
import {
  buildingAt,
  cell,
  ctxOf,
  grassMap,
  PICKUP_ATOMIC,
  settlerAt,
  siteAt,
  WOOD,
} from './producer-supply/support.js';

// Self-filling houses (the well, the hive) top their own stock up once per game second with no worker.
// Consumers lift the ready unit off the shelf like any store's, and a carrier posted there takes it to the
// nearest recipe consumer with room before storage. The goods and buildings live in a LOCAL content
// extension, since the shared fixture's typeIds 10..14 are footprinted houses the placement tests claim.

const WATER = 207;
const BREAD = 208;
const HONEY = 209;
const ALE = 210;
const OPERATOR = 2; // the bakery/brewery craftsman (the fixture's carpenter job, reused as the operator)
const CARRIER = 24;
const WELL = 10;
const HIVE = 11;
const BAKERY = 12;
const BREWERY = 13;
const WAREHOUSE = 7; // testContent's general storage - extended below to stock the utility outputs
const WELL_PUMP_ATOMIC = 44; // the well's `collectAtomic`
const HIVE_COLLECT_ATOMIC = 45; // the hive's
const CONSUMER_CAPACITY = 10;
const BUILD_MATERIAL = WOOD;

/** testContent extended with the self-filling well and hive, their consumers (bakery, brewery) and
 *  utility-good slots on the warehouse, the storage fallback. */
function utilityContent(wellCapacity = 1): ContentSet {
  const base = testContent();
  const consumerSlot = (goodType: number) => ({ goodType, capacity: CONSUMER_CAPACITY, initial: 0 });
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: WATER, id: 'water', weight: 1 },
      { typeId: BREAD, id: 'bread', weight: 1 },
      { typeId: HONEY, id: 'honey', weight: 1 },
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
      {
        typeId: WELL,
        id: 'work_well_00',
        kind: 'workplace',
        buildOnBioPattern: true,
        collectAtomic: WELL_PUMP_ATOMIC,
        refillsOwnStock: true,
        workers: [{ jobType: CARRIER, count: 1 }],
        stock: [{ goodType: WATER, capacity: wellCapacity, initial: 0 }],
        produces: [WATER],
        construction: [{ goodType: BUILD_MATERIAL, amount: 1 }], // so a site stays one until supplied
      },
      {
        typeId: HIVE,
        id: 'work_hive_00',
        kind: 'workplace',
        buildOnBioPattern: true,
        collectAtomic: HIVE_COLLECT_ATOMIC,
        refillsOwnStock: true,
        workers: [{ jobType: CARRIER, count: 1 }],
        stock: [{ goodType: HONEY, capacity: 1, initial: 0 }],
        produces: [HONEY],
      },
      {
        typeId: BAKERY,
        id: 'bakery',
        kind: 'workplace',
        workers: [
          { jobType: OPERATOR, count: 1 },
          { jobType: CARRIER, count: 1 },
        ],
        stock: [consumerSlot(WATER), consumerSlot(BREAD)],
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
        stock: [consumerSlot(HONEY), consumerSlot(WATER), consumerSlot(ALE)],
        produces: [ALE],
        recipes: [
          {
            inputs: [
              { goodType: HONEY, amount: 1 },
              { goodType: WATER, amount: 1 },
            ],
            outputs: [{ goodType: ALE, amount: 1 }],
            ticks: 6,
          },
        ],
      },
    ],
  });
}

const waterIn = (sim: Simulation, store: Entity): number =>
  sim.world.get(store, Stockpile).amounts.get(WATER) ?? 0;

describe('self-filling houses refill their own stock', () => {
  it('adds one unit per game second up to capacity, with nobody posted', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(3), map: grassMap(4, 1) });
    const well = buildingAt(sim, WELL, 1, 0);

    const seen: number[] = [];
    for (let second = 0; second < 5; second++) {
      for (let t = 0; t < TICKS_PER_SECOND; t++) sim.step();
      seen.push(waterIn(sim, well));
    }

    expect(seen).toEqual([1, 2, 3, 3, 3]);
  });

  it('refills the unit a settler took within the next game second', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(4, 1) });
    const well = buildingAt(sim, WELL, 1, 0, [[WATER, 1]]);
    for (let t = 0; t < TICKS_PER_SECOND; t++) sim.step();
    expect(waterIn(sim, well)).toBe(1);

    sim.world.mut(well, Stockpile).amounts.set(WATER, 0);
    for (let t = 0; t < TICKS_PER_SECOND; t++) sim.step();

    expect(waterIn(sim, well)).toBe(1);
  });

  it('fills the hive with honey the same way', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(4, 1) });
    const hive = buildingAt(sim, HIVE, 1, 0);
    for (let t = 0; t < TICKS_PER_SECOND; t++) sim.step();
    expect(sim.world.get(hive, Stockpile).amounts.get(HONEY)).toBe(1);
  });

  it('does not fill a well still under construction', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(4, 1) });
    const site = siteAt(sim, WELL, 1, 0);
    for (let t = 0; t < 3 * TICKS_PER_SECOND; t++) sim.step();
    expect(waterIn(sim, site)).toBe(0);
  });
});

describe('consumers lift a self-filling house’s ready unit', () => {
  it('walks to a well holding water when no store does', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    buildingAt(sim, WELL, 3, 0, [[WATER, 1]]);
    const baker = settlerAt(sim, 0, 0, OPERATOR, bakery);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('lists an empty well among the refillers but not the holders other fetches sweep', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const well = buildingAt(sim, WELL, 3, 0);
    const stock = FetchableStock.of(sim.world, ctxOf(sim));
    expect(stock.holders(WATER).has(well)).toBe(false);
    expect(stock.refillers(WATER).has(well)).toBe(true);
  });

  it('walks to the nearest well even while it is empty', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(12, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    buildingAt(sim, WELL, 3, 0);
    buildingAt(sim, WAREHOUSE, 9, 0, [[WATER, 5]]);
    const baker = settlerAt(sim, 0, 0, OPERATOR, bakery);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('waits at an empty hive without playing the collect clip, and lifts the unit once it refills', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(12, 1) });
    const brewery = buildingAt(sim, BREWERY, 0, 0, [[WATER, 1]]);
    const hive = buildingAt(sim, HIVE, 3, 0);
    const warehouse = buildingAt(sim, WAREHOUSE, 9, 0, [[HONEY, 5]]);
    const brewer = settlerAt(sim, 3, 0, OPERATOR, brewery); // already at the hive

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(brewer, CurrentAtomic).effect.kind).toBe('idle');
    expect(sim.world.has(brewer, MoveGoal)).toBe(false);

    let lifted = false;
    for (let t = 0; t < 2 * TICKS_PER_SECOND && !lifted; t++) {
      sim.step();
      const atomic = sim.world.tryGet(brewer, CurrentAtomic);
      lifted = atomic?.effect.kind === 'pickup' && atomic.effect.from === hive;
    }
    expect(lifted).toBe(true);
    expect(sim.world.get(warehouse, Stockpile).amounts.get(HONEY)).toBe(5);
  });

  it('ranks sources from the workplace, not from where the worker stands', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(16, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    buildingAt(sim, WAREHOUSE, 4, 0, [[WATER, 1]]);
    buildingAt(sim, WAREHOUSE, 14, 0, [[WATER, 1]]);
    const baker = settlerAt(sim, 13, 0, OPERATOR, bakery); // beside the far store

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 4, 0));
  });

  it('lifts the water off the well with the pump action', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(8, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    const well = buildingAt(sim, WELL, 2, 0, [[WATER, 1]]);
    const baker = settlerAt(sim, 2, 0, OPERATOR, bakery); // standing on the well

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(baker, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: WATER, amount: 1, from: well });
    expect(atomic.atomicId).toBe(WELL_PUMP_ATOMIC);
  });

  it('lifts honey off the hive with the hive’s own action', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const brewery = buildingAt(sim, BREWERY, 3, 0);
    const hive = buildingAt(sim, HIVE, 0, 0, [[HONEY, 1]]);
    const brewer = settlerAt(sim, 0, 0, OPERATOR, brewery); // on the hive

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(brewer, CurrentAtomic);
    expect(atomic.atomicId).toBe(HIVE_COLLECT_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: HONEY, amount: 1, from: hive });
  });

  it('lifts a unit off an ordinary store with the generic pick-up', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(8, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    const warehouse = buildingAt(sim, WAREHOUSE, 2, 0, [[WATER, 1]]);
    const baker = settlerAt(sim, 2, 0, OPERATOR, bakery); // standing on the warehouse

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(baker, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: WATER, amount: 1, from: warehouse });
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
  });

  it('leaves the brewery’s water reserve alone and fetches from storage instead', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(8, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    const brewery = buildingAt(sim, BREWERY, 1, 0, [[WATER, 5]]); // a rival consumer's own water, next door
    buildingAt(sim, WAREHOUSE, 6, 0, [[WATER, 5]]);
    const baker = settlerAt(sim, 0, 0, OPERATOR, bakery);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 6, 0));
    expect(waterIn(sim, brewery)).toBe(5);
  });

  it('end to end: an UNSTAFFED well feeds the bakery', () => {
    const sim = new Simulation({ seed: 2, content: utilityContent(), map: grassMap(6, 1) });
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    buildingAt(sim, WELL, 1, 0); // built, but nobody is ever posted to it
    settlerAt(sim, 0, 0, OPERATOR, bakery);

    let bread = 0;
    for (let i = 0; i < 200; i++) {
      sim.step();
      for (const ev of sim.events.current())
        if (ev.kind === 'goodProduced' && ev.goodType === BREAD) bread += ev.amount;
    }

    expect(bread).toBeGreaterThan(0);
  });

  it('is deterministic: the same seed drives the refill→carry→bake loop to a byte-identical state', () => {
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

/** The brewery fixture staffed with two operators, so two brewers fetch for it at once. */
function twoBrewerContent(): ContentSet {
  const base = utilityContent();
  return parseContentSet({
    ...base,
    buildings: base.buildings.map((b) =>
      b.typeId === BREWERY ? { ...b, workers: [{ jobType: OPERATOR, count: 2 }] } : b,
    ),
  });
}

describe('claims at a self-filling house', () => {
  it('a far carrier claiming the well’s unit keeps it from no baker beside it, nor holds the refill up', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(16, 1) });
    const well = buildingAt(sim, WELL, 2, 0, [[WATER, 1]]);
    const bakery = buildingAt(sim, BAKERY, 0, 0);
    // Planned first: the well's own carrier, far off, sets out to haul the unit away.
    const carrier = settlerAt(sim, 15, 0, CARRIER, well);
    const baker = settlerAt(sim, 2, 0, OPERATOR, bakery); // on the well
    for (const e of [well, bakery, carrier, baker]) sim.world.add(e, Owner, { player: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(carrier, MoveGoal).cell).toBe(cell(sim, 2, 0));
    expect(sim.world.get(carrier, PickupClaim)).toEqual({ source: well, goodType: WATER, amount: 1 });
    expect(sim.world.get(baker, CurrentAtomic).effect).toEqual({
      kind: 'pickup',
      goodType: WATER,
      amount: 1,
      from: well,
    });

    let refilled = false;
    let emptied = false;
    for (let t = 0; t < 4 * TICKS_PER_SECOND && !refilled; t++) {
      sim.step();
      if (waterIn(sim, well) === 0) emptied = true;
      else if (emptied) refilled = true;
    }
    expect(refilled).toBe(true);
    expect(sim.world.get(baker, Carrying).goodType).toBe(WATER);
  });

  it('two warehouse carriers in one pass: only the first claims the well’s one unit', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(16, 1) });
    const well = buildingAt(sim, WELL, 2, 0, [[WATER, 1]]);
    const warehouse = buildingAt(sim, WAREHOUSE, 14, 0);
    const first = settlerAt(sim, 10, 0, CARRIER, warehouse);
    const second = settlerAt(sim, 12, 0, CARRIER, warehouse);
    for (const e of [well, warehouse, first, second]) sim.world.add(e, Owner, { player: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(first, MoveGoal).cell).toBe(cell(sim, 2, 0));
    expect(sim.world.get(first, PickupClaim)).toEqual({ source: well, goodType: WATER, amount: 1 });
    expect(sim.world.tryGet(second, PickupClaim)?.source).not.toBe(well);
    expect(sim.world.tryGet(second, MoveGoal)?.cell).not.toBe(cell(sim, 2, 0));
  });

  it('two brewers lifting the hive’s one unit at once: one takes it, the other waits there for the refill', () => {
    const sim = new Simulation({ seed: 1, content: twoBrewerContent(), map: grassMap(8, 1) });
    const brewery = buildingAt(sim, BREWERY, 0, 0, [[WATER, 1]]);
    const hive = buildingAt(sim, HIVE, 3, 0, [[HONEY, 1]]);
    const brewers = [settlerAt(sim, 3, 0, OPERATOR, brewery), settlerAt(sim, 3, 0, OPERATOR, brewery)];
    const honeyIn = (): number => sim.world.get(hive, Stockpile).amounts.get(HONEY) ?? 0;
    const liftsAtHive = (e: Entity): boolean => {
      const atomic = sim.world.tryGet(e, CurrentAtomic);
      return atomic?.effect.kind === 'pickup' && atomic.effect.from === hive;
    };
    const carriesHoney = (e: Entity): boolean => sim.world.tryGet(e, Carrying)?.goodType === HONEY;

    plannerSystem(sim.world, ctxOf(sim));
    expect(brewers.every(liftsAtHive)).toBe(true);

    for (let t = 0; t < 2 * TICKS_PER_SECOND && brewers.some(liftsAtHive); t++) sim.step();
    expect(brewers.filter(carriesHoney)).toHaveLength(1);
    const loser = brewers.find((e) => !carriesHoney(e));
    if (loser === undefined) throw new Error('one brewer ends empty-handed');
    expect(sim.world.has(loser, Carrying)).toBe(false);
    sim.step(); // its next planner pass
    expect(sim.world.has(loser, MoveGoal)).toBe(false);
    expect(sim.world.get(loser, CurrentAtomic).effect.kind).toBe('idle');
    expect(sim.world.get(loser, PickupClaim)).toEqual({ source: hive, goodType: HONEY, amount: 0 });

    let refills = 0;
    let last = honeyIn();
    for (let t = 0; t < 2 * TICKS_PER_SECOND && !carriesHoney(loser); t++) {
      sim.step();
      const now = honeyIn();
      expect(now).toBeLessThanOrEqual(1);
      if (now > last) refills++;
      last = now;
    }
    expect(refills).toBe(1);
    expect(carriesHoney(loser)).toBe(true);
  });

  it('a fetcher waiting at an empty hive keeps its errand untouched until the refill, then lifts', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(12, 1) });
    const brewery = buildingAt(sim, BREWERY, 0, 0, [[WATER, 1]]);
    const hive = buildingAt(sim, HIVE, 3, 0);
    // Just past a refill beat, so the wait spans most of a game second.
    while (sim.tick % TICKS_PER_SECOND !== 1) sim.step();
    const { world } = sim;
    setStockAmount(world, hive, HONEY, 0);
    const brewer = settlerAt(sim, 3, 0, OPERATOR, brewery); // already at the hive
    const errandGenerations = (): number[] =>
      [SupplyRun, PickupClaim].flatMap((c) => [
        world.componentGeneration(c),
        world.componentValueGeneration(c),
      ]);

    sim.step();
    expect(world.get(brewer, CurrentAtomic).effect.kind).toBe('idle');
    expect(world.get(brewer, SupplyRun)).toEqual({ site: brewery, goodType: HONEY, amount: 1 });
    expect(world.get(brewer, PickupClaim)).toEqual({ source: hive, goodType: HONEY, amount: 0 });
    const held = errandGenerations();

    let waited = 0;
    while (world.tryGet(brewer, CurrentAtomic)?.effect.kind === 'idle') {
      expect(errandGenerations()).toEqual(held);
      sim.step();
      waited++;
    }
    expect(waited).toBeLessThan(TICKS_PER_SECOND);
    expect(errandGenerations()).toEqual(held);
    expect(world.get(hive, Stockpile).amounts.get(HONEY)).toBe(1);
    sim.step(); // the refill beat has passed: its next planner pass lifts the unit
    expect(world.get(brewer, CurrentAtomic).effect).toEqual({
      kind: 'pickup',
      goodType: HONEY,
      amount: 1,
      from: hive,
    });
  });

  it('a brewer with no seat fetches even while a colleague brings the same input', () => {
    const sim = new Simulation({ seed: 1, content: twoBrewerContent(), map: grassMap(12, 1) });
    const brewery = buildingAt(sim, BREWERY, 0, 0, [[WATER, 1]]);
    const warehouse = buildingAt(sim, WAREHOUSE, 6, 0, [[HONEY, 3]]);
    const colleague = settlerAt(sim, 3, 0, OPERATOR, brewery);
    sim.world.add(colleague, SupplyRun, { site: brewery, goodType: HONEY, amount: 1 });
    sim.world.add(colleague, PickupClaim, { source: warehouse, goodType: HONEY, amount: 1 });
    sim.world.add(colleague, MoveGoal, { cell: cell(sim, 6, 0) });
    const brewer = settlerAt(sim, 0, 0, OPERATOR, brewery);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(brewer, SupplyRun)).toEqual({ site: brewery, goodType: HONEY, amount: 1 });
    expect(sim.world.has(brewer, Resting)).toBe(false);
  });
});

describe('a carrier posted at a self-filling house distributes its goods', () => {
  it('lifts the ready unit off its well with the pump action', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const well = buildingAt(sim, WELL, 2, 0, [[WATER, 1]]);
    buildingAt(sim, BAKERY, 0, 0);
    const porter = settlerAt(sim, 2, 0, CARRIER, well); // the well's posted carrier, on its door
    sim.world.add(porter, Owner, { player: 0 });
    sim.world.add(well, Owner, { player: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(porter, CurrentAtomic);
    expect(atomic.atomicId).toBe(WELL_PUMP_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: WATER, amount: 1, from: well });
  });

  it('routes the water to a nearby bakery before central storage', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const well = buildingAt(sim, WELL, 5, 0);
    buildingAt(sim, BAKERY, 2, 0);
    buildingAt(sim, WAREHOUSE, 4, 0); // strictly NEARER than the bakery, so a plain store pick would win it
    const porter = settlerAt(sim, 5, 0, CARRIER, well);
    sim.world.add(porter, Carrying, { goodType: WATER, amount: 1 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(porter, MoveGoal).cell).toBe(cell(sim, 2, 0));
  });

  it('passes a full consumer by for the next one with room', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(8, 1) });
    const well = buildingAt(sim, WELL, 7, 0);
    buildingAt(sim, BREWERY, 5, 0, [[WATER, CONSUMER_CAPACITY]]); // the nearer consumer, full
    buildingAt(sim, BAKERY, 1, 0); // farther, with room
    const porter = settlerAt(sim, 7, 0, CARRIER, well);
    sim.world.add(porter, Carrying, { goodType: WATER, amount: 1 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(porter, MoveGoal).cell).toBe(cell(sim, 1, 0));
  });

  it('leaves the unit in the well when neither a consumer nor storage has room', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const well = buildingAt(sim, WELL, 2, 0, [[WATER, 1]]);
    buildingAt(sim, BAKERY, 0, 0, [[WATER, CONSUMER_CAPACITY]]);
    const porter = settlerAt(sim, 2, 0, CARRIER, well);
    sim.world.add(porter, Owner, { player: 0 });
    sim.world.add(well, Owner, { player: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(porter, CurrentAtomic)?.effect.kind).not.toBe('pickup');
    expect(waterIn(sim, well)).toBe(1);
  });

  it('falls back to central storage when no consumer has room', () => {
    const sim = new Simulation({ seed: 1, content: utilityContent(), map: grassMap(6, 1) });
    const well = buildingAt(sim, WELL, 5, 0);
    buildingAt(sim, BAKERY, 2, 0, [[WATER, CONSUMER_CAPACITY]]);
    buildingAt(sim, WAREHOUSE, 4, 0);
    const porter = settlerAt(sim, 5, 0, CARRIER, well);
    sim.world.add(porter, Carrying, { goodType: WATER, amount: 1 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(porter, MoveGoal).cell).toBe(cell(sim, 4, 0));
  });
});
