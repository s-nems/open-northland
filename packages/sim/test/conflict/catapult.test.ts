import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  diplomacyStance,
  Health,
  Owner,
  Palisade,
  Position,
  Projectile,
  Resting,
  Settler,
  SettlerProgress,
  Stance,
  seatPassenger,
  setDiplomacyStance,
  UnreachableTargets,
  Vehicle,
  VehicleDrive,
  wasAttackedBy,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  halfCellMapFromCells,
  ONE,
  parseSaveGame,
  playerCommand,
  positionOfNode,
  restoreSimulation,
  type SimEvent,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../src/index.js';
import { resolveGroundImpact } from '../../src/systems/conflict/ground-impact.js';
import { isFleeThreat } from '../../src/systems/conflict/targeting.js';
import { UNREACHABLE_TARGET_MEMO_SIZE } from '../../src/systems/conflict/unreachable-targets.js';
import { vehiclesGone } from '../../src/systems/missions/goals/casualties.js';
import { REGENERATION_HITPOINTS_PER_TICK } from '../../src/systems/lifecycle/needs/index.js';
import { FIGHT_EXPERIENCE_TYPE } from '../../src/systems/progression/index.js';
import { ARMOR_MATERIAL, MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

// The catapult's fight (docs/formats/VEHICLES.md "Catapult"): the stance scans, the band's back-off
// and approach, the scatter roll, the ground burst on whatever stands on the landing node (the owner's
// own men included), wall demolition through the wall's own valency rule, and vehicles as targets of
// every other weapon.

const VIKING = 1;
const SOLDIER = 31; // `soldier_unarmed`: a fighter trade, so it may crew the catapult
const ARCHER = 40;
const CATAPULT_JOB = 54;
const P1 = 1;
const P2 = 2;
const P3 = 3;
const GRASS = 0;
const WATER = 1;
const HANDCART = 1;
const CATAPULT = 5;
const HOME = 3;
const WALL_TYPE = 1;
const WALL_HITPOINTS = 100;
/** The extracted catapult row (`weapons.ini` type 21). */
const CATAPULT_WEAPON = 21;
const CATAPULT_MAIN_TYPE = 7;
const CATAPULT_MIN_RANGE = 8;
const CATAPULT_MAX_RANGE = 24;
const CATAPULT_VS_BARE = 8000;
const CATAPULT_VS_VEHICLE = 350;
const CATAPULT_VS_HOUSE = 3625;
/** The catapult's attack clip (`atomicanimations.ini` `viking_catapult_attack`: `length 48`, `event 1 25`). */
const VEHICLE_ATTACK_CLIP_TICKS = 48;
const VEHICLE_ATTACK_EVENT_TICK = 1;
const ATTACK_ATOMIC = 81;
const ATOMIC_EVENT_ATTACK = 25;
/** Every armor material a weapon row lists damage for. */
const ALL_MATERIALS = Object.values(ARMOR_MATERIAL);
/** The row's `createsmoke 1` / `smokelifetime 20`. */
const CATAPULT_SMOKE_TICKS = 20;
/** 16 map points at `speed 3`: `16 * 8 / 3` ticks of flight. */
const SIXTEEN_POINT_FLIGHT_TICKS = 42;
/** `damage[7] / 100`: the valency one stone knocks off a wall. */
const WALL_STEPS_PER_STONE = 36;
const BOW_VS_VEHICLE = 40;
const MACE_VS_VEHICLE = 40;
/** A commander this practised never scatters: the roll (0..99) can never exceed `skill + 10`. */
const MASTER_SKILL = 100;
/** Enough ticks for a stone to be loosed and land from anywhere in the band. */
const SHOT_TICKS = 120;
/** A house no run of stones brings down, so a long shot series keeps its mark. */
const TOUGH_HOUSE = 1_000_000;

function siegeContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: SOLDIER, id: 'soldier_unarmed' },
      { typeId: ARCHER, id: 'soldier_bow_short' },
      { typeId: CATAPULT_JOB, id: 'vehicle_catapult' },
    ],
    buildings: [{ typeId: HOME, id: 'home', kind: 'home', hitpoints: 10_000 }],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
    ],
    vehicles: [
      {
        typeId: HANDCART,
        id: 'handcart',
        jobId: 50,
        stockSlots: 15,
        logicSize: 0,
        passengerJobs: [SOLDIER],
        hitpoints: 100,
      },
      {
        typeId: CATAPULT,
        id: 'catapult',
        jobId: CATAPULT_JOB,
        stockSlots: 0,
        logicSize: 1,
        passengerJobs: [SOLDIER],
        hitpoints: 3000,
      },
    ],
    weapons: [
      {
        typeId: 7,
        id: 'mace',
        tribeType: VIKING,
        jobType: SOLDIER,
        mainType: 3,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 40, '6': MACE_VS_VEHICLE, '7': 25 },
      },
      {
        typeId: CATAPULT_WEAPON,
        id: 'catapult',
        tribeType: VIKING,
        jobType: CATAPULT_JOB,
        mainType: CATAPULT_MAIN_TYPE,
        munitionType: 2,
        speed: 3,
        damageType: 2,
        minRange: CATAPULT_MIN_RANGE,
        maxRange: CATAPULT_MAX_RANGE,
        damage: { '0': CATAPULT_VS_BARE, '6': CATAPULT_VS_VEHICLE, '7': CATAPULT_VS_HOUSE },
        hitSounds: { '0': 90, '6': 90, '7': 90 },
        impactSmokeTicks: CATAPULT_SMOKE_TICKS,
      },
      {
        typeId: 16,
        id: 'short_bow',
        tribeType: VIKING,
        jobType: ARCHER,
        mainType: 6,
        munitionType: 1,
        speed: 8,
        minRange: 3,
        maxRange: 15,
        damage: { '0': 500, '6': BOW_VS_VEHICLE, '7': 100 },
      },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [
          { jobType: SOLDIER, atomicId: ATTACK_ATOMIC, animation: 'viking_attack' },
          { jobType: ARCHER, atomicId: ATTACK_ATOMIC, animation: 'viking_attack' },
          { jobType: CATAPULT_JOB, atomicId: ATTACK_ATOMIC, animation: 'viking_catapult_attack' },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'viking_attack', name: 'viking_attack', length: 4 },
      {
        id: 'viking_catapult_attack',
        name: 'viking_catapult_attack',
        length: VEHICLE_ATTACK_CLIP_TICKS,
        events: [{ at: VEHICLE_ATTACK_EVENT_TICK, type: ATOMIC_EVENT_ATTACK }],
      },
    ],
  });
}

