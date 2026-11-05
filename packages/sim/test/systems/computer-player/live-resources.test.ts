import { describe, expect, it } from 'vitest';
import { FOG_MODE, mapBriefOf, Position, Resource } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../src/index.js';
import { ownedSettlers } from '../../../src/systems/ai-shared/seat-roster.js';
import {
  anyLiveResource,
  gathererReach,
  knownResourceTest,
  nearestLiveResource,
  reachableResourceGate,
  reachableResourceTest,
} from '../../../src/systems/computer-player/live-resources.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { cellOfNode } from '../../../src/systems/vision/gates.js';
import type { FogState } from '../../../src/systems/vision/state.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { waterColumnMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  COLLECTOR,
  ctxOf,
  HQ_X,
  HQ_Y,
  IRON,
  MUD,
  makeAiSeat,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  spawnMen,
} from './support.js';

/** Stood at the scan, far from the seat's base. */
const EARLY = RESOURCE_SPOTS.mud;
/** Placed after the scan, nearer the base than {@link EARLY}. */
const LATER = { ...RESOURCE_SPOTS.mud, x: 40, y: 16 };
/** A good of which only a post-scan deposit stands. */
const LATER_IRON = { ...RESOURCE_SPOTS.iron, x: 44, y: 20 };
const BASE = { hx: HQ_X, hy: HQ_Y };
const SIGHT_RADIUS = 3;
const FLAG_RADIUS = 6;

interface Setup {
  sim: Simulation;
  early: Entity;
  later: Entity;
}

/** A computer seat scanned with only {@link EARLY} on the map, then {@link LATER} and {@link LATER_IRON}
 *  placed. */
function setup(): Setup {
  const sim = aiSim();
  makeAiSeat(sim, SEAT);
  placeHq(sim);
  placeResources(sim, [EARLY]);
  sim.step();
  if (mapBriefOf(sim.world) === null) throw new Error('setup: the seat scanned the map');
  placeResources(sim, [LATER, LATER_IRON]);
  spawnMen(sim, 1, COLLECTOR);
  sim.step();
  const muds = [...sim.world.query(Resource)]
    .filter((e) => sim.world.get(e, Resource).goodType === MUD)
    .sort((a, b) => a - b);
  const [early, later] = muds;
  if (early === undefined || later === undefined) throw new Error('setup: two mud deposits');
  return { sim, early, later };
}

/** Fog of war with nothing in the seat's sight; the tests stamp sight by hand and never step after. */
function fogOfWar(sim: Simulation): FogState {
  const fog = sim.fog;
  if (fog === undefined) throw new Error('setup: a mapped sim has fog');
  fog.activeMode = FOG_MODE.CLASSIC_FOG_OF_WAR;
  return fog;
}

function ctxWith(sim: Simulation, fog?: FogState): SystemContext {
  return { ...ctxOf(sim, sim.tick), ...(fog ? { fog } : {}) };
}

function nearestMud(sim: Simulation, ctx: SystemContext): Entity | null {
  return nearestLiveResource(sim.world, MUD, BASE, knownResourceTest(sim.world, ctx, SEAT) ?? undefined);
}

describe('computer seat resource searches', () => {
  it('passes over a post-scan deposit on unexplored ground for one that stood at the scan', () => {
    const { sim, early } = setup();
    const ctx = ctxWith(sim, fogOfWar(sim));
    expect(nearestMud(sim, ctx)).toBe(early);
    expect(anyLiveResource(sim.world, IRON, knownResourceTest(sim.world, ctx, SEAT))).toBe(false);
  });

  it('takes a post-scan deposit once its ground is explored', () => {
    const { sim, later } = setup();
    const fog = fogOfWar(sim);
    const { cx, cy } = cellOfNode(LATER.x, LATER.y);
    fog.stampSight(SEAT, cx, cy, SIGHT_RADIUS);
    expect(nearestMud(sim, ctxWith(sim, fog))).toBe(later);
  });

  it('knows every deposit with the fog off', () => {
    const { sim, later } = setup();
    const ctx = ctxWith(sim);
    expect(knownResourceTest(sim.world, ctx, SEAT)).toBeNull();
    expect(nearestMud(sim, ctx)).toBe(later);
    expect(anyLiveResource(sim.world, IRON)).toBe(true);
  });

  it("keeps the assistant's harvest reach over unexplored ground", () => {
    const { sim, later } = setup();
    const ctx = ctxWith(sim, fogOfWar(sim));
    const terrain = sim.terrain;
    const [holder] = ownedSettlers(sim.world, SEAT);
    if (terrain === undefined || holder === undefined) throw new Error('setup');
    const flag = { hx: LATER.x, hy: LATER.y };
    expect(gathererReach(sim.world, ctx, terrain).canWork(holder, flag, FLAG_RADIUS, later)).toBe(true);
    const known = knownResourceTest(sim.world, ctx, SEAT);
    expect(gathererReach(sim.world, ctx, terrain, known).canWork(holder, flag, FLAG_RADIUS, later)).toBe(
      false,
    );
  });
});

/** A cell map cut in two banks by a water column at cell column `river` (half-cell node x 32-33). */
const BANKS_CELLS = { width: 32, height: 16, river: 16 };
const WEST_ORIGIN = { hx: 10, hy: 16 };
/** `placeResources` takes the west deposit's spot; the move writes the east one's half-cell node. */
const WEST_DEPOSIT = { x: 20, y: 16 };
const EAST_DEPOSIT = { hx: 48, hy: 16 };

describe('reachable resource test', () => {
  it('judges a moved deposit by its new bank, not by the bound read before the move', () => {
    const map = waterColumnMap(BANKS_CELLS.width, BANKS_CELLS.height, BANKS_CELLS.river);
    const sim = new Simulation({ seed: 1, content: aiContent(), map });
    placeResources(sim, [{ ...RESOURCE_SPOTS.mud, ...WEST_DEPOSIT }]);
    sim.step();
    const terrain = sim.terrain;
    const [deposit] = sim.world.query(Resource);
    if (terrain === undefined || deposit === undefined) throw new Error('setup: a mapped sim with a deposit');
    const reachable = () =>
      reachableResourceTest(sim.world, ctxOf(sim), terrain, WEST_ORIGIN, () => true)(deposit);
    expect(reachable()).toBe(true);
    Object.assign(sim.world.mut(deposit, Position), positionOfNode(EAST_DEPOSIT.hx, EAST_DEPOSIT.hy));
    expect(reachable()).toBe(false);
  });

  it("gates out an anchor across the water and keeps one on the origin's bank", () => {
    const map = waterColumnMap(BANKS_CELLS.width, BANKS_CELLS.height, BANKS_CELLS.river);
    const sim = new Simulation({ seed: 1, content: aiContent(), map });
    placeResources(sim, [{ ...RESOURCE_SPOTS.mud, ...WEST_DEPOSIT }]);
    sim.step();
    const terrain = sim.terrain;
    const [deposit] = sim.world.query(Resource);
    if (terrain === undefined || deposit === undefined) throw new Error('setup: a mapped sim with a deposit');
    const ctx = ctxOf(sim);
    const gate = reachableResourceGate(ctx, terrain, WEST_ORIGIN);
    const reachable = reachableResourceTest(sim.world, ctx, terrain, WEST_ORIGIN, () => true);
    const mud = sim.world.get(deposit, Resource).goodType;
    expect(gate?.(EAST_DEPOSIT.hx, EAST_DEPOSIT.hy)).toBe(false);
    expect(nearestLiveResource(sim.world, mud, WEST_ORIGIN, reachable, gate)).toBe(deposit);
  });
});
