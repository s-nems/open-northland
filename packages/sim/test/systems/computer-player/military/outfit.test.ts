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
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import {
  ARMOUR_FETCHES_PER_DECISION,
  armourFetchOrders,
} from '../../../../src/systems/computer-player/military/outfit.js';
import { armorGoodsByProtection } from '../../../../src/systems/readviews/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { grassCellMap } from '../../../fixtures/terrain.js';

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
