import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Building,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Settler,
  Vehicle,
  VehicleDrive,
  WaveMarch,
} from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command, PlayerCommand } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  EventBuffer,
  exportSaveGame,
  parseSaveGame,
  playerCommand,
  Rng,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../src/index.js';
import { type HalfCellNode, positionOfNode } from '../../src/nav/halfcell.js';
import {
  ASSAULT_RING_RADIUS_NODES,
  CHARGE_ARMY_DIVISOR,
  CHARGE_MIN_ENEMIES,
  FIGHT_HOLD_TIMEOUT_TICKS,
  LEG_TIMEOUT_TICKS,
  militaryModule,
  RALLY_HOLD_RADIUS_NODES,
  SIEGE_MARCH_MIN_CATAPULTS,
  SIEGE_TIMEOUT_TICKS,
} from '../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { entityNode } from '../../src/systems/spatial/nodes.js';
import { boardRider, createVehicle, removeVehicle } from '../../src/systems/vehicles/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

// A launched wave marching in legs: it closes up before each next leg, its catapults lead, it charges an
// enemy body big enough, and at its objective it breaks the towers before it goes in.

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const BARRACKS_TYPE = 12;
const TOWER_TYPE = 15;
const FIST = 31;
const SPEARMAN = 32;
const BOWMAN = 40;
const CATAPULT = 5;
/** A seed whose opening wave draw is its floor, so a band of that floor marches at once. */
const EAGER_SEED = 7;
const BARRACKS = { x: 30, y: 30 };
const FOE_HQ = { x: 110, y: 70 };
/** A far corner the enemy's men wait in, out of sight of everyone, until a case moves them in. */
const FOE_CAMP = { x: 100, y: 6 };
/** Open ground between the two seats, out of the watch band of either settlement. */
const MIDFIELD = { hx: 70, hy: 50 };
/** How far east of the wave the enemy body stands, in files of {@link ENEMY_FILE} men two nodes apart:
 *  inside the charge radius of the wave's centre. */
const ENEMY_OFFSET = 12;
const ENEMY_FILE = 4;
/** How far from its first man the enemy body reaches. */
const ENEMY_BODY_SPREAD = 8;
/** An enemy tower beside the objective, inside the siege radius. */
const FOE_TOWER = { x: 96, y: 70 };
const BAND = 5;

const CONTENT: ContentSet = marchContent();

/** {@link aiContent} with the catapult row of `vehicletypes.ini`, soldiers as crew. */
function marchContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    vehicles: [
      {
        typeId: CATAPULT,
        id: 'catapult',
        jobId: 54,
        stockSlots: 0,
        logicSize: 1,
        passengerJobs: [FIST, SPEARMAN, BOWMAN],
        commanderJob: FIST,
        hitpoints: 3000,
      },
    ],
  });
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: CONTENT,
    rng: new Rng(EAGER_SEED),
    tick: sim.tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

const MAP_W = 128;
const MAP_H = 96;
/** Ground type 1 of the synthetic fixtures: water, walkable by nothing. */
const WATER = 1;
/** How thick a moat is, in nodes: wide enough that no diagonal step crosses it. */
const MOAT_NODES = 2;

/** The grass map with a water moat around the node rectangle `island` (inclusive), so what stands on it
 *  is on another continent. */
function moatMap(island: { x0: number; y0: number; x1: number; y1: number }): TerrainMap {
  const map = grassNodeMap(MAP_W, MAP_H);
  const typeIds = [...map.typeIds];
  for (let y = island.y0 - MOAT_NODES; y <= island.y1 + MOAT_NODES; y++) {
    for (let x = island.x0 - MOAT_NODES; x <= island.x1 + MOAT_NODES; x++) {
      const inside = x >= island.x0 && x <= island.x1 && y >= island.y0 && y <= island.y1;
      if (!inside) typeIds[y * MAP_W + x] = WATER;
    }
  }
  return { ...map, typeIds };
}

function marchSim(map: TerrainMap = grassNodeMap(MAP_W, MAP_H)): Simulation {
  const sim = new Simulation({ seed: 1, content: CONTENT, map });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  place(sim, BARRACKS_TYPE, BARRACKS, SEAT);
  place(sim, HQ_TYPE, FOE_HQ, FOE);
  return sim;
}

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }, owner: number): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
}

