import { describe, expect, it } from 'vitest';
import {
  Building,
  missionRecords,
  Stockpile,
  TRIBUTE_SLOTS,
  tributeSlot,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { playerCommand, type Simulation } from '../../src/index.js';
import type { HalfCellNode } from '../../src/nav/halfcell.js';
import type { MissionDefinition, MissionResultOp } from '../../src/systems/missions/index.js';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import {
  FIRST_PASS,
  failedResultsUntil,
  firingSim,
  HEADQUARTERS,
  holds,
  missionSim,
  POINT,
  roundTrip,
  VIKING,
} from './support.js';

/**
 * The tribute table: what a script opens, demands and closes, the goal that reads a paid slot, and the
 * one seat command that pays. The fixture headquarters is a storage that opens with ten wood; the
 * sawmill is a workplace whose wood slot is an input and whose plank slot is its product; the kitchen
 * makes bread, the dish that becomes food_simple everywhere else.
 */

const OWNER = 0;
const RIVAL = 1;
const SLOT = 5;
const OTHER_SLOT = 9;
const STRING_ID = 930;
const WOOD = 1;
const PLANK = 2;
const FOOD = 3;
const STONE = 4;
const MUSHROOM = 5;
const WHEAT = 6;
const BREAD = 7;
const SAWMILL = 2;
const WAREHOUSE = 7;
const KITCHEN = 21;
/** What the fixture headquarters opens with. */
const HQ_WOOD = 10;
const ELSEWHERE = { hx: 8, hy: 8 };
const FAR_CORNER = { hx: 36, hy: 36 };
/** The tick after the first pass, on which a command enqueued at the pass applies. */
const AFTER_FIRST_PASS = FIRST_PASS + 1;

interface HouseSpec {
  readonly type: number;
  readonly at?: HalfCellNode;
  readonly owner?: number;
  readonly goods?: readonly { readonly good: number; readonly amount: number }[];
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
    owner: spec.owner ?? OWNER,
    ...(spec.goods !== undefined ? { initialGoods: spec.goods } : {}),
  });
}

function stockAt(sim: Simulation, type: number, good: number): number {
  for (const e of houses(sim, type)) return sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  throw new Error(`no house of type ${type}`);
}

function* houses(sim: Simulation, type: number): Iterable<Entity> {
  for (const e of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(e, Building).buildingType === type) yield e;
  }
}

function create(slot = SLOT, payer = OWNER, receiver = RIVAL): MissionResultOp {
  return { opcode: 'CreateTribute', slot, player: payer, otherPlayer: receiver, stringId: STRING_ID };
}

function demand(good: number, amount: number, slot = SLOT): MissionResultOp {
  return { opcode: 'AddTributeGoods', slot, good, amount };
}

function clear(slot = SLOT): MissionResultOp {
  return { opcode: 'ClearTribute', slot };
}

/** Mission 0 fires the results on the first pass; mission 1 then asks `PayTribute` in the same pass. */
function tributeSim(results: readonly MissionResultOp[], slot = SLOT): Simulation {
  const opening: MissionDefinition = {
    successfullIf: SUCCESSFUL_IF.all,
    active: true,
    visible: false,
    goals: [],
    results,
  };
  const asking: MissionDefinition = {
    successfullIf: SUCCESSFUL_IF.all,
    active: true,
    visible: false,
    goals: [{ opcode: 'PayTribute', slot }],
    results: [],
  };
  return missionSim([opening, asking]);
}

function paidHolds(sim: Simulation): boolean {
  return missionRecords(sim.world)[1]?.evaluated === true;
}

function pay(sim: Simulation, slot = SLOT, seat = OWNER, payer = seat): void {
  sim.enqueue(playerCommand(seat, { kind: 'payTribute', player: payer, slot }));
  sim.step();
}

