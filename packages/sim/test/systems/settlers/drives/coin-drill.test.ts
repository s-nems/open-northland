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
import { fx, ONE, positionOfNode, Simulation } from '../../../../src/index.js';
import type { NodeId } from '../../../../src/nav/terrain/index.js';
import { walkBlockMask } from '../../../../src/systems/footprint/walk-block-mask.js';
import { personalFightPoints } from '../../../../src/systems/progression/bonus.js';
import { COIN_DRILL_TERM_TICKS } from '../../../../src/systems/progression/coin-drill.js';
import { FIGHT_EXPERIENCE_TYPE, fightUnitsOfPoints } from '../../../../src/systems/progression/experience.js';
import { isInside } from '../../../../src/systems/settlers/indoors.js';
import { IDLE_REPLAN_PERIOD_TICKS } from '../../../../src/systems/settlers/planner/idle-replan.js';
import { interactionCell } from '../../../../src/systems/settlers/targets/index.js';
import { entityNode } from '../../../../src/systems/spatial/nodes.js';
import { testContent } from '../../../fixtures/content.js';
import { grassMap } from '../../../fixtures/needs.js';

/**
 * The coin drill: a soldier, armed or bare, pays one barracks coin per term, repeats his
 * `..._soldier_train` clip inside until it is served and then gains its points, below the drill limit; not
 * the recruit's `trainSoldier` enlistment. The fixture binds the clip to the bare soldier alone, as the real tribes do, with the real
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
/** A served term: whole repetitions until the term's ticks are drawn down, the last one overrunning. */
const SERVED_TERM_TICKS = Math.ceil(COIN_DRILL_TERM_TICKS / TRAIN_CLIP_TICKS) * TRAIN_CLIP_TICKS;
const WEAPON_CLASS = { SPEAR: 2, SWORD: 3, SABER: 4, BOW: 6 } as const;
/** The walk between the soldiers' row and the barracks door at the fixture's gait, with slack. */
const WALK_TICKS = 120;
/** Enough hitpoints to outlast the few blows a test reads. */
const FIGHTER_HP = 500;

