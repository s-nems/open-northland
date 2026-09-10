import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, missionRecords, Position, Stockpile, Vehicle } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { type HalfCellNode, nodeOfPosition } from '../../src/nav/halfcell.js';
import type { MissionGoalOp, MissionResultOp } from '../../src/systems/missions/index.js';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { MAX_GROUND_STACK } from '../../src/systems/stores/index.js';
import { testContent } from '../fixtures/content.js';
import { FIRST_PASS, firingSim, goalSim, HEADQUARTERS, holds, missionSim, POINT, VIKING } from './support.js';

/**
 * The goods a script hands out and asks about: stock put into named houses, into the player's
 * storages, and onto the ground around a point, and the four counts that read it back. The fixture
 * headquarters is a storage that opens with ten wood; the sawmill is a workplace whose wood slot is
 * an input and whose plank slot is its product.
 */

const SAWMILL = 2;
const WOOD = 1;
const PLANK = 2;
const BREAD = 7;
const HQ_WOOD_CAPACITY = 150;
const SAWMILL_WOOD_CAPACITY = 20;
const OWNER = 0;
const RIVAL = 1;
const GROUP = 5;
const OTHER_GROUP = 6;
/** Two ticks in, every setup command has applied and no pass has run. */
const PLACED = 2;
/** Well outside every range these tests use, on either side of the point. */
const FAR = { hx: POINT.hx + 12, hy: POINT.hy + 12 };
const ELSEWHERE = { hx: 8, hy: 8 };
const FAR_CORNER = { hx: 36, hy: 36 };
/** A storage with a build bill, so a site of it stays unfinished until someone hauls the wood in. */
const SHED = 40;

function shedContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: SHED,
        id: 'shed',
        kind: 'storage',
        stock: [{ goodType: WOOD, capacity: 50, initial: 0 }],
        construction: [{ goodType: WOOD, amount: 1 }],
      },
    ],
  });
}

interface HouseSpec {
  readonly type: number;
  readonly at?: HalfCellNode;
  readonly owner?: number;
  readonly missionId?: number;
  readonly goods?: readonly { readonly good: number; readonly amount: number }[];
  readonly unfinished?: boolean;
}

function place(sim: Simulation, spec: HouseSpec): void {
  const at = spec.at ?? POINT;
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: spec.type,
    tribe: VIKING,
    x: at.hx,
    y: at.hy,
    force: true,
    ...(spec.owner !== undefined ? { owner: spec.owner } : {}),
    ...(spec.missionId !== undefined ? { missionId: spec.missionId } : {}),
    ...(spec.goods !== undefined ? { initialGoods: spec.goods } : {}),
    ...(spec.unfinished ? { underConstruction: true } : {}),
  });
}

function houses(sim: Simulation): Entity[] {
  return [...sim.world.query(Building)].sort((a, b) => a - b);
}

function onlyHouse(sim: Simulation): Entity {
  const [e, ...rest] = houses(sim);
  if (e === undefined || rest.length > 0) throw new Error('expected one house');
  return e;
}

function stock(sim: Simulation, e: Entity, good: number): number {
  return sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
}

function groundPiles(sim: Simulation, good: number): { at: HalfCellNode; amount: number }[] {
  const { world } = sim;
  const piles: { at: HalfCellNode; amount: number }[] = [];
  for (const e of world.query(Stockpile, Position)) {
    if (world.has(e, Building) || world.has(e, Vehicle)) continue;
    const amount = world.get(e, Stockpile).amounts.get(good) ?? 0;
    const p = world.get(e, Position);
    piles.push({ at: nodeOfPosition(p.x, p.y), amount });
  }
  return piles;
}

function groundTotal(sim: Simulation, good: number): number {
  return groundPiles(sim, good).reduce((sum, p) => sum + p.amount, 0);
}

/** Run to the first pass, reporting each house's stock of `good` before and after it. */
function firstPassDelta(sim: Simulation, good: number): { before: number[]; after: number[] } {
  sim.run(PLACED);
  const before = houses(sim).map((e) => stock(sim, e, good));
  sim.run(FIRST_PASS - PLACED);
  const after = houses(sim).map((e) => stock(sim, e, good));
  return { before, after };
}

function areaOp(
  opcode: 'AddGoodsToMapArea' | 'RemoveGoodsFromMapArea',
  amount: number,
  range: number,
  flag: boolean,
): MissionResultOp {
  return { opcode, good: WOOD, amount, point: POINT, range, flag, player: OWNER };
}