/** A grass map; `walls` adds the one-node wall row a `placePalisade` stands up. */
function grass(width: number, height: number, walls = false): TerrainMap {
  const map = halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
  if (!walls) return map;
  const wall = { maxHitpoints: WALL_HITPOINTS, repairPerStrike: 1, construction: [] };
  return {
    ...map,
    landscapes: {
      types: [{ typeId: WALL_TYPE, walk: [{ dx: 0, dy: 0 }], build: [], groups: [], wall }],
      placements: [],
    },
  };
}

/** Grass with a water strait over the cell columns `[from, to)`. */
function strait(width: number, height: number, from: number, to: number): TerrainMap {
  const typeIds = Array.from({ length: width * height }, (_, i) =>
    i % width >= from && i % width < to ? WATER : GRASS,
  );
  return halfCellMapFromCells({ width, height, typeIds });
}

function sim(map: TerrainMap, seed = 1): Simulation {
  return new Simulation({ seed, content: siegeContent(), map });
}

/** A fighter standing on node (hx, hy), in the ATTACK stance like a fresh soldier. */
function fighterAt(s: Simulation, hx: number, hy: number, owner: number, jobType = SOLDIER): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(hx, hy));
  addPerson(s.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  s.world.add(e, Health, { hitpoints: 100_000, max: 100_000 });
  s.world.add(e, Owner, { player: owner });
  s.world.add(e, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
  return e;
}

function houseAt(s: Simulation, hx: number, hy: number, owner: number, hitpoints = 10_000): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(hx, hy));
  s.world.add(e, Building, { buildingType: HOME, tribe: VIKING, built: ONE, level: 0 });
  s.world.add(e, Health, { hitpoints, max: hitpoints });
  s.world.add(e, Owner, { player: owner });
  return e;
}

/** A crewed catapult at node (hx, hy): its commander is seated and aboard before tick zero, with the
 *  given catapult experience. */
function catapultAt(s: Simulation, hx: number, hy: number, owner: number, skill = MASTER_SKILL): Entity {
  const e = createVehicle(s.world, ctxOf(s), { vehicleType: CATAPULT, x: hx, y: hy, tribe: VIKING, owner });
  if (e === null) throw new Error('catapult type missing');
  const commander = fighterAt(s, hx - 3, hy, owner);
  s.world.mut(commander, Stance).mode = MILITARY_MODE.IGNORE;
  if (skill > 0)
    s.world.mut(commander, SettlerProgress).experience.set(FIGHT_EXPERIENCE_TYPE.CATAPULT, skill);
  expect(seatPassenger(s.world, e, commander)).toBe(true);
  boardRider(s.world, commander, e);
  return e;
}

function collect(
  s: Simulation,
  ticks: number,
  kinds: readonly SimEvent['kind'][],
  afterTick?: () => void,
): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    for (const ev of s.events.current()) if (kinds.includes(ev.kind)) out.push(ev);
    afterTick?.();
  }
  return out;
}

function order(s: Simulation, vehicle: Entity, owner: number, target: Entity): void {
  s.enqueue(
    playerCommand(owner, { kind: 'attackWithVehicle', vehicle, target: { kind: 'entity', entity: target } }),
  );
}

