import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CoinDrillOrder,
  CurrentAtomic,
  Health,
  LostWay,
  MISSION_BEHAVIOUR,
  Owner,
  Position,
  Resting,
  removeCurrentAtomic,
  SettlerProgress,
  Stockpile,
  setStockAmount,
  stampMissionBehaviour,
  TrainingOrder,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../../src/index.js';
import type { NodeId } from '../../../../src/nav/terrain/index.js';
import { walkBlockMask } from '../../../../src/systems/footprint/walk-block-mask.js';
import { personalFightPoints } from '../../../../src/systems/progression/bonus.js';
import { FIGHT_EXPERIENCE_TYPE, fightUnitsOfPoints } from '../../../../src/systems/progression/experience.js';
import { entityNode } from '../../../../src/systems/spatial/nodes.js';
import { testContent } from '../../../fixtures/content.js';
import { grassMap } from '../../../fixtures/needs.js';

/**
 * The coin drill: an armed soldier pays one barracks coin per repetition of his
 * `..._soldier_train` clip and gains its points, below the drill limit; not the recruit's `trainSoldier`
 * enlistment. The fixture binds the clip to the bare soldier alone, as the real tribes do, with the real
 * events: `CHANGE_GOLD -1` early and `GET_TRAINING 25` late.
 */

const VIKING = 1;
const PLAYER = 0;
const OTHER_PLAYER = 1;
const CIVILIST_JOB = 6;
const CARRIER_JOB = 24;
const SOLDIER_JOB = 31;
const SPEAR_JOB = 32;
const SWORD_JOB = 34;
const SABER_JOB = 37;
const BOW_JOB = 40;
const BARRACKS_TYPE = 91;
/** A house whose one walk-blocked node is its own. */
const HUT_TYPE = 92;
const COIN_GOOD = 8;
const TRAIN_ATOMIC = 90;
const TRAIN_CLIP_TICKS = 28;
const COIN_FRAME = 2;
const POINTS_FRAME = 22;
const POINTS_PER_COIN = 25;
const WEAPON_CLASS = { SPEAR: 2, SWORD: 3, SABER: 4, BOW: 6 } as const;
/** The walk between the soldiers' row and the barracks door at the fixture's gait, with slack. */
const WALK_TICKS = 120;
/** Enough hitpoints to outlast the few blows a test reads. */
const FIGHTER_HP = 500;

function coinDrillContent(): ContentSet {
  const base = testContent();
  const viking = base.tribes[0];
  if (viking === undefined) throw new Error('fixture tribe missing');
  const weapon = (typeId: number, jobType: number, mainType: number) => ({
    typeId,
    id: `test_weapon_${typeId}`,
    tribeType: VIKING,
    jobType,
    mainType,
    minRange: 1,
    maxRange: 2,
    damage: { '0': 50 },
  });
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: COIN_GOOD, id: 'coin', weight: 1 }],
    jobs: [
      ...base.jobs,
      { typeId: SPEAR_JOB, id: 'soldier_spear_wooden', baseJob: SOLDIER_JOB, ignoresHomeHouse: true },
      { typeId: SWORD_JOB, id: 'soldier_sword_short', baseJob: SOLDIER_JOB, ignoresHomeHouse: true },
      { typeId: SABER_JOB, id: 'soldier_saber_long', baseJob: SOLDIER_JOB, ignoresHomeHouse: true },
      { typeId: BOW_JOB, id: 'soldier_bow_short', baseJob: SOLDIER_JOB, ignoresHomeHouse: true },
    ],
    weapons: [
      ...base.weapons,
      weapon(40, SPEAR_JOB, WEAPON_CLASS.SPEAR),
      weapon(41, SWORD_JOB, WEAPON_CLASS.SWORD),
      weapon(42, BOW_JOB, WEAPON_CLASS.BOW),
      weapon(43, SABER_JOB, WEAPON_CLASS.SABER),
    ],
    buildings: [
      ...base.buildings,
      {
        typeId: BARRACKS_TYPE,
        id: 'barracks',
        kind: 'training',
        workers: [{ jobType: CARRIER_JOB, count: 4 }],
        stock: [{ goodType: COIN_GOOD, capacity: 100, initial: 1 }],
      },
      {
        typeId: HUT_TYPE,
        id: 'hut',
        kind: 'workplace',
        footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx: 2, dy: 0 } },
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

