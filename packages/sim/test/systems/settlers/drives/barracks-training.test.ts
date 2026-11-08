import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AssistantCounters,
  AssistantRecruit,
  addPerson,
  Building,
  DeliveryFlag,
  defaultAssistantCounters,
  Equipment,
  EquipOrder,
  Female,
  Fleeing,
  Health,
  IdleStand,
  MISSION_BEHAVIOUR,
  MoveGoal,
  OrderQueue,
  Owner,
  PlayerOrder,
  Position,
  RallyPoint,
  Resting,
  Settler,
  SettlerProgress,
  Sheltering,
  Stance,
  Stockpile,
  setMissionBehaviour,
  stampOwner,
  TrainingOrder,
  UnderConstruction,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, ONE, type SimEvent, Simulation } from '../../../../src/index.js';
import { hexDistanceBetween, nodeOfPosition } from '../../../../src/nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../src/nav/terrain/index.js';
import { needSubjectOf, plannerSystem, settlerMeetsNeed } from '../../../../src/systems/index.js';
import { removeBuildingSilently } from '../../../../src/systems/lifecycle/cleanup.js';
import { WORK_FLAG_SNAP_MAX_RADIUS } from '../../../../src/systems/orders/work/selection.js';
import { MILITARY_MODE } from '../../../../src/systems/readviews/index.js';
import { BARRACKS_DRILL_TICKS } from '../../../../src/systems/settlers/drives/training.js';
import { interactionCell } from '../../../../src/systems/settlers/targets/index.js';
import { noteUnreachableGoal } from '../../../../src/systems/settlers/unreachable-goals.js';
import { entityNode } from '../../../../src/systems/spatial/nodes.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf, grassMap } from '../../../fixtures/needs.js';
import { setNeeds } from '../../../fixtures/settler.js';
import { waterColumnMap } from '../../../fixtures/terrain.js';

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
const OTHER_PLAYER = 1;
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
const WOOD_GOOD = 1;
/** The barracks' construction bill: two loads, so the recruit makes more than one trip. */
const BARRACKS_WOOD = 2;
/** A weapon good no content row binds - the armed recruit's march decision reads the slot alone. */
const PRESET_WEAPON_GOOD = 99;
/** The sword good the arming content binds: a `trainSword` recruit fetches it before any rally walk. */
const SWORD_GOOD = 7;
/** The weapon rows' sword `maintype`. */
const SWORD_CLASS = 3;
/** Well over the drive threshold - this recruit seeks food before anything else. */
const STARVING = fx.div(fx.fromInt(9), fx.fromInt(10));
/** The planner's yard around a door, where a settler waiting at a foundation stands. */
const DOOR_YARD_RADIUS_NODES = 4;
/** The four-cell walk to the door at the fixture's gait, with slack. */
const WALK_TICKS = 100;
/** Long enough for the walk plus the whole drill and its overshoot repetition. */
const RUN_TICKS = WALK_TICKS + BARRACKS_DRILL_TICKS + EXERCISE_CLIP_TICKS;
/** Two round trips between the fixture's store and the foundation, with slack. */
const SUPPLY_TICKS = 4 * WALK_TICKS;

