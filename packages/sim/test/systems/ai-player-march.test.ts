import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Owner, Position, Settler, WaveMarch } from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command, PlayerCommand } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { EventBuffer, playerCommand, Rng, Simulation } from '../../src/index.js';
import { type HalfCellNode, positionOfNode } from '../../src/nav/halfcell.js';
import {
  ASSAULT_RING_RADIUS_NODES,
  CHARGE_ARMY_DIVISOR,
  CHARGE_MIN_ENEMIES,
  militaryModule,
  RALLY_HOLD_RADIUS_NODES,
} from '../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
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

function marchSim(): Simulation {
  const sim = new Simulation({ seed: 1, content: CONTENT, map: grassNodeMap(128, 96) });
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
    const rally = rallyOf(sim);
    const catapults = [
      catapultAt(sim, { x: rally.x + 4, y: rally.y + 10 }),
      catapultAt(sim, { x: rally.x - 6, y: rally.y + 10 }),
    ];
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
});

describe('military module - the wave charges', () => {
  /** A wave of `size` launched and standing in midfield, with `enemies` fighters moved in beside it. Both
   *  are set down between decisions, so nobody is in a fight yet. */
  function standoff(size: number, enemies: number): { sim: Simulation; band: Entity[]; foes: Entity[] } {
    const sim = marchSim();
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
});

describe('military module - the siege', () => {
  it('turns the catapults and archers on the towers while the melee waits, then sends everyone in', () => {
    const sim = marchSim();
    const rally = rallyOf(sim);
    const catapult = catapultAt(sim, { x: rally.x + 4, y: rally.y + 10 });
    const spearmen = pack(sim, BAND, SPEARMAN);
    const bowmen = pack(sim, 2, BOWMAN, BAND);
    run(sim);
    sim.world.mut(barracksOf(sim), WaveMarch).arrived = true;
    place(sim, TOWER_TYPE, FOE_TOWER, FOE);
    const tower = foeBuilding(sim, TOWER_TYPE);

    const siege = run(sim);
    expect(siege.filter((c) => c.kind === 'attackWithVehicle')).toEqual([
      { kind: 'attackWithVehicle', vehicle: catapult, target: { kind: 'entity', entity: tower } },
    ]);
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
    expect(drives(assault).map((c) => [c.vehicle, c.attackMove])).toEqual([[catapult, true]]);
  });
});
