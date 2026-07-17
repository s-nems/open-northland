import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  MoveGoal,
  Position,
  Settler,
  Stockpile,
  stampOwner,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, nodeOfPosition, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { findPath } from '../../src/nav/pathfinding.js';
import { constructionSystem, dynamicBlockOverlay } from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import {
  HUT,
  HUT_FOOTPRINT,
  mappedSim,
  terrainOf,
  VIKING,
  WOODCUTTER,
} from '../footprint/building-placement/support.js';

/**
 * Displacement — a settler never ends up standing inside walls, from either side. Building-first
 * (`evictSettlersFromFootprint`): the moment a plot becomes impassable (a placement onto occupied
 * ground, a construction finish, a home tier upgrade growing the walls), settlers standing inside are
 * pushed to the nearest free cell. Settler-first (`evictSettlerFromBlockedSpawn`): a settler spawned
 * onto an already-standing body is pushed out, which is the case an authored map load hits.
 * The HUT fixture's body is (0,0)+(1,0) with the door at (-1,0); anchored at (5,5) the body nodes are
 * (5,5) and (6,5), the door (4,5).
 */

const PLAYER = 0;
const ANCHOR = { x: 5, y: 5 };
const BODY = [
  { x: 5, y: 5 },
  { x: 6, y: 5 },
];

function settlerAtNode(sim: Simulation, x: number, y: number, owner?: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  stampOwner(sim.world, e, owner);
  return e;
}

function nodeOf(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return { x: n.hx, y: n.hy };
}

function onBody(sim: Simulation, e: Entity): boolean {
  const n = nodeOf(sim, e);
  return BODY.some((c) => c.x === n.x && c.y === n.y);
}

/** The one settler a spawn test created — throws when absent, so a dropped command fails loudly rather
 *  than passing vacuously. */
function spawnedSettler(sim: Simulation): Entity {
  const all = [...sim.world.query(Settler)];
  const [only] = all;
  if (all.length !== 1 || only === undefined) {
    throw new Error(`expected exactly one spawned settler, got ${all.length}`);
  }
  return only;
}

/** Can the settler stand — and therefore leave — where it ended up? Walkable ground, clear of every
 *  building/resource walk-block, which is exactly what the pathfinder demands of a route's mid-cells. */
function standable(sim: Simulation, e: Entity): boolean {
  const terrain = terrainOf(sim);
  const n = nodeOf(sim, e);
  const node = terrain.nodeAt(n.x, n.y);
  return terrain.isWalkable(node) && !dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(node);
}