describe('CreateTribute and PayTribute', () => {
  it('opens the slot paid with nothing demanded, so the goal holds in the same pass', () => {
    const sim = tributeSim([create()]);
    sim.run(FIRST_PASS);
    expect(tributeSlot(sim.world, SLOT)).toEqual({
      active: true,
      paid: true,
      payer: OWNER,
      receiver: RIVAL,
      stringId: STRING_ID,
      demands: [],
    });
    expect(paidHolds(sim)).toBe(true);
    expect(sim.openTributes(OWNER)).toEqual([]);
  });

  it('reopens a slot over whatever it held', () => {
    const sim = tributeSim([create(), demand(WOOD, 5), create(SLOT, RIVAL, OWNER)]);
    sim.run(FIRST_PASS);
    expect(tributeSlot(sim.world, SLOT)).toMatchObject({
      payer: RIVAL,
      receiver: OWNER,
      paid: true,
      demands: [],
    });
  });

  it('reports a slot outside the table for every tribute line', () => {
    const sim = firingSim([create(TRIBUTE_SLOTS), demand(WOOD, 1, -1), clear(TRIBUTE_SLOTS)]);
    expect(failedResultsUntil(sim, FIRST_PASS)).toEqual(['CreateTribute', 'AddTributeGoods', 'ClearTribute']);
    expect(tributeSlot(sim.world, TRIBUTE_SLOTS)).toBeUndefined();
  });
});

describe('AddTributeGoods', () => {
  it('makes the slot unpaid, grows a repeated good and appends a new one', () => {
    const sim = tributeSim([create(), demand(WOOD, 5), demand(PLANK, 2), demand(WOOD, 3)]);
    sim.run(FIRST_PASS);
    expect(tributeSlot(sim.world, SLOT)).toMatchObject({
      paid: false,
      demands: [
        { good: WOOD, amount: 8 },
        { good: PLANK, amount: 2 },
      ],
    });
    expect(paidHolds(sim)).toBe(false);
  });

  it('drops and reports a sixth kind of good', () => {
    const sim = tributeSim([
      create(),
      demand(WOOD, 1),
      demand(PLANK, 1),
      demand(FOOD, 1),
      demand(STONE, 1),
      demand(MUSHROOM, 1),
      demand(WHEAT, 1),
      demand(WOOD, 1),
    ]);
    expect(failedResultsUntil(sim, FIRST_PASS)).toEqual(['AddTributeGoods']);
    const held = tributeSlot(sim.world, SLOT);
    expect(held?.demands.map((d) => d.good)).toEqual([WOOD, PLANK, FOOD, STONE, MUSHROOM]);
    expect(held?.demands[0]?.amount).toBe(2);
  });

  it('is skipped on a closed slot and on one never opened, without a report', () => {
    const sim = tributeSim([create(), clear(), demand(WOOD, 5), demand(PLANK, 1, OTHER_SLOT)]);
    expect(failedResultsUntil(sim, FIRST_PASS)).toEqual([]);
    expect(tributeSlot(sim.world, SLOT)).toMatchObject({ active: false, paid: true, demands: [] });
    expect(tributeSlot(sim.world, OTHER_SLOT)).toBeUndefined();
  });
});

describe('ClearTribute', () => {
  it('closes the slot: the goal stops holding and the window lists nothing, the data stays', () => {
    const sim = tributeSim([create(), demand(WOOD, 5), clear()]);
    sim.run(FIRST_PASS);
    expect(paidHolds(sim)).toBe(false);
    expect(sim.openTributes(OWNER)).toEqual([]);
    expect(tributeSlot(sim.world, SLOT)).toMatchObject({
      active: false,
      demands: [{ good: WOOD, amount: 5 }],
    });
  });
});

