import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  DefenceMode,
  Fleeing,
  Frightened,
  Garrison,
  Health,
  JobAssignment,
  MoveGoal,
  Owner,
  PathRequest,
  Position,
  Resource,
  Resting,
  Settler,
  Sheltering,
  StayPoint,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, positionOfNode, Simulation } from '../../src/index.js';
import { LayeredBlocks } from '../../src/nav/block-overlay.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import { CombatIndex } from '../../src/systems/conflict/combat-index.js';
import { FLEE_REPATH_CADENCE, fleeDestination } from '../../src/systems/conflict/flee.js';
import {
  animalFrightSystem,
  FRIGHT_REPATH_CADENCE,
  FRIGHT_STEP_NODES,
} from '../../src/systems/conflict/fright.js';
import { firingBuildings, isFleeThreat, SIGHT_RADIUS_NODES } from '../../src/systems/conflict/targeting.js';
import { dynamicBlockOverlay, stampResourceFootprintData } from '../../src/systems/footprint/index.js';
import { combatSystem } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { manhattan } from '../../src/systems/spatial/metric.js';
import { entityNode } from '../../src/systems/spatial/nodes.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, fleeCheckCtxOf } from '../fixtures/context.js';
import { grassNodeMap, waterColumnMap } from '../fixtures/terrain.js';
import { COW, fighterAtNode } from './combat-system/support.js';
import { combatantAtNode, P0, P1 } from './stances/support.js';

/**
 * Where a runner may aim and how often it re-aims: the FLEE drive and the wildlife fright pick an away-cell
 * a route can reach, stand a refused or boxed-in run out until their cadence, and a civilian runs only from
 * a building that can shoot.
 */

const VIKING = 1;
const SOLDIER_JOB = 31;
/** A fixture civilian with no economy drive near the test's trees, so only the flee moves it. */
const CIVILIAN_JOB = 6;
const HOUSE = 90;
const TOWER = 92;
const SHELTER = 93;
const SHELTER_CAPACITY = 4;
const HOUSE_BOW = 20;
const HOUSE_BOW_RANGE = 12;
/** A house body three nodes wide, anchored on its west wall. */
const HOUSE_WALLS = [0, 1, 2].map((dx) => ({ dx, dy: 0 }));
const BUILDING_HP = 1000;
/** The tree ring around a cornered runner: every node within this Chebyshev radius but its own. */
const RING_RADIUS = 2;
/** How many ticks a cadence test watches: several whole cadences of both drives. */
const WATCH_TICKS = 5 * FLEE_REPATH_CADENCE;

function content(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: HOUSE,
        id: 'house',
        kind: 'home',
        hitpoints: BUILDING_HP,
        footprint: { blocked: HOUSE_WALLS },
      },
      {
        typeId: TOWER,
        id: 'tower',
        kind: 'tower',
        hitpoints: BUILDING_HP,
        workers: [{ jobType: SOLDIER_JOB, count: 1 }],
        footprint: { blocked: [{ dx: 0, dy: 0 }] },
      },
      {
        typeId: SHELTER,
        id: 'shelter',
        kind: 'tower',
        hitpoints: BUILDING_HP,
        shelterCapacity: SHELTER_CAPACITY,
        footprint: { blocked: [{ dx: 0, dy: 0 }] },
      },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: HOUSE_BOW,
        id: 'house_bow',
        tribeType: VIKING,
        minRange: 1,
        maxRange: HOUSE_BOW_RANGE,
        damage: {},
      },
    ],
  });
}

function sim(map = grassNodeMap(64, 64)): Simulation {
  return new Simulation({ seed: 1, content: content(), map });
}

function terrainOf(s: Simulation): TerrainGraph {
  if (s.terrain === undefined) throw new Error('mapped sim expected');
  return s.terrain;
}

function buildingAtNode(s: Simulation, type: number, hx: number, hy: number, owner: number): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(hx, hy));
  s.world.add(e, Building, { buildingType: type, tribe: VIKING, built: ONE, level: 0 });
  s.world.add(e, Health, { hitpoints: BUILDING_HP, max: BUILDING_HP });
  s.world.add(e, Owner, { player: owner });
  return e;
}

/** A tree: a resource whose one node blocks the walk. */
function treeAtNode(s: Simulation, hx: number, hy: number): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(hx, hy));
  s.world.add(e, Resource, { goodType: 1, remaining: 1, harvestAtomic: 0 });
  stampResourceFootprintData(s.world, e, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
  return e;
}

