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
  Stockpile,
} from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { plannerSystem, productionSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import {
  BAKEHOUSE,
  buildingAt,
  CARPENTER,
  CARRIER,
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
  sim.world.mut(worker, Settler).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
  sim.world.add(worker, CraftSelection, { goods: [PLANK], cursor: 0 });
  settlerAt(sim, 5, 0, CARRIER, shop);
  plannerSystem(sim.world, ctxOf(sim));
  expect(sim.world.tryGet(worker, Resting)).toEqual({ at: shop });
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
    sim.world.mut(oldWorker, Settler).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
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
  sim.world.mut(worker, Settler).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
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
    sim.world.mut(a, Settler).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
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
  sim.world.mut(b, Settler).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
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
      sim.world.mut(e, Settler).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
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

it('reserves a shared ingredient while the other operator walks to an empty well', () => {
  const water = 207;
  const wellType = 30;
  const base = testContent();
  const forge = workshop(base, FORGE);
  forge.workers = [{ jobType: CARPENTER, count: 2 }];
  forge.stock.push({ goodType: water, capacity: 20, initial: 0 });
  secondRecipe(forge).inputs = [
    { goodType: WOOD, amount: 1 },
    { goodType: water, amount: 1 },
  ];
  const content = parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: water, id: 'water', weight: 1 }],
    buildings: [
      ...base.buildings,
      {
        typeId: wellType,
        id: 'work_well_00',
        kind: 'workplace',
        collectAtomic: 44,
        workers: [{ jobType: 24, count: 1 }],
        stock: [{ goodType: water, capacity: 1, initial: 0 }],
        produces: [water],
        recipes: [{ inputs: [], outputs: [{ goodType: water, amount: 1 }], ticks: 4 }],
      },
    ],
  });
  const sim = new Simulation({ seed: 1, content, map: grassMap(14, 1) });
  const shop = buildingAt(sim, FORGE, 0, 0);
  const store = buildingAt(sim, HEADQUARTERS, 3, 0);
  buildingAt(sim, wellType, 10, 0);
  settlerAt(sim, 13, 0, WOODCUTTER);
  for (const good of [PLANK, FOOD_SIMPLE]) {
    const worker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(worker, Settler).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
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
    sim.world.mut(worker, Settler).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
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