describe('the open tributes a payer owes', () => {
  it('lists unpaid slots ascending with what every store holds toward each demand', () => {
    const sim = tributeSim([
      create(OTHER_SLOT),
      demand(PLANK, 1, OTHER_SLOT),
      create(),
      demand(WOOD, 5),
      demand(PLANK, 3),
    ]);
    place(sim, { type: HEADQUARTERS });
    place(sim, { type: WAREHOUSE, at: ELSEWHERE, goods: [{ good: WOOD, amount: 5 }] });
    sim.run(FIRST_PASS);
    expect(sim.openTributes(OWNER)).toEqual([
      {
        slot: SLOT,
        receiver: RIVAL,
        stringId: STRING_ID,
        demands: [
          { good: WOOD, amount: 5, onHand: HQ_WOOD + 5 },
          { good: PLANK, amount: 3, onHand: 0 },
        ],
        payable: false,
      },
      {
        slot: OTHER_SLOT,
        receiver: RIVAL,
        stringId: STRING_ID,
        demands: [{ good: PLANK, amount: 1, onHand: 0 }],
        payable: false,
      },
    ]);
    expect(sim.openTributes(RIVAL)).toEqual([]);
  });

  it('is payable when the stores together hold every demand in full', () => {
    const sim = tributeSim([create(), demand(WOOD, 5), demand(PLANK, 3)]);
    place(sim, { type: HEADQUARTERS });
    place(sim, { type: WAREHOUSE, at: ELSEWHERE, goods: [{ good: PLANK, amount: 3 }] });
    sim.run(FIRST_PASS);
    // Ten wood here and three planks there add up.
    expect(sim.openTributes(OWNER)[0]?.payable).toBe(true);

    const short = tributeSim([create(), demand(WOOD, 5), demand(PLANK, 3)]);
    place(short, { type: HEADQUARTERS });
    place(short, { type: WAREHOUSE, at: ELSEWHERE, goods: [{ good: PLANK, amount: 2 }] });
    short.run(FIRST_PASS);
    expect(short.openTributes(OWNER)[0]?.payable).toBe(false);
  });

  it("counts a workplace's product and never the inputs delivered to it", () => {
    const sim = tributeSim([create(), demand(WOOD, 2)]);
    place(sim, { type: SAWMILL, goods: [{ good: WOOD, amount: 10 }] });
    sim.run(FIRST_PASS);
    expect(sim.openTributes(OWNER)[0]).toMatchObject({ demands: [{ onHand: 0 }], payable: false });

    const product = tributeSim([create(), demand(PLANK, 2)]);
    place(product, { type: SAWMILL, goods: [{ good: PLANK, amount: 5 }] });
    product.run(FIRST_PASS);
    expect(product.openTributes(OWNER)[0]).toMatchObject({ demands: [{ onHand: 5 }], payable: true });
  });

  it('adds up two demands one stocked good answers, so a store that could not pay both is not payable', () => {
    const short = tributeSim([create(), demand(BREAD, 2), demand(FOOD, 2)]);
    place(short, { type: HEADQUARTERS, goods: [{ good: FOOD, amount: 3 }] });
    short.run(FIRST_PASS);
    expect(short.openTributes(OWNER)[0]?.payable).toBe(false);

    const enough = tributeSim([create(), demand(BREAD, 2), demand(FOOD, 2)]);
    place(enough, { type: HEADQUARTERS, goods: [{ good: FOOD, amount: 4 }] });
    enough.run(FIRST_PASS);
    expect(enough.openTributes(OWNER)[0]?.payable).toBe(true);
    pay(enough);
    expect(stockAt(enough, HEADQUARTERS, FOOD)).toBe(0);
    expect(tributeSlot(enough.world, SLOT)?.paid).toBe(true);
  });

  it('meets a dish with the edible it becomes at a storage, and an edible with the dish at its kitchen', () => {
    const sim = tributeSim([create(), demand(BREAD, 2)]);
    place(sim, { type: HEADQUARTERS, goods: [{ good: FOOD, amount: 3 }] });
    sim.run(FIRST_PASS);
    expect(sim.openTributes(OWNER)[0]).toMatchObject({
      demands: [{ good: BREAD, onHand: 3 }],
      payable: true,
    });

    const kitchen = tributeSim([create(), demand(FOOD, 2)]);
    place(kitchen, { type: KITCHEN, goods: [{ good: BREAD, amount: 2 }] });
    kitchen.run(FIRST_PASS);
    expect(kitchen.openTributes(OWNER)[0]).toMatchObject({
      demands: [{ good: FOOD, onHand: 2 }],
      payable: true,
    });
  });
});

