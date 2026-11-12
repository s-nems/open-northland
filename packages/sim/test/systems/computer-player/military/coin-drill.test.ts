import { type BuildingType, type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiControl,
  addPerson,
  Building,
  CoinDrillOrder,
  computerModuleEnables,
  EquipOrder,
  Owner,
  Position,
  SettlerProgress,
  Stockpile,
} from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import {
  COIN_DRILL_REACH_NODES,
  coinDrillOrders,
  coinDrillPorters,
  coinPriorityOrders,
  SECOND_DRILL_PORTER_DRILLERS,
  THIRD_DRILL_PORTER_DRILLERS,
} from '../../../../src/systems/computer-player/military/coin-drill.js';
import { buildingStaffing } from '../../../../src/systems/computer-player/workforce/staffing-plan.js';
import type { SeatSupply } from '../../../../src/systems/computer-player/workforce/supply.js';
import { COIN_DRILL_LIMIT } from '../../../../src/systems/progression/coin-drill.js';
import { FIGHT_EXPERIENCE_TYPE, fightUnitsOfPoints } from '../../../../src/systems/progression/experience.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { grassCellMap } from '../../../fixtures/terrain.js';

/** The computer seat's coin drill: porters and the coin priority at its barracks while any of its soldiers
 *  may still drill, and its idle soldiers near a barracks with free coins sent to drill. */

const VIKING = 1;
const SEAT = 0;
const CARRIER_JOB = 24;
const CIVILIST_JOB = 6;
const SOLDIER_JOB = 31;
const SWORD_JOB = 34;
const SWORD_WEAPON = 41;
const SWORD_CLASS = 3;
const BARRACKS_TYPE = 91;
const COIN_GOOD = 8;
const TRAIN_ATOMIC = 90;
const TRAIN_CLIP_TICKS = 28;
const COIN_FRAME = 2;
const POINTS_FRAME = 22;
const POINTS_PER_COIN = 25;
const BARRACKS_CARRIER_SLOTS = 4;
/** The most porters the seat posts for the drill. */
const MOST_DRILL_PORTERS = 3;
const MAP = { width: 48, height: 16 } as const;
const BARRACKS_AT = { x: 4, y: 6 } as const;
/** A cell column past the drill reach from the barracks, in visual cells: a node is half a cell. */
const FAR_X = BARRACKS_AT.x + COIN_DRILL_REACH_NODES;

function drillContent(): ContentSet {
  const base = testContent();
  const viking = base.tribes[0];
  if (viking === undefined) throw new Error('fixture tribe missing');
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: COIN_GOOD, id: 'coin', weight: 1 }],
    jobs: [
      ...base.jobs,
      { typeId: SWORD_JOB, id: 'soldier_sword_short', baseJob: SOLDIER_JOB, ignoresHomeHouse: true },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: SWORD_WEAPON,
        id: 'test_sword',
        tribeType: VIKING,
        jobType: SWORD_JOB,
        mainType: SWORD_CLASS,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 50 },
      },
    ],
    buildings: [
      ...base.buildings,
      {
        typeId: BARRACKS_TYPE,
        id: 'barracks',
        kind: 'training',
        workers: [{ jobType: CARRIER_JOB, count: BARRACKS_CARRIER_SLOTS }],
        stock: [{ goodType: COIN_GOOD, capacity: 100, initial: 0 }],
      },
    ],
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: 'viking_soldier_train',
        name: 'viking_soldier_train',
        length: TRAIN_CLIP_TICKS,
        events: [
          { at: COIN_FRAME, type: 30, value: -1 },
          { at: POINTS_FRAME, type: 29, value: POINTS_PER_COIN },
        ],
      },
    ],
    tribes: [
      {
        ...viking,
        atomicBindings: [
          ...viking.atomicBindings,
          { jobType: SOLDIER_JOB, atomicId: TRAIN_ATOMIC, animation: 'viking_soldier_train' },
        ],
      },
      ...base.tribes.slice(1),
    ],
  });
}

function seatSim(
  modules: Parameters<typeof computerModuleEnables>[0] = {},
  computerEnabled = true,
): Simulation {
  const sim = new Simulation({ seed: 1, content: drillContent(), map: grassCellMap(MAP.width, MAP.height) });
  sim.world.add(sim.world.create(), AiControl, {
    player: SEAT,
    computerEnabled,
    modules: computerModuleEnables(modules),
    mapAiEnabled: true,
    difficulty: 'hard',
  });
  return sim;
}

function barracksAt(sim: Simulation, coins: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(BARRACKS_AT.x), y: fx.fromInt(BARRACKS_AT.y) });
  sim.world.add(e, Building, { buildingType: BARRACKS_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: SEAT });
  sim.world.add(e, Stockpile, { amounts: new Map([[COIN_GOOD, coins]]) });
  return e;
}

function soldierAt(sim: Simulation, x: number, y: number, jobType = SWORD_JOB, points = 0): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: SEAT });
  if (points > 0)
    sim.world
      .mut(e, SettlerProgress)
      .experience.set(FIGHT_EXPERIENCE_TYPE.PERSONAL, fightUnitsOfPoints(points));
  return e;
}

/** `count` swordsmen in rows beside the barracks. */
function swordsmen(sim: Simulation, count: number): Entity[] {
  return Array.from({ length: count }, (_, i) => soldierAt(sim, 10 + (i % 20), 2 + 2 * Math.floor(i / 20)));
}

function drillOrders(sim: Simulation, idle: readonly Entity[]): PlayerCommand[] {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  return coinDrillOrders(sim.world, ctxOf(sim), terrain, ownedBuildings(sim.world, SEAT), idle);
}