describe('catapult stances and scans', () => {
  it('holding, fires at an enemy house inside its band and never at one beyond it', () => {
    const s = sim(grass(40, 10));
    const catapult = catapultAt(s, 6, 8, P1);
    const near = houseAt(s, 22, 8, P2, TOUGH_HOUSE); // 16 nodes east: inside 8..24
    houseAt(s, 60, 8, P2); // 54 nodes: beyond the band
    const hits = collect(s, SHOT_TICKS, ['projectileHit']);
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((ev) => (ev.kind === 'projectileHit' ? ev.target : -1)))).toEqual(
      new Set([near]),
    );
    // Every stone lands at least the column; the commander's growing experience raises it further.
    expect(TOUGH_HOUSE - s.world.get(near, Health).hitpoints).toBeGreaterThanOrEqual(
      hits.length * CATAPULT_VS_HOUSE,
    );
    expect(s.world.get(catapult, Vehicle).task).toBe('attacks');
    expect(s.world.has(catapult, VehicleDrive)).toBe(false);
  });

  it('holding, ignores a house too close for the band and stays put', () => {
    const s = sim(grass(20, 10));
    const catapult = catapultAt(s, 6, 8, P1);
    houseAt(s, 10, 8, P2); // 4 nodes: under the near reach
    const hits = collect(s, SHOT_TICKS, ['projectileHit', 'projectileLaunched']);
    expect(hits).toEqual([]);
    expect(s.world.get(catapult, Vehicle).attack).toBeNull();
    expect(s.world.has(catapult, VehicleDrive)).toBe(false);
  });

  it('in the attack stance, backs off from a house that stands inside the near reach and then fires', () => {
    const s = sim(grass(30, 12));
    const catapult = catapultAt(s, 8, 8, P1);
    const house = houseAt(s, 12, 8, P2); // 4 nodes: the catapult must open the distance
    s.enqueue(playerCommand(P1, { kind: 'setVehicleStance', vehicle: catapult, stance: 'attack' }));
    s.run(3);
    expect(s.world.has(catapult, VehicleDrive)).toBe(true);
    const hits = collect(s, 400, ['projectileHit']);
    expect(hits.some((ev) => ev.kind === 'projectileHit' && ev.target === house)).toBe(true);
  });

  it('fires the shot at the clip event tick and repeats on the clip cadence', () => {
    const s = sim(grass(40, 10));
    catapultAt(s, 6, 8, P1);
    houseAt(s, 22, 8, P2, TOUGH_HOUSE);
    const launchTicks: number[] = [];
    for (let i = 0; i < 3 * VEHICLE_ATTACK_CLIP_TICKS + 10; i++) {
      s.step();
      for (const ev of s.events.current()) if (ev.kind === 'projectileLaunched') launchTicks.push(s.tick);
    }
    expect(launchTicks.length).toBeGreaterThanOrEqual(3);
    // The scan acquires on tick 1 and the clip starts there; its event tick is one later.
    expect(launchTicks[0]).toBe(1 + VEHICLE_ATTACK_EVENT_TICK);
    expect((launchTicks[1] ?? 0) - (launchTicks[0] ?? 0)).toBe(VEHICLE_ATTACK_CLIP_TICKS);
  });
});