describe('the payTribute command', () => {
  it('drains the storages by id and then the workplaces, marks the slot paid and keeps its demands', () => {
    const sim = tributeSim([create(), demand(WOOD, 5), demand(PLANK, 3)]);
    place(sim, { type: HEADQUARTERS });
    place(sim, {
      type: WAREHOUSE,
      at: ELSEWHERE,
      goods: [
        { good: WOOD, amount: 5 },
        { good: PLANK, amount: 3 },
      ],
    });
    place(sim, { type: SAWMILL, at: FAR_CORNER, goods: [{ good: PLANK, amount: 5 }] });
    sim.run(FIRST_PASS);
    pay(sim);
    expect(sim.tick).toBe(AFTER_FIRST_PASS);
    // The headquarters stood first and gave its wood; the planks came from the warehouse, so the
    // sawmill's product was never touched.
    expect(stockAt(sim, HEADQUARTERS, WOOD)).toBe(HQ_WOOD - 5);
    expect(stockAt(sim, WAREHOUSE, WOOD)).toBe(5);
    expect(stockAt(sim, WAREHOUSE, PLANK)).toBe(0);
    expect(stockAt(sim, SAWMILL, PLANK)).toBe(5);
    expect(tributeSlot(sim.world, SLOT)).toMatchObject({
      paid: true,
      demands: [
        { good: WOOD, amount: 5 },
        { good: PLANK, amount: 3 },
      ],
    });
    expect(sim.openTributes(OWNER)).toEqual([]);
    sim.run(FIRST_PASS);
    expect(paidHolds(sim)).toBe(true);
  });

  it('takes nothing while the stores cannot cover a demand, and nothing twice', () => {
    const sim = tributeSim([create(), demand(WOOD, 5), demand(PLANK, 3)]);
    place(sim, { type: HEADQUARTERS });
    place(sim, { type: WAREHOUSE, at: ELSEWHERE, goods: [{ good: PLANK, amount: 2 }] });
    sim.run(FIRST_PASS);
    pay(sim);
    expect(stockAt(sim, HEADQUARTERS, WOOD)).toBe(HQ_WOOD);
    expect(stockAt(sim, WAREHOUSE, PLANK)).toBe(2);
    expect(tributeSlot(sim.world, SLOT)?.paid).toBe(false);

    const paid = tributeSim([create(), demand(WOOD, 5)]);
    place(paid, { type: HEADQUARTERS });
    paid.run(FIRST_PASS);
    pay(paid);
    pay(paid);
    expect(stockAt(paid, HEADQUARTERS, WOOD)).toBe(HQ_WOOD - 5);
  });

  it('pays a dish demand out of the edible a storage holds', () => {
    const sim = tributeSim([create(), demand(BREAD, 2)]);
    place(sim, { type: HEADQUARTERS, goods: [{ good: FOOD, amount: 3 }] });
    sim.run(FIRST_PASS);
    pay(sim);
    expect(stockAt(sim, HEADQUARTERS, FOOD)).toBe(1);
    expect(tributeSlot(sim.world, SLOT)?.paid).toBe(true);
  });

  it('is refused for another seat and for a slot the seat does not owe', () => {
    const sim = tributeSim([create(), demand(WOOD, 5)]);
    place(sim, { type: HEADQUARTERS });
    sim.run(FIRST_PASS);
    pay(sim, SLOT, RIVAL, OWNER); // a seat naming another payer never passes the authority gate
    pay(sim, SLOT, RIVAL); // and paying its own name for a slot it does not owe is skipped
    expect(stockAt(sim, HEADQUARTERS, WOOD)).toBe(HQ_WOOD);
    expect(tributeSlot(sim.world, SLOT)?.paid).toBe(false);
    expect(holds(sim)).toBe(true); // the opening mission fired; the asking one still waits
  });

  it('survives a save before and after the payment', () => {
    const sim = tributeSim([create(), demand(WOOD, 5), demand(PLANK, 1)]);
    place(sim, {
      type: WAREHOUSE,
      goods: [
        { good: WOOD, amount: 5 },
        { good: PLANK, amount: 1 },
      ],
    });
    sim.run(FIRST_PASS);
    const restored = roundTrip(sim);
    expect(restored.openTributes(OWNER)).toEqual(sim.openTributes(OWNER));
    pay(sim);
    expect(roundTrip(sim).openTributes(OWNER)).toEqual([]);
  });
});