/** `seats` is the barracks' `schoolSize`, the men it drills at once; unset seats everyone. */
function coinDrillContent(seats?: number): ContentSet {
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
        ...(seats === undefined ? {} : { schoolSize: seats }),
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

function freshSim(seats?: number): Simulation {
  return new Simulation({ seed: 1, content: coinDrillContent(seats), map: grassMap(12, 8) });
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

function termRuns(sim: Simulation, e: Entity): boolean {
  return (sim.world.tryGet(e, CoinDrillOrder)?.termTicksLeft ?? 0) > 0;
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
  it('drills every soldier for a coin each, armed or bare, and refuses a civilian', () => {
    const sim = freshSim();
    const soldierJobs = [SWORD_JOB, SPEAR_JOB, SABER_JOB, BOW_JOB, SOLDIER_JOB];
    const house = barracksAt(sim, 8, 3, soldierJobs.length);
    const soldiers = soldierJobs.map((job, i) => soldierAt(sim, job, 2, 1 + i, 40));
    const civilian = soldierAt(sim, CIVILIST_JOB, 3, 6);
    for (const entity of [...soldiers, civilian]) sim.enqueueSetup({ kind: 'orderCoinDrill', entity, house });
    sim.step();
    expect(soldiers.map((e) => sim.world.has(e, CoinDrillOrder))).toEqual([true, true, true, true, true]);
    expect(sim.world.has(civilian, CoinDrillOrder)).toBe(false);
    run(sim, WALK_TICKS + SERVED_TERM_TICKS);
    expect(soldiers.map((e) => pointsOf(sim, e))).toEqual([65, 65, 65, 65, 65]);
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
    run(sim, WALK_TICKS + 2 * SERVED_TERM_TICKS);
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

  it('drills one term per coin while under the limit and a coin is left, then walks back to where he stood', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 3);
    const soldier = soldierAt(sim, BOW_JOB, 2, 3);
    const start = nodeOf(sim, soldier);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: soldier, house });
    run(sim, 2 * WALK_TICKS + 2 * SERVED_TERM_TICKS);
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
    run(sim, WALK_TICKS + SERVED_TERM_TICKS);
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
    run(sim, 2 * WALK_TICKS + 2 * SERVED_TERM_TICKS);
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
    while (!termRuns(sim, driller)) sim.step();
    sim.world.destroy(drilling);
    run(sim, 2 * WALK_TICKS);
    expect([walker, driller].map((e) => sim.world.has(e, CoinDrillOrder))).toEqual([false, false]);
    expect([walker, driller].map((e) => sim.world.has(e, Resting))).toEqual([false, false]);
    expect([nodeOf(sim, walker), nodeOf(sim, driller)]).toEqual(starts);
    expect(pointsOf(sim, driller)).toBe(0);
  });

  it('walks back beside the node he left when a building now stands on it, not lost', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 1);
    const soldier = soldierAt(sim, SWORD_JOB, 2, 3);
    const start = nodeOf(sim, soldier);
    const startAt = { ...sim.world.get(soldier, Position) };
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: soldier, house });
    while (!termRuns(sim, soldier)) sim.step();
    const hut = sim.world.create();
    sim.world.add(hut, Position, startAt);
    sim.world.add(hut, Building, { buildingType: HUT_TYPE, tribe: VIKING, built: ONE, level: 0 });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const blocked = walkBlockMask(sim.world, { content: sim.content }, terrain);
    expect(blocked.has(start)).toBe(true);
    run(sim, SERVED_TERM_TICKS + 2 * WALK_TICKS);
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
    while (!termRuns(sim, driller)) sim.step();
    const enemy = soldierAt(sim, SWORD_JOB, 6, 3);
    sim.world.mut(enemy, Owner).player = OTHER_PLAYER;
    sim.world.add(enemy, Health, { hitpoints: FIGHTER_HP, max: FIGHTER_HP });
    while (sim.world.tryGet(driller, CurrentAtomic)?.effect.kind !== 'attack') sim.step();
    expect(sim.world.has(driller, Resting)).toBe(false);
    expect(sim.world.get(driller, CoinDrillOrder).stage).toBe('return');
  });

  it('takes the coin as the term starts and grants the points only once it is served', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 2);
    const driller = soldierAt(sim, SWORD_JOB, 7, 3);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: driller, house });
    while (!termRuns(sim, driller)) sim.step();
    expect(coinsOf(sim, house)).toBe(1);
    run(sim, SERVED_TERM_TICKS - TRAIN_CLIP_TICKS);
    expect(sim.world.get(driller, CurrentAtomic).atomicId).toBe(TRAIN_ATOMIC);
    expect([pointsOf(sim, driller), coinsOf(sim, house)]).toEqual([0, 1]);
    run(sim, TRAIN_CLIP_TICKS);
    expect(pointsOf(sim, driller)).toBe(POINTS_PER_COIN);
  });

  it('resumes the term after a cut clip, with no second coin', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 2);
    const driller = soldierAt(sim, SWORD_JOB, 7, 3);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: driller, house });
    while (!termRuns(sim, driller)) sim.step();
    removeCurrentAtomic(sim.world, driller);
    run(sim, TRAIN_CLIP_TICKS);
    expect(termRuns(sim, driller)).toBe(true);
    expect(coinsOf(sim, house)).toBe(1);
    run(sim, 2 * SERVED_TERM_TICKS);
    expect(pointsOf(sim, driller)).toBe(2 * POINTS_PER_COIN);
    expect(coinsOf(sim, house)).toBe(0);
  });

  it('an attack order calls the drill off, stepping out and giving back the coin of the cut term', () => {
    const sim = freshSim();
    const house = barracksAt(sim, 8, 3, 2);
    const driller = soldierAt(sim, SWORD_JOB, 7, 3);
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: driller, house });
    while (!termRuns(sim, driller)) sim.step();
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
  it('stays inside from entry to exit over two terms, entered from beside a door another man stands on', () => {
    const sim = freshSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const house = barracksAt(sim, 8, 3, 2);
    const driller = soldierAt(sim, SWORD_JOB, 2, 3);
    const door = interactionCell(sim.world, { content: sim.content }, terrain, house, nodeOf(sim, driller));
    const blocker = soldierAt(sim, SWORD_JOB, 0, 0);
    sim.world.add(blocker, Position, (({ x, y }) => positionOfNode(x, y))(terrain.coordsOf(door)));
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: driller, house });
    while (!sim.world.has(driller, Resting)) sim.step();
    expect(nodeOf(sim, driller)).not.toBe(door);
    let insideTicks = 0;
    while (sim.world.get(driller, CoinDrillOrder).stage === 'drill') {
      expect(sim.world.get(driller, Resting).at, `tick ${sim.tick}`).toBe(house);
      insideTicks++;
      sim.step();
    }
    expect(insideTicks).toBeGreaterThanOrEqual(2 * SERVED_TERM_TICKS);
    expect([pointsOf(sim, driller), coinsOf(sim, house)]).toEqual([2 * POINTS_PER_COIN, 0]);
  });

  it('shares the barracks seats with recruits in enrolment order, the rest waiting outside', () => {
    const sim = freshSim(2);
    const house = barracksAt(sim, 8, 3, 3);
    const [firstRecruit, lateRecruit] = [
      soldierAt(sim, CIVILIST_JOB, 6, 3),
      soldierAt(sim, CIVILIST_JOB, 6, 4),
    ];
    const [firstDriller, lateDriller] = [soldierAt(sim, SWORD_JOB, 5, 3), soldierAt(sim, SWORD_JOB, 5, 4)];
    sim.enqueueSetup({ kind: 'trainSoldier', entity: firstRecruit, house });
    sim.step();
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: firstDriller, house });
    sim.step();
    // The same tick: the recruit, the lower id, comes first.
    sim.enqueueSetup({ kind: 'orderCoinDrill', entity: lateDriller, house });
    sim.enqueueSetup({ kind: 'trainSoldier', entity: lateRecruit, house });
    sim.step();
    run(sim, WALK_TICKS);
    const men = [firstRecruit, firstDriller, lateRecruit, lateDriller];
    expect(men.map((e) => isInside(sim.world, e, house))).toEqual([true, true, false, false]);
    expect(sim.world.get(lateDriller, CoinDrillOrder).seated).toBe(false);
    sim.enqueueSetup({ kind: 'moveUnit', entity: firstDriller, x: 2, y: 6 });
    run(sim, IDLE_REPLAN_PERIOD_TICKS + 1);
    expect(sim.world.get(lateRecruit, TrainingOrder).seated).toBe(true);
    expect(sim.world.get(lateDriller, CoinDrillOrder).seated).toBe(false);
  });

  it('frees the place of a waiting driller called off, and his coin', () => {
    const sim = freshSim(1);
    const house = barracksAt(sim, 8, 3, 3);
    const seated = soldierAt(sim, SWORD_JOB, 5, 4);
    const calledOff = soldierAt(sim, SWORD_JOB, 6, 4);
    const next = soldierAt(sim, SWORD_JOB, 7, 4);
    for (const entity of [seated, calledOff, next]) {
      sim.enqueueSetup({ kind: 'orderCoinDrill', entity, house });
      sim.step();
    }
    run(sim, WALK_TICKS);
    expect(sim.world.get(calledOff, CoinDrillOrder).seated).toBe(false);
    sim.enqueueSetup({ kind: 'moveUnit', entity: calledOff, x: 2, y: 6 });
    sim.step();
    expect(sim.world.has(calledOff, CoinDrillOrder)).toBe(false);
    run(sim, 3 * SERVED_TERM_TICKS + WALK_TICKS);
    // The coin he spoke for buys the seated man a second term; the next in line drills the last.
    expect([seated, calledOff, next].map((e) => pointsOf(sim, e))).toEqual([
      2 * POINTS_PER_COIN,
      0,
      POINTS_PER_COIN,
    ]);
    expect(coinsOf(sim, house)).toBe(0);
  });
});