describe('the clip and its target', () => {
  it('lets a clip end unfired when its mark leaves the map before the event tick', () => {
    const s = sim(grass(40, 10));
    const catapult = catapultAt(s, 6, 8, P1);
    const mark = fighterAt(s, 22, 8, P2);
    s.world.mut(mark, Stance).mode = MILITARY_MODE.IGNORE;
    s.run(1); // the scan acquires the mark and the clip starts
    expect(s.world.get(catapult, Vehicle).attack?.clipStart).toBe(1);
    s.world.destroy(mark);
    const launches = collect(s, 3, ['projectileLaunched']);
    expect(launches).toEqual([]);
    expect(s.world.get(catapult, Vehicle).attack).toBeNull();
    expect(s.world.get(catapult, Vehicle).task).toBe('none');
  });

  it('a goto supersedes the attack, and a crew stepping out lets the target go', () => {
    const s = sim(grass(40, 10));
    const catapult = catapultAt(s, 6, 8, P1);
    houseAt(s, 22, 8, P2, TOUGH_HOUSE);
    s.run(1);
    expect(s.world.get(catapult, Vehicle).attack).not.toBeNull();
    s.enqueue(playerCommand(P1, { kind: 'moveVehicle', vehicle: catapult, x: 6, y: 4 }));
    s.run(1);
    expect(s.world.get(catapult, Vehicle).attack).toBeNull();
    s.enqueue(playerCommand(P1, { kind: 'stopVehicle', vehicle: catapult }));
    s.run(40);
    expect(s.world.get(catapult, Vehicle).attack).not.toBeNull(); // re-acquired once idle
    s.enqueue(playerCommand(P1, { kind: 'unloadPeople', vehicle: catapult }));
    s.run(2);
    expect(s.world.get(catapult, Vehicle).attack).toBeNull();
  });

  it('holds an attack ordered while the commander still walks to the door, and fires once it is in', () => {
    const s = sim(grass(40, 10));
    const catapult = createVehicle(s.world, ctxOf(s), {
      vehicleType: CATAPULT,
      x: 6,
      y: 8,
      tribe: VIKING,
      owner: P1,
    });
    if (catapult === null) throw new Error('catapult');
    const commander = fighterAt(s, 2, 8, P1);
    s.world.mut(commander, Stance).mode = MILITARY_MODE.IGNORE;
    s.world.mut(commander, SettlerProgress).experience.set(FIGHT_EXPERIENCE_TYPE.CATAPULT, MASTER_SKILL);
    s.enqueue(playerCommand(P1, { kind: 'attachToVehicle', entity: commander, vehicle: catapult }));
    s.run(1);
    const house = houseAt(s, 22, 8, P2, TOUGH_HOUSE);
    order(s, catapult, P1, house);
    s.run(1);
    // Seated but outside: the order waits on the boarding instead of being dropped by the combat pass.
    expect(s.world.get(catapult, Vehicle).task).toBe('waitsForHuman');
    expect(s.world.get(catapult, Vehicle).attack).toMatchObject({
      ordered: true,
      target: { kind: 'entity', entity: house },
    });
    const launches = collect(s, SHOT_TICKS * 2, ['projectileLaunched']);
    expect(launches.length).toBeGreaterThan(0);
    expect(s.world.get(catapult, Vehicle).attack).toMatchObject({ ordered: true });
  });

  it('refuses an attack order on an uncommanded catapult with the no-commander note', () => {
    const s = sim(grass(40, 10));
    const catapult = createVehicle(s.world, ctxOf(s), {
      vehicleType: CATAPULT,
      x: 6,
      y: 8,
      tribe: VIKING,
      owner: P1,
    });
    if (catapult === null) throw new Error('catapult');
    order(s, catapult, P1, houseAt(s, 22, 8, P2));
    const refused = collect(s, 1, ['vehicleMoveRefused']);
    expect(refused.map((ev) => (ev.kind === 'vehicleMoveRefused' ? ev.reason : ''))).toEqual(['noCommander']);
  });

  it('in the defence stance, chases within the leash and keeps its target while the drive runs', () => {
    const s = sim(grass(40, 12));
    const catapult = catapultAt(s, 8, 8, P1);
    const house = houseAt(s, 12, 8, P2, TOUGH_HOUSE); // inside the near reach: the defence backs off
    s.enqueue(playerCommand(P1, { kind: 'setVehicleStance', vehicle: catapult, stance: 'defence' }));
    s.run(3);
    expect(s.world.has(catapult, VehicleDrive)).toBe(true);
    // The drive's ticks keep the held target as it is: nothing rewrites the attack while it runs.
    const held = s.world.get(catapult, Vehicle).attack;
    s.run(8);
    expect(s.world.get(catapult, Vehicle).attack).toBe(held);
    const hits = collect(s, 400, ['projectileHit']);
    expect(hits.some((ev) => ev.kind === 'projectileHit' && ev.target === house)).toBe(true);
    expect(s.world.get(catapult, Vehicle).guard).toEqual({ hx: 8, hy: 8 });
  });

  it("strikes an enemy wall it is ordered at, as a soldier's ordered blow does", () => {
    const at = { hx: 22, hy: 8 };
    const s = sim(grass(40, 10, true));
    s.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL_TYPE,
      x: at.hx,
      y: at.hy,
      tribe: VIKING,
      owner: P2,
    });
    s.step();
    const [wall] = s.world.query(Palisade);
    if (wall === undefined) throw new Error('no wall stood up');
    const catapult = catapultAt(s, 6, 8, P1);
    order(s, catapult, P1, wall);
    s.step();
    expect(s.world.get(catapult, Vehicle).attack?.target).toEqual({ kind: 'entity', entity: wall });
    collect(s, VEHICLE_ATTACK_CLIP_TICKS, ['projectileHit']);
    expect(s.world.get(wall, Health).hitpoints).toBe(WALL_HITPOINTS - WALL_STEPS_PER_STONE);
  });

  it('survives a save round trip with a live attack, a worn wall and a stone in flight', () => {
    const wall = { hx: 22, hy: 8 };
    const run = (): Simulation => {
      const s = sim(grass(40, 10, true), 5);
      s.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL_TYPE,
        x: wall.hx,
        y: wall.hy,
        tribe: VIKING,
        owner: P2,
      });
      s.step();
      const catapult = catapultAt(s, 6, 8, P1, 0);
      s.enqueue(
        playerCommand(P1, {
          kind: 'attackWithVehicle',
          vehicle: catapult,
          target: { kind: 'ground', ...wall },
        }),
      );
      s.run(VEHICLE_ATTACK_CLIP_TICKS + 2); // one stone landed, the next just loosed
      return s;
    };
    const s = run();
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(s)))), {
      content: siegeContent(),
      map: grass(40, 10, true),
    });
    expect(restored.hashState()).toBe(s.hashState());
    s.run(100);
    restored.run(100);
    expect(restored.hashState()).toBe(s.hashState());
  });
});

