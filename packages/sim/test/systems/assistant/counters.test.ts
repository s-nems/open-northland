import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AssistantArmorOrders,
  AssistantChildOrder,
  AssistantCounters,
  AssistantRecruit,
  AssistantWeaponOrders,
  AssistantWeaponVetoes,
  addPerson,
  Building,
  ChildOrder,
  Equipment,
  EquipOrder,
  FamilyDuty,
  Female,
  JobAssignment,
  Marriage,
  MISSION_BEHAVIOUR,
  MoveGoal,
  Owner,
  PathFollow,
  PickupClaim,
  Position,
  Residence,
  Settler,
  Stance,
  Stockpile,
  setMissionBehaviour,
  setNeedsEnabled,
  setSettlerJob,
  TrainingOrder,
  Weapon,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { nodeOfPosition } from '../../../src/nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { ASSISTANT_DECISION_PERIOD_TICKS } from '../../../src/systems/assistant/index.js';
import { WEAPON_MAIN_TYPE } from '../../../src/systems/readviews/index.js';
import { BARRACKS_DRILL_TICKS } from '../../../src/systems/settlers/drives/training.js';
import { ASSISTANT_SCAN_PERIOD_TICKS } from '../../../src/systems/settlers/planner/assistant-grants.js';
import { interactionCell } from '../../../src/systems/settlers/targets/index.js';
import { hexNodeDistance } from '../../../src/systems/spatial/metric.js';
import { TEST_MANIFEST, testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';
import { stampPost } from '../signposts/support.js';

/**
 * The assistant's production counters: the `setAssistantCounter` command and carrier lifecycle, the
 * birth queue (daughters outrank sons; a birth pays the counter), and the training queue (free men
 * only; enlistment or the landed weapon pays; a weapon-class recruit is armed and then armored from
 * store). Training runs on the shared `testContent` extended barracks-style; the birth block builds
 * the family fixture's own content, because the age-class job ids (baby 1 / child 3…) collide with
 * the shared fixture's trades.
 */

const VIKING = 1;
const PLAYER = 0;
const OTHER_PLAYER = 1;
const CIVILIST = 6;
const WOODCUTTER = 1;
const CARRIER = 24;
const BARRACKS_WORKER_SLOTS = 4;
const SOLDIER = 31;
const SWORDSMAN_SHORT = 34;
const SWORDSMAN_LONG = 35;
const BARRACKS_TYPE = 91;
const EXERCISE_ATOMIC = 89;
const EXERCISE_CLIP_TICKS = 4;
const TRAINING_TRACK = 77;
/** The `event <at> 29 1` type - one TRAINING point per finished repetition (the barracks fixture). */
const TRAINING_EVENT_TYPE = 29;
/** More TRAINING repeats than any test run can bank - a gate that would always refuse. */
const UNBANKABLE_TRAINING = 9999;
const SWORD_SHORT_GOOD = 41;
const SWORD_LONG_GOOD = 42;
const ARMOR_WOOL_GOOD = 61;
const ARMOR_CHAIN_GOOD = 62;
const SWORD_SHORT_WEAPON = 7;
const SWORD_LONG_WEAPON = 8;
const BOW_GOOD = 71;
const BOW_WEAPON = 9;
const ARCHER = 40;
/** A dispatch beat plus slack - the counter must have acted (or provably not) within one beat. */
const BEAT_TICKS = ASSISTANT_DECISION_PERIOD_TICKS + 2;
/** Far beyond a recruit's own walk range (50 nodes = 25 tiles) - only a signpost chain reaches it. */
const FAR_TILE = 40;
/** Past the end of that post chain - out of reach even from {@link FAR_TILE}, where the walk range is
 *  measured anew from wherever the recruit stands. */
const BEYOND_TILE = 70;
/** Two barracks either side of a free man: only the far one's door lies within a walk range of
 *  {@link BEYOND_TILE}. */
const NEAR_BARRACKS_TILE = 22;
const MIDWAY_TILE = 40;
const FAR_BARRACKS_TILE = 58;
/** How far from a barracks door the men gathering there fan out: onto the free nodes beside it. */
const DOOR_FAN_OUT_NODES = 2;

function trainContent(): ContentSet {
  const base = testContent();
  const viking = base.tribes[0];
  if (viking === undefined) throw new Error('fixture tribe missing');
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: SWORD_SHORT_GOOD, id: 'sword_short', equip: { category: 'weapon' } },
      { typeId: SWORD_LONG_GOOD, id: 'sword_long', equip: { category: 'weapon' } },
      { typeId: ARMOR_WOOL_GOOD, id: 'armor_wool', equip: { category: 'armor' } },
      { typeId: ARMOR_CHAIN_GOOD, id: 'armor_chain', equip: { category: 'armor' } },
    ],
    jobs: [
      ...base.jobs,
      { typeId: SWORDSMAN_SHORT, id: 'soldier_sword_short' },
      { typeId: SWORDSMAN_LONG, id: 'soldier_sword_long' },
    ],
    buildings: [
      ...base.buildings,
      {
        typeId: BARRACKS_TYPE,
        id: 'barracks',
        kind: 'training',
        workers: [{ jobType: CARRIER, count: BARRACKS_WORKER_SLOTS }],
      },
    ],
    // The sword pair: the long blade out-damages the short one, so the arming preference must fetch
    // it first when both are in store (bare-target damage decides, never the good id).
    weapons: [
      ...base.weapons,
      {
        typeId: SWORD_SHORT_WEAPON,
        id: 'short_sword',
        tribeType: VIKING,
        mainType: 3,
        goodType: SWORD_SHORT_GOOD,
        jobType: SWORDSMAN_SHORT,
        minRange: 1,
        maxRange: 1,
        damage: { '0': 1600 },
      },
      {
        typeId: SWORD_LONG_WEAPON,
        id: 'long_sword',
        tribeType: VIKING,
        mainType: 3,
        goodType: SWORD_LONG_GOOD,
        jobType: SWORDSMAN_LONG,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 3800 },
      },
    ],
    armor: [
      { typeId: 1, id: 'armor_wool', mainType: 1, goodType: ARMOR_WOOL_GOOD, materialType: 1 },
      { typeId: 3, id: 'armor_chain', mainType: 2, goodType: ARMOR_CHAIN_GOOD, materialType: 3 },
    ],
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: 'viking_exercise',
        name: 'viking_exercise',
        length: EXERCISE_CLIP_TICKS,
        events: [{ at: 2, type: TRAINING_EVENT_TYPE, value: 1 }],
      },
    ],
    tribes: [
      {
        ...viking,
        atomicBindings: [
          ...viking.atomicBindings,
          { jobType: CIVILIST, atomicId: EXERCISE_ATOMIC, animation: 'viking_exercise' },
        ],
        jobRequirements: [
          ...viking.jobRequirements,
          {
            requirement: 'train',
            target: 'job',
            targetId: SOLDIER,
            amount: 5,
            experienceTypes: [TRAINING_TRACK],
          },
          // Unbankable on purpose: the weapon-class flip must IGNORE trainfor rows - a soldier
          // handles any weapon handed to him, the barracks only unlocks the base profession
          // (user rule 2026-08-01). The long-sword test proves the rows never gate the flip.
          {
            requirement: 'train',
            target: 'job',
            targetId: SWORDSMAN_SHORT,
            amount: UNBANKABLE_TRAINING,
            experienceTypes: [TRAINING_TRACK],
          },
          {
            requirement: 'train',
            target: 'job',
            targetId: SWORDSMAN_LONG,
            amount: UNBANKABLE_TRAINING,
            experienceTypes: [TRAINING_TRACK],
          },
        ],
      },
      ...base.tribes.slice(1),
    ],
  });
}

