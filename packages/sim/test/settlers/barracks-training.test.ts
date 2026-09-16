import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  EquipOrder,
  Female,
  MoveGoal,
  Owner,
  Position,
  Resting,
  Settler,
  Sheltering,
  Stockpile,
  TrainingOrder,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { needSubjectOf, settlerMeetsNeed } from '../../src/systems/index.js';
import { BARRACKS_DRILL_TICKS } from '../../src/systems/settlers/drives/training.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { noteUnreachableGoal } from '../../src/systems/settlers/unreachable-goals.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, grassMap } from './needs/support.js';

/**
 * The barracks drill: a colonist sent to a training house walks to its door, drills inside for
 * {@link BARRACKS_DRILL_TICKS}, and steps back out a soldier. The served term IS the qualification -
 * the drill banks no experience stat and flips the trade directly (authored rule), while the
 * class's requirement rows read tracks nothing accrues, keeping every other door onto the trade shut.
 *
 * The fixture mirrors the extracted shape at fixture scale: a `training` house, the civilist's exercise
 * clip (whose `event <at> 29 1` the sim now ignores), and the base soldier class's
 * `needforjob 31 5 69` / `trainforjob 31 5 77` pair.
 */

const VIKING = 1;
const HUMAN_PLAYER = 0;
const CIVILIST_JOB = 6;
const CARRIER_JOB = 24;
const SOLDIER_JOB = 31;
const BARRACKS_TYPE = 91;
const EXERCISE_ATOMIC = 89;
const EXERCISE_CLIP_TICKS = 4;
const SOLDIER_GENERAL_TRACK = 69;
const TRAINING_TRACK = 77;
const SCHOOLING_REPEATS = 5;
/** The fixture's headquarters (it declares the food stock slot) and its `food_simple` good. */
const HEADQUARTERS_TYPE = 1;
const FOOD_GOOD = 3;
const LARDER_FOOD = 5;
/** Well over the drive threshold - this recruit seeks food before anything else. */
const STARVING = fx.div(fx.fromInt(9), fx.fromInt(10));
/** The four-cell walk to the door at the fixture's gait, with slack. */
const WALK_TICKS = 100;
/** Long enough for the walk plus the whole drill and its overshoot repetition. */
const RUN_TICKS = WALK_TICKS + BARRACKS_DRILL_TICKS + EXERCISE_CLIP_TICKS;

function barracksContent(): ContentSet {
  const base = testContent();
  const viking = base.tribes[0];
  if (viking === undefined) throw new Error('fixture tribe missing');
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      // The real barracks shape: a LEARN house that also employs haulers, which is what tells it apart
      // from the school (`isBarracksType`).
      {
        typeId: BARRACKS_TYPE,
        id: 'barracks',
        kind: 'training',
        workers: [{ jobType: CARRIER_JOB, count: 4 }],
        // Flagged `logicCanEnableDefenceMode` like the real one; the single seat is fixture scale.
        canEnableDefenceMode: true,
        shelterCapacity: 1,
      },
    ],
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: 'viking_exercise',
        name: 'viking_exercise',
        length: EXERCISE_CLIP_TICKS,
        events: [{ at: 2, type: 29, value: 1 }],
      },
    ],
    tribes: [
      {
        ...viking,
        atomicBindings: [
          ...viking.atomicBindings,
          { jobType: CIVILIST_JOB, atomicId: EXERCISE_ATOMIC, animation: 'viking_exercise' },
        ],
        jobRequirements: [
          ...viking.jobRequirements,
          {
            requirement: 'need',
            target: 'job',
            targetId: SOLDIER_JOB,
            amount: SCHOOLING_REPEATS,
            experienceTypes: [SOLDIER_GENERAL_TRACK],
          },
          {
            requirement: 'train',
            target: 'job',
            targetId: SOLDIER_JOB,
            amount: SCHOOLING_REPEATS,
            experienceTypes: [TRAINING_TRACK],
          },
        ],
      },
      ...base.tribes.slice(1),
    ],
  });
}

function simWithBarracks(): Simulation {
  return new Simulation({ seed: 1, content: barracksContent(), map: grassMap(10, 8) });
}

/** A built headquarters stocked with {@link LARDER_FOOD} food - the larder the eat drive walks to. */
function larderAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD_GOOD, LARDER_FOOD]]) });
  return e;
}