describe('the attack-move march', () => {
  /** The march's goal, 58 nodes east: inside the walk range. */
  const GOAL = { hx: 62, hy: 8 };
  /** Within the scan from the start (34 nodes), beyond it from the goal (52): only a march fights it. */
  const ROADSIDE_HOUSE = { hx: 24, hy: 22 };
  /** Under one stone's structure damage, so the first hit razes it. */
  const FRAIL_HOUSE = 3000;
  const MARCH_TICKS = 4000;

  function march(s: Simulation, catapult: Entity, attackMove: boolean): void {
    s.enqueue(playerCommand(P1, { kind: 'moveVehicle', vehicle: catapult, ...toXY(GOAL), attackMove }));
  }
  const toXY = (node: { hx: number; hy: number }) => ({ x: node.hx, y: node.hy });

  /** Step until the catapult stands on `goal` with nothing left to do, or the budget runs out. */
  function runToGoal(s: Simulation, catapult: Entity, goal: { hx: number; hy: number }): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = 0; i < MARCH_TICKS; i++) {
      s.step();
      events.push(...s.events.current());
      const state = s.world.get(catapult, Vehicle);
      const at = positionOfNode(goal.hx, goal.hy);
      const pos = s.world.get(catapult, Position);
      if (state.march === null && !s.world.has(catapult, VehicleDrive) && pos.x === at.x && pos.y === at.y)
        break;
    }
    return events;
  }

  it('stops to raze an enemy house it passes, then drives on and ends at the goal', () => {
    const s = sim(grass(40, 12));
    const catapult = catapultAt(s, 4, 8, P1); // holding: the march fights in the attack stance anyway
    const house = houseAt(s, ROADSIDE_HOUSE.hx, ROADSIDE_HOUSE.hy, P2, FRAIL_HOUSE);
    march(s, catapult, true);
    s.run(1);
    expect(s.world.get(catapult, Vehicle).march?.goal).toEqual(GOAL);
    const events = runToGoal(s, catapult, GOAL);
    expect(events.some((ev) => ev.kind === 'projectileHit' && ev.target === house)).toBe(true);
    const state = s.world.get(catapult, Vehicle);
    expect(state.march).toBeNull();
    expect(state.attack).toBeNull();
    expect(s.world.get(catapult, Position)).toEqual(positionOfNode(GOAL.hx, GOAL.hy));
  });

  it('a plain goto drives past the same house without a shot', () => {
    const s = sim(grass(40, 12));
    const catapult = catapultAt(s, 4, 8, P1);
    s.enqueue(playerCommand(P1, { kind: 'setVehicleStance', vehicle: catapult, stance: 'attack' }));
    houseAt(s, ROADSIDE_HOUSE.hx, ROADSIDE_HOUSE.hy, P2, FRAIL_HOUSE);
    march(s, catapult, false);
    s.run(1);
    expect(s.world.get(catapult, Vehicle).march).toBeNull();
    const events = runToGoal(s, catapult, GOAL);
    expect(s.world.get(catapult, Position)).toEqual(positionOfNode(GOAL.hx, GOAL.hy));
    expect(events.filter((ev) => ev.kind === 'projectileLaunched')).toEqual([]);
  });

  it('rests its scan past a bank lined with more unreachable enemies than the memo holds', () => {
    const s = sim(strait(40, 12, 16, 32));
    const goal = { hx: 30, hy: 8 };
    const catapult = catapultAt(s, 4, 8, P1);
    // More houses than the memo holds, all inside the scan of the march's last stretch.
    const bank = UNREACHABLE_TARGET_MEMO_SIZE + 4;
    for (let i = 0; i < bank; i++) houseAt(s, 64 + (i % 3), 5 + 2 * Math.floor(i / 3), P2, TOUGH_HOUSE);
    s.enqueue(playerCommand(P1, { kind: 'moveVehicle', vehicle: catapult, ...toXY(goal), attackMove: true }));
    runToGoal(s, catapult, goal);
    expect(s.world.get(catapult, Position)).toEqual(positionOfNode(goal.hx, goal.hy));
    expect(s.world.get(catapult, Vehicle).march).toBeNull();
  });

  it('gives up an enemy across water it cannot close on and marches on', () => {
    // Cells 16..31 are water: no node of the west bank lies within the far reach of the house.
    const s = sim(strait(40, 12, 16, 32));
    const goal = { hx: 30, hy: 8 };
    const catapult = catapultAt(s, 4, 8, P1);
    const house = houseAt(s, 66, 8, P2, TOUGH_HOUSE);
    s.enqueue(playerCommand(P1, { kind: 'moveVehicle', vehicle: catapult, ...toXY(goal), attackMove: true }));
    const events = runToGoal(s, catapult, goal);
    expect(s.world.get(catapult, Position)).toEqual(positionOfNode(goal.hx, goal.hy));
    expect(s.world.get(catapult, UnreachableTargets)?.entries.map((entry) => entry.target)).toEqual([house]);
    expect(events.filter((ev) => ev.kind === 'projectileLaunched')).toEqual([]);
  });

  it('an ordered attack or a stop ends the march', () => {
    const s = sim(grass(40, 12));
    const catapult = catapultAt(s, 4, 8, P1);
    const house = houseAt(s, ROADSIDE_HOUSE.hx, ROADSIDE_HOUSE.hy, P2, TOUGH_HOUSE);
    march(s, catapult, true);
    s.run(1);
    order(s, catapult, P1, house);
    s.run(1);
    expect(s.world.get(catapult, Vehicle).march).toBeNull();
    march(s, catapult, true);
    s.run(1);
    s.enqueue(playerCommand(P1, { kind: 'stopVehicle', vehicle: catapult }));
    s.run(1);
    expect(s.world.get(catapult, Vehicle).march).toBeNull();
    march(s, catapult, true);
    s.run(1);
    s.enqueue(playerCommand(P1, { kind: 'unloadPeople', vehicle: catapult }));
    s.run(1);
    expect(s.world.get(catapult, Vehicle).march).toBeNull();
  });

  it('a march whose crew steps out is over, and a new crew does not drive it off', () => {
    const s = sim(grass(40, 12));
    const catapult = catapultAt(s, 4, 8, P1);
    const commander = s.world.get(catapult, Vehicle).passengers.find((seat) => seat !== null)?.entity;
    if (commander === undefined) throw new Error('commander');
    march(s, catapult, true);
    s.run(1);
    s.enqueue(playerCommand(P1, { kind: 'detachFromVehicle', entity: commander }));
    s.run(2);
    expect(s.world.get(catapult, Vehicle).march).toBeNull();
  });

  it('ends a march with no route left where it stands, with the no-path note and a new guard', () => {
    const s = sim(strait(40, 12, 16, 32));
    const catapult = catapultAt(s, 4, 8, P1);
    s.enqueue(playerCommand(P1, { kind: 'moveVehicle', vehicle: catapult, x: 20, y: 8, attackMove: true }));
    s.run(1);
    // The goal moves across the strait under the drive, as if the way there had closed.
    const farShore = { hx: 70, hy: 8 };
    s.world.mut(catapult, Vehicle).march = { goal: farShore, restUntil: 0 };
    const refused = collect(s, MARCH_TICKS, ['vehicleMoveRefused']);
    const state = s.world.get(catapult, Vehicle);
    expect(state.march).toBeNull();
    expect(refused.map((ev) => (ev.kind === 'vehicleMoveRefused' ? ev.reason : ''))).toEqual(['noPath']);
    expect(s.world.get(catapult, Position)).toEqual(positionOfNode(20, 8));
    expect(state.guard).toEqual({ hx: 20, hy: 8 });
  });

  it('survives a save round trip mid-march', () => {
    const run = (): Simulation => {
      const s = sim(grass(40, 12), 3);
      const catapult = catapultAt(s, 4, 8, P1);
      houseAt(s, ROADSIDE_HOUSE.hx, ROADSIDE_HOUSE.hy, P2, FRAIL_HOUSE);
      march(s, catapult, true);
      s.run(60);
      return s;
    };
    const s = run();
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(s)))), {
      content: siegeContent(),
      map: grass(40, 12),
    });
    expect(restored.hashState()).toBe(s.hashState());
    s.run(600);
    restored.run(600);
    expect(restored.hashState()).toBe(s.hashState());
  });

  it('a commander on foot hands its attack-move to the vehicle as a march', () => {
    const s = sim(grass(40, 12));
    const catapult = catapultAt(s, 4, 8, P1);
    const commander = s.world.get(catapult, Vehicle).passengers.find((seat) => seat !== null)?.entity;
    if (commander === undefined) throw new Error('commander');
    s.enqueue(playerCommand(P1, { kind: 'attackMoveUnit', entity: commander, ...toXY(GOAL) }));
    s.run(1);
    expect(s.world.get(catapult, Vehicle).march?.goal).toEqual(GOAL);
  });
});

