import { parseContentSet } from '@open-northland/data';
import { expect, it } from 'vitest';
import {
  Carrying,
  CraftSelection,
  JobAssignment,
  MoveGoal,
  Owner,
  PathRequest,
  PlayerOrder,
  Production,
  Resting,
  Settler,
  SettlerProgress,
  Stockpile,
  SupplyRun,
} from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { plannerSystem, productionSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import {
  BAKEHOUSE,
  buildingAt,
  CARPENTER,
  CARRIER,
  cell,
  ctxOf,
  FOOD_SIMPLE,
  FORGE,
  grassMap,
  HEADQUARTERS,
  PLANK,
  PLANK_GATE_RAW_XP,
  settlerAt,
  WHEAT,
  WOOD,
  WOOD_TRACK,
  WOODCUTTER,
} from './producer-supply/support.js';

it('a carrier must not enable recipes deselected by the craftsman', () => {
  const content = testContent();
  workshop(content, BAKEHOUSE).workers.push({ jobType: CARRIER, count: 1 });
  const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
  const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [[WOOD, 10]]);
  buildingAt(sim, HEADQUARTERS, 3, 0, [[WHEAT, 5]]);
  settlerAt(sim, 5, 0, WOODCUTTER);
  const worker = settlerAt(sim, 0, 0, CARPENTER, shop);
  sim.world.mut(worker, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
  sim.world.add(worker, CraftSelection, { goods: [PLANK], cursor: 0 });
  settlerAt(sim, 5, 0, CARRIER, shop);
  plannerSystem(sim.world, ctxOf(sim));
  expect(sim.world.tryGet(worker, Resting)).toEqual({ at: shop });
});

it.each(['this pass', 'an earlier tick'])(
  'an operator with a startable recipe takes its seat while a colleague already fetches, errand from %s',
  (planned) => {
    const content = testContent();
    workshop(content, BAKEHOUSE).workers = [{ jobType: CARPENTER, count: 2 }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(8, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [[WOOD, 5]]);
    const store = buildingAt(sim, HEADQUARTERS, 4, 0, [[WHEAT, 5]]);
    settlerAt(sim, 7, 0, WOODCUTTER);
    const baker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(baker, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });
    const joiner = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(joiner, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(joiner, CraftSelection, { goods: [PLANK], cursor: 0 });
    if (planned === 'an earlier tick') {
      sim.world.add(baker, SupplyRun, { site: shop, goodType: WHEAT, amount: 1, source: store });
      sim.world.add(baker, MoveGoal, { cell: cell(sim, 4, 0) });
    }
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(baker, SupplyRun).goodType).toBe(WHEAT);
    expect(sim.world.has(joiner, SupplyRun)).toBe(false);
    expect(sim.world.tryGet(joiner, Resting)).toEqual({ at: shop });
  },
);

it('a recipe waiting for a unit a colleague set off for this pass keeps its rotation turn', () => {
  const content = testContent();
  const forge = workshop(content, FORGE);
  forge.workers = [{ jobType: CARPENTER, count: 2 }];
  secondRecipe(forge).inputs = [{ goodType: WOOD, amount: 2 }];
  const sim = new Simulation({ seed: 1, content, map: grassMap(8, 1) });
  const shop = buildingAt(sim, FORGE, 0, 0, [[WOOD, 1]]);
  buildingAt(sim, HEADQUARTERS, 4, 0, [[WOOD, 5]]);
  settlerAt(sim, 7, 0, WOODCUTTER);
  // Planned first, so its fetch is stamped before the other operator decides.
  const fetcher = settlerAt(sim, 0, 0, CARPENTER, shop);
  sim.world.add(fetcher, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });
  const waiting = settlerAt(sim, 0, 0, CARPENTER, shop);
  sim.world.mut(waiting, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
  sim.world.add(waiting, CraftSelection, { goods: [PLANK, FOOD_SIMPLE], cursor: 1 });
  plannerSystem(sim.world, ctxOf(sim));
  expect(sim.world.get(fetcher, SupplyRun).goodType).toBe(WOOD);
  expect(sim.world.get(waiting, CraftSelection).cursor).toBe(1);
  expect(sim.world.tryGet(waiting, Resting)).toEqual({ at: shop });
});

it('a colleague walking to an emptied store does not hold back a startable recipe', () => {
  const content = testContent();
  const forge = workshop(content, FORGE);
  forge.workers = [{ jobType: CARPENTER, count: 2 }];
  secondRecipe(forge).inputs = [{ goodType: WOOD, amount: 2 }];
  const sim = new Simulation({ seed: 1, content, map: grassMap(8, 1) });
  const shop = buildingAt(sim, FORGE, 0, 0, [[WOOD, 1]]);
  const emptied = buildingAt(sim, HEADQUARTERS, 4, 0);
  settlerAt(sim, 7, 0, WOODCUTTER);
  const fetcher = settlerAt(sim, 2, 0, CARPENTER, shop);
  sim.world.add(fetcher, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });
  sim.world.add(fetcher, SupplyRun, { site: shop, goodType: WOOD, amount: 1, source: emptied });
  sim.world.add(fetcher, MoveGoal, { cell: cell(sim, 4, 0) });
  const waiting = settlerAt(sim, 0, 0, CARPENTER, shop);
  sim.world.mut(waiting, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
  sim.world.add(waiting, CraftSelection, { goods: [PLANK, FOOD_SIMPLE], cursor: 1 });
  plannerSystem(sim.world, ctxOf(sim));
  productionSystem(sim.world, ctxOf(sim));
  expect(sim.world.get(shop, Production).cycles.map((c) => c.goodType)).toEqual([PLANK]);
});

for (const owned of [false, true])
  it(`specialized workers retain shared input, owned=${owned}`, () => {
    const content = testContent();
    const bakery = workshop(content, BAKEHOUSE);
    bakery.workers = [{ jobType: CARPENTER, count: 2 }];
    secondRecipe(bakery).inputs = [
      { goodType: WOOD, amount: 1 },
      { goodType: WHEAT, amount: 1 },
    ];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [[WOOD, 1]]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WHEAT, 1]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const oldWorker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(oldWorker, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(oldWorker, CraftSelection, { goods: [PLANK], cursor: 0 });
    const newWorker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(newWorker, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });
    if (owned)
      for (const e of new Set([...sim.world.query(Settler), ...sim.world.query(Stockpile)]))
        sim.world.add(e, Owner, { player: 0 });
    let produced = false;
    for (let i = 0; i < 1200; i++) {
      sim.step();
      for (const e of sim.world.query(Stockpile))
        if ((sim.world.get(e, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0) > 0) produced = true;
      for (const e of sim.world.query(Carrying))
        if (sim.world.get(e, Carrying).goodType === FOOD_SIMPLE) produced = true;
    }
    expect(produced).toBe(true);
  });

it('selected expensive recipe receives two units with first output full', () => {
  const content = testContent();
  secondRecipe(workshop(content, FORGE)).inputs = [{ goodType: WOOD, amount: 2 }];
  const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
  const shop = buildingAt(sim, FORGE, 0, 0, [
    [WOOD, 1],
    [PLANK, 20],
  ]);
  buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
  settlerAt(sim, 5, 0, WOODCUTTER);
  const worker = settlerAt(sim, 0, 0, CARPENTER, shop);
  sim.world.mut(worker, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
  sim.world.add(worker, CraftSelection, { goods: [PLANK, FOOD_SIMPLE], cursor: 0 });
  let produced = false;
  for (let i = 0; i < 700; i++) {
    sim.step();
    for (const e of sim.world.query(Stockpile))
      if ((sim.world.get(e, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0) > 0) produced = true;
  }
  expect(produced).toBe(true);
});

it('recipe choice does not depend on assignment insertion order', () => {
  const goals = [false, true].map((reinsert) => {
    const content = testContent();
    workshop(content, BAKEHOUSE).workers = [{ jobType: CARPENTER, count: 2 }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(8, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 1]]);
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WHEAT, 1]]);
    settlerAt(sim, 7, 0, WOODCUTTER);
    const a = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(a, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(a, CraftSelection, { goods: [PLANK], cursor: 0 });
    const b = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(b, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });
    if (reinsert) {
      sim.world.remove(a, JobAssignment);
      sim.world.add(a, JobAssignment, { workplace: shop });
    }
    plannerSystem(sim.world, ctxOf(sim));
    return sim.world.tryGet(a, MoveGoal)?.cell;
  });
  expect(goals[0]).toBe(goals[1]);
});