function spawnAt(
  sim: Simulation,
  spots: readonly { x: number; y: number }[],
  jobType: number,
  owner = SEAT,
): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (const { x, y } of spots) {
    sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner });
  }
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

/** Men packed into the hold ring of the barracks door, so they stand formed up there. */
function pack(sim: Simulation, count: number, jobType: number, skip = 0): Entity[] {
  const rally = rallyOf(sim);
  const spots: { x: number; y: number }[] = [];
  for (let r = 1; r <= RALLY_HOLD_RADIUS_NODES && spots.length < skip + count; r++) {
    for (let dy = -r; dy <= r && spots.length < skip + count; dy++) {
      const dx = r - Math.abs(dy);
      spots.push({ x: rally.x + dx, y: rally.y + dy });
      if (dx !== 0 && spots.length < skip + count) spots.push({ x: rally.x - dx, y: rally.y + dy });
    }
  }
  return spawnAt(sim, spots.slice(skip), jobType);
}

function catapultAt(sim: Simulation, at: { x: number; y: number }): Entity {
  const e = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: CATAPULT,
    x: at.x,
    y: at.y,
    tribe: VIKING,
    owner: SEAT,
  });
  if (e === null) throw new Error('setup: the catapult is not in the content');
  const [driver] = spawnAt(sim, [{ x: at.x, y: at.y + 4 }], FIST);
  if (driver === undefined) throw new Error('setup: no driver');
  sim.enqueue(playerCommand(SEAT, { kind: 'attachToVehicle', entity: driver, vehicle: e }));
  sim.step();
  boardRider(sim.world, driver, e);
  return e;
}

/** Park spots around the barracks door, spaced apart and inside the band a launching wave takes its
 *  catapults from. */
const TRAIN_OFFSETS = [
  { x: 4, y: 10 },
  { x: -6, y: 10 },
  { x: 4, y: -10 },
  { x: -6, y: -10 },
];

/** `count` crewed catapults parked around the barracks door, the fewest a siege march takes by default. */
function siegeTrain(sim: Simulation, count = SIEGE_MARCH_MIN_CATAPULTS): Entity[] {
  const rally = rallyOf(sim);
  return TRAIN_OFFSETS.slice(0, count).map(({ x, y }) => catapultAt(sim, { x: rally.x + x, y: rally.y + y }));
}

function terrainOf(sim: Simulation) {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  return terrain;
}

function barracksOf(sim: Simulation): Entity {
  const barracks = [...sim.world.query(Building, Owner)].find(
    (e) => sim.world.get(e, Building).buildingType === BARRACKS_TYPE,
  );
  if (barracks === undefined) throw new Error('setup: no barracks');
  return barracks;
}

function foeBuilding(sim: Simulation, buildingType: number): Entity {
  const found = [...sim.world.query(Building, Owner)].find(
    (e) => sim.world.get(e, Building).buildingType === buildingType && sim.world.get(e, Owner).player === FOE,
  );
  if (found === undefined) throw new Error(`setup: no enemy building ${buildingType}`);
  return found;
}

function rallyOf(sim: Simulation): { x: number; y: number } {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  return terrain.coordsOf(interactionCell(sim.world, ctxOf(sim), terrain, barracksOf(sim)));
}

function objectiveOf(sim: Simulation): { x: number; y: number } {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  return terrain.coordsOf(interactionCell(sim.world, ctxOf(sim), terrain, foeBuilding(sim, HQ_TYPE)));
}

function run(sim: Simulation): PlayerCommand[] {
  return [...militaryModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind !== 'setRegeneration');
}

function march(sim: Simulation) {
  const state = sim.world.tryGet(barracksOf(sim), WaveMarch);
  if (state === undefined) throw new Error('expected a marching wave');
  return state;
}

function walks(commands: readonly Command[]): Map<Entity, HalfCellNode> {
  const goals = new Map<Entity, HalfCellNode>();
  for (const c of commands) if (c.kind === 'attackMoveUnit') goals.set(c.entity, { hx: c.x, hy: c.y });
  return goals;
}

function drives(commands: readonly Command[]): Extract<Command, { kind: 'moveVehicle' }>[] {
  return commands.flatMap((c) => (c.kind === 'moveVehicle' ? [c] : []));
}