function barracksContent(): ContentSet {
  const base = testContent();
  const viking = base.tribes[0];
  if (viking === undefined) throw new Error('fixture tribe missing');
  return parseContentSet({
    ...base,
    weapons: [
      ...base.weapons,
      // A real class row, so a `trainSword` booking has a good to shop for: the sword is the base
      // soldier class's weapon, and taking it up keeps the trade.
      {
        typeId: 30,
        id: 'test_sword',
        tribeType: VIKING,
        jobType: SOLDIER_JOB,
        mainType: SWORD_CLASS,
        goodType: SWORD_GOOD,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 50 },
      },
    ],
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
        construction: [{ goodType: WOOD_GOOD, amount: BARRACKS_WOOD }],
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

/** A built headquarters holding `wood` - the store a recruit fetches a foundation's material from. */
function woodStoreAt(sim: Simulation, x: number, y: number, wood: number): Entity {
  const e = larderAt(sim, x, y);
  sim.world.mut(e, Stockpile).amounts.set(WOOD_GOOD, wood);
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

function run(sim: Simulation, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    events.push(...sim.events.current());
  }
  return events;
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

    const events = run(sim, RUN_TICKS);
    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    expect(events).toContainEqual({
      kind: 'settlerTrained',
      entity: recruit,
      course: 'barracks',
      target: 'job',
      typeId: SOLDIER_JOB,
    });
    // The flip is the drill's whole product: nothing banked, so the XP-gate stays closed even for
    // him - the barracks remains the only route onto the trade (authored rule).
    expect(qualifiesAsSoldier(sim, recruit)).toBe(false);
    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
    expect(sim.world.has(recruit, Resting)).toBe(false); // back outside
  });

  it('sends soldiers trained after a rally point is set to it, and none before', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    const early = settlerAt(sim, CIVILIST_JOB, 2, 3);
    sim.enqueueSetup({ kind: 'trainSoldier', entity: early, house });
    run(sim, RUN_TICKS);
    expect(jobOf(sim, early)).toBe(SOLDIER_JOB);
    const earlyAnchor = sim.world.get(early, Stance).anchorCell;

    const rally = { x: 4, y: 12 };
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, ...rally });
    const late = settlerAt(sim, CIVILIST_JOB, 2, 4);
    // The soldier the flag gathers is an armed one: a preset weapon slot stands for the gear a recruit
    // took on the way out or fetched before the drill ended. The bare case is the next test.
    sim.world.add(late, Equipment, {
      boots: null,
      tool: null,
      weapon: { goodType: PRESET_WEAPON_GOOD, degreeOfUse: fx.fromInt(0) },
      armor: null,
      misc: [],
    });
    sim.enqueueSetup({ kind: 'trainSoldier', entity: late, house });
    run(sim, RUN_TICKS + 2 * WALK_TICKS);

    const flag = sim.world.get(house, RallyPoint).flag;
    expect(sim.world.has(flag, DeliveryFlag)).toBe(true);
    const node = entityNode(sim.world, terrainOf(sim), flag);
    const flagAt = sim.world.get(flag, Position);
    const planted = nodeOfPosition(flagAt.x, flagAt.y);
    expect(hexDistanceBetween(planted.hx, planted.hy, rally.x, rally.y)).toBeLessThanOrEqual(
      WORK_FLAG_SNAP_MAX_RADIUS,
    );
    expect(jobOf(sim, late)).toBe(SOLDIER_JOB);
    expect(sim.world.get(late, Stance).anchorCell).toBe(node);
    const at = sim.world.get(late, Position);
    const here = nodeOfPosition(at.x, at.y);
    expect(hexDistanceBetween(here.hx, here.hy, planted.hx, planted.hy)).toBeLessThanOrEqual(1);
    expect(sim.world.get(early, Stance).anchorCell).toBe(earlyAnchor); // the soldier trained before stays put

    // A second click moves the same flag instead of minting another.
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 6, y: 12 });
    sim.step();
    expect(sim.world.get(house, RallyPoint).flag).toBe(flag);

    sim.enqueueSetup({ kind: 'clearRallyPoint', building: house });
    sim.step();
    expect(sim.world.has(house, RallyPoint)).toBe(false);
    expect(sim.world.isAlive(flag)).toBe(false);
  });

  it('a soldier drilled by hand walks to the flag bare: only an assistant recruit fetches a weapon', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    // Swords in store: a hand-drilled soldier leaves them there.
    const store = larderAt(sim, 2, 10);
    sim.world.mut(store, Stockpile).amounts.set(SWORD_GOOD, 3);
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 4, y: 12 });
    sim.step();
    const flag = sim.world.get(house, RallyPoint).flag;
    const rallyNode = entityNode(sim.world, terrainOf(sim), flag);

    const bare = settlerAt(sim, CIVILIST_JOB, 2, 3);
    sim.enqueueSetup({ kind: 'trainSoldier', entity: bare, house });
    run(sim, RUN_TICKS + 2 * WALK_TICKS);

    expect(jobOf(sim, bare)).toBe(SOLDIER_JOB);
    expect(sim.world.tryGet(bare, Equipment)?.weapon ?? null).toBeNull();
    expect(sim.world.has(bare, EquipOrder)).toBe(false);
    expect(sim.world.get(bare, Stance).anchorCell).toBe(rallyNode);
    const at = nodeOfPosition(sim.world.get(bare, Position).x, sim.world.get(bare, Position).y);
    const flagAt = sim.world.get(flag, Position);
    const planted = nodeOfPosition(flagAt.x, flagAt.y);
    expect(hexDistanceBetween(at.hx, at.hy, planted.hx, planted.hy)).toBeLessThanOrEqual(1);
  });

  it('a booked recruit the barracks cannot dress starts no rally walk either', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 4, y: 12 });
    sim.step();
    const flag = sim.world.get(house, RallyPoint).flag;
    const rallyNode = entityNode(sim.world, terrainOf(sim), flag);
    // Counter cover, so the assistant's release pass does not drop the booking as past its ask.
    sim.world.add(sim.world.create(), AssistantCounters, {
      player: HUMAN_PLAYER,
      counters: { ...defaultAssistantCounters(), trainSword: { value: 1, infinite: false } },
    });

    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);
    sim.world.add(recruit, AssistantRecruit, { intent: 'trainSword', armed: false, barracks: house });
    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, RUN_TICKS);

    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    expect(sim.world.get(recruit, Stance).anchorCell).toBe(rallyNode);
    expect(sim.world.has(recruit, MoveGoal)).toBe(false);
    // The booking survives unsettled: the arming pass still owes him his sword, and its fetch outing -
    // closing on the post - will be the walk that first brings him to the flag.
    expect(sim.world.get(recruit, AssistantRecruit).armed).toBe(false);
  });

  it('a booked recruit fetches his sword before the rally walk starts', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    // The swords wait in the headquarters, not the barracks: the recruit's fetch errand is the walk
    // that first carries him there, and the enlist beat must not race it with a bare rally walk.
    const store = larderAt(sim, 2, 10);
    sim.world.mut(store, Stockpile).amounts.set(SWORD_GOOD, 3);
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 4, y: 12 });
    sim.step();
    const flag = sim.world.get(house, RallyPoint).flag;
    const rallyNode = entityNode(sim.world, terrainOf(sim), flag);
    sim.world.add(sim.world.create(), AssistantCounters, {
      player: HUMAN_PLAYER,
      counters: { ...defaultAssistantCounters(), trainSword: { value: 1, infinite: false } },
    });

    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);
    sim.world.add(recruit, AssistantRecruit, { intent: 'trainSword', armed: false, barracks: house });
    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });

    let armedAt = -1;
    let rallyWalkAt = -1;
    for (let i = 0; i < RUN_TICKS + 4 * WALK_TICKS && (armedAt < 0 || rallyWalkAt < 0); i++) {
      sim.step();
      if ((sim.world.tryGet(recruit, Equipment)?.weapon ?? null) !== null && armedAt < 0) armedAt = i;
      if (sim.world.tryGet(recruit, MoveGoal)?.cell === rallyNode && rallyWalkAt < 0) rallyWalkAt = i;
    }

    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    expect(sim.world.get(recruit, Stance).anchorCell).toBe(rallyNode);
    // He is armed before the flag ever holds his walk: the fetch outing closes on the post.
    expect(armedAt).toBeGreaterThanOrEqual(0);
    expect(rallyWalkAt).toBeGreaterThanOrEqual(0);
    expect(rallyWalkAt).toBeGreaterThanOrEqual(armedAt);
  });

  it('the combat pass marching him home does not outrun the arming: no bare rally walk on a live map', () => {
    // The real-game shape this holds: every spawned settler is a combatant (Health), and a rival seat
    // somewhere on the map keeps the combat dormancy gate awake, so the combat pass runs every tick.
    // A DEFEND guard off its anchor is sent home by that pass - and without the walk-back's arming
    // deferral the fresh bare soldier would march to the flag before the arming beat ever dispatched
    // his fetch, then hold the errand off for the whole walk (`isTravelling`).
    const sim = new Simulation({ seed: 1, content: barracksContent(), map: grassMap(40, 20) });
    const house = barracksAt(sim, 6, 3);
    const store = larderAt(sim, 2, 10);
    sim.world.mut(store, Stockpile).amounts.set(SWORD_GOOD, 3);
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 4, y: 12 });
    sim.step();
    const flag = sim.world.get(house, RallyPoint).flag;
    const rallyNode = entityNode(sim.world, terrainOf(sim), flag);
    sim.world.add(sim.world.create(), AssistantCounters, {
      player: HUMAN_PLAYER,
      counters: { ...defaultAssistantCounters(), trainSword: { value: 1, infinite: false } },
    });
    // A hostile seat's settler beyond the DEFEND search radius of the flag, so nothing is fought and
    // every combat pass only offers the walk home.
    const rival = settlerAt(sim, CIVILIST_JOB, 36, 2);
    sim.world.mut(rival, Owner).player = OTHER_PLAYER;
    sim.world.add(rival, Health, { hitpoints: 100, max: 100 });

    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);
    sim.world.add(recruit, Health, { hitpoints: 100, max: 100 });
    sim.world.add(recruit, AssistantRecruit, { intent: 'trainSword', armed: false, barracks: house });
    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });

    let bareRallyWalkAt = -1;
    let fetchAt = -1;
    let armedAt = -1;
    let rallyWalkAt = -1;
    for (let i = 0; i < RUN_TICKS + 6 * WALK_TICKS && (armedAt < 0 || rallyWalkAt < 0); i++) {
      sim.step();
      const goal = sim.world.tryGet(recruit, MoveGoal)?.cell;
      const bare = (sim.world.tryGet(recruit, Equipment)?.weapon ?? null) === null;
      if (goal === rallyNode && bare && bareRallyWalkAt < 0) bareRallyWalkAt = i;
      if (fetchAt < 0 && sim.world.has(recruit, EquipOrder)) fetchAt = i;
      if ((sim.world.tryGet(recruit, Equipment)?.weapon ?? null) !== null && armedAt < 0) armedAt = i;
      if (goal === rallyNode && !bare && rallyWalkAt < 0) rallyWalkAt = i;
    }

    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    expect(sim.world.get(recruit, Stance).anchorCell).toBe(rallyNode);
    // Not one bare step toward the flag, though the combat pass ran the whole way: the walk-back holds
    // while the weapon is owed.
    expect(bareRallyWalkAt).toBe(-1);
    // The fetch owns his feet first, and only the armed landing starts the march to the post.
    expect(fetchAt).toBeGreaterThanOrEqual(0);
    expect(armedAt).toBeGreaterThan(fetchAt);
    expect(rallyWalkAt).toBeGreaterThanOrEqual(0);
    expect(rallyWalkAt).toBeGreaterThanOrEqual(armedAt);
  });

  it("an armed recruit the pass releases with no armor to fetch walks his barracks' post", () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 4, y: 12 });
    sim.step();
    const flag = sim.world.get(house, RallyPoint).flag;
    const rallyNode = entityNode(sim.world, terrainOf(sim), flag);
    sim.world.add(sim.world.create(), AssistantCounters, {
      player: HUMAN_PLAYER,
      counters: { ...defaultAssistantCounters(), trainSword: { value: 1, infinite: false } },
    });

    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);
    // Armed on the way out (or dressed by hand), armor leg still owed: the booking holds his feet.
    sim.world.add(recruit, Equipment, {
      boots: null,
      tool: null,
      weapon: { goodType: PRESET_WEAPON_GOOD, degreeOfUse: fx.fromInt(0) },
      armor: null,
      misc: [],
    });
    sim.world.add(recruit, AssistantRecruit, { intent: 'trainSword', armed: true, barracks: house });
    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });

    let releasedAt = -1;
    for (let i = 0; i < RUN_TICKS + 2 * WALK_TICKS && releasedAt < 0; i++) {
      sim.step();
      if (!sim.world.has(recruit, AssistantRecruit)) releasedAt = i;
    }

    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    // No armor anywhere, so the pass releases him - and the walk the booking held back starts now.
    expect(releasedAt).toBeGreaterThanOrEqual(0);
    expect(sim.world.has(recruit, AssistantRecruit)).toBe(false);
    expect(sim.world.tryGet(recruit, MoveGoal)?.cell).toBe(rallyNode);
  });

  it('takes the rally flag down with a barracks that is razed', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 4, y: 12 });
    sim.step();
    const flag = sim.world.get(house, RallyPoint).flag;
    removeBuildingSilently(sim.world, ctxOf(sim), house);
    expect(sim.world.isAlive(flag)).toBe(false);
  });

  it('refuses a rally point on a barracks foundation', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    sim.world.add(house, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.mut(house, Building).built = fx.fromInt(0);
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 4, y: 12 });
    sim.step();
    expect(sim.world.has(house, RallyPoint)).toBe(false);
  });

  it('a Shift-queued drill waits for the walk ahead, and the next walk waits for the drill', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);
    sim.enqueueSetup({ kind: 'moveUnit', entity: recruit, x: 2, y: 12 });
    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house, queued: true });
    sim.enqueueSetup({ kind: 'moveUnit', entity: recruit, x: 2, y: 2, queued: true });
    sim.step();
    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
    expect(sim.world.get(recruit, OrderQueue).orders).toHaveLength(2);

    for (let i = 0; i < WALK_TICKS && !sim.world.has(recruit, TrainingOrder); i++) sim.step();
    expect(nodeOfPosition(sim.world.get(recruit, Position).x, sim.world.get(recruit, Position).y)).toEqual({
      hx: 2,
      hy: 12,
    });
    for (let i = 0; i < 2 * RUN_TICKS && sim.world.has(recruit, TrainingOrder); i++) {
      sim.step();
      expect(sim.world.has(recruit, PlayerOrder)).toBe(false);
    }
    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    for (let i = 0; i < WALK_TICKS && !sim.world.has(recruit, PlayerOrder); i++) sim.step();
    expect(sim.world.has(recruit, PlayerOrder)).toBe(true);
  });

  it('a Shift-queued walk starts when the finished drill ends, the flag staying his post', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 4, y: 12 });
    sim.step();
    const flag = sim.world.get(house, RallyPoint).flag;
    const rallyNode = entityNode(sim.world, terrainOf(sim), flag);
    const flagAt = sim.world.get(flag, Position);
    const planted = nodeOfPosition(flagAt.x, flagAt.y);
    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);
    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.enqueueSetup({ kind: 'moveUnit', entity: recruit, x: 2, y: 2, queued: true });
    sim.step();
    expect(sim.world.get(recruit, OrderQueue).orders).toHaveLength(1); // queued behind the drill

    for (let i = 0; i < 2 * RUN_TICKS && sim.world.has(recruit, TrainingOrder); i++) sim.step();
    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    // The flag takes the fresh soldier as its guard anchor even so.
    expect(sim.world.get(recruit, Stance).anchorCell).toBe(rallyNode);
    // A bare recruit starts no rally walk, so the queue starts at once: the player's walk takes the road
    // first, and the flag holds him from the arming outing or the walk-back on.
    for (let i = 0; i < WALK_TICKS && !sim.world.has(recruit, PlayerOrder); i++) sim.step();
    expect(sim.world.has(recruit, PlayerOrder)).toBe(true);
    // And it ends at the queued destination, not at the flag.
    for (let i = 0; i < 2 * WALK_TICKS && sim.world.has(recruit, PlayerOrder); i++) sim.step();
    const at = nodeOfPosition(sim.world.get(recruit, Position).x, sim.world.get(recruit, Position).y);
    expect(hexDistanceBetween(at.hx, at.hy, 2, 2)).toBeLessThanOrEqual(1);
    expect(hexDistanceBetween(at.hx, at.hy, planted.hx, planted.hy)).toBeGreaterThan(2);
  });

  it('spreads recruits leaving one barracks door onto their own nodes, each anchored where it stands', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    const recruits = [3, 4, 5].map((y) => settlerAt(sim, CIVILIST_JOB, 2, y));
    for (const recruit of recruits) sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, RUN_TICKS + WALK_TICKS);

    const terrain = terrainOf(sim);
    const nodes = recruits.map((recruit) => {
      expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
      expect(sim.world.get(recruit, Stance).mode).toBe(MILITARY_MODE.DEFEND);
      expect(sim.world.has(recruit, MoveGoal)).toBe(false); // settled, not still shuffling
      const at = sim.world.get(recruit, Position);
      const n = nodeOfPosition(at.x, at.y);
      const node = terrain.nodeAtClamped(n.hx, n.hy);
      expect(sim.world.get(recruit, Stance).anchorCell).toBe(node); // so the combat walk-back keeps it there
      return node;
    });
    expect(new Set(nodes).size).toBe(recruits.length);
  });

  it('spreads booked recruits waiting at the door for a weapon, the rally flag staying their post', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    sim.enqueueSetup({ kind: 'setRallyPoint', building: house, x: 4, y: 12 });
    sim.step();
    const rallyNode = entityNode(sim.world, terrainOf(sim), sim.world.get(house, RallyPoint).flag);
    // Counter cover, so the assistant's release pass keeps the bookings; no sword anywhere to fetch.
    sim.world.add(sim.world.create(), AssistantCounters, {
      player: HUMAN_PLAYER,
      counters: { ...defaultAssistantCounters(), trainSword: { value: 3, infinite: false } },
    });
    const recruits = [3, 4, 5].map((y) => settlerAt(sim, CIVILIST_JOB, 2, y));
    for (const recruit of recruits) {
      sim.world.add(recruit, AssistantRecruit, { intent: 'trainSword', armed: false, barracks: house });
      sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    }
    run(sim, RUN_TICKS + WALK_TICKS);

    const terrain = terrainOf(sim);
    const nodes = recruits.map((recruit) => {
      expect(sim.world.get(recruit, AssistantRecruit).armed).toBe(false);
      expect(sim.world.get(recruit, Stance).anchorCell).toBe(rallyNode);
      const at = sim.world.get(recruit, Position);
      const n = nodeOfPosition(at.x, at.y);
      return terrain.nodeAtClamped(n.hx, n.hy);
    });
    // Stacked on the door node they would draw as one figure, the others hidden beneath it.
    expect(new Set(nodes).size).toBe(recruits.length);
    expect(nodes).not.toContain(rallyNode);
  });

  it('waits beside a barracks foundation and drills once it stands', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    sim.world.add(house, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.mut(house, Building).built = fx.fromInt(0);
    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, RUN_TICKS);
    expect(sim.world.has(recruit, TrainingOrder)).toBe(true);
    expect(sim.world.has(recruit, Resting)).toBe(false); // outside, not drilling
    expect(sim.world.get(recruit, TrainingOrder).drillTicksLeft).toBe(BARRACKS_DRILL_TICKS);
    const door = interactionCell(sim.world, ctxOf(sim), terrainOf(sim), house);
    const at = sim.world.get(recruit, Position);
    const here = nodeOfPosition(at.x, at.y);
    const doorNode = terrainOf(sim).coordsOf(door);
    const fromDoor = hexDistanceBetween(here.hx, here.hy, doorNode.x, doorNode.y);
    expect(fromDoor).toBeGreaterThan(0); // the door node stays free
    expect(fromDoor).toBeLessThanOrEqual(DOOR_YARD_RADIUS_NODES);
    expect(sim.world.get(recruit, IdleStand).standing).toBe(false); // re-checks only on its idle beat

    sim.world.remove(house, UnderConstruction);
    sim.world.mut(house, Building).built = ONE;
    const events = run(sim, RUN_TICKS);
    expect(jobOf(sim, recruit)).toBe(SOLDIER_JOB);
    expect(events.some((event) => event.kind === 'settlerTrained')).toBe(true);
  });

  it('carries the material a barracks foundation still needs while it waits', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    sim.world.add(house, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.mut(house, Building).built = fx.fromInt(0);
    sim.world.add(house, Stockpile, { amounts: new Map() });
    const store = woodStoreAt(sim, 2, 5, BARRACKS_WOOD + 1);
    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, SUPPLY_TICKS);
    expect(sim.world.get(house, Stockpile).amounts.get(WOOD_GOOD)).toBe(BARRACKS_WOOD);
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD_GOOD)).toBe(1); // only the bill is lifted
    expect(sim.world.get(recruit, TrainingOrder).drillTicksLeft).toBe(BARRACKS_DRILL_TICKS);
  });

  it('drops the errand when the barracks foundation lies across water', () => {
    const sim = new Simulation({ seed: 1, content: barracksContent(), map: waterColumnMap(12, 8, 5) });
    const house = barracksAt(sim, 8, 3);
    sim.world.add(house, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.mut(house, Building).built = fx.fromInt(0);
    const recruit = settlerAt(sim, CIVILIST_JOB, 2, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    run(sim, RUN_TICKS);
    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
    expect(sim.world.has(recruit, MoveGoal)).toBe(false);
  });

  it('leaves a serving soldier in the trade he already holds', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 6, 3);
    const veteran = settlerAt(sim, SOLDIER_JOB, 2, 3);

    sim.enqueueSetup({ kind: 'trainSoldier', entity: veteran, house });
    const events = run(sim, RUN_TICKS);

    expect(jobOf(sim, veteran)).toBe(SOLDIER_JOB);
    expect(sim.world.has(veteran, TrainingOrder)).toBe(false);
    expect(events.some((event) => event.kind === 'settlerTrained')).toBe(false);
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
    expect(sim.world.get(recruit, SettlerProgress).experience.size).toBe(0);
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
    setNeeds(sim, recruit, { hunger: STARVING });

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

  it('interrupts an autonomous route for an available shelter without dropping the active walk', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const worker = settlerAt(sim, CARRIER_JOB, 2, 3);
    const errand = terrainOf(sim).nodeAt(16, 6);
    sim.world.add(worker, MoveGoal, { cell: errand });
    sim.step();
    expect(sim.world.get(worker, MoveGoal).cell).toBe(errand);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: house, enabled: true });
    sim.step();

    expect(sim.world.get(worker, Sheltering).shelter).toBe(house);
    expect(sim.world.get(worker, MoveGoal).cell).not.toBe(errand);
  });

  it('centres a mid-leg walker at the shelter door before marking it inside', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const worker = settlerAt(sim, CARRIER_JOB, 2, 3);
    sim.world.mut(worker, Position).x = fx.fromFloat(2.9);
    sim.world.add(worker, MoveGoal, { cell: terrainOf(sim).nodeAt(16, 6) });
    sim.enqueueSetup({ kind: 'setDefenceMode', building: house, enabled: true });

    sim.step();

    expect(sim.world.get(worker, Sheltering).shelter).toBe(house);
    expect(sim.world.has(worker, Resting)).toBe(false);
    expect(sim.world.get(worker, Position).x).not.toBe(fx.fromInt(3));
  });

  it('keeps a fleeing route when the alarm shelter has no free seat', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const occupant = settlerAt(sim, CIVILIST_JOB, 3, 3);
    const runner = settlerAt(sim, CARRIER_JOB, 2, 3);
    const away = terrainOf(sim).nodeAt(16, 6);
    sim.world.add(occupant, Sheltering, { shelter: house });
    sim.world.add(runner, MoveGoal, { cell: away });
    sim.world.add(runner, Fleeing, {});
    sim.enqueueSetup({ kind: 'setDefenceMode', building: house, enabled: true });
    sim.step();

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(runner, Sheltering)).toBe(false);
    expect(sim.world.get(runner, MoveGoal).cell).toBe(away);
  });

  it('calls the drill off when a script fixes the recruit trade mid-term', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3); // at the door - it drills from tick one

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    expect(sim.world.has(recruit, TrainingOrder)).toBe(true);

    setMissionBehaviour(sim.world, recruit, MISSION_BEHAVIOUR.JOB_LOCKED, true);
    const events = run(sim, RUN_TICKS);

    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
    expect(jobOf(sim, recruit)).toBe(CIVILIST_JOB);
    expect(events.some((event) => event.kind === 'settlerTrained')).toBe(false);
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

  it('abandons the errand when a script hands the barracks to another player mid-term', () => {
    const sim = simWithBarracks();
    const house = barracksAt(sim, 3, 3);
    const recruit = settlerAt(sim, CIVILIST_JOB, 3, 3); // at the door - it drills from tick one

    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house });
    sim.step();
    expect(sim.world.has(recruit, TrainingOrder)).toBe(true);

    stampOwner(sim.world, house, OTHER_PLAYER);
    const events = run(sim, RUN_TICKS);

    expect(sim.world.has(recruit, TrainingOrder)).toBe(false);
    expect(sim.world.has(recruit, Resting)).toBe(false);
    expect(jobOf(sim, recruit)).toBe(CIVILIST_JOB);
    expect(events.some((event) => event.kind === 'settlerTrained')).toBe(false);
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

  it("refuses a woman and a target that is not a training house, but drills at another tribe's barracks", () => {
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
    expect(sim.world.get(stranger, TrainingOrder).house).toBe(foreignHouse);
  });
});