it('expensive unused selection does not let a cheap recipe steal priority', () => {
  const content = testContent();
  const type = workshop(content, FORGE);
  type.workers = [{ jobType: CARPENTER, count: 2 }];
  secondRecipe(type).inputs = [
    { goodType: WOOD, amount: 1 },
    { goodType: WHEAT, amount: 1 },
  ];
  type.stock.push({ goodType: 7, capacity: 20, initial: 0 });
  type.recipes.push({
    inputs: [
      { goodType: WOOD, amount: 1 },
      { goodType: WHEAT, amount: 1 },
      { goodType: FOOD_SIMPLE, amount: 1 },
    ],
    outputs: [{ goodType: 7, amount: 1 }],
    ticks: 20,
  });
  const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
  const shop = buildingAt(sim, FORGE, 0, 0, [
    [WOOD, 1],
    [WHEAT, 1],
    [FOOD_SIMPLE, 1],
  ]);
  settlerAt(sim, 5, 0, WOODCUTTER);
  const a = settlerAt(sim, 0, 0, CARPENTER, shop);
  sim.world.add(a, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });
  const b = settlerAt(sim, 0, 0, CARPENTER, shop);
  sim.world.mut(b, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
  sim.world.add(b, CraftSelection, { goods: [PLANK, 7], cursor: 0 });
  productionSystem(sim.world, ctxOf(sim));
  expect(sim.world.get(shop, Production).cycles[0]?.goodType).toBe(FOOD_SIMPLE);
});

