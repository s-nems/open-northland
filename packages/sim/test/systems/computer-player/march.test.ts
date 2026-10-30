import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Owner, Position, Settler, Vehicle, WaveMarch } from '../../../src/components/index.js';
import { CommandQueue } from '../../../src/core/command-queue.js';
import type { Command, PlayerCommand } from '../../../src/core/commands/index.js';
import { PersonalNames } from '../../../src/core/personal-names.js';
import type { Entity } from '../../../src/ecs/world.js';
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
} from '../../../src/index.js';
import { type HalfCellNode, hexDistance, positionOfNode } from '../../../src/nav/halfcell.js';
import {
  ASSAULT_RING_RADIUS_NODES,
  GATHER_MARCH_TIMEOUT_TICKS,
  GATHER_STANDOFF_NODES,
  GATHER_TOWER_CLEARANCE_HEX,
  GATHER_WAIT_TICKS,
  militaryModule,
  RALLY_HOLD_RADIUS_NODES,
  SIEGE_MARCH_MIN_CATAPULTS,
  SIEGE_TIMEOUT_TICKS,
} from '../../../src/systems/computer-player/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { interactionCell } from '../../../src/systems/settlers/targets/index.js';
import { entityNode } from '../../../src/systems/spatial/nodes.js';
import { boardRider, createVehicle, removeVehicle } from '../../../src/systems/vehicles/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

// A launched wave gathers short of the enemy base, goes in as one group attack-move once most of it has
// arrived or a timeout runs out, and its catapults break the towers by the objective first.

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
    names: new PersonalNames(1, []),
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