/** Trees on every node within {@link RING_RADIUS} of (hx, hy), sealing whoever stands there in. */
function treeRing(s: Simulation, hx: number, hy: number): void {
  for (let dy = -RING_RADIUS; dy <= RING_RADIUS; dy++) {
    for (let dx = -RING_RADIUS; dx <= RING_RADIUS; dx++) {
      if (dx !== 0 || dy !== 0) treeAtNode(s, hx + dx, hy + dy);
    }
  }
}

/** A soldier standing at `tower`'s post, as the garrison drive leaves one. */
function manTower(s: Simulation, tower: Entity, owner: number): Entity {
  const e = combatantAtNode(s, 0, 0, owner, MILITARY_MODE.ATTACK, { jobType: SOLDIER_JOB });
  const at = s.world.get(tower, Position);
  s.world.mut(e, Position).x = at.x;
  s.world.mut(e, Position).y = at.y;
  s.world.add(e, JobAssignment, { workplace: tower });
  s.world.add(e, Garrison, { post: tower, returnTo: { x: at.x, y: at.y } });
  return e;
}

/** Whether `e`'s player sees any flee threat around it, through the index's presence gate. */
function threatsAround(s: Simulation, e: Entity, members: Entity[]): boolean {
  const terrain = terrainOf(s);
  const { x, y } = terrain.coordsOf(entityNode(s.world, terrain, e));
  const index = new CombatIndex(s.world, ctxOf(s), terrain, members);
  return index.threatsWithin(s.world.get(e, Owner).player, x, y, SIGHT_RADIUS_NODES);
}

/** Step `ticks` combat passes on successive ticks from `from`, counting the fleer's re-aims: each one stamps
 *  a fresh `repathAt`. */
function countFleeReaims(s: Simulation, civ: Entity, from: number, ticks: number): number {
  let reaims = 0;
  let last = s.world.tryGet(civ, Fleeing)?.repathAt;
  for (let tick = from; tick < from + ticks; tick++) {
    combatSystem(s.world, { ...ctxOf(s), tick });
    const now = s.world.tryGet(civ, Fleeing)?.repathAt;
    if (now !== last) reaims++;
    last = now;
  }
  return reaims;
}

describe('fleeDestination - only a cell a route can reach', () => {
  const empty = new LayeredBlocks([]);

  it('passes over a blocked best cell for the next best one', () => {
    const s = sim();
    const terrain = terrainOf(s);
    const here = terrain.nodeAt(30, 30);
    const threat = terrain.nodeAt(34, 30);
    const best = fleeDestination(terrain, empty, here, threat);
    const next = fleeDestination(terrain, new LayeredBlocks([new Set([best])]), here, threat);
    expect(next).not.toBe(best);
    expect(next).not.toBe(here);
    expect(manhattan(terrain, next, threat)).toBeGreaterThan(manhattan(terrain, here, threat));
  });

  it('never aims across water at the other bank', () => {
    // The threat is west of a runner on the west bank, so every farther cell but the east one is off the map.
    const s = sim(waterColumnMap(20, 4, 10));
    const terrain = terrainOf(s);
    const here = terrain.nodeAt(15, 2);
    const dest = fleeDestination(terrain, empty, here, terrain.nodeAt(1, 2));
    expect(terrain.componentOf(dest)).toBe(terrain.componentOf(here));
  });
});