function teleport(sim: Simulation, e: Entity, at: HalfCellNode): void {
  const p = positionOfNode(at.hx, at.hy);
  const live = sim.world.mut(e, Position);
  live.x = p.x;
  live.y = p.y;
}

function manhattan(a: HalfCellNode, b: { x: number; y: number } | HalfCellNode): number {
  const bx = 'hx' in b ? b.hx : b.x;
  const by = 'hy' in b ? b.hy : b.y;
  return Math.abs(a.hx - bx) + Math.abs(a.hy - by);
}

/** How far along the leg from `from` to `to` a node lies, in units of the leg's Manhattan length. */
function along(from: HalfCellNode, to: HalfCellNode, at: HalfCellNode): number {
  return (at.hx - from.hx) * (to.hx - from.hx) + (at.hy - from.hy) * (to.hy - from.hy);
}

function legLength(from: HalfCellNode, to: HalfCellNode): number {
  return Math.abs(to.hx - from.hx) + Math.abs(to.hy - from.hy);
}

describe('military module - the wave marches in legs', () => {
  it('orders nobody past the leg end, and gives the next leg only once the straggler has closed up', () => {
    const sim = marchSim();
    const band = pack(sim, BAND, SPEARMAN);
    const first = walks(run(sim));
    const state = march(sim);
    expect(state.men).toEqual(band);
    expect(state.leg).toBe(0);
    expect(state.waypoints.length).toBeGreaterThan(2);
    const [end] = state.waypoints;
    if (end === undefined) throw new Error('expected a leg end');
    // Every man walks to his own place in a rank on the leg end, never beyond it.
    expect([...first.keys()]).toEqual(band);
    const reach = along(state.origin, end, end) + legLength(state.origin, end);
    for (const goal of first.values()) expect(along(state.origin, end, goal)).toBeLessThanOrEqual(reach);

    // Four close up, one lags at the door: the wave waits for him, and only he is walked on.
    const [straggler, ...fast] = band;
    if (straggler === undefined) throw new Error('setup: no band');
    for (const e of fast) {
      const goal = first.get(e);
      if (goal !== undefined) teleport(sim, e, goal);
    }
    const waiting = walks(run(sim));
    expect(march(sim).leg).toBe(0);
    expect([...waiting.keys()]).toEqual([straggler]);
    expect(waiting.get(straggler)).toEqual(first.get(straggler));

    // He arrives: the whole wave gets the next leg, and still nobody goes past its end.
    const goal = first.get(straggler);
    if (goal === undefined) throw new Error('expected a place for the straggler');
    teleport(sim, straggler, goal);
    const next = walks(run(sim));
    const after = march(sim);
    expect(after.leg).toBe(1);
    expect([...next.keys()]).toEqual(band);
    const nextEnd = after.waypoints[1];
    if (nextEnd === undefined) throw new Error('expected a second leg end');
    const nextReach = along(end, nextEnd, nextEnd) + legLength(end, nextEnd);
    for (const g of next.values()) expect(along(end, nextEnd, g)).toBeLessThanOrEqual(nextReach);
  });

  it('puts the catapults in front, the melee ranks behind them and the archers last', () => {
    const sim = marchSim();
    const catapults = siegeTrain(sim);
    const spearmen = pack(sim, BAND, SPEARMAN);
    const bowmen = pack(sim, 2, BOWMAN, BAND);
    const commands = run(sim);
    const state = march(sim);
    expect(state.catapults).toEqual(catapults);
    const [end] = state.waypoints;
    if (end === undefined) throw new Error('expected a leg end');

    const drove = drives(commands);
    expect(drove.map((c) => c.vehicle)).toEqual(catapults);
    expect(drove.every((c) => c.attackMove === true)).toBe(true);
    const goals = walks(commands);
    const progress = (at: HalfCellNode): number => along(state.origin, end, at);
    const front = Math.min(...drove.map((c) => progress({ hx: c.x, hy: c.y })));
    const melee = spearmen
      .map((e) => goals.get(e))
      .filter((g) => g !== undefined)
      .map(progress);
    const archers = bowmen
      .map((e) => goals.get(e))
      .filter((g) => g !== undefined)
      .map(progress);
    expect(melee).toHaveLength(BAND);
    expect(archers).toHaveLength(2);
    expect(Math.max(...melee)).toBeLessThan(front);
    expect(Math.max(...archers)).toBeLessThan(Math.min(...melee));

    // Marching, the catapults are the wave's: no park order ever calls them home.
    expect(drives(run(sim)).every((c) => c.attackMove === true)).toBe(true);
  });

  it('marches on without the stragglers once the leg times out, and hands them back', () => {
    const sim = marchSim();
    const catapults = siegeTrain(sim);
    const band = pack(sim, BAND + 1, SPEARMAN);
    const first = walks(run(sim));
    expect(march(sim).catapults).toEqual(catapults);
    // All but one man close up; he and the catapults never leave the door.
    const [straggler, ...fast] = band;
    if (straggler === undefined) throw new Error('setup: no band');
    for (const e of fast) {
      const goal = first.get(e);
      if (goal !== undefined) teleport(sim, e, goal);
    }
    expect(march(sim).leg).toBe(0);
    expect(walks(run(sim)).has(straggler)).toBe(true);
    expect(march(sim).leg).toBe(0);

    sim.world.mut(barracksOf(sim), WaveMarch).legSince = sim.tick - LEG_TIMEOUT_TICKS;
    const next = run(sim);
    const state = march(sim);
    expect(state.leg).toBe(1);
    expect(state.men).toEqual(fast);
    expect(state.catapults).toEqual([]);
    expect([...walks(next).keys()]).toEqual(fast);
    expect(drives(next).filter((c) => c.attackMove === true)).toEqual([]);
  });
});