/** A built barracks of `tribe`, owned by `owner`, standing on cell (x, y). */
function barracksAt(sim: Simulation, x: number, y: number, tribe = VIKING, owner = HUMAN_PLAYER): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: BARRACKS_TYPE, tribe, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

function settlerAt(sim: Simulation, jobType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

function jobOf(sim: Simulation, e: Entity): number | null {
  return sim.world.get(e, Settler).jobType;
}

function qualifiesAsSoldier(sim: Simulation, e: Entity): boolean {
  return settlerMeetsNeed(sim.world, ctxOf(sim), needSubjectOf(sim.world, e), 'job', SOLDIER_JOB);
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

function terrainOf(sim: Simulation): TerrainGraph {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  return terrain;
}

describe('trainSoldier - the barracks drill', () => {
  it('walks a colonist in, drills him, and sends him out a soldier', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);
    expect(qualifiesAsSoldier(sim, recruit)).toBe(false); // no route onto the trade before the drill

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    expect(sim.world.has(recruit, TrainingOrder)).toBe(true);
    expect(sim.world.has(recruit, MoveGoal)).toBe(true); // heading for the door

    run(sim, RUN_TICKS);
    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    // The flip is the drill's whole product: nothing banked, so the XP-gate stays closed even for
    // him - the barracks remains the only route onto the trade (authored rule).
    expect(qualifiesAsSoldier(sim, recruit)).toBe(false);
    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
    expect(sim.world.has(recruit, Resting)).toBe(false); // back outside
  });

  it('leaves a serving soldier in the trade he already holds', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    const veteran = settlerAt(sim, SOLDIER_JOB, 2, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: veteran, house });
    run(sim, RUN_TICKS);

    expect(jobOf(sim, veteran)).toBe(SOLDIER_JOB);
    expect(sim.world.has(veteran, TrainingOrder)).toBe(false);
  });

  it('banks no experience stat at all - the trade flip is the whole product', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3); // already on the door node - no walk

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, RUN_TICKS);

    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    // The clip's TRAINING event is dead data: no "Wyszkolenie" counter may ever appear on a drilled
    // settler (authored rule).
    expect(sim.world.get(recruit, Settler).experience.size).toBe(0);
  });

  it('lets a player walk call the drill off, and a re-issue starts a fresh term', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, 3 * EXERCISE_CLIP_TICKS + 1);
    const served = sim.world.get(recruit, TrainingOrder).drillTicksLeft;
    expect(served).toBeLessThan(BARRACKS_DRILL_TICKS);

    // A player walk calls the drill off - the one control that stops it. The order parks behind the
    // repetition in flight (the exercise clip is not interruptible), so it lands a few ticks later.
    sim.enqueueSetup({ kind: 'moveUnit', entity: recruit, x: 1, y: 1 });
    run(sim, EXERCISE_CLIP_TICKS + 2);
    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);

    // Sent back, it starts a fresh drill and still ends up a soldier.
    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, RUN_TICKS);
    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
  });

  it('lets the player call the drill off outright, keeping the settler where it stands', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, 3 * EXERCISE_CLIP_TICKS + 1);
    expect(sim.world.has(recruit, TrainingOrder)).toBe(true);

    sim.enqueueSetup({ kind: 'cancelTraining', entity: recruit });
    sim.step();

    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
    // The drill served is lost: sent back, the recruit takes the full term again.
    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    expect(sim.world.get(recruit, TrainingOrder).drillTicksLeft).toBe(BARRACKS_DRILL_TICKS);
  });

  it('is a no-op when re-issued for the house the settler is already drilling at', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, 3 * EXERCISE_CLIP_TICKS + 1);
    const served = sim.world.get(recruit, TrainingOrder).drillTicksLeft;

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    expect(sim.world.get(recruit, TrainingOrder).drillTicksLeft).toBeLessThanOrEqual(served);
  });

  it('lets a hungry recruit eat first, keeping the errand and its untouched clock', () => {
    const sim = simWithBarracks();
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: true });
    const house = barracksAt(sim, 3, 3);
    const larder = larderAt(sim, 8, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3);
    sim.world.mut(recruit, Settler).hunger = STARVING;

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    // The needs drives sit above the errand: the recruit leaves the door for the larder instead of
    // stepping inside, and its errand (and its untouched clock) survive the detour.
    expect(sim.world.has(recruit, Resting)).toBe(false);
    expect(sim.world.has(recruit, MoveGoal)).toBe(true);
    expect(sim.world.get(recruit, TrainingOrder).drillTicksLeft).toBe(BARRACKS_DRILL_TICKS);

    // It reaches the larder and eats; the drill is still owed in full when the meal is done.
    run(sim, RUN_TICKS);
    expect(sim.world.get(larder, Stockpile).amounts.get(FOOD_GOOD)).toBeLessThan(LARDER_FOOD);
  });

  it('a profession change calls the drill off', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    // Parked behind the repetition in flight like the move order above, then applied.
    sim.enqueueSetup({ kind: 'setJob', entity: recruit, jobType: CARRIER_JOB });
    run(sim, EXERCISE_CLIP_TICKS + 2);

    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
    expect(jobOf(sim, recruit)).toBe(CARRIER_JOB);
  });

  it('pauses the drill while the barracks stands on alarm, and resumes it on stand-down', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, 3 * EXERCISE_CLIP_TICKS + 1);
    const served = sim.world.get(recruit, TrainingOrder).drillTicksLeft;
    expect(served).toBeLessThan(BARRACKS_DRILL_TICKS);

    // The alarm outranks the errand: once the repetition in flight plays out, the recruit takes a seat in
    // the house it was drilling in, and its clock stands still for as long as the alarm holds.
    sim.enqueueSetup({ kind: 'setDefenceMode', building: house, enabled: true });
    run(sim, EXERCISE_CLIP_TICKS + 2);
    expect(sim.world.get(recruit, Sheltering).shelter).toBe(house);
    expect(sim.world.tryGet(recruit, Resting)?.at).toBe(house);
    const paused = sim.world.get(recruit, TrainingOrder).drillTicksLeft;
    expect(paused).toBeLessThanOrEqual(served);
    run(sim, 3 * EXERCISE_CLIP_TICKS);
    expect(sim.world.get(recruit, TrainingOrder).drillTicksLeft).toBe(paused);

    // Stand-down frees the seat; the errand survives the detour and finishes.
    sim.enqueueSetup({ kind: 'setDefenceMode', building: house, enabled: false });
    run(sim, RUN_TICKS);
    expect(sim.world.has(recruit, Sheltering)).toBe(false);
    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
  });

  it('abandons the errand at its next planning when the house is gone', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3); // at the door - it drills from tick one

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    expect(sim.world.has(recruit, TrainingOrder)).toBe(true);

    sim.world.destroy(house);
    run(sim, EXERCISE_CLIP_TICKS + 1); // the repetition in flight plays out, then the rung re-plans

    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
    expect(sim.world.has(recruit, Resting)).toBe(false);
    expect(jobOf(sim, recruit)).toBe(CIVILIST_JOB);
  });

  it('refuses a door the settler has just failed to reach, instead of stamping and abandoning', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);
    const door = interactionCell(sim.world, ctxOf(sim), terrainOf(sim), house);
    noteUnreachableGoal(sim.world, ctxOf(sim), recruit, door);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    // Accepting it would cancel whatever the settler was doing, only for the drill rung to drop the
    // errand next tick - and the AI would re-issue the same order every decision.
    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
  });

  it('calls off an equip errand it supersedes', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);
    sim.world.add(recruit, EquipOrder, {
      group: 'tool',
      slot: 0,
      goodType: null,
      returnTo: 0 as NodeId,
      stage: 'acquire',
      issuer: 'player',
      queued: [],
    });

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    expect(sim.world.has(recruit, EquipOrder)).toBe(false);
    expect(sim.world.has(recruit, TrainingOrder)).toBe(true);
  });

  it('refuses a woman, a wrong-tribe house, and a target that is not a training house', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    const woman = settlerAt(sim, CIVILIST_JOB, 2, 3);
    sim.world.add(woman, Female, { female: true });
    const stranger = settlerAt(sim, CIVILIST_JOB, 2, 4);
    const foreignHouse = barracksAt(sim, 8, 3, VIKING + 1);
    const notAHouse = settlerAt(sim, CIVILIST_JOB, 8, 5);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: woman, house });
    sim.enqueueSetup({ kind: 'trainSoldier', entity: stranger, house: foreignHouse });
    sim.enqueueSetup({ kind: 'trainSoldier', entity: stranger, house: notAHouse });
    sim.step();

    expect(sim.world.has(woman, TrainingOrder)).toBe(false);
    expect(sim.world.has(stranger, TrainingOrder)).toBe(false);
  });
});
