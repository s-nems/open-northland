import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AssistantRecruit,
  addPerson,
  Equipment,
  type EquipmentSlot,
  EquipOrder,
  MISC_EQUIP_SLOTS,
  Owner,
  Position,
  Stockpile,
} from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import {
  ARMOUR_FETCHES_PER_DECISION,
  armourFetchOrders,
  barracksPriorityOrders,
} from '../../../../src/systems/computer-player/military/outfit.js';
import { armorGoodsByProtection } from '../../../../src/systems/readviews/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { grassCellMap } from '../../../fixtures/terrain.js';
import {
  SEAT as AI_SEAT,
  SWORD as AI_SWORD,
  aiSim,
  armedContent,
  BARRACKS_TYPE,
  BOW,
  SPEAR,
} from '../support.js';

/** The computer seat's armour orders for soldiers armed before their armour was made. */

const VIKING = 1;
const SEAT = 0;
/** The fixture's soldier trade. */
const SOLDIER = 31;
/** The fixture's sword (economy goods). */
const SWORD = 9;
const ARMOR_WOOL = 61;
const ARMOR_CHAIN = 62;
/** Soldiers enough to pass the per-decision bound. */
const CROWD = ARMOUR_FETCHES_PER_DECISION + 2;

function armourContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: ARMOR_WOOL, id: 'armor_wool', equip: { category: 'armor' } },
      { typeId: ARMOR_CHAIN, id: 'armor_chain', equip: { category: 'armor' } },
    ],
    armor: [
      { typeId: 1, id: 'armor_wool', mainType: 1, goodType: ARMOR_WOOL, materialType: 1 },
      { typeId: 3, id: 'armor_chain', mainType: 2, goodType: ARMOR_CHAIN, materialType: 3 },
    ],
  });
}

function seatSim(): Simulation {
  return new Simulation({ seed: 1, content: armourContent(), map: grassCellMap(16, 6) });
}

/** A seat soldier at visual cell (x, 2), holding a sword unless `armed` is false. */
function soldierAt(sim: Simulation, x: number, armed = true): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(2) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: SOLDIER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: SEAT });
  sim.world.add(e, Equipment, {
    boots: null,
    tool: null,
    weapon: armed ? { goodType: SWORD, degreeOfUse: fx.fromInt(0) } : null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
  return e;
}

function stock(sim: Simulation, amounts: ReadonlyMap<number, number>): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(12), y: fx.fromInt(2) });
  sim.world.add(e, Stockpile, { amounts: new Map(amounts) });
  sim.world.add(e, Owner, { player: SEAT });
}

/** The armour each ordered man is sent for, by entity. */
function ordered(sim: Simulation, men: readonly Entity[]): Map<Entity, number> {
  const sent = new Map<Entity, number>();
  for (const c of armourFetchOrders(sim.world, ctxOf(sim), SEAT, men)) {
    if (c.kind !== 'equipGood' || c.group !== 'armor') throw new Error(`unexpected order ${c.kind}`);
    sent.set(c.entity, c.goodType);
  }
  return sent;
}

describe('armourFetchOrders - dressing armed soldiers later', () => {
  it('sends the best armour in stock first, the next once it is spoken for, a bounded few a decision', () => {
    const sim = seatSim();
    const [best, next] = armorGoodsByProtection(sim.content);
    if (best === undefined || next === undefined) throw new Error('setup: two armour goods expected');
    stock(
      sim,
      new Map([
        [best, 1],
        [next, CROWD],
      ]),
    );
    const men = Array.from({ length: CROWD }, (_, i) => soldierAt(sim, 1 + i));

    const sent = ordered(sim, men);

    expect(sent.size).toBe(ARMOUR_FETCHES_PER_DECISION);
    expect([...sent.values()]).toEqual([
      best,
      ...new Array<number>(ARMOUR_FETCHES_PER_DECISION - 1).fill(next),
    ]);
  });

  it('passes over the bare-handed, the dressed, a booked recruit and a man already on an errand', () => {
    const sim = seatSim();
    stock(sim, new Map([[ARMOR_WOOL, CROWD]]));
    const bare = soldierAt(sim, 1, false);
    const dressed = soldierAt(sim, 2);
    sim.world.mut(dressed, Equipment).armor = { goodType: ARMOR_WOOL, degreeOfUse: fx.fromInt(0) };
    const booked = soldierAt(sim, 3);
    sim.world.add(booked, AssistantRecruit, { intent: 'trainSword', armed: true, barracks: booked });
    const busy = soldierAt(sim, 4);
    sim.world.add(busy, EquipOrder, {
      group: 'armor',
      slot: 0,
      goodType: ARMOR_WOOL,
      returnTo: null,
      stage: 'acquire',
      issuer: 'player',
      queued: [],
    });
    const free = soldierAt(sim, 5);

    expect([...ordered(sim, [bare, dressed, booked, busy, free]).keys()]).toEqual([free]);
  });

  it('sends nobody when the stock lends no armour beyond the errands under way', () => {
    const sim = seatSim();
    stock(sim, new Map([[ARMOR_WOOL, 1]]));
    const busy = soldierAt(sim, 1);
    sim.world.add(busy, EquipOrder, {
      group: 'armor',
      slot: 0,
      goodType: ARMOR_WOOL,
      returnTo: null,
      stage: 'acquire',
      issuer: 'player',
      queued: [],
    });

    expect(ordered(sim, [busy, soldierAt(sim, 2)]).size).toBe(0);
  });
});