describe('military module - the siege march needs four catapults', () => {
  it('leaves fewer than four catapults parked at home and marches as a plain wave', () => {
    const sim = marchSim();
    const catapults = siegeTrain(sim, SIEGE_MARCH_MIN_CATAPULTS - 1);
    const band = pack(sim, BAND, SPEARMAN);
    const commands = run(sim);
    const state = march(sim);
    expect(state.catapults).toEqual([]);
    expect(drives(commands).filter((c) => catapults.includes(c.vehicle) && c.attackMove === true)).toEqual(
      [],
    );
    // Without catapults the melee ranks stand on the leg end itself.
    const [end] = state.waypoints;
    if (end === undefined) throw new Error('expected a leg end');
    const goals = [...walks(commands).values()];
    expect(goals).toHaveLength(band.length);
    expect(Math.min(...goals.map((g) => manhattan(g, end)))).toBeLessThanOrEqual(2);
  });

  it('sends the rest home and marches on at once when a catapult is lost on the way', () => {
    const sim = marchSim();
    const catapults = siegeTrain(sim);
    const band = pack(sim, BAND, SPEARMAN);
    const first = walks(run(sim));
    expect(march(sim).catapults).toEqual(catapults);
    // The men close up, the catapults are still on their way when one of them is destroyed.
    for (const [e, goal] of first) {
      teleport(sim, e, goal);
      sim.world.remove(e, PlayerOrder);
    }
    const [lost] = catapults;
    if (lost === undefined) throw new Error('setup');
    removeVehicle(sim.world, ctxOf(sim), lost, 'destroyed');
    // The men walk on at once to the plain wave's places, forward onto the leg end the catapults held.
    const next = walks(run(sim));
    const state = march(sim);
    expect(state.catapults).toEqual([]);
    const [end] = state.waypoints;
    if (end === undefined) throw new Error('expected a leg end');
    for (const e of band) {
      const goal = next.get(e);
      const was = first.get(e);
      if (goal === undefined) throw new Error('expected a new place');
      if (was === undefined) throw new Error('expected a first place');
      expect(along(state.origin, end, goal)).toBeGreaterThan(along(state.origin, end, was));
    }
  });
});

