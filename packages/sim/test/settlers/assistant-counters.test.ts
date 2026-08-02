import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AssistantChildOrder,
  AssistantCounters,
  AssistantRecruit,
  Building,
  ChildOrder,
  Equipment,
  EquipOrder,
  FamilyDuty,
  FEMALE,
  Female,
  JobAssignment,
  Marriage,
  MoveGoal,
  Owner,
  Position,
  Residence,
  Settler,
  Stockpile,
  setNeedsEnabled,
  TrainingOrder,
  Weapon,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { ASSISTANT_DECISION_PERIOD_TICKS } from '../../src/systems/assistant/index.js';
import { BARRACKS_DRILL_TICKS } from '../../src/systems/settlers/drives/training.js';
import { TEST_MANIFEST, testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

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
/** The spawn command's idle sentinel (job 0): the wire form of "no trade", normalized to null. */
const IDLE_SPAWN_JOB = 0;
const SWORD_SHORT_GOOD = 41;
const SWORD_LONG_GOOD = 42;
const ARMOR_WOOL_GOOD = 61;
const ARMOR_CHAIN_GOOD = 62;
const SWORD_SHORT_WEAPON = 7;
const SWORD_LONG_WEAPON = 8;
/** A dispatch beat plus slack - the counter must have acted (or provably not) within one beat. */
const BEAT_TICKS = ASSISTANT_DECISION_PERIOD_TICKS + 2;

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

function trainSim(): Simulation {
  const sim = new Simulation({ seed: 1, content: trainContent(), map: grassMap(16, 6) });
  setNeedsEnabled(sim.world, false);
  return sim;
}

function settlerAt(sim: Simulation, jobType: number | null, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
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

/** A loose ground pile holding the given goods - a store the arming pass can fetch from. */
function pileAt(sim: Simulation, x: number, y: number, amounts: ReadonlyMap<number, number>): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map(amounts) });
  return e;
}

function setCounter(
  sim: Simulation,
  counter: 'extraWomen' | 'extraMen' | 'trainSoldiers' | 'trainSword' | 'trainSpear' | 'trainBow',
  value: number,
  infinite = false,
  player = PLAYER,
): void {
  sim.enqueue({ kind: 'setAssistantCounter', player, counter, value, infinite });
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

describe('the training queue', () => {
  it('sends only a free man to drill: not the employed, not another trade', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
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

    expect(sim.world.get(free, AssistantRecruit)).toEqual({ intent: 'trainSoldiers', armed: false });
    expect(sim.world.has(employed, TrainingOrder)).toBe(false);
    expect(sim.world.has(tradesman, TrainingOrder)).toBe(false);
  });

  it('drafts an unemployed (null-job) man once no workplace wants him', () => {
    const sim = trainSim();
    const house = barracksAt(sim, 6, 3);
    // Fill the barracks' four hauler slots, so the JobSystem has no opening to win the man first -
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

  it('normalizes the spawn command idle sentinel to the trade-less null shape', () => {
    const sim = trainSim();
    // No barracks and no workplace on the map, so nothing employs him before the read.
    sim.enqueue({ kind: 'spawnSettler', jobType: IDLE_SPAWN_JOB, x: 3, y: 3, tribe: VIKING, owner: PLAYER });
    run(sim, 1);
    const spawned = [...sim.world.query(Settler)];
    expect(spawned).toHaveLength(1);
    const only = spawned[0];
    if (only === undefined) throw new Error('spawn failed');
    expect(sim.world.get(only, Settler).jobType).toBe(null);
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
    barracksAt(sim, 6, 3);
    const man = settlerAt(sim, CIVILIST, 3, 3);
    setCounter(sim, 'trainSoldiers', 1);
    runUntil(sim, () => sim.world.has(man, TrainingOrder), BEAT_TICKS, 'dispatched');

    // The player walks him off: the drill order dies, the booking goes stale, the counter is unpaid.
    sim.enqueue({ kind: 'moveUnit', entity: man, x: 5, y: 3 });
    runUntil(sim, () => !sim.world.has(man, TrainingOrder), BEAT_TICKS, 'interrupted');
    expect(sim.assistantCounters(PLAYER).trainSoldiers.value).toBe(1);

    // The sweep clears the stale booking, and the standing counter simply drafts him again.
    runUntil(sim, () => sim.world.has(man, TrainingOrder), 6 * BEAT_TICKS, 're-dispatched');
    expect(sim.world.get(man, AssistantRecruit)).toEqual({ intent: 'trainSoldiers', armed: false });
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

  it('a weapon-class recruit drills the standard term, takes the strongest sword, then armor - and pays on the sword', () => {
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

    // The armor leg: the heavy tier outranks the light one; the booking ends once it is worn.
    runUntil(sim, () => (sim.world.tryGet(recruit, Equipment)?.armor ?? null) !== null, 2000, 'armor');
    expect(sim.world.tryGet(recruit, Equipment)?.armor?.goodType).toBe(ARMOR_CHAIN_GOOD);
    runUntil(sim, () => !sim.world.has(recruit, AssistantRecruit), 200, 'booking released');
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

  it('demotes a swordsman back to the unarmed base when the sword comes off', () => {
    const sim = trainSim();
    barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST, 3, 3);
    pileAt(sim, 9, 3, new Map([[SWORD_LONG_GOOD, 1]]));

    setCounter(sim, 'trainSword', 1);
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SWORDSMAN_LONG, 3000, 'swordsman');
    runUntil(sim, () => !sim.world.has(recruit, AssistantRecruit), 2000, 'booking released');

    sim.enqueue({ kind: 'unequipGood', entity: recruit, group: 'weapon', slot: 0 });
    runUntil(sim, () => sim.world.get(recruit, Settler).jobType === SOLDIER, 1000, 'demotion');
    expect(sim.world.has(recruit, Weapon)).toBe(false);
    expect(sim.world.tryGet(recruit, Equipment)?.weapon ?? null).toBe(null);
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
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOME, x: 6 + 8 * i, y: 0, tribe: VIKING });
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
    sim.world.add(wife, Residence, { home });
    sim.world.add(husband, Residence, { home });
    sim.world.get(home, Stockpile).amounts.set(FOOD, 3);
    wives.push(wife);
  }
  return { sim, wives };
}

function spawnAdult(sim: Simulation, jobType: number, x: number, y: number, female: boolean): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: PLAYER });
  if (female) sim.world.add(e, Female, FEMALE);
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

  it("a player's own makeChild never pays the assistant's counters", () => {
    const { sim, wives } = coupleSim(1);
    const wife = wives[0];
    if (wife === undefined) throw new Error('setup');
    setCounter(sim, 'extraMen', 2);
    sim.enqueue({ kind: 'makeChild', entity: wife, child: 'male' }); // beats the assistant to the womb
    sim.step();
    expect(sim.world.has(wife, AssistantChildOrder)).toBe(false);

    runUntil(sim, () => sim.world.get(wife, Marriage).child !== null, 4000, 'birth');
    expect(sim.assistantCounters(PLAYER).extraMen.value).toBe(2); // untouched - not the assistant's son
  });
});