describe('FLEE - aiming past trees and houses', () => {
  it('runs past a tree standing on its best away-cell', () => {
    const s = sim();
    const terrain = terrainOf(s);
    const civ = combatantAtNode(s, 30, 30, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    combatantAtNode(s, 34, 30, P1, MILITARY_MODE.IGNORE);
    const best = fleeDestination(
      terrain,
      new LayeredBlocks([]),
      terrain.nodeAt(30, 30),
      terrain.nodeAt(34, 30),
    );
    const { x, y } = terrain.coordsOf(best);
    treeAtNode(s, x, y);

    combatSystem(s.world, fleeCheckCtxOf(s, civ));

    const goal = s.world.get(civ, MoveGoal).cell;
    expect(goal).not.toBe(best);
    expect(dynamicBlockOverlay(s.world, ctxOf(s), terrain).has(goal)).toBe(false);
  });

  it('runs past a house standing on its best away-cell', () => {
    const s = sim();
    const terrain = terrainOf(s);
    const civ = combatantAtNode(s, 30, 30, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    combatantAtNode(s, 34, 30, P1, MILITARY_MODE.IGNORE);
    const best = fleeDestination(
      terrain,
      new LayeredBlocks([]),
      terrain.nodeAt(30, 30),
      terrain.nodeAt(34, 30),
    );
    const { x, y } = terrain.coordsOf(best);
    buildingAtNode(s, HOUSE, x - 1, y, P0); // the middle wall on the best cell
    expect(dynamicBlockOverlay(s.world, ctxOf(s), terrain).has(best)).toBe(true);

    combatSystem(s.world, fleeCheckCtxOf(s, civ));

    const goal = s.world.get(civ, MoveGoal).cell;
    expect(goal).not.toBe(best);
    expect(dynamicBlockOverlay(s.world, ctxOf(s), terrain).has(goal)).toBe(false);
  });
});

describe('FLEE and fright - a cornered or refused run waits for the cadence', () => {
  it('a civilian boxed in by the map edge re-aims once per cadence', () => {
    // Every compass cell twelve nodes out is off a map this small.
    const s = sim(grassNodeMap(12, 12));
    const civ = combatantAtNode(s, 6, 6, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    combatantAtNode(s, 8, 6, P1, MILITARY_MODE.IGNORE);
    const from = fleeCheckCtxOf(s, civ).tick;

    const reaims = countFleeReaims(s, civ, from, WATCH_TICKS);

    expect(s.world.has(civ, MoveGoal)).toBe(false); // stands and hopes
    expect(reaims).toBeLessThanOrEqual(Math.ceil(WATCH_TICKS / FLEE_REPATH_CADENCE));
  });

  it('a refused flee route is stood out until the cadence, not re-aimed on the failure tick', () => {
    const s = sim();
    const terrain = terrainOf(s);
    const civ = combatantAtNode(s, 30, 30, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    combatantAtNode(s, 34, 30, P1, MILITARY_MODE.IGNORE);
    const from = fleeCheckCtxOf(s, civ).tick;
    combatSystem(s.world, { ...ctxOf(s), tick: from });
    const goal = s.world.get(civ, MoveGoal).cell;
    // The router's answer on the next tick: no route.
    s.world.add(civ, PathRequest, { start: terrain.nodeAt(30, 30), goal, failed: true });

    for (let tick = from + 1; tick < from + FLEE_REPATH_CADENCE; tick++) {
      combatSystem(s.world, { ...ctxOf(s), tick });
      expect(s.world.has(civ, MoveGoal)).toBe(false);
    }
    combatSystem(s.world, { ...ctxOf(s), tick: from + FLEE_REPATH_CADENCE });
    expect(s.world.has(civ, MoveGoal)).toBe(true);
  });

  it('a civilian sealed in by trees asks for a route at most once per cadence', () => {
    // Counted probe: the planner turns a goal into one PathRequest, and the router fails it the same tick,
    // so a request standing unfailed after the planner pass is one this fleer asked for.
    const s = sim();
    const civ = combatantAtNode(s, 30, 30, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    combatantAtNode(s, 34, 30, P1, MILITARY_MODE.IGNORE);
    treeRing(s, 30, 30);
    let requests = 0;
    s.setInstrument((name, run) => {
      run();
      if (name === 'planner' && s.world.tryGet(civ, PathRequest)?.failed === false) requests++;
    });

    for (let i = 0; i < WATCH_TICKS; i++) s.step();

    expect(s.world.has(civ, Fleeing)).toBe(true);
    expect(requests).toBeGreaterThan(0);
    expect(requests).toBeLessThanOrEqual(Math.ceil(WATCH_TICKS / FLEE_REPATH_CADENCE));
  });

  it('a frightened animal beside a house runs past it and stands a refused run out', () => {
    const s = sim();
    const terrain = terrainOf(s);
    const cow = fighterAtNode(s, 30, 30, COW, null);
    s.world.add(cow, StayPoint, { cell: terrain.nodeAt(30, 30) });
    const scare = terrain.nodeAt(34, 30);
    const best = fleeDestination(
      terrain,
      new LayeredBlocks([]),
      terrain.nodeAt(30, 30),
      scare,
      FRIGHT_STEP_NODES,
    );
    const { x, y } = terrain.coordsOf(best);
    buildingAtNode(s, HOUSE, x - 1, y, P0);
    const from = ctxOf(s).tick;
    s.world.add(cow, Frightened, { until: from + WATCH_TICKS * 2, repathAt: from, from: scare });

    animalFrightSystem(s.world, { ...ctxOf(s), tick: from });
    const goal = s.world.get(cow, MoveGoal).cell;
    expect(goal).not.toBe(best);
    expect(dynamicBlockOverlay(s.world, ctxOf(s), terrain).has(goal)).toBe(false);

    s.world.add(cow, PathRequest, { start: terrain.nodeAt(30, 30), goal, failed: true });
    for (let tick = from + 1; tick < from + FRIGHT_REPATH_CADENCE; tick++) {
      animalFrightSystem(s.world, { ...ctxOf(s), tick });
      expect(s.world.has(cow, MoveGoal)).toBe(false);
    }
    animalFrightSystem(s.world, { ...ctxOf(s), tick: from + FRIGHT_REPATH_CADENCE });
    expect(s.world.has(cow, MoveGoal)).toBe(true);
  });
});

describe('FLEE - only a building that shoots is a threat', () => {
  /** Whether `civ` counts building `b` as a flee threat this tick. */
  function scares(s: Simulation, civ: Entity, b: Entity): boolean {
    const ctx = ctxOf(s);
    return isFleeThreat(s.world, ctx, civ, s.world.get(civ, Settler), b, firingBuildings(s.world, ctx));
  }

  it('a civilian beside an enemy house keeps working', () => {
    const s = sim();
    const civ = combatantAtNode(s, 30, 30, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    const house = buildingAtNode(s, HOUSE, 34, 30, P1);

    expect(scares(s, civ, house)).toBe(false);
    expect(threatsAround(s, civ, [civ])).toBe(false);
    combatSystem(s.world, fleeCheckCtxOf(s, civ));
    expect(s.world.has(civ, Fleeing)).toBe(false);
  });

  it('a civilian beside an unmanned enemy tower keeps working', () => {
    const s = sim();
    const civ = combatantAtNode(s, 30, 30, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    const tower = buildingAtNode(s, TOWER, 34, 30, P1);

    expect(scares(s, civ, tower)).toBe(false);
    combatSystem(s.world, fleeCheckCtxOf(s, civ));
    expect(s.world.has(civ, Fleeing)).toBe(false);
  });

  it('a civilian beside an enemy tower with a fighter at its post flees', () => {
    // A garrison at its post is no target itself, so only the manned tower can scare the civilian.
    const s = sim();
    const civ = combatantAtNode(s, 30, 30, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    const tower = buildingAtNode(s, TOWER, 34, 30, P1);
    const soldier = manTower(s, tower, P1);

    expect(scares(s, civ, tower)).toBe(true);
    expect(threatsAround(s, civ, [civ, soldier])).toBe(true);
    combatSystem(s.world, fleeCheckCtxOf(s, civ));
    expect(s.world.has(civ, Fleeing)).toBe(true);
  });

  it('a shelter on alarm fires while anyone is inside it', () => {
    const s = sim();
    const civ = combatantAtNode(s, 30, 30, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    const shelter = buildingAtNode(s, SHELTER, 34, 30, P1);
    s.world.add(shelter, DefenceMode, {});
    expect(scares(s, civ, shelter)).toBe(false); // on alarm but empty

    // Whatever the stance of the one inside: the building aims, not its people.
    const inside = combatantAtNode(s, 34, 30, P1, MILITARY_MODE.IGNORE, { jobType: CIVILIAN_JOB });
    s.world.add(inside, Sheltering, { shelter });
    s.world.add(inside, Resting, { at: shelter });
    expect(scares(s, civ, shelter)).toBe(true);
  });

  it('the presence gate counts a manned tower but not a plain house', () => {
    // Only the buildings: the civilian is the one unit, so no enemy unit can open the gate.
    const s = sim();
    const civ = combatantAtNode(s, 30, 30, P0, MILITARY_MODE.FLEE, { jobType: CIVILIAN_JOB });
    buildingAtNode(s, HOUSE, 34, 30, P1);
    const tower = buildingAtNode(s, TOWER, 30, 36, P1);
    expect(threatsAround(s, civ, [civ])).toBe(false);

    const soldier = manTower(s, tower, P1); // left out of the members, so only the tower's firing mark counts
    expect(threatsAround(s, civ, [civ])).toBe(true);

    s.world.remove(soldier, Garrison); // off duty: the next build drops the mark
    expect(threatsAround(s, civ, [civ])).toBe(false);
  });
});