describe('military module - the leg goes out while the catapults still drive', () => {
  it('gives the next leg once every catapult is near its place, driving or not', () => {
    const sim = marchSim();
    const catapults = siegeTrain(sim);
    pack(sim, BAND, SPEARMAN);
    const commands = run(sim);
    for (const c of commands) sim.enqueue(playerCommand(SEAT, c));
    sim.step();
    expect(catapults.every((v) => sim.world.has(v, VehicleDrive))).toBe(true);
    for (const [e, goal] of walks(commands)) {
      teleport(sim, e, goal);
      sim.world.remove(e, PlayerOrder);
    }
    // Two nodes short of each place along the column: still under way, near enough.
    for (const c of drives(commands)) teleport(sim, c.vehicle, { hx: c.x, hy: c.y - 2 });
    expect(march(sim).leg).toBe(0);
    const next = run(sim);
    expect(march(sim).leg).toBe(1);
    expect(drives(next).map((c) => c.vehicle)).toEqual(catapults);
  });

  it('orders on a man left standing on a walk nobody owns', () => {
    const sim = marchSim();
    const band = pack(sim, BAND, SPEARMAN);
    const first = walks(run(sim));
    const [stray, ...rest] = band;
    if (stray === undefined) throw new Error('setup');
    for (const e of rest) {
      const goal = first.get(e);
      if (goal !== undefined) teleport(sim, e, goal);
      sim.world.remove(e, PlayerOrder);
    }
    // His march order is gone and a stale goal of no order's holds him where he stands.
    sim.world.remove(stray, PlayerOrder);
    sim.world.add(stray, MoveGoal, { cell: entityNode(sim.world, terrainOf(sim), stray) });
    expect(walks(run(sim)).get(stray)).toEqual(first.get(stray));
  });
});

describe('military module - the wave holds while its catapults fight', () => {
  /** A launched wave of four catapults, spearmen and bowmen standing on their places, with the first
   *  catapult firing at `target` on its own and the leg already due to time out. */
  function fighting(target: 'tower' | 'man') {
    const sim = marchSim();
    const catapults = siegeTrain(sim);
    const spearmen = pack(sim, BAND, SPEARMAN);
    const bowmen = pack(sim, 2, BOWMAN, BAND);
    for (const [e, goal] of walks(run(sim))) {
      teleport(sim, e, goal);
      sim.world.remove(e, PlayerOrder);
    }
    place(sim, TOWER_TYPE, FOE_TOWER, FOE);
    const tower = foeBuilding(sim, TOWER_TYPE);
    const [foe] = spawnAt(sim, [FOE_CAMP], SPEARMAN, FOE);
    const [shooter, ...others] = catapults;
    if (shooter === undefined || foe === undefined) throw new Error('setup');
    const entity = target === 'tower' ? tower : foe;
    sim.world.mut(shooter, Vehicle).attack = {
      target: { kind: 'entity', entity },
      ordered: false,
      clipStart: null,
    };
    sim.world.mut(barracksOf(sim), WaveMarch).legSince = sim.tick - LEG_TIMEOUT_TICKS;
    return { sim, catapults, shooter, others, spearmen, bowmen, tower };
  }

  function stances(commands: readonly Command[], men: readonly Entity[]): number[] {
    return men.map((e) => {
      const set = commands.find((c) => c.kind === 'setStance' && c.entity === e);
      return set?.kind === 'setStance' ? set.mode : -1;
    });
  }

  it('holds its leg, the archers and the idle catapults join the fight on a tower, the melee waits', () => {
    const { sim, catapults, shooter, others, spearmen, bowmen, tower } = fighting('tower');
    const commands = run(sim);
    const state = march(sim);
    expect(state.leg).toBe(0);
    expect(state.catapults).toEqual(catapults);
    expect(state.holdSince).toBe(sim.tick);
    expect(state.legSince).toBe(sim.tick);
    expect(commands.filter((c) => c.kind === 'attackWithVehicle')).toEqual(
      others.map((vehicle) => ({
        kind: 'attackWithVehicle',
        vehicle,
        target: { kind: 'entity', entity: tower },
      })),
    );
    expect(drives(commands)).toEqual([]);
    const focused = commands.flatMap((c) => (c.kind === 'attackUnit' ? [c] : []));
    expect(focused).toEqual(bowmen.map((entity) => ({ kind: 'attackUnit', entity, target: tower })));
    expect(walks(commands).size).toBe(0);
    expect(stances(commands, spearmen)).toEqual(spearmen.map(() => MILITARY_MODE.IGNORE));

    // The fight ends: the wave keeps its catapults, gives the one fallen behind its place a whole leg to
    // drive back, and forms up again.
    for (const vehicle of catapults) sim.world.mut(vehicle, Vehicle).attack = null;
    teleport(sim, shooter, { hx: BARRACKS.x, hy: BARRACKS.y + 8 });
    const after = run(sim);
    const reformed = march(sim);
    expect(reformed.holdSince).toBeNull();
    expect(reformed.catapults).toEqual(catapults);
    expect(reformed.leg).toBe(0);
    expect(drives(after).map((c) => c.vehicle)).toContain(shooter);
  });

  it('leaves the fight with men to the archers and the melee on their places', () => {
    const { sim, catapults, spearmen, bowmen } = fighting('man');
    const commands = run(sim);
    expect(march(sim).leg).toBe(0);
    expect(march(sim).catapults).toEqual(catapults);
    expect(commands.some((c) => c.kind === 'attackUnit' || c.kind === 'attackWithVehicle')).toBe(false);
    const men = [...spearmen, ...bowmen];
    expect(stances(commands, men)).toEqual(men.map(() => MILITARY_MODE.DEFEND));
  });

  it('marches on without the catapult still fighting once the hold has lasted too long', () => {
    const { sim, shooter, others } = fighting('man');
    run(sim);
    sim.world.mut(barracksOf(sim), WaveMarch).holdSince = sim.tick - FIGHT_HOLD_TIMEOUT_TICKS;
    run(sim);
    const state = march(sim);
    expect(state.holdSince).toBeNull();
    expect(sim.world.get(shooter, Vehicle).attack).not.toBeNull();
    expect(state.catapults).toEqual(others);
    // Three are too few for a siege march: they go home, and the wave marches on without them.
    const next = run(sim);
    expect(march(sim).catapults).toEqual([]);
    expect(drives(next)).toEqual([]);
    expect(walks(next).size).toBeGreaterThan(0);
  });

  it('calls its archers off a tower the catapults no longer fight, and marches on', () => {
    const { sim, catapults, bowmen, tower } = fighting('tower');
    const hold = run(sim);
    for (const c of hold) sim.enqueue(playerCommand(SEAT, c));
    sim.step();
    expect(bowmen.every((e) => sim.world.get(e, AttackOrder).target === tower)).toBe(true);

    // Every catapult is lost: the hold is over, and the archers the wave set at the tower walk back.
    const ctx = ctxOf(sim);
    for (const vehicle of catapults) removeVehicle(sim.world, ctx, vehicle, 'destroyed');
    const after = run(sim);
    expect(march(sim).catapults).toEqual([]);
    expect(march(sim).holdSince).toBeNull();
    expect([...walks(after).keys()]).toEqual(expect.arrayContaining(bowmen));
  });
});