describe('footprint displacement — settlers never end up standing inside walls', () => {
  it('placing a building onto standing settlers pushes them off every body cell', () => {
    const sim = mappedSim();
    const onAnchor = settlerAtNode(sim, 5, 5, PLAYER);
    const onWall = settlerAtNode(sim, 6, 5, PLAYER);
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    expect(onBody(sim, onAnchor)).toBe(false);
    expect(onBody(sim, onWall)).toBe(false);
    // Displaced to two DISTINCT free cells (the claim set fans evictees out).
    expect(nodeOf(sim, onAnchor)).not.toEqual(nodeOf(sim, onWall));
  });

  it('spares the door cell — it is the passable gate, not a wall', () => {
    const sim = mappedSim();
    const door = HUT_FOOTPRINT.door;
    const atDoor = settlerAtNode(sim, ANCHOR.x + door.dx, ANCHOR.y + door.dy, PLAYER);
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    expect(nodeOf(sim, atDoor)).toEqual({ x: ANCHOR.x + door.dx, y: ANCHOR.y + door.dy });
  });

  it('leaves unowned fixtures and mid-transit walkers alone', () => {
    const sim = mappedSim();
    const unowned = settlerAtNode(sim, 5, 5); // no Owner — the spacing drives' byte-identical stance
    const walker = settlerAtNode(sim, 6, 5, PLAYER);
    sim.world.add(walker, MoveGoal, { cell: terrainOf(sim).nodeAt(10, 5) }); // passing through — its route plays out
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    expect(nodeOf(sim, unowned)).toEqual({ x: 5, y: 5 });
    // The walker was not teleported by the eviction — it is still travelling its own route.
    expect(sim.world.has(walker, MoveGoal) || onBody(sim, walker)).toBe(true);
  });

  it('a construction finish evicts a stray that wandered onto the plot mid-build', () => {
    const sim = mappedSim();
    // A HUT site raised by hand (empty construction cost → finishes on the first construction tick).
    const site = sim.world.create();
    sim.world.add(site, Position, positionOfNode(ANCHOR.x, ANCHOR.y));
    sim.world.add(site, Building, { buildingType: HUT, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(site, Stockpile, { amounts: new Map<number, number>() });
    const stray = settlerAtNode(sim, 6, 5, PLAYER);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(site, Building).built).toBe(ONE); // finished this tick
    expect(onBody(sim, stray)).toBe(false); // and the stray was pushed outside the walls
  });

  it('a settler spawned inside a standing house body is pushed outside it', () => {
    const sim = mappedSim();
    // The authored map-load order: every `placeBuilding` enqueues BEFORE any `spawnSettler`, so the
    // building's own eviction pass runs while the settler does not yet exist — the spawn push is what
    // covers this. Both land in one tick, exactly as `enqueuePlacements` sends them.
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, tribe: VIKING, x: 6, y: 5, owner: PLAYER });
    sim.step();
    const walled = spawnedSettler(sim);
    expect(onBody(sim, walled)).toBe(false);
    // The point of the push: the settler stands somewhere it can actually walk out of.
    expect(standable(sim, walled)).toBe(true);
  });

  it('frees a fully enclosed spawn — the only case that is genuinely stuck', () => {
    // `findPath` exempts a blocked START, so standing on a body cell is not itself a wedge: a settler
    // walks off as soon as ONE step is passable. Only a cell whose every `steps()` edge is blocked has
    // no way out — 50 of the 1041 real blocked spawns. KEEP's body is exactly that: the anchor plus its
    // eight lattice steps (E/W, the four diagonals, N/S), so a settler on the anchor is truly walled in.
    const KEEP = 30;
    const SOLID = [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 }, // E, W
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 }, // N, S
      { dx: 1, dy: -2 },
      { dx: 1, dy: 2 },
      { dx: -1, dy: 2 },
      { dx: -1, dy: -2 }, // NE, SE, SW, NW
    ];
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
      buildings: [{ typeId: KEEP, id: 'keep', kind: 'workplace', footprint: { blocked: SOLID } }],
    });
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(16, 16) });
    const keep = sim.world.create();
    sim.world.add(keep, Position, positionOfNode(8, 8));
    sim.world.add(keep, Building, { buildingType: KEEP, tribe: VIKING, built: ONE, level: 0 });

    const terrain = terrainOf(sim);
    const walled = terrain.nodeAt(8, 8);
    const away = terrain.nodeAt(2, 2);
    const blocks = dynamicBlockOverlay(sim.world, ctxOf(sim), terrain);
    // The fixture proves itself: the authored cell really has no route out before the push.
    expect(findPath(terrain, walled, away, blocks)).toBeNull();

    sim.enqueue({ kind: 'spawnSettler', jobType: 0, tribe: VIKING, x: 8, y: 8, owner: PLAYER });
    sim.step();
    const freed = spawnedSettler(sim);
    const at = nodeOf(sim, freed);
    expect(at).not.toEqual({ x: 8, y: 8 }); // pushed off the walled anchor…
    // …and it can now actually walk away, which is the whole point.
    expect(findPath(terrain, terrain.nodeAt(at.x, at.y), away, blocks)).not.toBeNull();
  });

  it('a settler spawned on free ground keeps its authored cell', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, tribe: VIKING, x: 10, y: 10, owner: PLAYER });
    sim.step();
    expect(nodeOf(sim, spawnedSettler(sim))).toEqual({ x: 10, y: 10 });
  });

  it('a settler spawned on the door cell stays — the door is a passable stand, not a wall', () => {
    const sim = mappedSim();
    const door = HUT_FOOTPRINT.door;
    const at = { x: ANCHOR.x + door.dx, y: ANCHOR.y + door.dy };
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.enqueue({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      tribe: VIKING,
      x: at.x,
      y: at.y,
      owner: PLAYER,
    });
    sim.step();
    expect(nodeOf(sim, spawnedSettler(sim))).toEqual(at);
  });

  it('a home tier upgrade evicts settlers from the cells the larger footprint encloses', () => {
    const HOME_S = 20; // 1-node body
    const HOME_L = 21; // grows one node east
    const STONE = 1;
    const content = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [
        { typeId: 0, id: 'none' },
        { typeId: STONE, id: 'stone' },
      ],
      jobs: [{ typeId: 0, id: 'idle' }],
      landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
      buildings: [
        {
          typeId: HOME_S,
          id: 'home_level_00',
          kind: 'home',
          homeSize: 1,
          construction: [{ goodType: STONE, amount: 1 }],
          footprint: { blocked: [{ dx: 0, dy: 0 }] },
        },
        {
          typeId: HOME_L,
          id: 'home_level_01',
          kind: 'home',
          homeSize: 2,
          construction: [{ goodType: STONE, amount: 1 }],
          footprint: {
            blocked: [
              { dx: 0, dy: 0 },
              { dx: 1, dy: 0 },
            ],
          },
        },
      ],
    });
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(16, 16) });
    const home = sim.world.create();
    sim.world.add(home, Position, positionOfNode(5, 5));
    sim.world.add(home, Building, { buildingType: HOME_S, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(home, Stockpile, { amounts: new Map<number, number>([[STONE, 1]]) }); // next tier paid
    const beside = settlerAtNode(sim, 6, 5, PLAYER); // legal today, enclosed by HOME_L's body
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(home, Building).buildingType).toBe(HOME_L); // upgraded
    expect(nodeOf(sim, beside)).not.toEqual({ x: 6, y: 5 }); // and the settler stepped aside
  });
});