it.each([
  [1, 1, 0, 2],
  [0, 2, 0, 2],
  [0, 3, 0, 2],
  [0, 2, 3, 2],
  [0, 3, 3, 2],
  [0, 2, 5, 2],
  [0, 3, 3, 3],
  [0, 4, 3, 4],
])(
  'preserves shared input across deliveries with stock %i, source %i, start %i, recipe amount %i',
  (stock, source, start, amount) => {
    const content = testContent();
    const type = workshop(content, FORGE);
    type.workers = [{ jobType: CARPENTER, count: 2 }];
    secondRecipe(type).inputs = [{ goodType: WOOD, amount }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const shop = buildingAt(sim, FORGE, 0, 0, [[WOOD, stock]]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, source]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    for (const good of [PLANK, FOOD_SIMPLE]) {
      const e = settlerAt(sim, good === PLANK ? start : 0, 0, CARPENTER, shop);
      sim.world.mut(e, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
      sim.world.add(e, CraftSelection, { goods: [good], cursor: 0 });
    }
    for (const e of new Set([...sim.world.query(Settler), ...sim.world.query(Stockpile)]))
      sim.world.add(e, Owner, { player: 0 });
    let produced = false;
    for (let tick = 0; tick < 1200; tick++) {
      sim.step();

      for (const e of sim.world.query(Stockpile))
        if ((sim.world.get(e, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0) > 0) produced = true;
    }
    expect(produced).toBe(true);
  },
);

function workshop(content: ReturnType<typeof testContent>, typeId: number) {
  const type = content.buildings.find((building) => building.typeId === typeId);
  if (type === undefined) throw new Error(`missing fixture workshop ${typeId}`);
  return type;
}

function secondRecipe(type: ReturnType<typeof workshop>) {
  const recipe = type.recipes[1];
  if (recipe === undefined) throw new Error('fixture workshop needs two recipes');
  return recipe;
}

const WATER = 207;
const WELL = 30;

/** The forge's second recipe also wants water, which only an empty well beside it can draw. */
function forgeBesideWell() {
  const base = testContent();
  const forge = workshop(base, FORGE);
  forge.workers = [{ jobType: CARPENTER, count: 2 }];
  forge.stock.push({ goodType: WATER, capacity: 20, initial: 0 });
  secondRecipe(forge).inputs = [
    { goodType: WOOD, amount: 1 },
    { goodType: WATER, amount: 1 },
  ];
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: WATER, id: 'water', weight: 1 }],
    buildings: [
      ...base.buildings,
      {
        typeId: WELL,
        id: 'work_well_00',
        kind: 'workplace',
        collectAtomic: 44,
        workers: [{ jobType: 24, count: 1 }],
        stock: [{ goodType: WATER, capacity: 1, initial: 0 }],
        produces: [WATER],
        recipes: [{ inputs: [], outputs: [{ goodType: WATER, amount: 1 }], ticks: 4 }],
      },
    ],
  });
}