/** Each man's goal in the wave's group attack-moves of `commands`. */
function groupWalks(commands: readonly Command[]): Map<Entity, HalfCellNode> {
  const goals = new Map<Entity, HalfCellNode>();
  for (const c of commands) {
    if (c.kind !== 'attackMoveUnitGroup') continue;
    for (const m of c.members) goals.set(m.entity, { hx: m.x, hy: m.y });
  }
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

function gatherPointOf(sim: Simulation): HalfCellNode {
  const at = march(sim).gatherAt;
  if (at === null) throw new Error('expected a gathering wave');
  return at;
}

/** The men `commands` send into the ring around the objective. */
function sentIn(sim: Simulation, commands: readonly Command[]): Entity[] {
  const objective = objectiveOf(sim);
  return [...groupWalks(commands)]
    .filter(([, g]) => manhattan(g, objective) <= ASSAULT_RING_RADIUS_NODES)
    .map(([e]) => e);
}

/** Set `men` down on their goals in `commands`, as if they had walked there. */
function arrive(sim: Simulation, commands: readonly Command[], men: readonly Entity[]): void {
  const goals = groupWalks(commands);
  for (const e of men) {
    const goal = goals.get(e);
    if (goal === undefined) throw new Error('expected a goal');
    teleport(sim, e, goal);
  }
}

describe('military module - the wave gathers, then goes in', () => {
  it('walks to a gathering point short of the base and goes in once most of it stands there', () => {
    const sim = marchSim();
    const band = pack(sim, BAND, SPEARMAN);
    const first = run(sim);
    const state = march(sim);
    expect(state.men).toEqual(band);
    const gather = gatherPointOf(sim);
    const objective = objectiveOf(sim);
    expect(manhattan(gather, objective)).toBeGreaterThan(GATHER_STANDOFF_NODES);
    expect(manhattan(gather, objective)).toBeLessThan(
      manhattan(gather, rallyOf(sim)) + GATHER_STANDOFF_NODES,
    );
    // One group attack-move, as a player's selection click gives, onto the ring around the point.
    expect(first.filter((c) => c.kind === 'attackMoveUnit')).toEqual([]);
    const goals = groupWalks(first);
    expect([...goals.keys()]).toEqual(band);
    for (const g of goals.values())
      expect(manhattan(g, gather)).toBeLessThanOrEqual(ASSAULT_RING_RADIUS_NODES);

    // Three of five arrive: too few, so the wave waits and walks only the other two on.
    const [a, b, c, d, e] = band;
    if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined)
      throw new Error('setup: no band');
    arrive(sim, first, [a, b, c]);
    const waiting = run(sim);
    expect(march(sim).gatherAt).not.toBeNull();
    expect(march(sim).firstArrival).toBe(sim.tick);
    expect([...groupWalks(waiting).keys()]).toEqual([d, e]);

    // A fourth arrives: the wave goes in on the objective, the straggler with it.
    arrive(sim, first, [d]);
    const assault = run(sim);
    expect(march(sim).gatherAt).toBeNull();
    expect(sentIn(sim, assault)).toEqual(band);
  });

  it('goes in with whoever stands there once the wait for the stragglers runs out', () => {
    const sim = marchSim();
    const band = pack(sim, BAND, SPEARMAN);
    const first = run(sim);
    const [vanguard] = band;
    if (vanguard === undefined) throw new Error('setup: no band');
    arrive(sim, first, [vanguard]);
    run(sim);
    expect(march(sim).gatherAt).not.toBeNull();

    sim.world.mut(barracksOf(sim), WaveMarch).firstArrival = sim.tick - GATHER_WAIT_TICKS;
    const assault = run(sim);
    expect(march(sim).gatherAt).toBeNull();
    expect(sentIn(sim, assault)).toEqual(band);
  });

  it('goes in once the march has taken too long, even with nobody there', () => {
    const sim = marchSim();
    const band = pack(sim, BAND, SPEARMAN);
    run(sim);
    expect(march(sim).firstArrival).toBeNull();
    sim.world.mut(barracksOf(sim), WaveMarch).since = sim.tick - GATHER_MARCH_TIMEOUT_TICKS;
    expect(sentIn(sim, run(sim))).toEqual(band);
  });

  it('gathers out of reach of an enemy tower on the way', () => {
    const sim = marchSim();
    place(sim, TOWER_TYPE, FOE_TOWER, FOE);
    pack(sim, BAND, SPEARMAN);
    run(sim);
    const towerNode = entityNode(sim.world, terrainOf(sim), foeBuilding(sim, TOWER_TYPE));
    const { x, y } = terrainOf(sim).coordsOf(towerNode);
    expect(hexDistance(gatherPointOf(sim), { hx: x, hy: y })).toBeGreaterThan(GATHER_TOWER_CLEARANCE_HEX);
  });
});

describe('military module - the siege march needs four catapults', () => {
  it('leaves fewer than four catapults parked at home', () => {
    const sim = marchSim();
    const catapults = siegeTrain(sim, SIEGE_MARCH_MIN_CATAPULTS - 1);
    pack(sim, BAND, SPEARMAN);
    const commands = run(sim);
    expect(march(sim).catapults).toEqual([]);
    expect(drives(commands).filter((c) => catapults.includes(c.vehicle) && c.attackMove === true)).toEqual(
      [],
    );
  });

  it('drives the catapults to the gathering point with the men', () => {
    const sim = marchSim();
    const catapults = siegeTrain(sim);
    pack(sim, BAND, SPEARMAN);
    const commands = run(sim);
    expect(march(sim).catapults).toEqual(catapults);
    const drove = drives(commands);
    expect(drove.map((c) => c.vehicle)).toEqual(catapults);
    expect(drove.every((c) => c.attackMove === true)).toBe(true);
    // Each drive is a hop toward the gathering point, never past it.
    const gather = gatherPointOf(sim);
    const door = rallyOf(sim);
    for (const c of drove)
      expect(manhattan({ hx: c.x, hy: c.y }, door)).toBeLessThan(manhattan(gather, door));
  });

  it('sends the rest home when a catapult is lost on the way', () => {
    const sim = marchSim();
    const catapults = siegeTrain(sim);
    pack(sim, BAND, SPEARMAN);
    run(sim);
    const [lost] = catapults;
    if (lost === undefined) throw new Error('setup');
    removeVehicle(sim.world, ctxOf(sim), lost, 'destroyed');
    const next = run(sim);
    expect(march(sim).catapults).toEqual([]);
    expect(drives(next).filter((c) => c.attackMove === true)).toEqual([]);
  });
});