const BARRACKS_AT = { x: 20, y: 10 };
const SECOND_BARRACKS_AT = { x: 40, y: 10 };
const ARMOR_33 = 33;
const MEAD = 43;
const POTION_HEAL_BIG = 49;
const AMULET_FOOD = 50;
const AMULET_SPEED = 55;
/** A weapon good arming only another tribe's soldier. */
const FOREIGN_AXE = 70;
const OTHER_TRIBE = 2;
const SHELF = 60;
/** The fixture's food, shelved by the barracks but never its priority. */
const FOOD = 3;

/** The armed fixture with gear goods, a foreign weapon, and a barracks shelving all but the short bow
 *  and the food amulet. */
function barracksContent(): ContentSet {
  const base = armedContent();
  const shelved = [AI_SWORD, SPEAR, ARMOR_33, MEAD, POTION_HEAL_BIG, AMULET_SPEED, FOREIGN_AXE, FOOD];
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: ARMOR_33, id: 'armor_wool', equip: { category: 'armor' } },
      { typeId: MEAD, id: 'mead' },
      { typeId: POTION_HEAL_BIG, id: 'potion_heal_big', equip: { category: 'misc' } },
      { typeId: AMULET_FOOD, id: 'amulet_food', equip: { category: 'misc' } },
      { typeId: AMULET_SPEED, id: 'amulet_speed', equip: { category: 'misc' } },
      { typeId: FOREIGN_AXE, id: 'axe' },
    ],
    armor: [{ typeId: 1, id: 'armor_wool', mainType: 1, goodType: ARMOR_33, materialType: 1 }],
    weapons: [
      ...base.weapons,
      {
        typeId: 9,
        id: 'foreign_axe',
        tribeType: OTHER_TRIBE,
        jobType: 34,
        mainType: 1,
        goodType: FOREIGN_AXE,
        minRange: 1,
        maxRange: 1,
      },
    ],
    buildings: base.buildings.map((b) =>
      b.typeId === BARRACKS_TYPE
        ? { ...b, stock: shelved.map((goodType) => ({ goodType, capacity: SHELF, initial: 0 })) }
        : b,
    ),
  });
}

function placeBarracks(sim: Simulation, at: { x: number; y: number }, underConstruction = false): void {
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BARRACKS_TYPE,
    x: at.x,
    y: at.y,
    tribe: VIKING,
    owner: AI_SEAT,
    underConstruction,
  });
  sim.step();
}

function barracksOrders(sim: Simulation): PlayerCommand[] {
  return barracksPriorityOrders(sim.world, ctxOf(sim), ownedBuildings(sim.world, AI_SEAT));
}

/** The goods each barracks is ordered to mark, by entity. */
function marksByBarracks(commands: readonly PlayerCommand[]): Map<Entity, number[]> {
  const marks = new Map<Entity, number[]>();
  for (const c of commands) {
    if (c.kind !== 'setStorePriority' || !c.priority) throw new Error(`unexpected order ${c.kind}`);
    marks.set(c.building, [...(marks.get(c.building) ?? []), c.goodType]);
  }
  return marks;
}

function apply(sim: Simulation, commands: readonly PlayerCommand[]): void {
  for (const c of commands) sim.enqueueSetup(c);
  sim.step();
}

const BARRACKS_GEAR = [SPEAR, AI_SWORD, ARMOR_33, POTION_HEAL_BIG, MEAD, AMULET_SPEED];

describe('barracksPriorityOrders - the barracks fetches the army gear', () => {
  it('marks every gear good the barracks shelves once, in the ranking weapons, armour, potions, mead, amulets', () => {
    const sim = aiSim(1, barracksContent());
    placeBarracks(sim, BARRACKS_AT);

    const marks = [...marksByBarracks(barracksOrders(sim)).values()];

    expect(marks).toHaveLength(1);
    const [goods = []] = marks;
    expect([...goods].sort((a, b) => a - b)).toEqual([...BARRACKS_GEAR].sort((a, b) => a - b));
    expect(goods.slice(-4)).toEqual([ARMOR_33, POTION_HEAL_BIG, MEAD, AMULET_SPEED]);
    expect(goods).not.toContain(BOW); // the seat's weapon the barracks has no shelf for
    expect(goods).not.toContain(FOREIGN_AXE);
    expect(goods).not.toContain(FOOD);

    apply(sim, barracksOrders(sim));
    expect(barracksOrders(sim)).toEqual([]);
  });

  it('leaves an unfinished barracks unmarked until it stands', () => {
    const sim = aiSim(1, barracksContent());
    placeBarracks(sim, BARRACKS_AT, true);

    expect(barracksOrders(sim)).toEqual([]);
  });

  it('marks a barracks built after the first, and a rebuilt one, leaving the marked one alone', () => {
    const sim = aiSim(1, barracksContent());
    placeBarracks(sim, BARRACKS_AT);
    apply(sim, barracksOrders(sim));
    const [first] = ownedBuildings(sim.world, AI_SEAT);
    if (first === undefined) throw new Error('setup: barracks missing');
    placeBarracks(sim, SECOND_BARRACKS_AT);

    const second = marksByBarracks(barracksOrders(sim));
    expect(second.has(first)).toBe(false);
    expect(second.size).toBe(1);

    apply(sim, barracksOrders(sim));
    sim.world.destroy(first);
    placeBarracks(sim, BARRACKS_AT);
    const rebuilt = marksByBarracks(barracksOrders(sim));
    expect(rebuilt.size).toBe(1);
    expect([...rebuilt.values()][0]).toHaveLength(BARRACKS_GEAR.length);
  });
});
