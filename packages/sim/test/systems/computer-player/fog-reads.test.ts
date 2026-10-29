import { describe, expect, it } from 'vitest';
import { AiControl, aiControlEntity, FOG_MODE } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { seatRaiders } from '../../../src/systems/ai-shared/military/defence/index.js';
import { ownedBuildings } from '../../../src/systems/ai-shared/seat-roster.js';
import { campaignTarget, waveBandAt } from '../../../src/systems/computer-player/index.js';
import {
  believedDefendingPoints,
  strongestBelievedEnemy,
} from '../../../src/systems/computer-player/military/enemy-strength.js';
import { enemyTowerNodesNear } from '../../../src/systems/computer-player/military/march/siege.js';
import { unitPoints } from '../../../src/systems/computer-player/military/points.js';
import { nearestEnemyBuilding } from '../../../src/systems/computer-player/sea-route.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { ownedFightersOf } from '../../../src/systems/movement/collision/owned-fighters.js';
import { cellOfNode } from '../../../src/systems/vision/gates.js';
import type { FogState } from '../../../src/systems/vision/state.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  ctxOf,
  HQ_TYPE,
  makeAiSeat,
  placeHq,
  SEAT,
  STOCK_TYPE,
  TOWER_TYPE,
  UNARMED,
  VIKING,
} from './support.js';

const MAP_W = 128;
const MAP_H = 64;
const OTHER = 1;
const OTHER_START = { x: 100, y: 40 };
/** Raised after the start scan, nearer the seat than its start building. */
const OTHER_LATER = { x: 80, y: 40 };
const FIGHTERS_AT = { x: 90, y: 30 };
const SIGHT_RADIUS = 2;
/** Wide enough to take in the whole spawned band. */
const ARMY_SIGHT_RADIUS = 8;
/** More than the opening wave band, so a counted army never reads as the unknown default. */
const FIGHTERS = 9;
const RALLY = { x: 30, y: 30 };

/** A computer seat (or, with `computerEnabled` false, a map-AI seat) and another seat holding one start
 *  building of `startType`, scanned before anything else is placed. */
function fogSim(startType: number, computerEnabled = true): Simulation {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(MAP_W, MAP_H) });
  makeAiSeat(sim, SEAT);
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier !== null) sim.world.mut(carrier, AiControl).computerEnabled = computerEnabled;
  placeHq(sim);
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: OTHER, tribes: [VIKING] });
  place(sim, startType, OTHER_START);
  sim.step();
  return sim;
}

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }): Entity {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, ...at, tribe: VIKING, owner: OTHER });
  sim.step();
  const owned = ownedBuildings(sim.world, OTHER);
  const newest = owned[owned.length - 1];
  if (newest === undefined) throw new Error('setup: the other seat has no building');
  return newest;
}

function spawnFighters(sim: Simulation): void {
  for (let i = 0; i < FIGHTERS; i++) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: UNARMED,
      x: FIGHTERS_AT.x + 2 * (i % 3),
      y: FIGHTERS_AT.y + 2 * Math.floor(i / 3),
      tribe: VIKING,
      owner: OTHER,
    });
  }
  sim.step();
}

/** The sim's masks under a fog-of-war mode, nothing in the seat's sight; the tests stamp sight by hand
 *  and never step after. */
function fogOfWar(sim: Simulation): FogState {
  const fog = sim.fog;
  if (fog === undefined) throw new Error('setup: a mapped sim has fog');
  fog.activeMode = FOG_MODE.CLASSIC_FOG_OF_WAR;
  return fog;
}

function lookAt(fog: FogState, at: { x: number; y: number }, radius = SIGHT_RADIUS): void {
  const { cx, cy } = cellOfNode(at.x, at.y);
  fog.stampSight(SEAT, cx, cy, radius);
}

function fogCtx(sim: Simulation, fog?: FogState): SystemContext {
  return { ...ctxOf(sim, sim.tick), content: sim.content, ...(fog ? { fog } : {}) };
}

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('setup: a mapped sim has terrain');
  return sim.terrain;
}

function rallyOf(sim: Simulation): NodeId {
  return terrainOf(sim).nodeAtClamped(RALLY.x, RALLY.y);
}