function freshSim(): Simulation {
  return new Simulation({ seed: 1, content: coinDrillContent(), map: grassMap(12, 8) });
}

function barracksAt(sim: Simulation, x: number, y: number, coins: number, owner = PLAYER): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: BARRACKS_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stockpile, { amounts: new Map([[COIN_GOOD, coins]]) });
  return e;
}

function soldierAt(sim: Simulation, jobType: number, x: number, y: number, points = 0): Entity {
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
  sim.world.add(e, Owner, { player: PLAYER });
  if (points > 0)
    sim.world
      .mut(e, SettlerProgress)
      .experience.set(FIGHT_EXPERIENCE_TYPE.PERSONAL, fightUnitsOfPoints(points));
  return e;
}

function pointsOf(sim: Simulation, e: Entity): number {
  return personalFightPoints(sim.world.get(e, SettlerProgress).experience);
}

function coinsOf(sim: Simulation, house: Entity): number {
  return sim.world.get(house, Stockpile).amounts.get(COIN_GOOD) ?? 0;
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

function nodeOf(sim: Simulation, e: Entity): NodeId {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  return entityNode(sim.world, terrain, e);
}

describe('orderCoinDrill - the coin-paid soldier drill', () => {
  it('drills every armed soldier for a coin each and refuses the bare soldier and a civilian', () => {
    const sim = freshSim();
    const armedJobs = [SWORD_JOB, SPEAR_JOB, SABER_JOB, BOW_JOB];
    const house = barracksAt(sim, 8, 3, armedJobs.length);
    const armed = armedJobs.map((job, i) => soldierAt(sim, job, 2, 1 + i, 40));
    const bare = soldierAt(sim, SOLDIER_JOB, 3, 5);
    const civilian = soldierAt(sim, CIVILIST_JOB, 3, 6);
    for (const entity of [...armed, bare, civilian])
      sim.enqueueSetup({ kind: 'orderCoinDrill', entity, house });
    sim.step();
    expect(armed.map((e) => sim.world.has(e, CoinDrillOrder))).toEqual([true, true, true, true]);
    expect(sim.world.has(bare, CoinDrillOrder)).toBe(false);
    expect(sim.world.has(civilian, CoinDrillOrder)).toBe(false);
    run(sim, WALK_TICKS + 2 * TRAIN_CLIP_TICKS);
    expect(armed.map((e) => pointsOf(sim, e))).toEqual([65, 65, 65, 65]);
    expect(coinsOf(sim, house)).toBe(0);
  });

  it('refuses a soldier at the limit and lets one just under it drill once past it', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 5);
    const atLimit = soldierAt(sim, SWORD_JOB, 2, 2, 50);
    const under = soldierAt(sim, SWORD_JOB, 2, 4, 49);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: atLimit, house });
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: under, house });
    sim.step();
    expect(sim.world.has(atLimit, CoinDrillOrder)).toBe(false);
    run(sim, WALK_TICKS + 3 * TRAIN_CLIP_TICKS);
    expect(pointsOf(sim, under)).toBe(74);
    expect(coinsOf(sim, house)).toBe(4);
  });

  it('refuses a man a mission bars from experience, and ends his drill once barred', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 5);
    const barred = soldierAt(sim, SWORD_JOB, 2, 2);
    const later = soldierAt(sim, SWORD_JOB, 2, 4);
    stampMissionBehaviour(sim.world, barred, MISSION_BEHAVIOUR.NO_JOB_EXPERIENCE);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: barred, house });
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: later, house });
    sim.step();
    expect(sim.world.has(barred, CoinDrillOrder)).toBe(false);
    stampMissionBehaviour(sim.world, later, MISSION_BEHAVIOUR.NO_JOB_EXPERIENCE);
    run(sim, WALK_TICKS);
    expect(sim.world.get(later, CoinDrillOrder).stage).toBe('return');
    expect(coinsOf(sim, house)).toBe(5);
  });

  it('repeats while under the limit and a coin is left, then walks back to where he stood', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 3);
    const soldier = soldierAt(sim, BOW_JOB, 2, 3);
    const start = nodeOf(sim, soldier);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: soldier, house });
    run(sim, 2 * WALK_TICKS + 3 * TRAIN_CLIP_TICKS);
    expect(pointsOf(sim, soldier)).toBe(50);
    expect(coinsOf(sim, house)).toBe(1);
    expect(sim.world.has(soldier, CoinDrillOrder)).toBe(false);
    expect(nodeOf(sim, soldier)).toBe(start);
  });

  it('refuses a soldier at a barracks without coins, and walks one back whose coin was taken meanwhile', () => {
    const sim = freshSim();
    const empty = barracksAt(sim, 8, 6, 0);
    const house = barracksAt(sim, 8, 2, 1);
    const refused = soldierAt(sim, SPEAR_JOB, 2, 6);
    const soldier = soldierAt(sim, SPEAR_JOB, 2, 3);
    const refusedStart = nodeOf(sim, refused);
    const start = nodeOf(sim, soldier);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: refused, house: empty });
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: soldier, house });
    sim.step();
    expect(sim.world.has(refused, CoinDrillOrder)).toBe(false);
    expect(sim.world.has(soldier, CoinDrillOrder)).toBe(true);
    setStockAmount(sim.world, house, COIN_GOOD, 0);
    run(sim, 2 * WALK_TICKS);
    expect(sim.world.has(soldier, CoinDrillOrder)).toBe(false);
    expect(nodeOf(sim, soldier)).toBe(start);
    expect(pointsOf(sim, soldier)).toBe(0);
    expect(nodeOf(sim, refused)).toBe(refusedStart);
  });

  it('sends only as many of a group as the barracks has free coins, the nearest first as the order lists them', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 2);
    const near = [soldierAt(sim, SWORD_JOB, 6, 3, 40), soldierAt(sim, BOW_JOB, 5, 4, 40)];
    const far = [soldierAt(sim, SPEAR_JOB, 2, 2, 40), soldierAt(sim, SWORD_JOB, 1, 5, 40)];
    const farStarts = far.map((e) => nodeOf(sim, e));
    sim.enqueueSetup({
      kind: 'unitActionGroup',
      members: [...near, ...far].map((entity) => ({ entity })),
      action: { kind: 'orderCoinDrill', house },
    });
    sim.step();
    expect([...near, ...far].map((e) => sim.world.has(e, CoinDrillOrder))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    run(sim, WALK_TICKS + 2 * TRAIN_CLIP_TICKS);
    expect(near.map((e) => pointsOf(sim, e))).toEqual([65, 65]);
    expect(far.map((e) => nodeOf(sim, e))).toEqual(farStarts);
    expect(coinsOf(sim, house)).toBe(0);
  });

  it('leaves the coin another soldier is walking to rather than drill it himself', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 2);
    const near = soldierAt(sim, SWORD_JOB, 6, 3);
    const far = soldierAt(sim, BOW_JOB, 1, 3);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: near, house });
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: far, house });
    run(sim, 2 * WALK_TICKS + 2 * TRAIN_CLIP_TICKS);
    expect([pointsOf(sim, near), pointsOf(sim, far)]).toEqual([POINTS_PER_COIN, POINTS_PER_COIN]);
    expect(coinsOf(sim, house)).toBe(0);
  });

  it('walks back from a barracks razed on his way or while he drills', () => {
    const sim = freshSim();
    const onWay = barracksAt(sim, 8, 6, 1);
    const drilling = barracksAt(sim, 8, 2, 1);
    const walker = soldierAt(sim, SWORD_JOB, 2, 6);
    const driller = soldierAt(sim, SWORD_JOB, 7, 2);
    const starts = [nodeOf(sim, walker), nodeOf(sim, driller)];
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: walker, house: onWay });
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: driller, house: drilling });
    sim.step();
    sim.world.destroy(onWay);
    while (sim.world.get(driller, CoinDrillOrder).paid !== true) sim.step();
    sim.world.destroy(drilling);
    run(sim, 2 * WALK_TICKS);
    expect([walker, driller].map((e) => sim.world.has(e, CoinDrillOrder))).toEqual([false, false]);
    expect([walker, driller].map((e) => sim.world.has(e, Resting))).toEqual([false, false]);
    expect([nodeOf(sim, walker), nodeOf(sim, driller)]).toEqual(starts);
  });

  it('walks back beside the node he left when a building now stands on it, not lost', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 1);
    const soldier = soldierAt(sim, SWORD_JOB, 2, 3);
    const start = nodeOf(sim, soldier);
    const startAt = { ...sim.world.get(soldier, Position) };
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: soldier, house });
    while (sim.world.tryGet(soldier, CoinDrillOrder)?.paid !== true) sim.step();
    const hut = sim.world.create();
    sim.world.add(hut, Position, startAt);
    sim.world.add(hut, Building, { buildingType: HUT_TYPE, tribe: VIKING, built: ONE, level: 0 });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const blocked = walkBlockMask(sim.world, { content: sim.content }, terrain);
    expect(blocked.has(start)).toBe(true);
    run(sim, TRAIN_CLIP_TICKS + 2 * WALK_TICKS);
    expect(sim.world.has(soldier, CoinDrillOrder)).toBe(false);
    expect(sim.world.has(soldier, LostWay)).toBe(false);
    const end = nodeOf(sim, soldier);
    expect(blocked.has(end)).toBe(false);
    expect(terrain.neighbours(start)).toContain(end);
  });

  it('steps out to a fight that takes him from the drill and turns back', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 5);
    const driller = soldierAt(sim, SWORD_JOB, 7, 3);
    sim.world.add(driller, Health, { hitpoints: FIGHTER_HP, max: FIGHTER_HP });
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: driller, house });
    while (sim.world.tryGet(driller, CoinDrillOrder)?.paid !== true) sim.step();
    const enemy = soldierAt(sim, SWORD_JOB, 6, 3);
    sim.world.mut(enemy, Owner).player = OTHER_PLAYER;
    sim.world.add(enemy, Health, { hitpoints: FIGHTER_HP, max: FIGHTER_HP });
    while (sim.world.tryGet(driller, CurrentAtomic)?.effect.kind !== 'attack') sim.step();
    expect(sim.world.has(driller, Resting)).toBe(false);
    expect(sim.world.get(driller, CoinDrillOrder).stage).toBe('return');
  });

  it('gives back the coin of a repetition cut before its points', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 2);
    const driller = soldierAt(sim, SWORD_JOB, 7, 3);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: driller, house });
    while (sim.world.tryGet(driller, CoinDrillOrder)?.paid !== true) sim.step();
    removeCurrentAtomic(sim.world, driller);
    run(sim, 3 * TRAIN_CLIP_TICKS);
    expect(pointsOf(sim, driller)).toBe(2 * POINTS_PER_COIN);
    expect(coinsOf(sim, house)).toBe(0);
  });

  it('an attack order calls the drill off, stepping out and giving back the coin of the cut repetition', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 2);
    const driller = soldierAt(sim, SWORD_JOB, 7, 3);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: driller, house });
    while (sim.world.tryGet(driller, CoinDrillOrder)?.paid !== true) sim.step();
    expect(coinsOf(sim, house)).toBe(1);
    const enemy = soldierAt(sim, SWORD_JOB, 2, 6);
    sim.world.mut(enemy, Owner).player = OTHER_PLAYER;
    for (const e of [driller, enemy]) sim.world.add(e, Health, { hitpoints: FIGHTER_HP, max: FIGHTER_HP });
    sim.enqueueSetup({ kind: 'attackUnit', entity: driller, target: enemy });
    sim.step();
    expect(sim.world.has(driller, CoinDrillOrder)).toBe(false);
    expect(sim.world.has(driller, Resting)).toBe(false);
    expect(coinsOf(sim, house)).toBe(2);
    expect(pointsOf(sim, driller)).toBe(0);
  });

  it("refuses another side's barracks, and a walk order calls the drill off", () => {
    const sim = freshSim();
    const theirs = barracksAt(sim, 8, 6, 3, OTHER_PLAYER);
    const ours = barracksAt(sim, 8, 2, 3);
    const soldier = soldierAt(sim, SWORD_JOB, 2, 3);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: soldier, house: theirs });
    sim.step();
    expect(sim.world.has(soldier, CoinDrillOrder)).toBe(false);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: soldier, house: ours });
    sim.step();
    sim.enqueueSetup({ kind: 'moveUnit', entity: soldier, x: 2, y: 6 });
    sim.step();
    expect(sim.world.has(soldier, CoinDrillOrder)).toBe(false);
    expect(sim.world.has(soldier, TrainingOrder)).toBe(false);
  });
});