function trainSim(map = grassMap(16, 6)): Simulation {
  const sim = new Simulation({ seed: 1, content: trainContent(), map });
  setNeedsEnabled(sim.world, false);
  return sim;
}

/** {@link trainContent} plus a bow class: its good, its archer trade and the weapon row joining them. */
function bowContent(): ContentSet {
  const base = trainContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: BOW_GOOD, id: 'bow_short', equip: { category: 'weapon' } }],
    jobs: [...base.jobs, { typeId: ARCHER, id: 'soldier_bow_short' }],
    weapons: [
      ...base.weapons,
      {
        typeId: BOW_WEAPON,
        id: 'short_bow',
        tribeType: VIKING,
        mainType: WEAPON_MAIN_TYPE.BOW,
        goodType: BOW_GOOD,
        jobType: ARCHER,
        minRange: 3,
        maxRange: 17,
        damage: { '0': 1200 },
      },
    ],
  });
}

function settlerAt(sim: Simulation, jobType: number | null, x: number, y: number): Entity {
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
  return e;
}

function barracksAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: BARRACKS_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

/** A soldier out of his drill at `barracks`, booked on the `intent` counter and still owed his weapon. */
function drilledRecruitAt(
  sim: Simulation,
  x: number,
  y: number,
  barracks: Entity,
  intent: 'trainSword' | 'trainBow' = 'trainSword',
): Entity {
  const e = settlerAt(sim, SOLDIER, x, y);
  sim.world.add(e, AssistantRecruit, { intent, armed: false, barracks });
  return e;
}

/** A barracks whose own stock holds one unit of each good. */
function stockedBarracksAt(sim: Simulation, x: number, y: number, goods: readonly number[]): Entity {
  const e = barracksAt(sim, x, y);
  sim.world.add(e, Stockpile, { amounts: new Map(goods.map((good) => [good, 1])) });
  return e;
}

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('setup: terrain missing');
  return sim.terrain;
}

function nodeOf(sim: Simulation, e: Entity): NodeId {
  const p = sim.world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return terrainOf(sim).nodeAtClamped(n.hx, n.hy);
}

function doorOf(sim: Simulation, building: Entity): NodeId {
  return interactionCell(sim.world, ctxOf(sim), terrainOf(sim), building);
}

/** A loose ground pile holding the given goods - a store the arming pass can fetch from. */
function pileAt(sim: Simulation, x: number, y: number, amounts: ReadonlyMap<number, number>): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map(amounts) });
  return e;
}

function vetoWeapon(sim: Simulation, goodType: number, vetoed: boolean): void {
  sim.enqueueSetup({ kind: 'setAssistantWeaponVeto', player: PLAYER, goodType, vetoed });
}

function setArmorOrder(sim: Simulation, order: readonly number[], off: readonly number[]): void {
  sim.enqueueSetup({ kind: 'setAssistantArmorOrder', player: PLAYER, intent: 'trainSword', order, off });
}

function setWeaponOrder(sim: Simulation, order: readonly number[]): void {
  sim.enqueueSetup({ kind: 'setAssistantWeaponOrder', player: PLAYER, intent: 'trainSword', order });
}