describe('the scatter roll', () => {
  it('lands every stone of an untrained commander within a quarter of the distance on each axis', () => {
    const s = sim(grass(40, 20), 7);
    const catapult = catapultAt(s, 8, 10, P1, 0);
    const house = houseAt(s, 28, 10, P2, TOUGH_HOUSE); // 20 nodes: spread up to 5
    order(s, catapult, P1, house);
    const landings = collect(s, 20 * VEHICLE_ATTACK_CLIP_TICKS, ['projectileHit', 'projectileMissed']);
    expect(landings.length).toBeGreaterThanOrEqual(15);
    for (const ev of landings) {
      if (ev.kind !== 'projectileHit' && ev.kind !== 'projectileMissed') continue;
      expect(Math.abs(ev.at.hx - 28)).toBeLessThanOrEqual(5);
      expect(Math.abs(ev.at.hy - 10)).toBeLessThanOrEqual(5);
    }
    expect(landings.some((ev) => ev.kind === 'projectileMissed')).toBe(true);
  });

  it('is deterministic: the same seed lands the same stones', () => {
    const run = (): string => {
      const s = sim(grass(40, 20), 7);
      const catapult = catapultAt(s, 8, 10, P1, 0);
      order(s, catapult, P1, houseAt(s, 28, 10, P2, TOUGH_HOUSE));
      s.run(10 * VEHICLE_ATTACK_CLIP_TICKS);
      return s.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('the ground burst', () => {
  it('flies distance * 8 / speed ticks along its chord, then bursts once with the weapon smoke', () => {
    // The stone follows the arrow's rule: it sits on the aim the tick before its land tick.
    const s = sim(grass(40, 10));
    const catapult = catapultAt(s, 6, 8, P1);
    const house = houseAt(s, 22, 8, P2, TOUGH_HOUSE); // 16 map points east
    order(s, catapult, P1, house);
    let stone: Entity | undefined;
    for (let i = 0; i < VEHICLE_ATTACK_CLIP_TICKS && stone === undefined; i++) {
      s.step();
      for (const ev of s.events.current()) if (ev.kind === 'projectileLaunched') stone = ev.projectile;
    }
    if (stone === undefined) throw new Error('no stone loosed');
    const { launchTick, landTick } = s.world.get(stone, Projectile);
    // The release tick counts toward the flight, so the stone strikes one tick short of it.
    expect(landTick - launchTick).toBe(SIXTEEN_POINT_FLIGHT_TICKS - 1);
    const origin = positionOfNode(6, 8);
    const aim = positionOfNode(22, 8);
    while (s.tick < landTick - 1) {
      s.step();
      const at = s.world.get(stone, Position);
      expect(at.y).toBe(origin.y);
      expect(at.x).toBeGreaterThan(origin.x);
      expect(at.x).toBeLessThanOrEqual(aim.x);
    }
    expect(s.world.get(stone, Position)).toEqual(aim); // on the aim, held for the drawn last segment
    s.step();
    expect(s.world.has(stone, Projectile)).toBe(false);
    expect(s.events.current().filter((ev) => ev.kind === 'groundBurst')).toEqual([
      {
        kind: 'groundBurst',
        projectile: stone,
        munitionType: 2,
        smokeTicks: CATAPULT_SMOKE_TICKS,
        at: { hx: 22, hy: 8 },
      },
    ]);
  });

  it("strikes the owner's own man standing on the landing node (hitself)", () => {
    const s = sim(grass(40, 10));
    const catapult = catapultAt(s, 6, 8, P1);
    const house = houseAt(s, 22, 8, P2);
    const own = fighterAt(s, 22, 8, P1); // stands on the house's anchor node
    s.world.mut(own, Stance).mode = MILITARY_MODE.IGNORE;
    order(s, catapult, P1, house);
    // Damage is summed blow by blow: a fed settler heals between two stones, and the heal of the blow's own
    // tick nets off one point.
    let lost = 0;
    let before = s.world.get(own, Health).hitpoints;
    const hits = collect(s, SHOT_TICKS, ['projectileHit'], () => {
      const now = s.world.get(own, Health).hitpoints;
      lost += Math.max(0, before - now);
      before = now;
    });
    const struck = hits.map((ev) => (ev.kind === 'projectileHit' ? ev.target : -1));
    expect(new Set(struck)).toEqual(new Set([house, own]));
    const ownHits = struck.filter((t) => t === own).length;
    expect(ownHits).toBeGreaterThan(0);
    expect(lost).toBeGreaterThanOrEqual(ownHits * (CATAPULT_VS_BARE - REGENERATION_HITPOINTS_PER_TICK));
  });

  it("wounds an ally's man on the landing node without turning his player hostile", () => {
    const s = sim(grass(40, 10));
    setDiplomacyStance(s.world, P1, P3, 'friend');
    setDiplomacyStance(s.world, P3, P1, 'friend');
    const catapult = catapultAt(s, 6, 8, P1);
    const house = houseAt(s, 22, 8, P2);
    const ally = fighterAt(s, 22, 8, P3);
    s.world.mut(ally, Stance).mode = MILITARY_MODE.IGNORE;
    order(s, catapult, P1, house);
    const hits = collect(s, SHOT_TICKS, ['projectileHit']);
    expect(hits.some((ev) => ev.kind === 'projectileHit' && ev.target === ally)).toBe(true);
    expect(s.world.get(ally, Health).hitpoints).toBeLessThan(s.world.get(ally, Health).max);
    expect(diplomacyStance(s.world, P3, P1)).toBe('friend');
    expect(wasAttackedBy(s.world, P3, P1)).toBe(false);
  });

  it('passes over a man resting inside the house its stone strikes', () => {
    const s = sim(grass(40, 10));
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const house = houseAt(s, 22, 8, P2);
    const inside = fighterAt(s, 22, 8, P2); // on the house's anchor node, but indoors
    s.world.add(inside, Resting, { at: house });
    const shooter = fighterAt(s, 6, 8, P1);
    const aim = positionOfNode(22, 8);
    const stone = {
      source: shooter,
      target: null,
      player: P1,
      damage: Object.fromEntries(ALL_MATERIALS.map((m) => [String(m), CATAPULT_VS_HOUSE])),
      hitSounds: {},
      weaponMainType: CATAPULT_MAIN_TYPE,
      missSounds: {},
      munitionType: 0,
      hitSelf: true,
      area: false,
      originX: aim.x,
      originY: aim.y,
      aimX: aim.x,
      aimY: aim.y,
      cover: null,
      launchTick: 0,
      landTick: 1,
      impact: { smokeTicks: null },
    };
    const houseBefore = s.world.get(house, Health).hitpoints;
    expect(resolveGroundImpact(s.world, ctxOf(s), terrain, s.world.create(), stone, [])).toBe(true);
    expect(s.world.get(house, Health).hitpoints).toBeLessThan(houseBefore);
    expect(s.world.get(inside, Health).hitpoints).toBe(s.world.get(inside, Health).max);
  });

  it('strikes an enemy vehicle whose disc covers the landing node', () => {
    const s = sim(grass(40, 10));
    const catapult = catapultAt(s, 6, 8, P1);
    const target = catapultAt(s, 24, 8, P2); // crewed too: it shoots back, and those hits are filtered out
    order(s, catapult, P1, target);
    const hits = collect(s, SHOT_TICKS, ['projectileHit']).filter(
      (ev) => ev.kind === 'projectileHit' && ev.target === target,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(3000 - s.world.get(target, Health).hitpoints).toBeGreaterThanOrEqual(
      hits.length * CATAPULT_VS_VEHICLE,
    );
  });
});

describe('wall demolition', () => {
  it('knocks damage[7] / 100 valency off a wall per stone and razes it once none is left', () => {
    const at = { hx: 22, hy: 8 };
    const s = sim(grass(40, 10, true));
    s.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL_TYPE,
      x: at.hx,
      y: at.hy,
      tribe: VIKING,
      owner: P2,
    });
    s.step();
    const [wall] = s.world.query(Palisade);
    if (wall === undefined) throw new Error('no wall stood up');
    const catapult = catapultAt(s, 6, 8, P1);
    s.enqueue(
      playerCommand(P1, {
        kind: 'attackWithVehicle',
        vehicle: catapult,
        target: { kind: 'ground', ...at },
      }),
    );
    const struck = collect(s, VEHICLE_ATTACK_CLIP_TICKS, ['projectileHit']);
    expect(struck.map((ev) => (ev.kind === 'projectileHit' ? ev.target : -1))).toEqual([wall]);
    expect(s.world.get(wall, Health).hitpoints).toBe(WALL_HITPOINTS - WALL_STEPS_PER_STONE);
    collect(s, 3 * VEHICLE_ATTACK_CLIP_TICKS, ['projectileHit']);
    expect(s.world.isAlive(wall)).toBe(false);
  });
});

describe('vehicles as targets', () => {
  it('frightens a fleer only while armed: a catapult, never a cart', () => {
    const s = sim(grass(20, 6));
    const civilian = fighterAt(s, 4, 4, P1);
    const cart = createVehicle(s.world, ctxOf(s), {
      vehicleType: HANDCART,
      x: 8,
      y: 4,
      tribe: VIKING,
      owner: P2,
    });
    const catapult = createVehicle(s.world, ctxOf(s), {
      vehicleType: CATAPULT,
      x: 12,
      y: 4,
      tribe: VIKING,
      owner: P2,
    });
    if (cart === null || catapult === null) throw new Error('vehicle types');
    const ctx = ctxOf(s);
    const fears = (t: Entity): boolean =>
      isFleeThreat(s.world, ctx, civilian, s.world.get(civilian, Settler), t, new Set());
    expect(fears(cart)).toBe(false);
    expect(fears(catapult)).toBe(true);
  });

  it('an archer in the attack stance shoots an enemy cart down and the cleanup wrecks it', () => {
    const s = sim(grass(20, 6));
    fighterAt(s, 4, 4, P1, ARCHER);
    const cart = createVehicle(s.world, ctxOf(s), {
      vehicleType: HANDCART,
      x: 12,
      y: 4,
      tribe: VIKING,
      owner: P2,
    });
    if (cart === null) throw new Error('cart');
    const wrecked = collect(s, 200, ['vehicleDestroyed']);
    expect(wrecked.map((ev) => (ev.kind === 'vehicleDestroyed' ? ev.cause : ''))).toEqual(['destroyed']);
    expect(s.world.isAlive(cart)).toBe(false);
  });

  it('an ordered swordsman closes on an enemy catapult and batters its hull down', () => {
    const s = sim(grass(30, 6));
    const soldier = fighterAt(s, 2, 4, P1);
    s.world.mut(soldier, Stance).mode = MILITARY_MODE.IGNORE; // no auto-engagement: the order alone sends it
    const target = createVehicle(s.world, ctxOf(s), {
      vehicleType: CATAPULT,
      x: 14,
      y: 4,
      tribe: VIKING,
      owner: P2,
    });
    if (target === null) throw new Error('catapult'); // uncrewed: it cannot shoot back
    s.enqueue(playerCommand(P1, { kind: 'attackUnit', entity: soldier, target }));
    const wrecked = collect(s, 400, ['vehicleDestroyed']);
    expect(wrecked.map((ev) => (ev.kind === 'vehicleDestroyed' ? ev.entity : -1))).toEqual([target]);
  });

  it('VehiclesDied holds once the vehicle carrying the mission id is gone', () => {
    const s = sim(grass(20, 6));
    const MISSION_ID = 12;
    const cart = createVehicle(s.world, ctxOf(s), {
      vehicleType: HANDCART,
      x: 12,
      y: 4,
      tribe: VIKING,
      owner: P2,
      missionId: MISSION_ID,
    });
    if (cart === null) throw new Error('cart');
    expect(vehiclesGone(s.world, MISSION_ID)).toBe(false);
    fighterAt(s, 4, 4, P1, ARCHER);
    s.run(200);
    expect(vehiclesGone(s.world, MISSION_ID)).toBe(true);
  });
});