describe('AddGoodsToHouses', () => {
  it('gives every house carrying the id the amount, over its slot capacity, and only those', () => {
    const sim = firingSim([{ opcode: 'AddGoodsToHouses', objectId: GROUP, good: WOOD, amount: 50 }]);
    place(sim, { type: HEADQUARTERS, missionId: GROUP });
    place(sim, { type: SAWMILL, at: FAR, missionId: GROUP });
    place(sim, { type: HEADQUARTERS, at: ELSEWHERE, missionId: OTHER_GROUP });
    const { before, after } = firstPassDelta(sim, WOOD);
    expect(after).toEqual([(before[0] ?? 0) + 50, (before[1] ?? 0) + 50, before[2]]);
    expect(after[1]).toBeGreaterThan(SAWMILL_WOOD_CAPACITY); // filled past the slot, as the original's write does
  });

  it('reaches a product slot as readily as a storage slot', () => {
    const sim = firingSim([{ opcode: 'AddGoodsToHouses', objectId: GROUP, good: PLANK, amount: 5 }]);
    place(sim, { type: HEADQUARTERS, missionId: GROUP });
    place(sim, { type: SAWMILL, at: FAR, missionId: GROUP });
    sim.run(FIRST_PASS);
    expect(houses(sim).map((e) => stock(sim, e, PLANK))).toEqual([5, 5]);
  });

  it('skips a house whose type has no slot for the good', () => {
    const sim = firingSim([{ opcode: 'AddGoodsToHouses', objectId: GROUP, good: BREAD, amount: 5 }]);
    place(sim, { type: HEADQUARTERS, missionId: GROUP });
    sim.run(FIRST_PASS);
    expect(stock(sim, onlyHouse(sim), BREAD)).toBe(0);
  });

  it('does nothing for an amount of zero or less', () => {
    const sim = firingSim([{ opcode: 'AddGoodsToHouses', objectId: GROUP, good: WOOD, amount: -5 }]);
    place(sim, { type: HEADQUARTERS, missionId: GROUP });
    const { before, after } = firstPassDelta(sim, WOOD);
    expect(after).toEqual(before);
  });
});

describe('AddGoodsToAnyStock', () => {
  it('fills the player storages to capacity in id order and spills the rest to the next', () => {
    const sim = firingSim([{ opcode: 'AddGoodsToAnyStock', player: OWNER, good: WOOD, amount: 200 }]);
    place(sim, { type: HEADQUARTERS, owner: OWNER });
    place(sim, { type: HEADQUARTERS, at: ELSEWHERE, owner: OWNER });
    place(sim, { type: SAWMILL, at: FAR, owner: OWNER });
    place(sim, { type: HEADQUARTERS, at: FAR_CORNER, owner: RIVAL });
    const { before, after } = firstPassDelta(sim, WOOD);
    const spilled = 200 - (HQ_WOOD_CAPACITY - (before[0] ?? 0));
    expect(after).toEqual([HQ_WOOD_CAPACITY, (before[1] ?? 0) + spilled, before[2], before[3]]);
  });

  it('loses what no storage has room for', () => {
    const sim = firingSim([{ opcode: 'AddGoodsToAnyStock', player: OWNER, good: WOOD, amount: 1000 }]);
    place(sim, { type: HEADQUARTERS, owner: OWNER });
    sim.run(FIRST_PASS);
    expect(stock(sim, onlyHouse(sim), WOOD)).toBe(HQ_WOOD_CAPACITY);
  });

  it('passes an unfinished storage by', () => {
    const sim = firingSim(
      [{ opcode: 'AddGoodsToAnyStock', player: OWNER, good: WOOD, amount: 10 }],
      shedContent(),
    );
    place(sim, { type: SHED, owner: OWNER, unfinished: true });
    place(sim, { type: SHED, at: ELSEWHERE, owner: OWNER });
    const { before, after } = firstPassDelta(sim, WOOD);
    expect(after).toEqual([before[0], (before[1] ?? 0) + 10]);
  });
});