describe('military module - the catapults at the objective', () => {
  /** A wave of four catapults and spearmen sent in, with an enemy tower beside its objective. */
  function sentInBeside(map?: TerrainMap) {
    const sim = marchSim(map);
    const catapults = siegeTrain(sim);
    const men = pack(sim, BAND, SPEARMAN);
    run(sim);
    sim.world.mut(barracksOf(sim), WaveMarch).since = sim.tick - GATHER_MARCH_TIMEOUT_TICKS;
    run(sim);
    expect(march(sim).gatherAt).toBeNull();
    place(sim, TOWER_TYPE, FOE_TOWER, FOE);
    return { sim, catapults, men, tower: foeBuilding(sim, TOWER_TYPE) };
  }

  it('turns the catapults on the tower while the men go in at once, then drives them in once it falls', () => {
    const { sim, catapults, men, tower } = sentInBeside();
    const siege = run(sim);
    expect(siege.filter((c) => c.kind === 'attackWithVehicle')).toEqual(
      catapults.map((vehicle) => ({
        kind: 'attackWithVehicle',
        vehicle,
        target: { kind: 'entity', entity: tower },
      })),
    );
    expect(sentIn(sim, siege)).toEqual(men);

    sim.world.destroy(tower);
    const assault = run(sim);
    expect(drives(assault).map((c) => [c.vehicle, c.attackMove])).toEqual(catapults.map((v) => [v, true]));
  });

  it('leaves a tower across the water to the men', () => {
    const moat = { x0: FOE_TOWER.x - 6, y0: FOE_TOWER.y - 6, x1: FOE_TOWER.x + 6, y1: FOE_TOWER.y + 6 };
    const { sim, catapults } = sentInBeside(moatMap(moat));
    const commands = run(sim);
    expect(commands.some((c) => c.kind === 'attackWithVehicle')).toBe(false);
    expect(drives(commands).map((c) => c.vehicle)).toEqual(catapults);
  });

  it('gives the towers up for the objective once the siege has lasted too long', () => {
    const { sim, catapults } = sentInBeside();
    expect(run(sim).some((c) => c.kind === 'attackWithVehicle')).toBe(true);
    for (const v of catapults) sim.world.mut(v, Vehicle).attack = null;
    sim.world.mut(barracksOf(sim), WaveMarch).since = sim.tick - SIEGE_TIMEOUT_TICKS;
    const commands = run(sim);
    expect(commands.some((c) => c.kind === 'attackWithVehicle')).toBe(false);
    expect(drives(commands).map((c) => c.vehicle)).toEqual(catapults);
  });
});

describe('military module - a marching wave through a save', { timeout: 60_000 }, () => {
  /** Ticks to wait for the seat to launch its wave. */
  const LAUNCH_TICKS = 6000;
  /** Ticks the wave walks before the save, so it is under way. */
  const WALK_TICKS = 200;

  it('restores a wave on its way to the gathering point', () => {
    const sim = marchSim();
    pack(sim, BAND, SPEARMAN);
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true });
    sim.step();
    const barracks = barracksOf(sim);
    while (!sim.world.has(barracks, WaveMarch)) {
      if (sim.tick > LAUNCH_TICKS) throw new Error('setup: the wave never launched');
      sim.step();
    }
    for (let i = 0; i < WALK_TICKS; i++) sim.step();
    expect(sim.world.get(barracks, WaveMarch).gatherAt).not.toBeNull();

    const bytes = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: CONTENT,
      map: grassNodeMap(MAP_W, MAP_H),
    });
    expect(restored.hashState()).toBe(sim.hashState());
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(bytes);
  });
});