describe('military module - the wave charges', () => {
  /** A wave of `size` launched and standing in midfield, with `enemies` fighters moved in beside it. Both
   *  are set down between decisions, so nobody is in a fight yet. */
  function standoff(
    size: number,
    enemies: number,
    map?: TerrainMap,
  ): { sim: Simulation; band: Entity[]; foes: Entity[] } {
    const sim = marchSim(map);
    const foes = spawnAt(
      sim,
      Array.from({ length: enemies }, (_, i) => ({ x: FOE_CAMP.x + 2 * i, y: FOE_CAMP.y })),
      SPEARMAN,
      FOE,
    );
    const band = pack(sim, size, SPEARMAN);
    run(sim);
    for (const [i, e] of band.entries()) {
      teleport(sim, e, { hx: MIDFIELD.hx + 2 * (i % 8), hy: MIDFIELD.hy + 2 * Math.floor(i / 8) });
    }
    for (const [i, e] of foes.entries()) {
      teleport(sim, e, {
        hx: MIDFIELD.hx + ENEMY_OFFSET + 2 * (i % ENEMY_FILE),
        hy: MIDFIELD.hy + 2 * Math.floor(i / ENEMY_FILE),
      });
    }
    return { sim, band, foes };
  }

  /** The men of `band` `commands` send into the ring around the enemy body, counting those already
   *  standing in it, whom the charge leaves to fight where they are. */
  function chargedAt(
    commands: readonly Command[],
    band: readonly Entity[],
    foe: { x: number; y: number },
  ): number {
    const goals = walks(commands);
    const reach = ASSAULT_RING_RADIUS_NODES + ENEMY_BODY_SPREAD;
    return band.filter((e) => {
      const goal = goals.get(e);
      return goal === undefined || manhattan(goal, foe) <= reach;
    }).length;
  }

  const enemyBody = { x: MIDFIELD.hx + ENEMY_OFFSET, y: MIDFIELD.hy };

  it('charges an enemy body of the floor size, and keeps marching past one smaller', () => {
    const below = standoff(BAND, CHARGE_MIN_ENEMIES - 1);
    expect(chargedAt(run(below.sim), below.band, enemyBody)).toBe(0);

    const at = standoff(BAND, CHARGE_MIN_ENEMIES);
    expect(chargedAt(run(at.sim), at.band, enemyBody)).toBe(BAND);
  });

  it('raises the charge floor to a third of a big wave', () => {
    const size = 3 * CHARGE_ARMY_DIVISOR * 2;
    const needed = Math.ceil(size / CHARGE_ARMY_DIVISOR);
    expect(needed).toBeGreaterThan(CHARGE_MIN_ENEMIES);
    const below = standoff(size, needed - 1);
    expect(chargedAt(run(below.sim), below.band, enemyBody)).toBe(0);
    const at = standoff(size, needed);
    expect(chargedAt(run(at.sim), at.band, enemyBody)).toBe(size);
  });

  /** An enemy catapult beside the standing wave, firing at `target`. */
  function shelledBy(sim: Simulation, target: Entity): { vehicle: Entity; at: HalfCellNode } {
    const at = { hx: MIDFIELD.hx + ENEMY_OFFSET, hy: MIDFIELD.hy + ENEMY_OFFSET };
    const vehicle = createVehicle(sim.world, ctxOf(sim), {
      vehicleType: CATAPULT,
      x: at.hx,
      y: at.hy,
      tribe: VIKING,
      owner: FOE,
    });
    if (vehicle === null) throw new Error('setup: no enemy catapult');
    sim.world.mut(vehicle, Vehicle).attack = {
      target: { kind: 'entity', entity: target },
      ordered: false,
      clipStart: null,
    };
    return { vehicle, at };
  }

  it('charges an enemy catapult firing at its men at once, however few stand by it', () => {
    const { sim, band } = standoff(BAND, 0);
    const [man] = band;
    if (man === undefined) throw new Error('setup');
    const { at } = shelledBy(sim, man);
    expect(chargedAt(run(sim), band, { x: at.hx, y: at.hy })).toBe(BAND);
  });

  it('leaves an enemy catapult duelling its own catapults to them', () => {
    const { sim, band } = standoff(BAND, 0);
    const [ours] = siegeTrain(sim, 1);
    if (ours === undefined) throw new Error('setup');
    const { at } = shelledBy(sim, ours);
    expect(chargedAt(run(sim), band, { x: at.hx, y: at.hy })).toBe(0);
  });

  it('ignores an enemy body of the floor size across the water', () => {
    const island = {
      x0: enemyBody.x - 2,
      y0: enemyBody.y - 2,
      x1: enemyBody.x + 2 * ENEMY_FILE,
      y1: enemyBody.y + 2 * ENEMY_FILE,
    };
    const across = standoff(BAND, CHARGE_MIN_ENEMIES, moatMap(island));
    const terrain = across.sim.terrain;
    const [foe] = across.foes;
    const [man] = across.band;
    if (terrain === undefined || foe === undefined || man === undefined) throw new Error('setup');
    const componentOf = (e: Entity): number => terrain.componentOf(entityNode(across.sim.world, terrain, e));
    expect(componentOf(foe)).not.toBe(componentOf(man));
    expect(chargedAt(run(across.sim), across.band, enemyBody)).toBe(0);
  });
});