describe('AddGoodsToMapArea', () => {
  it('stacks the good on the ground nearest the point first', () => {
    const sim = firingSim([areaOp('AddGoodsToMapArea', 12, 2, false)]);
    sim.run(FIRST_PASS);
    expect(groundTotal(sim, WOOD)).toBe(12);
    const centre = groundPiles(sim, WOOD).find((p) => p.at.hx === POINT.hx && p.at.hy === POINT.hy);
    expect(centre?.amount).toBe(MAX_GROUND_STACK);
  });

  it('stops at the range and loses what the area cannot hold', () => {
    const sim = firingSim([areaOp('AddGoodsToMapArea', 9, 0, false)]);
    sim.run(FIRST_PASS);
    expect(groundTotal(sim, WOOD)).toBe(MAX_GROUND_STACK);
  });

  it('lays nothing for an amount of zero', () => {
    const sim = firingSim([areaOp('AddGoodsToMapArea', 0, 2, false)]);
    sim.run(FIRST_PASS);
    expect(groundPiles(sim, WOOD)).toEqual([]);
  });

  it('fills the player house standing there before the ground when the flag says so', () => {
    const sim = firingSim([areaOp('AddGoodsToMapArea', 200, 6, true)]);
    place(sim, { type: HEADQUARTERS, owner: OWNER });
    const { before, after } = firstPassDelta(sim, WOOD);
    expect(after[0]).toBe(HQ_WOOD_CAPACITY);
    expect(groundTotal(sim, WOOD)).toBe(200 - (HQ_WOOD_CAPACITY - (before[0] ?? 0)));
  });

  it('leaves the house alone without the flag, and another player house with it', () => {
    const without = firingSim([areaOp('AddGoodsToMapArea', 20, 6, false)]);
    place(without, { type: HEADQUARTERS, owner: OWNER });
    const { before, after } = firstPassDelta(without, WOOD);
    expect(after).toEqual(before);
    expect(groundTotal(without, WOOD)).toBe(20);

    const rival = firingSim([areaOp('AddGoodsToMapArea', 20, 6, true)]);
    place(rival, { type: HEADQUARTERS, owner: RIVAL });
    const delta = firstPassDelta(rival, WOOD);
    expect(delta.after).toEqual(delta.before);
  });
});

describe('RemoveGoodsFromMapArea', () => {
  function seeded(remove: MissionResultOp, house?: HouseSpec): Simulation {
    const sim = firingSim([areaOp('AddGoodsToMapArea', 12, 2, false), remove]);
    if (house !== undefined) place(sim, house);
    return sim;
  }

  it('picks the good up off the ground and reaps the heaps it empties', () => {
    const sim = seeded(areaOp('RemoveGoodsFromMapArea', 7, 2, false));
    sim.run(FIRST_PASS);
    expect(groundTotal(sim, WOOD)).toBe(5);
    expect(groundPiles(sim, WOOD).every((p) => p.amount > 0)).toBe(true);
  });

  it('takes the player house own stock first when the flag says so', () => {
    const sim = seeded(areaOp('RemoveGoodsFromMapArea', 15, 2, true), { type: HEADQUARTERS, owner: OWNER });
    const { before, after } = firstPassDelta(sim, WOOD);
    const held = before[0] ?? 0;
    expect(after[0]).toBe(0);
    expect(groundTotal(sim, WOOD)).toBe(12 - (15 - held));
  });

  it('leaves another player house alone, flag or not', () => {
    const sim = seeded(areaOp('RemoveGoodsFromMapArea', 15, 2, true), { type: HEADQUARTERS, owner: RIVAL });
    const { before, after } = firstPassDelta(sim, WOOD);
    expect(after).toEqual(before);
    expect(groundTotal(sim, WOOD)).toBe(0);
  });

  it('never takes a workplace input, which is not its own stock', () => {
    const sim = seeded(areaOp('RemoveGoodsFromMapArea', 15, 2, true), {
      type: SAWMILL,
      owner: OWNER,
      goods: [{ good: WOOD, amount: SAWMILL_WOOD_CAPACITY }],
    });
    sim.run(FIRST_PASS);
    expect(stock(sim, onlyHouse(sim), WOOD)).toBe(SAWMILL_WOOD_CAPACITY);
    expect(groundTotal(sim, WOOD)).toBe(0);
  });
});