it('reserves a shared ingredient while the other operator walks to an empty well', () => {
  const sim = new Simulation({ seed: 1, content: forgeBesideWell(), map: grassMap(14, 1) });
  const shop = buildingAt(sim, FORGE, 0, 0);
  const store = buildingAt(sim, HEADQUARTERS, 3, 0);
  buildingAt(sim, WELL, 10, 0);
  settlerAt(sim, 13, 0, WOODCUTTER);
  for (const good of [PLANK, FOOD_SIMPLE]) {
    const worker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(worker, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(worker, CraftSelection, { goods: [good], cursor: 0 });
    if (good === PLANK) sim.world.add(worker, Carrying, { goodType: WOOD, amount: 1 });
  }
  for (const e of new Set([...sim.world.query(Settler), ...sim.world.query(Stockpile)]))
    sim.world.add(e, Owner, { player: 0 });
  sim.run(700);
  expect(
    (sim.world.get(shop, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0) +
      (sim.world.get(store, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0),
  ).toBe(1);
});

it('keeps the reservation on the tick the fetcher reaches the well, before its draw starts', () => {
  const sim = new Simulation({ seed: 1, content: forgeBesideWell(), map: grassMap(14, 1) });
  const shop = buildingAt(sim, FORGE, 0, 0, [[WOOD, 1]]);
  const well = buildingAt(sim, WELL, 10, 0);
  settlerAt(sim, 13, 0, WOODCUTTER);
  const present = settlerAt(sim, 0, 0, CARPENTER, shop);
  sim.world.mut(present, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
  sim.world.add(present, CraftSelection, { goods: [PLANK], cursor: 0 });
  // Arrived: movement has retired the walk, and the planner starts the draw only next tick.
  const fetcher = settlerAt(sim, 10, 0, CARPENTER, shop);
  sim.world.add(fetcher, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });
  sim.world.add(fetcher, SupplyRun, { site: shop, goodType: WATER, amount: 1, source: well });
  productionSystem(sim.world, ctxOf(sim));
  expect(sim.world.has(shop, Production)).toBe(false);
});

it.each(['order', 'failed route'])(
  'releases a production reservation after an incoming worker interruption: %s',
  (reason) => {
    const content = testContent();
    const forge = workshop(content, FORGE);
    forge.workers = [{ jobType: CARPENTER, count: 2 }];
    secondRecipe(forge).inputs = [{ goodType: WOOD, amount: 2 }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const shop = buildingAt(sim, FORGE, 0, 0, [[WOOD, 1]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const worker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(worker, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(worker, CraftSelection, { goods: [PLANK], cursor: 0 });
    const incoming = settlerAt(sim, 3, 0, CARPENTER, shop);
    sim.world.add(incoming, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });
    sim.world.add(incoming, Carrying, { goodType: WOOD, amount: 1 });
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(shop, Production)).toBe(false);
    if (reason === 'order') sim.world.add(incoming, PlayerOrder, {});
    else sim.world.add(incoming, PathRequest, { start: 6, goal: 0, failed: true });
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(shop, Production).cycles[0]?.goodType).toBe(PLANK);
  },
);