function setCounter(
  sim: Simulation,
  counter: 'extraWomen' | 'extraMen' | 'trainSoldiers' | 'trainSword' | 'trainSpear' | 'trainBow',
  value: number,
  infinite = false,
  player = PLAYER,
): void {
  sim.enqueueSetup({ kind: 'setAssistantCounter', player, counter, value, infinite });
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

/** Step until `done()` or fail loudly - a hung queue must not pass as a slow one. */
function runUntil(sim: Simulation, done: () => boolean, max: number, label: string): void {
  for (let i = 0; i < max; i++) {
    sim.step();
    if (done()) return;
  }
  throw new Error(`never completed within ${max} ticks: ${label}`);
}

describe('setAssistantCounter - command and carrier lifecycle', () => {
  it('clamps into [0, 100], refuses infinity on extraWomen, and reads back detached', () => {
    const sim = trainSim();
    setCounter(sim, 'trainSword', 250);
    setCounter(sim, 'extraWomen', -5, true);
    sim.step();
    const counters = sim.assistantCounters(PLAYER);
    expect(counters.trainSword).toEqual({ value: 100, infinite: false });
    expect(counters.extraWomen).toEqual({ value: 0, infinite: false });
  });

  it('creates the carrier on the first non-default write and destroys it at all-default', () => {
    const sim = trainSim();
    setCounter(sim, 'extraMen', 0);
    sim.step();
    expect([...sim.world.query(AssistantCounters)].length).toBe(0); // a default write makes nothing

    setCounter(sim, 'extraMen', 3);
    sim.step();
    expect([...sim.world.query(AssistantCounters)].length).toBe(1);

    setCounter(sim, 'extraMen', 0);
    sim.step();
    expect([...sim.world.query(AssistantCounters)].length).toBe(0); // back to default - carrier gone
  });

  it('keeps the stored value while infinite, so switching infinity off restores it', () => {
    const sim = trainSim();
    setCounter(sim, 'trainBow', 7, true);
    sim.step();
    expect(sim.assistantCounters(PLAYER).trainBow).toEqual({ value: 7, infinite: true });
    setCounter(sim, 'trainBow', 7, false);
    sim.step();
    expect(sim.assistantCounters(PLAYER).trainBow).toEqual({ value: 7, infinite: false });
  });
});

describe('setAssistantWeaponVeto - command and carrier lifecycle', () => {
  it('lists vetoed weapons ascending, ignores a good that arms nobody, and drops the carrier when empty', () => {
    const sim = trainSim();
    vetoWeapon(sim, SWORD_LONG_GOOD, true);
    vetoWeapon(sim, SWORD_SHORT_GOOD, true);
    vetoWeapon(sim, ARMOR_WOOL_GOOD, true); // armor arms no class
    sim.step();
    expect(sim.assistantWeaponVetoes(PLAYER)).toEqual([SWORD_SHORT_GOOD, SWORD_LONG_GOOD]);

    vetoWeapon(sim, SWORD_LONG_GOOD, false);
    vetoWeapon(sim, SWORD_SHORT_GOOD, false);
    sim.step();
    expect(sim.assistantWeaponVetoes(PLAYER)).toEqual([]);
    expect([...sim.world.query(AssistantWeaponVetoes)].length).toBe(0);
  });
});

describe('setAssistantArmorOrder - command and carrier lifecycle', () => {
  it('keeps a class choice, skips a list that is not every armor once, and drops the carrier at default', () => {
    const sim = trainSim();
    const byDefault = sim.assistantArmorOrder(PLAYER, 'trainSword');
    expect([...byDefault.order].sort((a, b) => a - b)).toEqual([ARMOR_WOOL_GOOD, ARMOR_CHAIN_GOOD]);
    const reversed = [...byDefault.order].reverse();

    setArmorOrder(sim, [ARMOR_WOOL_GOOD], []); // not every armor
    setArmorOrder(sim, reversed, [SWORD_LONG_GOOD]); // off names a good outside the order
    sim.step();
    expect([...sim.world.query(AssistantArmorOrders)].length).toBe(0);

    setArmorOrder(sim, reversed, [ARMOR_CHAIN_GOOD]);
    sim.step();
    expect(sim.assistantArmorOrder(PLAYER, 'trainSword')).toEqual({
      order: reversed,
      off: [ARMOR_CHAIN_GOOD],
    });
    expect(sim.assistantArmorOrder(PLAYER, 'trainBow')).toEqual(byDefault);

    setArmorOrder(sim, byDefault.order, []);
    sim.step();
    expect([...sim.world.query(AssistantArmorOrders)].length).toBe(0);
  });
});

describe('setAssistantWeaponOrder - command and carrier lifecycle', () => {
  it('keeps a class order, skips a list that is not every class weapon once, and drops the carrier at default', () => {
    const sim = trainSim();
    expect(sim.assistantWeaponOrder(PLAYER, 'trainSword')).toEqual([SWORD_LONG_GOOD, SWORD_SHORT_GOOD]);

    setWeaponOrder(sim, [SWORD_SHORT_GOOD]);
    setWeaponOrder(sim, [SWORD_SHORT_GOOD, ARMOR_WOOL_GOOD]);
    sim.step();
    expect([...sim.world.query(AssistantWeaponOrders)].length).toBe(0);

    setWeaponOrder(sim, [SWORD_SHORT_GOOD, SWORD_LONG_GOOD]);
    sim.step();
    expect(sim.assistantWeaponOrder(PLAYER, 'trainSword')).toEqual([SWORD_SHORT_GOOD, SWORD_LONG_GOOD]);

    setWeaponOrder(sim, [SWORD_LONG_GOOD, SWORD_SHORT_GOOD]);
    sim.step();
    expect([...sim.world.query(AssistantWeaponOrders)].length).toBe(0);
  });
});

describe('the training queue', () => {
  it('sends only a free man to drill: not the employed, not another trade', () => {
    const sim = trainSim();
    const barracks = barracksAt(sim, 6, 3);
    const employed = settlerAt(sim, CIVILIST, 2, 2);
    sim.world.add(employed, JobAssignment, { workplace: barracksAt(sim, 12, 3) });
    const tradesman = settlerAt(sim, WOODCUTTER, 2, 3);
    const free = settlerAt(sim, CIVILIST, 2, 4);

    setCounter(sim, 'trainSoldiers', 1);
    // Schedule relationship pin: the assistant dispatches BEFORE the planner, so the drill's walk is
    // routed the very tick the order is booked - a reorder would leave the recruit goal-less here.
    let booked = false;
    for (let i = 0; i < BEAT_TICKS && !booked; i++) {
      sim.step();
      if (sim.world.has(free, TrainingOrder)) {
        booked = true;
        expect(sim.world.has(free, MoveGoal)).toBe(true);
      }
    }
    expect(booked).toBe(true);

    expect(sim.world.get(free, AssistantRecruit)).toEqual({
      intent: 'trainSoldiers',
      armed: false,
      barracks,
    });
    expect(sim.world.has(employed, TrainingOrder)).toBe(false);
    expect(sim.world.has(tradesman, TrainingOrder)).toBe(false);
  });

  it('drafts an unemployed (null-job) man once no workplace wants him', () => {
    const sim = trainSim();
    const house = barracksAt(sim, 6, 3);
    // Fill the barracks' four hauler slots, so no transport opening is left there -
    // an unemployed man with an opening nearby is the economy's to hire, not the assistant's.
    for (let i = 0; i < BARRACKS_WORKER_SLOTS; i++) {
      const hauler = settlerAt(sim, CARRIER, 10 + i, 2);
      sim.world.add(hauler, JobAssignment, { workplace: house });
    }
    const spawned = settlerAt(sim, null, 3, 3);

    setCounter(sim, 'trainSoldiers', 1);
    run(sim, BEAT_TICKS);
    expect(sim.world.has(spawned, TrainingOrder)).toBe(true);
  });

  it('books no more men than the counter asks, and enlistment pays it', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const first = settlerAt(sim, CIVILIST, 3, 3);
    const second = settlerAt(sim, CIVILIST, 2, 3);

    setCounter(sim, 'trainSoldiers', 1);
    run(sim, BEAT_TICKS);
    expect([sim.world.has(first, TrainingOrder), sim.world.has(second, TrainingOrder)]).toContain(false);

    runUntil(sim, () => sim.world.get(first, Settler).jobType === SOLDIER, 2000, 'enlistment');
    expect(sim.assistantCounters(PLAYER).trainSoldiers.value).toBe(0);
    expect(sim.world.has(first, AssistantRecruit)).toBe(false);

    // The paid counter books nobody else.
    run(sim, 3 * BEAT_TICKS);
    expect(sim.world.get(second, Settler).jobType).toBe(CIVILIST);
  });

  it('re-dispatches a recruit walked off mid-drill instead of draining the queue', () => {
    const sim = trainSim();
    const barracks = barracksAt(sim, 6, 3);
    const man = settlerAt(sim, CIVILIST, 3, 3);
    setCounter(sim, 'trainSoldiers', 1);
    runUntil(sim, () => sim.world.has(man, TrainingOrder), BEAT_TICKS, 'dispatched');

    // The player walks him off: the drill order dies, the booking goes stale, the counter is unpaid.
    sim.enqueueSetup({ kind: 'moveUnit', entity: man, x: 5, y: 3 });
    runUntil(sim, () => !sim.world.has(man, TrainingOrder), BEAT_TICKS, 'interrupted');
    expect(sim.assistantCounters(PLAYER).trainSoldiers.value).toBe(1);

    // The sweep clears the stale booking, and the standing counter simply drafts him again.
    runUntil(sim, () => sim.world.has(man, TrainingOrder), 6 * BEAT_TICKS, 're-dispatched');
    expect(sim.world.get(man, AssistantRecruit)).toEqual({ intent: 'trainSoldiers', armed: false, barracks });
  });

  it('an infinite counter keeps queueing every free man and never drains', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const men = [
      settlerAt(sim, CIVILIST, 2, 2),
      settlerAt(sim, CIVILIST, 2, 3),
      settlerAt(sim, CIVILIST, 2, 4),
    ];

    setCounter(sim, 'trainSoldiers', 0, true);
    run(sim, 3 * BEAT_TICKS);

    for (const man of men) expect(sim.world.has(man, TrainingOrder)).toBe(true);
    expect(sim.assistantCounters(PLAYER).trainSoldiers).toEqual({ value: 0, infinite: true });
  });

  it('never drafts a married man, even on an infinite counter', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const husband = settlerAt(sim, CIVILIST, 2, 2);
    const bachelor = settlerAt(sim, CIVILIST, 2, 3);
    // Only a living spouse matters to the draft; this content has no woman's trade to give her.
    const spouse = settlerAt(sim, WOODCUTTER, 2, 4);
    sim.world.add(husband, Marriage, { spouse, child: null });
    sim.world.add(spouse, Marriage, { spouse: husband, child: null });

    setCounter(sim, 'trainSoldiers', 0, true);
    run(sim, 3 * BEAT_TICKS);

    expect(sim.world.has(bachelor, TrainingOrder)).toBe(true);
    expect(sim.world.has(husband, TrainingOrder)).toBe(false);
  });

  it('a weapon-class recruit drills the standard term, takes the strongest sword, then armor - and pays on the sword', () => {
    const sim = trainSim();
    const barracks = barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    pileAt(
      sim,
      9,
      3,
      new Map([
        [SWORD_SHORT_GOOD, 1],
        [SWORD_LONG_GOOD, 1],
        [ARMOR_WOOL_GOOD, 1],
        [ARMOR_CHAIN_GOOD, 1],
      ]),
    );

    setCounter(sim, 'trainSword', 1);
    run(sim, BEAT_TICKS);
    // The one standard drill term, exactly like the plain soldier queue - a class intent buys no
    // extra barracks time (user rule 2026-08-01); the weapon comes afterwards.
    expect(sim.world.get(recruit, TrainingOrder).drillTicksLeft).toBe(BARRACKS_DRILL_TICKS);

    // Drill → enlist → the arming pass fetches the LONG sword (stronger row) → the class flips with
    // the combat Weapon, and the counter is paid at that moment.
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_LONG, 3000, 'swordsman');
    expect(sim.world.get(recruit, Weapon).weaponTypeId).toBe(SWORD_LONG_WEAPON);
    expect(sim.world.tryGet(recruit, Equipment)?.weapon?.goodType).toBe(SWORD_LONG_GOOD);
    expect(sim.assistantCounters(PLAYER).trainSword.value).toBe(0);

    // One outing (user rule 2026-08-01): the same errand retargets to the armor good at the store
    // instead of walking home in between - the chain shows as the live order flipping groups.
    runUntil(sim, () => sim.world.tryGet(recruit, EquipOrder)?.group === 'armor', 30, 'chained');

    // The armor leg: the default order puts the best protection first.
    runUntil(sim, () => (sim.world.tryGet(recruit, Equipment)?.armor ?? null) !== null, 2000, 'armor');
    expect(sim.world.tryGet(recruit, Equipment)?.armor?.goodType).toBe(ARMOR_CHAIN_GOOD);
    // Dressed, he walks back from the store to the barracks he drilled at, still booked on the way; the
    // arming pass settles the booking on its next beat after the errand ends.
    runUntil(sim, () => !sim.world.has(recruit, EquipOrder), 2000, 'arming errand released');
    expect(nodeOf(sim, recruit)).toBe(doorOf(sim, barracks));
    runUntil(
      sim,
      () => !sim.world.has(recruit, AssistantRecruit),
      2 * ASSISTANT_SCAN_PERIOD_TICKS,
      'booking released',
    );
  });

  it('a recruit steps out of the drill dressed when the barracks holds his weapon and armor', () => {
    const sim = trainSim();
    const barracks = stockedBarracksAt(sim, 6, 3, [SWORD_LONG_GOOD, ARMOR_CHAIN_GOOD]);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);

    setCounter(sim, 'trainSword', 1);
    run(sim, BEAT_TICKS);
    runUntil(sim, () => !sim.world.has(recruit, TrainingOrder), 3000, 'drill served');

    expect(sim.world.get(recruit, Settler).jobType).toBe(SWORDSMAN_LONG);
    expect(sim.world.tryGet(recruit, Equipment)?.armor?.goodType).toBe(ARMOR_CHAIN_GOOD);
    expect(sim.world.has(recruit, AssistantRecruit)).toBe(false);
    expect(sim.assistantCounters(PLAYER).trainSword.value).toBe(0);
    expect(sim.world.get(barracks, Stockpile).amounts.get(SWORD_LONG_GOOD)).toBe(0);
  });

  it('puts on the armor the barracks holds and fetches the missing weapon elsewhere', () => {
    const sim = trainSim();
    stockedBarracksAt(sim, 6, 3, [ARMOR_CHAIN_GOOD]);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    run(sim, BEAT_TICKS);
    runUntil(sim, () => !sim.world.has(recruit, TrainingOrder), 3000, 'drill served');

    expect(sim.world.get(recruit, Settler).jobType).toBe(SOLDIER);
    expect(sim.world.tryGet(recruit, Equipment)?.armor?.goodType).toBe(ARMOR_CHAIN_GOOD);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_LONG, 3000, 'swordsman');
  });

  it('leaves a weaker sword in the barracks while a better one lies in reach elsewhere', () => {
    const sim = trainSim();
    const barracks = stockedBarracksAt(sim, 6, 3, [SWORD_SHORT_GOOD]);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    run(sim, BEAT_TICKS);
    runUntil(sim, () => !sim.world.has(recruit, TrainingOrder), 3000, 'drill served');

    expect(sim.world.tryGet(recruit, Equipment)?.weapon ?? null).toBe(null);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_LONG, 3000, 'swordsman');
    expect(sim.world.get(barracks, Stockpile).amounts.get(SWORD_SHORT_GOOD)).toBe(1);
  });

  it('ends the outing at the store once the barracks he drilled at is gone', () => {
    const sim = trainSim();
    const barracks = barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    const pile = nodeOf(sim, pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]))); // emptied, the pile goes

    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SOLDIER, 3000, 'enlisted');
    sim.world.destroy(barracks);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_LONG, 3000, 'swordsman');
    runUntil(sim, () => !sim.world.has(recruit, EquipOrder), 2000, 'arming errand released');
    expect(nodeOf(sim, recruit)).toBe(pile);
  });

  it("arms a recruit with the first weapon of his class's order, the weaker one put first", () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    pileAt(
      sim,
      9,
      3,
      new Map([
        [SWORD_SHORT_GOOD, 1],
        [SWORD_LONG_GOOD, 1],
      ]),
    );

    setWeaponOrder(sim, [SWORD_SHORT_GOOD, SWORD_LONG_GOOD]);
    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_SHORT, 3000, 'short swordsman');
  });

  it("dresses a recruit in the first armor of his class's order that is not off", () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    pileAt(
      sim,
      9,
      3,
      new Map([
        [SWORD_LONG_GOOD, 1],
        [ARMOR_WOOL_GOOD, 1],
        [ARMOR_CHAIN_GOOD, 1],
      ]),
    );

    setArmorOrder(sim, [ARMOR_CHAIN_GOOD, ARMOR_WOOL_GOOD], [ARMOR_CHAIN_GOOD]);
    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => (sim.world.tryGet(recruit, Equipment)?.armor ?? null) !== null, 5000, 'armor');
    expect(sim.world.tryGet(recruit, Equipment)?.armor?.goodType).toBe(ARMOR_WOOL_GOOD);
  });

  it('releases a recruit unarmored when no armor is in store, once its weapon landed', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    pileAt(sim, 9, 3, new Map([[SWORD_SHORT_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_SHORT, 3000, 'swordsman');
    runUntil(sim, () => !sim.world.has(recruit, AssistantRecruit), 2000, 'released unarmored');
    expect(sim.world.tryGet(recruit, Equipment)?.armor ?? null).toBe(null);
    expect(sim.assistantCounters(PLAYER).trainSword.value).toBe(0);
  });

  it('never hands a recruit a vetoed weapon: he waits for an allowed one', () => {
    const sim = trainSim();
    const recruit = drilledRecruitAt(sim, 3, 3, barracksAt(sim, 6, 3));
    pileAt(sim, 9, 3, new Map([[SWORD_SHORT_GOOD, 1]]));
    vetoWeapon(sim, SWORD_SHORT_GOOD, true);

    setCounter(sim, 'trainSword', 1);
    run(sim, 4 * BEAT_TICKS);
    expect(sim.world.tryGet(recruit, Equipment)?.weapon ?? null).toBe(null);
    expect(sim.world.has(recruit, EquipOrder)).toBe(false);

    vetoWeapon(sim, SWORD_SHORT_GOOD, false);
    runUntil(
      sim,
      () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_SHORT,
      3000,
      'armed once allowed',
    );
  });

  it("takes its own side's weaker sword over a stronger one only another player holds", () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    const foreign = pileAt(sim, 8, 3, new Map([[SWORD_LONG_GOOD, 1]]));
    sim.world.add(foreign, Owner, { player: OTHER_PLAYER });
    pileAt(sim, 10, 3, new Map([[SWORD_SHORT_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_SHORT, 3000, 'swordsman');
    expect(sim.world.get(foreign, Stockpile).amounts.get(SWORD_LONG_GOOD)).toBe(1);
  });

  it('demotes a swordsman back to the unarmed base when the sword comes off', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_LONG, 3000, 'swordsman');
    runUntil(sim, () => !sim.world.has(recruit, AssistantRecruit), 2000, 'booking released');

    sim.enqueueSetup({ kind: 'unequipGood', entity: recruit, group: 'weapon', slot: 0 });
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SOLDIER, 1000, 'demotion');
    expect(sim.world.has(recruit, Weapon)).toBe(false);
    expect(sim.world.tryGet(recruit, Equipment)?.weapon ?? null).toBe(null);
  });

  it('shops for the weapon inside the signpost network instead of crossing the map', () => {
    const sim = trainSim(grassMap(96, 6));
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const recruit = drilledRecruitAt(sim, 3, 3, barracksAt(sim, 6, 3));
    pileAt(sim, FAR_TILE, 3, new Map([[SWORD_LONG_GOOD, 1]]));
    pileAt(sim, BEYOND_TILE, 3, new Map([[ARMOR_CHAIN_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    run(sim, 4 * BEAT_TICKS);
    // A soldier roams the whole map to FIGHT, but the sword lying 34 tiles out is not in a settlement
    // he knows the way around: the booking waits instead of walking him there.
    expect(sim.world.get(recruit, Settler).jobType).toBe(SOLDIER);
    expect(sim.world.has(recruit, EquipOrder)).toBe(false);
    expect(sim.world.has(recruit, AssistantRecruit)).toBe(true);

    // A chain of posts takes the network out to the pile, and the same booking sends him.
    stampPost(sim, 12, 3, PLAYER);
    stampPost(sim, 30, 3, PLAYER);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_LONG, 6000, 'armed');

    // The armor chained from the sword pile obeys the same reach: the only mail on the map lies past
    // the end of the network, so he is released dressed in nothing but his blade.
    runUntil(sim, () => !sim.world.has(recruit, AssistantRecruit), 2000, 'booking released');
    expect(sim.world.tryGet(recruit, Equipment)?.armor ?? null).toBe(null);
  });

  it('keeps him inside the network for the whole walk, not just the moment he is sent', () => {
    const sim = trainSim(grassMap(96, 6));
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    stampPost(sim, 12, 3, PLAYER);
    stampPost(sim, 30, 3, PLAYER);
    const inNetwork = pileAt(sim, FAR_TILE, 3, new Map([[SWORD_LONG_GOOD, 1]]));
    const outside = pileAt(sim, BEYOND_TILE, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => sim.world.has(recruit, EquipOrder), 3000, 'sent for the sword');

    // Somebody else takes the sword he was sent for while he is still walking. The store search re-picks
    // a source every planner tick, so a confinement applied only at dispatch would now hand him the pile
    // past the end of the network - the half-map errand this whole rule exists to stop.
    sim.world.mut(inNetwork, Stockpile).amounts.set(SWORD_LONG_GOOD, 0);
    run(sim, 4000);
    expect(sim.world.get(recruit, Settler).jobType).toBe(SOLDIER);
    expect(sim.world.get(outside, Stockpile).amounts.get(SWORD_LONG_GOOD)).toBe(1);
  });

  it('arms two recruits on the same beat from different units, never both after the last one', () => {
    const sim = trainSim();
    const barracks = barracksAt(sim, 6, 3);
    const first = settlerAt(sim, SOLDIER, 3, 3);
    // Ids one scan period apart share the arming beat.
    for (let i = 1; i < ASSISTANT_SCAN_PERIOD_TICKS; i++) sim.world.create();
    const second = settlerAt(sim, SOLDIER, 3, 4);
    for (const e of [first, second])
      sim.world.add(e, AssistantRecruit, { intent: 'trainSword', armed: false, barracks });
    setCounter(sim, 'trainSword', 2); // the counter the two bookings stand on
    const longPile = pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));
    const shortPile = pileAt(sim, 12, 3, new Map([[SWORD_SHORT_GOOD, 1]]));

    runUntil(sim, () => sim.world.has(first, EquipOrder), 2 * ASSISTANT_SCAN_PERIOD_TICKS, 'dispatched');
    // The first recruit takes the stronger blade; the second, sent on the same beat, the one left.
    expect(sim.world.get(first, PickupClaim)).toEqual({
      source: longPile,
      goodType: SWORD_LONG_GOOD,
      amount: 1,
    });
    expect(sim.world.get(second, PickupClaim)).toEqual({
      source: shortPile,
      goodType: SWORD_SHORT_GOOD,
      amount: 1,
    });
    runUntil(
      sim,
      () =>
        sim.world.get(first, Settler).jobType === SWORDSMAN_LONG &&
        sim.world.get(second, Settler).jobType === SWORDSMAN_SHORT,
      3000,
      'both armed',
    );
    // Both walk back to the one barracks door: inside their own town's calm zone fighters may share it.
    runUntil(
      sim,
      () => !sim.world.has(first, EquipOrder) && !sim.world.has(second, EquipOrder),
      2000,
      'both back',
    );
    const door = doorOf(sim, barracks);
    for (const e of [first, second])
      expect(hexNodeDistance(terrainOf(sim), nodeOf(sim, e), door)).toBeLessThanOrEqual(1);
  });

  it('arms a recruit sent to the pile another recruit already stands on', () => {
    // Fighters cannot share a node outside a town, so routing stands the second recruit in beside the pile
    // the armed first one keeps standing on; it must still lift its blade from there.
    const sim = trainSim();
    const barracks = barracksAt(sim, 6, 3);
    const first = settlerAt(sim, SOLDIER, 3, 3);
    for (let i = 1; i < ASSISTANT_SCAN_PERIOD_TICKS; i++) sim.world.create();
    const second = settlerAt(sim, SOLDIER, 3, 4);
    for (const e of [first, second])
      sim.world.add(e, AssistantRecruit, { intent: 'trainSword', armed: false, barracks });
    setCounter(sim, 'trainSword', 2); // the counter the two bookings stand on
    pileAt(
      sim,
      9,
      3,
      new Map([
        [SWORD_LONG_GOOD, 1],
        [SWORD_SHORT_GOOD, 1],
      ]),
    );

    runUntil(sim, () => sim.world.get(first, Settler).jobType === SWORDSMAN_LONG, 1500, 'first armed');
    runUntil(sim, () => sim.world.get(second, Settler).jobType === SWORDSMAN_SHORT, 1500, 'second armed');
    runUntil(sim, () => !sim.world.has(second, EquipOrder), 200, 'second errand ended');
    expect(sim.world.has(second, PickupClaim)).toBe(false);
  });

  it('arms a bare-handed soldier on a class counter before it drafts a man', () => {
    const sim = trainSim();
    const barracks = barracksAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER, 3, 3);
    const civilian = settlerAt(sim, CIVILIST, 2, 3);
    pileAt(
      sim,
      9,
      3,
      new Map([
        [SWORD_LONG_GOOD, 1],
        [ARMOR_CHAIN_GOOD, 1],
      ]),
    );

    setCounter(sim, 'trainSword', 1);
    runUntil(
      sim,
      () => {
        expect(sim.world.has(civilian, TrainingOrder)).toBe(false);
        return (sim.world.tryGet(soldier, Equipment)?.armor ?? null) !== null;
      },
      3000,
      'armed and armored',
    );
    expect(sim.world.get(soldier, Settler).jobType).toBe(SWORDSMAN_LONG);
    expect(sim.assistantCounters(PLAYER).trainSword.value).toBe(0);
    runUntil(sim, () => !sim.world.has(soldier, EquipOrder), 2000, 'walked back');
    expect(nodeOf(sim, soldier)).toBe(doorOf(sim, barracks));
    run(sim, 4 * BEAT_TICKS);
    expect(sim.world.get(civilian, Settler).jobType).toBe(CIVILIST);
  });

  it('holds the draft for a bare-handed soldier on a walk, and arms him once he stands', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER, 3, 3);
    const civilian = settlerAt(sim, CIVILIST, 2, 3);
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));
    sim.enqueueSetup({ kind: 'moveUnit', entity: soldier, x: 12, y: 3 });

    setCounter(sim, 'trainSword', 1);
    runUntil(
      sim,
      () => {
        expect(sim.world.has(civilian, TrainingOrder)).toBe(false);
        return sim.world.get(soldier, Settler).jobType === SWORDSMAN_LONG;
      },
      3000,
      'armed after the walk',
    );
    expect(sim.assistantCounters(PLAYER).trainSword.value).toBe(0);
  });

  it('takes a bare-handed soldier only for a weapon he can fetch, the others holding their slots', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const first = settlerAt(sim, SOLDIER, 3, 3);
    const second = settlerAt(sim, SOLDIER, 3, 4);
    const civilian = settlerAt(sim, CIVILIST, 2, 3);
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSword', 2);
    run(sim, BEAT_TICKS);
    // One sword: one booking, and the other bare soldier stays in the field unbooked.
    expect([first, second].filter((e) => sim.world.has(e, AssistantRecruit))).toHaveLength(1);
    runUntil(
      sim,
      () => [first, second].some((e) => sim.world.get(e, Settler).jobType === SWORDSMAN_LONG),
      3000,
      'one armed',
    );
    run(sim, 4 * BEAT_TICKS);
    const bare = [first, second].filter((e) => sim.world.get(e, Settler).jobType === SOLDIER);
    expect(bare).toHaveLength(1);
    for (const e of bare) expect(sim.world.has(e, AssistantRecruit)).toBe(false);
    expect(sim.world.has(civilian, TrainingOrder)).toBe(false);
    expect(sim.assistantCounters(PLAYER).trainSword.value).toBe(1);
  });

  it('drafts a man only for the slots no bare-handed soldier holds', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER, 3, 3);
    const men = [settlerAt(sim, CIVILIST, 2, 2), settlerAt(sim, CIVILIST, 2, 4)];
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 2]]));

    setCounter(sim, 'trainSword', 2);
    run(sim, 3 * BEAT_TICKS);
    expect(sim.world.has(soldier, AssistantRecruit)).toBe(true);
    expect(men.filter((e) => sim.world.has(e, TrainingOrder))).toHaveLength(1);
  });

  it('leaves a bare-handed soldier a script holds or whose trade it fixed to the draft', () => {
    for (const behaviour of [MISSION_BEHAVIOUR.JOB_LOCKED, MISSION_BEHAVIOUR.NOT_CONTROLLABLE]) {
      const sim = trainSim();
      barracksAt(sim, 6, 3);
      const held = settlerAt(sim, SOLDIER, 3, 3);
      setMissionBehaviour(sim.world, held, behaviour, true);
      const civilian = settlerAt(sim, CIVILIST, 2, 3);
      pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));

      setCounter(sim, 'trainSword', 1);
      run(sim, 3 * BEAT_TICKS);
      expect(sim.world.has(held, AssistantRecruit)).toBe(false);
      expect(sim.world.has(civilian, TrainingOrder)).toBe(true);
    }
  });

  it('arms a bare-handed soldier for the class whose weapon he can reach, whichever class has the turn', () => {
    // Started a beat apart, the two runs hand the bow its turn on opposite beats.
    for (const lead of [0, ASSISTANT_DECISION_PERIOD_TICKS]) {
      const sim = new Simulation({ seed: 1, content: bowContent(), map: grassMap(16, 6) });
      setNeedsEnabled(sim.world, false);
      run(sim, lead);
      barracksAt(sim, 6, 3);
      const soldier = settlerAt(sim, SOLDIER, 3, 3);
      const civilian = settlerAt(sim, CIVILIST, 2, 3);
      pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]])); // no bow anywhere

      setCounter(sim, 'trainSword', 1);
      setCounter(sim, 'trainBow', 1);
      runUntil(
        sim,
        () => {
          expect(sim.world.tryGet(civilian, AssistantRecruit)?.intent).not.toBe('trainSword');
          return sim.world.get(soldier, Settler).jobType === SWORDSMAN_LONG;
        },
        3000,
        'armed with the sword',
      );
    }
  });

  it('moves a drilled recruit whose sword ran out to the bow order and arms him with a bow', () => {
    const sim = new Simulation({ seed: 1, content: bowContent(), map: grassMap(16, 6) });
    setNeedsEnabled(sim.world, false);
    // Out of drill and booked for a sword, but the swords are gone: only a bow lies in store.
    const recruit = drilledRecruitAt(sim, 3, 3, barracksAt(sim, 6, 3));
    pileAt(sim, 9, 3, new Map([[BOW_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    setCounter(sim, 'trainBow', 1);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === ARCHER, 3000, 'armed with the bow');
    expect(sim.assistantCounters(PLAYER).trainBow.value).toBe(0);
    expect(sim.assistantCounters(PLAYER).trainSword.value).toBe(1);
  });

  it('keeps a drilled recruit on his own order while his weapon is in store, a spare bow or not', () => {
    const sim = new Simulation({ seed: 1, content: bowContent(), map: grassMap(16, 6) });
    setNeedsEnabled(sim.world, false);
    const recruit = drilledRecruitAt(sim, 3, 3, barracksAt(sim, 6, 3));
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));
    pileAt(sim, 9, 4, new Map([[BOW_GOOD, 1]]));
    // On a walk the arming pass leaves him be, so the assistant's beats weigh his booking first.
    sim.enqueueSetup({ kind: 'moveUnit', entity: recruit, x: 12, y: 3 });

    setCounter(sim, 'trainSword', 1);
    setCounter(sim, 'trainBow', 1);
    runUntil(
      sim,
      () => {
        expect(sim.world.tryGet(recruit, AssistantRecruit)?.intent ?? 'trainSword').toBe('trainSword');
        return sim.world.get(recruit, Settler).jobType === SWORDSMAN_LONG;
      },
      3000,
      'armed with the sword',
    );
  });

  it('never moves a drilled recruit onto a bow another recruit is owed', () => {
    const sim = new Simulation({ seed: 1, content: bowContent(), map: grassMap(16, 6) });
    setNeedsEnabled(sim.world, false);
    const barracks = barracksAt(sim, 6, 3);
    const stranded = drilledRecruitAt(sim, 3, 3, barracks);
    const archer = drilledRecruitAt(sim, 3, 4, barracks, 'trainBow');
    pileAt(sim, 9, 3, new Map([[BOW_GOOD, 1]])); // no sword anywhere
    sim.enqueueSetup({ kind: 'moveUnit', entity: archer, x: 12, y: 4 });

    setCounter(sim, 'trainSword', 1);
    setCounter(sim, 'trainBow', 2);
    runUntil(
      sim,
      () => {
        expect(sim.world.get(stranded, AssistantRecruit).intent).toBe('trainSword');
        return sim.world.get(archer, Settler).jobType === ARCHER;
      },
      3000,
      'the owed bow armed its recruit',
    );
  });

  it('drafts no more men for a class than its weapons inside the barracks reach', () => {
    const sim = trainSim(grassMap(96, 6));
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    barracksAt(sim, 6, 3);
    const men = [settlerAt(sim, CIVILIST, 3, 2), settlerAt(sim, CIVILIST, 3, 4)];
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));
    pileAt(sim, BEYOND_TILE, 3, new Map([[SWORD_LONG_GOOD, 1]])); // the side's, but past the door's reach

    setCounter(sim, 'trainSword', 2);
    run(sim, 4 * BEAT_TICKS);
    expect(men.filter((e) => sim.world.has(e, AssistantRecruit))).toHaveLength(1);
  });

  it('posts recruits back from the armory at the barracks door, each on his own node', () => {
    // Three, so at least one comes back to a door another holds, off the post he stepped to out of drill.
    const sim = trainSim();
    const barracks = barracksAt(sim, 6, 3);
    const men = [
      settlerAt(sim, CIVILIST, 3, 1),
      settlerAt(sim, CIVILIST, 3, 3),
      settlerAt(sim, CIVILIST, 3, 5),
    ];
    pileAt(sim, 12, 3, new Map([[SWORD_LONG_GOOD, 3]]));

    setCounter(sim, 'trainSword', 3);
    runUntil(
      sim,
      () =>
        men.every(
          (e) =>
            sim.world.get(e, Settler).jobType === SWORDSMAN_LONG &&
            !sim.world.has(e, AssistantRecruit) &&
            !sim.world.has(e, EquipOrder),
        ),
      6000,
      'both armed and back',
    );
    // The idle beats that fan the men out from their shared post.
    run(sim, 4 * BEAT_TICKS);
    for (const e of men) expect(sim.world.has(e, MoveGoal) || sim.world.has(e, PathFollow)).toBe(false);
    const door = doorOf(sim, barracks);
    expect(new Set(men.map((e) => nodeOf(sim, e))).size).toBe(men.length);
    for (const e of men) {
      expect(sim.world.get(e, Stance).anchorCell).toBe(nodeOf(sim, e));
      expect(hexNodeDistance(terrainOf(sim), nodeOf(sim, e), door)).toBeLessThanOrEqual(DOOR_FAN_OUT_NODES);
    }
  });

  it('gathers an armed bare-handed soldier at the nearest barracks he may walk to', () => {
    const sim = trainSim(grassMap(32, 6));
    barracksAt(sim, 4, 3);
    const near = barracksAt(sim, 24, 3);
    const soldier = settlerAt(sim, SOLDIER, 20, 3);
    pileAt(sim, 18, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => sim.world.has(soldier, AssistantRecruit), BEAT_TICKS, 'booked');
    expect(sim.world.get(soldier, AssistantRecruit).barracks).toBe(near);
  });

  it('drafts a man at the barracks whose door reaches the weapon, not the first one he may drill at', () => {
    const sim = trainSim(grassMap(96, 6));
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    barracksAt(sim, NEAR_BARRACKS_TILE, 3);
    const reaching = barracksAt(sim, FAR_BARRACKS_TILE, 3);
    const civilian = settlerAt(sim, CIVILIST, MIDWAY_TILE, 3);
    pileAt(sim, BEYOND_TILE, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => sim.world.has(civilian, AssistantRecruit), 4 * BEAT_TICKS, 'drafted');
    expect(sim.world.get(civilian, AssistantRecruit).barracks).toBe(reaching);
  });

  it('drafts a man only for an order whose weapon is in store, whichever class has the turn', () => {
    for (const lead of [0, ASSISTANT_DECISION_PERIOD_TICKS]) {
      const sim = new Simulation({ seed: 1, content: bowContent(), map: grassMap(16, 6) });
      setNeedsEnabled(sim.world, false);
      run(sim, lead);
      barracksAt(sim, 6, 3);
      const men = [settlerAt(sim, CIVILIST, 2, 2), settlerAt(sim, CIVILIST, 2, 4)];
      pileAt(sim, 9, 3, new Map([[BOW_GOOD, 1]])); // no sword anywhere

      setCounter(sim, 'trainSword', 1);
      setCounter(sim, 'trainBow', 1);
      run(sim, 3 * BEAT_TICKS);
      const drafted = men.filter((e) => sim.world.has(e, AssistantRecruit));
      expect(drafted.map((e) => sim.world.get(e, AssistantRecruit).intent)).toEqual(['trainBow']);

      // A sword in store, and the sword order drafts the other man.
      pileAt(sim, 9, 4, new Map([[SWORD_LONG_GOOD, 1]]));
      run(sim, BEAT_TICKS);
      expect(men.map((e) => sim.world.tryGet(e, AssistantRecruit)?.intent).sort()).toEqual([
        'trainBow',
        'trainSword',
      ]);
    }
  });

  it('leaves a bare-handed soldier unbooked while the only sword lies beyond his reach, and drafts nobody', () => {
    const sim = trainSim(grassMap(96, 6));
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    barracksAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER, 3, 3);
    const civilian = settlerAt(sim, CIVILIST, 2, 3);
    pileAt(sim, FAR_TILE, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    run(sim, 4 * BEAT_TICKS);
    expect(sim.world.has(soldier, AssistantRecruit)).toBe(false);
    expect(sim.world.has(civilian, TrainingOrder)).toBe(false);

    // A chain of posts takes his reach out to the pile, and the counter books him.
    stampPost(sim, 12, 3, PLAYER);
    stampPost(sim, 30, 3, PLAYER);
    runUntil(sim, () => sim.world.get(soldier, Settler).jobType === SWORDSMAN_LONG, 6000, 'armed');
  });

  it('calls off the arming of a recruit still waiting for a weapon once his counter is lowered', () => {
    const sim = trainSim();
    const recruit = drilledRecruitAt(sim, 3, 3, barracksAt(sim, 6, 3));

    setCounter(sim, 'trainSword', 1);
    run(sim, 2 * BEAT_TICKS);
    expect(sim.world.tryGet(recruit, AssistantRecruit)?.armed).toBe(false); // no sword in store

    setCounter(sim, 'trainSword', 0);
    run(sim, BEAT_TICKS);
    expect(sim.world.has(recruit, AssistantRecruit)).toBe(false);
    // The sword that comes in afterwards is nobody's: the counter asks for no swordsman.
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));
    run(sim, 4 * BEAT_TICKS);
    expect(sim.world.get(recruit, Settler).jobType).toBe(SOLDIER);
    expect(sim.world.has(recruit, EquipOrder)).toBe(false);
  });

  it('trains without arming ("naked") on the plain soldier counter even with weapons in store', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSoldiers', 1);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SOLDIER, 2000, 'enlistment');
    run(sim, 4 * BEAT_TICKS);
    expect(sim.world.get(recruit, Settler).jobType).toBe(SOLDIER);
    expect(sim.world.tryGet(recruit, Equipment)?.weapon ?? null).toBe(null);
  });
});