describe('military module - the siege', () => {
  it('turns the catapults and archers on the towers while the melee waits, then sends everyone in', () => {
    const sim = marchSim();
    const catapults = siegeTrain(sim);
    const spearmen = pack(sim, BAND, SPEARMAN);
    const bowmen = pack(sim, 2, BOWMAN, BAND);
    run(sim);
    sim.world.mut(barracksOf(sim), WaveMarch).arrived = true;
    place(sim, TOWER_TYPE, FOE_TOWER, FOE);
    const tower = foeBuilding(sim, TOWER_TYPE);

    const siege = run(sim);
    expect(siege.filter((c) => c.kind === 'attackWithVehicle')).toEqual(
      catapults.map((vehicle) => ({
        kind: 'attackWithVehicle',
        vehicle,
        target: { kind: 'entity', entity: tower },
      })),
    );
    const focused = siege.flatMap((c) => (c.kind === 'attackUnit' ? [c] : []));
    expect(focused).toEqual(bowmen.map((entity) => ({ kind: 'attackUnit', entity, target: tower })));
    // The melee holds its ranks rather than walking into the objective's fire.
    const objective = objectiveOf(sim);
    const goals = walks(siege);
    for (const e of spearmen) {
      const goal = goals.get(e);
      if (goal !== undefined) expect(manhattan(goal, objective)).toBeGreaterThan(ASSAULT_RING_RADIUS_NODES);
    }

    // The tower falls: everybody goes in on the objective.
    sim.world.destroy(tower);
    const assault = run(sim);
    const inRing = [...walks(assault)].filter(
      ([, g]) => manhattan(g, objective) <= ASSAULT_RING_RADIUS_NODES,
    );
    expect(inRing.map(([e]) => e)).toEqual([...spearmen, ...bowmen]);
    expect(drives(assault).map((c) => [c.vehicle, c.attackMove])).toEqual(catapults.map((v) => [v, true]));
  });

  /** An arrived wave of four catapults, spearmen and bowmen, with an enemy tower beside its objective. */
  function arrivedBeside(map?: TerrainMap) {
    const sim = marchSim(map);
    const catapults = siegeTrain(sim);
    const spearmen = pack(sim, BAND, SPEARMAN);
    const bowmen = pack(sim, 2, BOWMAN, BAND);
    run(sim);
    sim.world.mut(barracksOf(sim), WaveMarch).arrived = true;
    place(sim, TOWER_TYPE, FOE_TOWER, FOE);
    return { sim, catapults, men: [...spearmen, ...bowmen] };
  }

  function assaulted(sim: Simulation, commands: readonly Command[]): Entity[] {
    const objective = objectiveOf(sim);
    return [...walks(commands)]
      .filter(([, g]) => manhattan(g, objective) <= ASSAULT_RING_RADIUS_NODES)
      .map(([e]) => e);
  }

  it('leaves a tower across the water to the assault', () => {
    const moat = { x0: FOE_TOWER.x - 6, y0: FOE_TOWER.y - 6, x1: FOE_TOWER.x + 6, y1: FOE_TOWER.y + 6 };
    const { sim, catapults, men } = arrivedBeside(moatMap(moat));
    const commands = run(sim);
    expect(commands.some((c) => c.kind === 'attackWithVehicle' || c.kind === 'attackUnit')).toBe(false);
    expect(assaulted(sim, commands)).toEqual(men);
    expect(drives(commands).map((c) => c.vehicle)).toEqual(catapults);
  });

  it('gives the siege up for the assault once it has lasted too long', () => {
    const { sim, catapults, men } = arrivedBeside();
    expect(run(sim).some((c) => c.kind === 'attackWithVehicle')).toBe(true);

    sim.world.mut(barracksOf(sim), WaveMarch).legSince = sim.tick - SIEGE_TIMEOUT_TICKS;
    const commands = run(sim);
    expect(commands.some((c) => c.kind === 'attackWithVehicle' || c.kind === 'attackUnit')).toBe(false);
    expect(assaulted(sim, commands)).toEqual(men);
    expect(drives(commands).map((c) => c.vehicle)).toEqual(catapults);
  });
});

describe('military module - a marching wave through a save', { timeout: 60_000 }, () => {
  /** Ticks to wait for the seat to launch its wave and close up on its first leg end. */
  const LAUNCH_TICKS = 6000;
  /** Ticks to run both copies on after the save. */
  const AFTER_TICKS = 1500;

  it('restores a wave mid-march, and the restored seat marches identically', () => {
    const sim = marchSim();
    pack(sim, BAND, SPEARMAN);
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    sim.step();
    const barracks = barracksOf(sim);
    while ((sim.world.tryGet(barracks, WaveMarch)?.leg ?? 0) === 0) {
      if (sim.tick > LAUNCH_TICKS) throw new Error('setup: the wave never reached its second leg');
      sim.step();
    }

    const bytes = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: CONTENT,
      map: grassNodeMap(MAP_W, MAP_H),
    });
    expect(restored.hashState()).toBe(sim.hashState());
    sim.run(AFTER_TICKS);
    restored.run(AFTER_TICKS);
    expect(restored.hashState()).toBe(sim.hashState());
    expect(sim.world.tryGet(barracks, WaveMarch)?.leg ?? 0).toBeGreaterThan(1);
  });
});
