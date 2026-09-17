import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Health,
  Owner,
  Palisade,
  Position,
  Settler,
  SettlerProgress,
  Stance,
  seatPassenger,
  Vehicle,
  VehicleDrive,
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
import { VEHICLE_ATTACK_CLIP_TICKS, VEHICLE_ATTACK_EVENT_TICK } from '../../src/systems/conflict/combat.js';
import { vehiclesGone } from '../../src/systems/missions/goals/casualties.js';
import { FIGHT_EXPERIENCE_TYPE } from '../../src/systems/progression/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
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
const GRASS = 0;
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
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
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
          { jobType: SOLDIER, atomicId: 81, animation: 'viking_attack' },
          { jobType: ARCHER, atomicId: 81, animation: 'viking_attack' },
        ],
      },
    ],
    atomicAnimations: [{ id: 'viking_attack', name: 'viking_attack', length: 4 }],
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

function collect(s: Simulation, ticks: number, kinds: readonly SimEvent['kind'][]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    for (const ev of s.events.current()) if (kinds.includes(ev.kind)) out.push(ev);
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

  it('survives a save round trip with a live attack, a worn wall and a stone in flight', () => {
    const wall = { hx: 22, hy: 8 };
    const run = (): Simulation => {
      const s = sim(grass(40, 10, true), 5);
      s.enqueueSetup({ kind: 'placePalisade', gfxIndex: WALL_TYPE, x: wall.hx, y: wall.hy, tribe: VIKING, owner: P2 });
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
  it("strikes the owner's own man standing on the landing node (hitself)", () => {
    const s = sim(grass(40, 10));
    const catapult = catapultAt(s, 6, 8, P1);
    const house = houseAt(s, 22, 8, P2);
    const own = fighterAt(s, 22, 8, P1); // stands on the house's anchor node
    s.world.mut(own, Stance).mode = MILITARY_MODE.IGNORE;
    order(s, catapult, P1, house);
    const hits = collect(s, SHOT_TICKS, ['projectileHit']);
    const struck = hits.map((ev) => (ev.kind === 'projectileHit' ? ev.target : -1));
    expect(new Set(struck)).toEqual(new Set([house, own]));
    const ownHits = struck.filter((t) => t === own).length;
    expect(ownHits).toBeGreaterThan(0);
    expect(100_000 - s.world.get(own, Health).hitpoints).toBeGreaterThanOrEqual(ownHits * CATAPULT_VS_BARE);
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