// ── Births ────────────────────────────────────────────────────────────────────────────────────────

const FOOD = 16;
const WOMAN = 5;
const HOME = 2;
const BABY_FEMALE_JOB = 1;

function birthContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: FOOD, id: 'food_simple' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: BABY_FEMALE_JOB, id: 'baby_female' },
      { typeId: 2, id: 'baby_male' },
      { typeId: 3, id: 'child_female' },
      { typeId: 4, id: 'child_male' },
      { typeId: WOMAN, id: 'woman' },
      { typeId: CIVILIST, id: 'civilist' },
      { typeId: SOLDIER, id: 'soldier_unarmed', ignoresHomeHouse: true },
    ],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: HOME,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 3,
        stock: [{ goodType: FOOD, capacity: 5 }],
      },
    ],
  });
}

/** A housed, married couple with a stocked larder - everything short of the child order itself. */
function coupleSim(couples: number): { sim: Simulation; wives: Entity[] } {
  const sim = new Simulation({ seed: 5, content: birthContent(), map: grassMap(24, 6) });
  setNeedsEnabled(sim.world, false);
  const wives: Entity[] = [];
  for (let i = 0; i < couples; i++) {
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME, x: 6 + 8 * i, y: 0, tribe: VIKING });
  }
  sim.step();
  const homes = [...sim.world.query(Building)].sort((a, b) => a - b);
  for (let i = 0; i < couples; i++) {
    const home = homes[i];
    if (home === undefined) throw new Error('setup: home missing');
    const wife = spawnAdult(sim, WOMAN, 4 + 8 * i, 2, true);
    const husband = spawnAdult(sim, CIVILIST, 5 + 8 * i, 2, false);
    sim.world.add(wife, Marriage, { spouse: husband, child: null });
    sim.world.add(husband, Marriage, { spouse: wife, child: null });
    sim.world.add(wife, Residence, { home, since: 0 });
    sim.world.add(husband, Residence, { home, since: 0 });
    sim.world.mut(home, Stockpile).amounts.set(FOOD, 3);
    wives.push(wife);
  }
  return { sim, wives };
}