describe('the goods goals', () => {
  it('GoodsInHouses sums the named houses, any slot', () => {
    const enough = goalSim({ opcode: 'GoodsInHouses', objectId: GROUP, good: WOOD, amount: 30 });
    place(enough, { type: HEADQUARTERS, missionId: GROUP, goods: [{ good: WOOD, amount: 10 }] });
    place(enough, { type: SAWMILL, at: FAR, missionId: GROUP, goods: [{ good: WOOD, amount: 10 }] });
    enough.run(FIRST_PASS);
    expect(holds(enough)).toBe(true);

    const short = goalSim({ opcode: 'GoodsInHouses', objectId: GROUP, good: WOOD, amount: 31 });
    place(short, { type: HEADQUARTERS, missionId: GROUP, goods: [{ good: WOOD, amount: 10 }] });
    place(short, { type: SAWMILL, at: FAR, missionId: GROUP, goods: [{ good: WOOD, amount: 10 }] });
    short.run(FIRST_PASS);
    expect(holds(short)).toBe(false);
  });

  it('GoodsGlobal counts a workplace product but not its inputs', () => {
    const product = goalSim({ opcode: 'GoodsGlobal', player: OWNER, good: PLANK, amount: 5 });
    place(product, { type: SAWMILL, owner: OWNER, goods: [{ good: PLANK, amount: 5 }] });
    product.run(FIRST_PASS);
    expect(holds(product)).toBe(true);

    const input = goalSim({ opcode: 'GoodsGlobal', player: OWNER, good: WOOD, amount: 5 });
    place(input, { type: SAWMILL, owner: OWNER, goods: [{ good: WOOD, amount: SAWMILL_WOOD_CAPACITY }] });
    input.run(FIRST_PASS);
    expect(holds(input)).toBe(false);
  });

  it('an amount of zero or less holds over nothing at all', () => {
    for (const goal of [
      { opcode: 'GoodsInHouses', objectId: GROUP, good: WOOD, amount: 0 },
      { opcode: 'GoodsGlobal', player: OWNER, good: WOOD, amount: -1 },
      { opcode: 'NumberOfGoodsInArea', player: OWNER, good: WOOD, amount: 0, point: POINT, range: 3 },
      { opcode: 'NumberOfGoodsInHousesInArea', player: OWNER, good: WOOD, amount: 0, point: POINT, range: 3 },
    ] as const) {
      const sim = goalSim(goal);
      sim.run(FIRST_PASS);
      expect(holds(sim), goal.opcode).toBe(true);
    }
  });

  /** Whether `goal` holds on a pass that first laid twelve wood on the ground around the point. */
  function holdsOverLaidWood(
    goal: MissionGoalOp,
    ...specs: HouseSpec[]
  ): { held: boolean; stocks: number[] } {
    const sim = missionSim([
      {
        successfullIf: SUCCESSFUL_IF.all,
        active: true,
        visible: false,
        goals: [],
        results: [areaOp('AddGoodsToMapArea', 12, 2, false)],
      },
      { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [goal], results: [] },
    ]);
    for (const spec of specs) place(sim, spec);
    sim.run(FIRST_PASS);
    return {
      held: missionRecords(sim.world)[1]?.evaluated === true,
      stocks: houses(sim).map((e) => stock(sim, e, WOOD)),
    };
  }

  it('NumberOfGoodsInArea adds the ground to what the player houses within range hold', () => {
    const hq: HouseSpec = { type: HEADQUARTERS, owner: OWNER };
    const goal = (amount: number): MissionGoalOp => ({
      opcode: 'NumberOfGoodsInArea',
      player: OWNER,
      good: WOOD,
      amount,
      point: POINT,
      range: 3,
    });
    const inArea = 12 + (holdsOverLaidWood(goal(1), hq).stocks[0] ?? 0);
    expect(holdsOverLaidWood(goal(inArea), hq).held).toBe(true);
    expect(holdsOverLaidWood(goal(inArea + 1), hq).held).toBe(false);
    // A house beyond the range adds nothing, and so does one that is not the player's.
    expect(holdsOverLaidWood(goal(inArea + 1), hq, { ...hq, at: FAR }).held).toBe(false);
    expect(holdsOverLaidWood(goal(inArea + 1), hq, { ...hq, at: ELSEWHERE, owner: RIVAL }).held).toBe(false);
  });

  it('NumberOfGoodsInHousesInArea leaves the ground out', () => {
    const hq: HouseSpec = { type: HEADQUARTERS, owner: OWNER };
    const goal = (amount: number): MissionGoalOp => ({
      opcode: 'NumberOfGoodsInHousesInArea',
      player: OWNER,
      good: WOOD,
      amount,
      point: POINT,
      range: 3,
    });
    const held = holdsOverLaidWood(goal(1), hq).stocks[0] ?? 0;
    expect(held).toBeGreaterThan(0);
    expect(holdsOverLaidWood(goal(held), hq).held).toBe(true);
    expect(holdsOverLaidWood(goal(held + 1), hq).held).toBe(false);
  });
});