describe('computer seat reads under fog of war', () => {
  it('marches on a start headquarters it has never seen', () => {
    const sim = fogSim(HQ_TYPE);
    const hq = ownedBuildings(sim.world, OTHER)[0];
    const ctx = fogCtx(sim, fogOfWar(sim));
    expect(campaignTarget(sim.world, ctx, terrainOf(sim), SEAT, rallyOf(sim))).toBe(hq);
    expect(nearestEnemyBuilding(sim.world, ctx, SEAT, { hx: RALLY.x, hy: RALLY.y })?.entity).toBe(hq);
  });

  it('marches on and fronts toward a later building only once it is seen', () => {
    const sim = fogSim(STOCK_TYPE);
    const start = ownedBuildings(sim.world, OTHER)[0];
    const tower = place(sim, TOWER_TYPE, OTHER_LATER);
    const fog = fogOfWar(sim);
    const target = () => campaignTarget(sim.world, fogCtx(sim, fog), terrainOf(sim), SEAT, rallyOf(sim));
    const front = () =>
      nearestEnemyBuilding(sim.world, fogCtx(sim, fog), SEAT, { hx: RALLY.x, hy: RALLY.y })?.entity;
    expect(target()).toBe(start);
    expect(front()).toBe(start);
    lookAt(fog, OTHER_LATER);
    expect(target()).toBe(tower);
    expect(front()).toBe(tower);
  });

  it('counts a tower near the objective only once it is seen', () => {
    const sim = fogSim(STOCK_TYPE);
    place(sim, TOWER_TYPE, OTHER_LATER);
    const fog = fogOfWar(sim);
    const objective = terrainOf(sim).nodeAtClamped(OTHER_START.x, OTHER_START.y);
    const towers = () => enemyTowerNodesNear(sim.world, fogCtx(sim, fog), terrainOf(sim), SEAT, objective);
    expect(towers()).toEqual([]);
    lookAt(fog, OTHER_LATER);
    expect(towers()).toHaveLength(1);
  });

  it('weighs unseen fighters as unknown and seen ones by their points', () => {
    const sim = fogSim(STOCK_TYPE);
    spawnFighters(sim);
    const fog = fogOfWar(sim);
    const own = 4;
    const ctx = fogCtx(sim, fog);
    // Unknown: the launch assumes parity, the floor the opening band of the seat's phase.
    expect(believedDefendingPoints(sim.world, ctx, SEAT, OTHER, own)).toBe(own);
    expect(strongestBelievedEnemy(sim.world, ctx, SEAT)).toEqual({
      men: waveBandAt(sim.tick).min,
      points: null,
    });
    lookAt(fog, FIGHTERS_AT, ARMY_SIGHT_RADIUS);
    const points = armyPoints(sim, ctx);
    expect(believedDefendingPoints(sim.world, ctx, SEAT, OTHER, own)).toBe(points);
    expect(strongestBelievedEnemy(sim.world, ctx, SEAT)).toEqual({ men: FIGHTERS, points });
  });

  it('agrees with the live army with the fog off', () => {
    const sim = fogSim(STOCK_TYPE);
    spawnFighters(sim);
    const ctx = fogCtx(sim);
    const points = armyPoints(sim, ctx);
    expect(strongestBelievedEnemy(sim.world, ctx, SEAT)).toEqual({ men: FIGHTERS, points });
    expect(believedDefendingPoints(sim.world, ctx, SEAT, OTHER, 0)).toBe(points);
  });
});

function armyPoints(sim: Simulation, ctx: SystemContext): number {
  const fighters = ownedFightersOf(sim.world, sim.content, OTHER);
  expect(fighters).toHaveLength(FIGHTERS);
  return fighters.reduce((sum, e) => sum + unitPoints(sim.world, ctx, e), 0);
}

describe('shared enemy reads by controller', () => {
  it('lists an unseen raider for a map-AI seat but not for a computer seat until it sees him', () => {
    const mapAi = fogSim(STOCK_TYPE, false);
    spawnFighters(mapAi);
    const mapAiCtx = fogCtx(mapAi, fogOfWar(mapAi));
    expect(seatRaiders(mapAi.world, mapAiCtx, terrainOf(mapAi), SEAT)).toHaveLength(FIGHTERS);

    const computer = fogSim(STOCK_TYPE);
    spawnFighters(computer);
    const fog = fogOfWar(computer);
    const raiders = () =>
      seatRaiders(computer.world, fogCtx(computer, fog), terrainOf(computer), SEAT).length;
    expect(raiders()).toBe(0);
    // Only the sight changed: the seat's cached scan must not outlive it.
    lookAt(fog, FIGHTERS_AT, ARMY_SIGHT_RADIUS);
    expect(raiders()).toBe(FIGHTERS);
  });
});