describe('the computer seat coin drill', () => {
  it('posts one barracks porter from the first soldier who may drill, two and three as they grow', () => {
    const porters = (drillers: number, barracks = true): number => {
      const sim = seatSim();
      if (barracks) barracksAt(sim, 0);
      swordsmen(sim, drillers);
      // Men who may not drill do not count: a soldier at the limit and a civilian.
      soldierAt(sim, 2, 12, SWORD_JOB, COIN_DRILL_LIMIT);
      soldierAt(sim, 4, 12, CIVILIST_JOB);
      return coinDrillPorters(sim.world, ctxOf(sim), SEAT);
    };
    expect(porters(0)).toBe(0);
    expect(porters(1, false)).toBe(0);
    expect(porters(1)).toBe(1);
    expect(porters(SECOND_DRILL_PORTER_DRILLERS - 1)).toBe(1);
    expect(porters(SECOND_DRILL_PORTER_DRILLERS)).toBe(2);
    expect(porters(THIRD_DRILL_PORTER_DRILLERS)).toBe(MOST_DRILL_PORTERS);
  });

  it('posts no drill porter while the computer or its military module is off', () => {
    for (const sim of [seatSim({ military: false }), seatSim({}, false)]) {
      barracksAt(sim, 0);
      swordsmen(sim, THIRD_DRILL_PORTER_DRILLERS);
      expect(coinDrillPorters(sim.world, ctxOf(sim), SEAT)).toBe(0);
    }
  });

  it("runs the barracks' carriers up to the drill porters in its staffing plan", () => {
    const sim = seatSim();
    const barracks = barracksAt(sim, 0);
    const type = sim.content.buildings.find((row) => row.typeId === BARRACKS_TYPE) as BuildingType;
    const plan = (drillPorters: number) =>
      buildingStaffing(
        sim.world,
        ctxOf(sim),
        { player: SEAT, owned: [barracks], supply: {} as SeatSupply, profile: {} as never, drillPorters },
        barracks,
        type,
        { operators: 0, carriers: 0 },
      );
    expect(plan(0)).toMatchObject({ carrierTarget: 0, carrierSurplus: 0 });
    expect(plan(MOST_DRILL_PORTERS)).toMatchObject({
      carrierTarget: MOST_DRILL_PORTERS,
      carrierSurplus: MOST_DRILL_PORTERS,
    });
  });

  it('marks coin a priority good at the barracks while anyone may drill, and takes the mark off after', () => {
    const sim = seatSim();
    const barracks = barracksAt(sim, 0);
    const [man] = swordsmen(sim, 1);
    if (man === undefined) throw new Error('setup: one swordsman');
    const orders = () => coinPriorityOrders(sim.world, ctxOf(sim), SEAT, ownedBuildings(sim.world, SEAT));
    const mark = { kind: 'setStorePriority', building: barracks, goodType: COIN_GOOD };
    expect(orders()).toEqual([{ ...mark, priority: true }]);
    sim.enqueueSetup({ ...mark, priority: true } as PlayerCommand);
    sim.step();
    expect(orders()).toEqual([]);
    sim.world
      .mut(man, SettlerProgress)
      .experience.set(FIGHT_EXPERIENCE_TYPE.PERSONAL, fightUnitsOfPoints(COIN_DRILL_LIMIT));
    expect(orders()).toEqual([{ ...mark, priority: false }]);
  });

  it('sends the idle soldiers near the barracks nearest first, then by id, one per free coin', () => {
    const sim = seatSim();
    const coins = 2;
    const barracks = barracksAt(sim, coins);
    const far = soldierAt(sim, 14, 2);
    const tiedLow = soldierAt(sim, 8, 2);
    const tiedHigh = soldierAt(sim, 8, 2);
    expect(drillOrders(sim, [far, tiedHigh, tiedLow])).toEqual([
      { kind: 'orderCoinDrill', entity: tiedLow, house: barracks },
      { kind: 'orderCoinDrill', entity: tiedHigh, house: barracks },
    ]);
  });

  it('drills a bare soldier and passes over one out of reach, one at the limit and one on an errand', () => {
    const sim = seatSim();
    const barracks = barracksAt(sim, 5);
    const outOfReach = soldierAt(sim, FAR_X, BARRACKS_AT.y);
    const atLimit = soldierAt(sim, 8, 2, SWORD_JOB, COIN_DRILL_LIMIT);
    const bare = soldierAt(sim, 8, 4, SOLDIER_JOB);
    const busy = soldierAt(sim, 8, 8);
    sim.world.add(busy, EquipOrder, {
      group: 'weapon',
      slot: 0,
      goodType: COIN_GOOD,
      returnTo: null,
      stage: 'acquire',
      issuer: 'player',
      queued: [],
    });
    const drilling = soldierAt(sim, 8, 10);
    sim.world.add(drilling, CoinDrillOrder, {
      house: barracks,
      returnTo: 0,
      stage: 'return',
      termTicksLeft: 0,
    });
    const free = soldierAt(sim, 10, 10);
    expect(drillOrders(sim, [outOfReach, atLimit, bare, busy, drilling, free])).toEqual([
      { kind: 'orderCoinDrill', entity: bare, house: barracks },
      { kind: 'orderCoinDrill', entity: free, house: barracks },
    ]);
  });

  it('sends nobody to a barracks whose coins other drillers already speak for', () => {
    const sim = seatSim();
    const barracks = barracksAt(sim, 1);
    const walking = soldierAt(sim, 8, 2);
    sim.world.add(walking, CoinDrillOrder, {
      house: barracks,
      returnTo: 0,
      stage: 'drill',
      termTicksLeft: 0,
    });
    expect(drillOrders(sim, [soldierAt(sim, 8, 4)])).toEqual([]);
  });
});