function spawnAdult(sim: Simulation, jobType: number, x: number, y: number, female: boolean): Entity {
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
  if (female) sim.world.add(e, Female, { female: true });
  return e;
}

describe('the birth queue', () => {
  it('orders a daughter, and the birth pays the counter and clears the booking', () => {
    const { sim, wives } = coupleSim(1);
    const wife = wives[0];
    if (wife === undefined) throw new Error('setup');

    setCounter(sim, 'extraWomen', 1);
    // Schedule relationship pin: the assistant books BEFORE the FamilySystem, so the order is being
    // driven (the family-duty fence up) the very tick it appears.
    let booked = false;
    for (let i = 0; i < BEAT_TICKS && !booked; i++) {
      sim.step();
      if (sim.world.has(wife, ChildOrder)) {
        booked = true;
        expect(sim.world.has(wife, FamilyDuty)).toBe(true);
      }
    }
    expect(booked).toBe(true);
    expect(sim.world.get(wife, ChildOrder).child).toBe('female');
    expect(sim.world.get(wife, AssistantChildOrder).sex).toBe('female');

    runUntil(sim, () => sim.world.get(wife, Marriage).child !== null, 4000, 'birth');
    const child = sim.world.get(wife, Marriage).child;
    expect(child).not.toBeNull();
    if (child !== null) expect(sim.world.has(child, Female)).toBe(true);
    expect(sim.assistantCounters(PLAYER).extraWomen.value).toBe(0);
    expect(sim.world.has(wife, AssistantChildOrder)).toBe(false);

    // The paid counter orders nothing further.
    run(sim, 3 * BEAT_TICKS);
    expect(sim.world.has(wife, ChildOrder)).toBe(false);
  });

  it('daughters outrank sons when both counters are set', () => {
    const { sim, wives } = coupleSim(2);
    setCounter(sim, 'extraWomen', 1);
    setCounter(sim, 'extraMen', 1);
    run(sim, BEAT_TICKS);

    const sexes = wives.map((w) => sim.world.get(w, ChildOrder).child);
    expect(sexes).toEqual(['female', 'male']); // canonical order: the first womb takes the daughter
  });

  it('books no more wombs than the counter asks', () => {
    const { sim, wives } = coupleSim(2);
    setCounter(sim, 'extraWomen', 1);
    run(sim, 3 * BEAT_TICKS);

    const ordered = wives.filter((w) => sim.world.has(w, ChildOrder));
    expect(ordered.length).toBe(1);
  });

  it('an infinite son counter keeps every family expecting', () => {
    const { sim, wives } = coupleSim(2);
    setCounter(sim, 'extraMen', 0, true);
    run(sim, BEAT_TICKS);

    for (const wife of wives) expect(sim.world.get(wife, ChildOrder).child).toBe('male');
    expect(sim.assistantCounters(PLAYER).extraMen).toEqual({ value: 0, infinite: true });
  });

  it('passes over a family whose husband never comes home for one that can have the child', () => {
    const { sim, wives } = coupleSim(2);
    const [away, home] = wives;
    if (away === undefined || home === undefined) throw new Error('setup');
    setSettlerJob(sim.world, sim.world.get(away, Marriage).spouse, SOLDIER);
    setCounter(sim, 'extraWomen', 1);
    run(sim, BEAT_TICKS);

    expect(sim.world.has(away, ChildOrder)).toBe(false);
    expect(sim.world.get(home, AssistantChildOrder).sex).toBe('female');
  });

  it('gives back a booking once the husband takes up a trade that never comes home', () => {
    const { sim, wives } = coupleSim(2);
    const [first, second] = wives;
    if (first === undefined || second === undefined) throw new Error('setup');
    setCounter(sim, 'extraWomen', 1);
    run(sim, BEAT_TICKS);
    expect(sim.world.has(first, AssistantChildOrder)).toBe(true);

    setSettlerJob(sim.world, sim.world.get(first, Marriage).spouse, SOLDIER);
    run(sim, 2 * BEAT_TICKS);

    expect(sim.world.has(first, ChildOrder)).toBe(false);
    expect(sim.world.get(second, AssistantChildOrder).sex).toBe('female');
  });

  it("a player's own makeChild never pays the assistant's counters", () => {
    const { sim, wives } = coupleSim(1);
    const wife = wives[0];
    if (wife === undefined) throw new Error('setup');
    setCounter(sim, 'extraMen', 2);
    sim.enqueueSetup({ kind: 'makeChild', entity: wife, child: 'male' }); // beats the assistant to the womb
    sim.step();
    expect(sim.world.has(wife, AssistantChildOrder)).toBe(false);

    runUntil(sim, () => sim.world.get(wife, Marriage).child !== null, 4000, 'birth');
    expect(sim.assistantCounters(PLAYER).extraMen.value).toBe(2); // untouched - not the assistant's son
  });
});
