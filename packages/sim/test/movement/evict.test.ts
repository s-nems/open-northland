import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  BerryBush,
  Building,
  CurrentAtomic,
  DEFAULT_WORK_FLAG_RADIUS,
  DeliveryFlag,
  GroundDrop,
  MoveGoal,
  Position,
  Settler,
  Stockpile,
  stampOwner,
  UnderConstruction,
  WorkFlag,
  YardDeliveryRoute,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, nodeOfPosition, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import {
  canPlaceWorkFlag,
  constructionSystem,
  createBerryBush,
  dynamicBlockOverlay,
  evictWorkFlagsFromFootprint,
} from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import {
  HQ,
  HUT,
  HUT_FOOTPRINT,
  mappedSim,
  terrainOf,
  VIKING,
  WOODCUTTER,
} from '../footprint/building-placement/support.js';

/**
 * Displacement — nothing a house lands on ends up sealed inside its walls. Settlers, from either side:
 * building-first (`evictSettlersFromFootprint`), the moment a plot becomes impassable (a placement onto
 * occupied ground, a construction finish, a home tier upgrade growing the walls), settlers standing inside
 * are pushed to the nearest free cell; settler-first (`evictSettlerFromBlockedSpawn`), a settler spawned
 * onto an already-standing body is pushed out, which is the case an authored map load hits. And work flags
 * (`evictWorkFlagsFromFootprint`): the placement gates ignore flags, so a house may legally land on one.
 * The HUT fixture's body is (0,0)+(1,0) with the door at (-1,0); anchored at (5,5) the body nodes are
 * (5,5) and (6,5), the door (4,5). Its family body adds the growth cell (6,6) — reserved from level 0,
 * and walls to a flag though not to a walker, which is the flag/settler split these two suites pin.
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
      manifest: TEST_MANIFEST,
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
          upgradeTarget: HOME_L,
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
    sim.world.add(home, Stockpile, { amounts: new Map<number, number>() });
    const beside = settlerAtNode(sim, 6, 5, PLAYER); // legal today, enclosed by HOME_L's body
    sim.enqueue({ kind: 'upgradeBuilding', building: home });
    sim.step(); // opens the upgrade site (the small body doesn't reach (6,5) — the settler stays)
    // Deliver the difference and hammer the site out by hand; the finish adopts the larger tier.
    sim.world.get(home, Stockpile).amounts.set(STONE, 1);
    sim.world.get(home, UnderConstruction).labor = ONE;
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(home, Building).buildingType).toBe(HOME_L); // upgraded
    expect(nodeOf(sim, beside)).not.toEqual({ x: 6, y: 5 }); // and the settler stepped aside
  });
});

/**
 * The sealed-nook rule: a stamp that closes the last open orthogonal side of a still-walkable cell it
 * touches displaces the settler resting there (the real repro: the upgrade scene's builder hammered from
 * the one-node gap between the HQ and the home, and the finished tier-2 wall sealed it — he rested on
 * under the HQ sprite for good). The fixture: HOME_S at (5,5) upgrades to HOME_L, whose body grows to
 * (6,5); a U-shaped neighbour blocks (7,4), (8,5), (7,6), so the finish seals the nook at (7,5).
 */
describe('footprint displacement — a finish that seals a nook beside the body displaces its occupant', () => {
  const HOME_S = 20;
  const HOME_L = 21;
  const U_WALLS = 22;
  const U_WALLS_DOORED = 23; // same walls, door on its own anchor — the nook cell becomes a designated stand
  const STONE = 1;
  const NOOK = { x: 7, y: 5 };
  const U_BODY = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ];

  function nookContent() {
    return parseContentSet({
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
          upgradeTarget: HOME_L,
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
        { typeId: U_WALLS, id: 'u_walls', kind: 'workplace', footprint: { blocked: U_BODY } },
        {
          typeId: U_WALLS_DOORED,
          id: 'u_walls_doored',
          kind: 'workplace',
          footprint: { blocked: U_BODY, door: { dx: 0, dy: 0 } },
        },
      ],
    });
  }

  /** A built HOME_S at (5,5), a U neighbour anchored ON the nook cell, then the upgrade hammered out. */
  function sealNook(uType: number | null): Simulation {
    const sim = new Simulation({ seed: 1, content: nookContent(), map: grassNodeMap(16, 16) });
    const home = sim.world.create();
    sim.world.add(home, Position, positionOfNode(5, 5));
    sim.world.add(home, Building, { buildingType: HOME_S, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(home, Stockpile, { amounts: new Map<number, number>() });
    if (uType !== null) {
      const walls = sim.world.create();
      sim.world.add(walls, Position, positionOfNode(NOOK.x, NOOK.y));
      sim.world.add(walls, Building, { buildingType: uType, tribe: VIKING, built: ONE, level: 0 });
    }
    sim.enqueue({ kind: 'upgradeBuilding', building: home });
    sim.step();
    sim.world.get(home, Stockpile).amounts.set(STONE, 1);
    sim.world.get(home, UnderConstruction).labor = ONE;
    return sim;
  }

  it('displaces the resting settler out of the sealed nook', () => {
    const sim = sealNook(U_WALLS);
    const wedged = settlerAtNode(sim, NOOK.x, NOOK.y, PLAYER);
    constructionSystem(sim.world, ctxOf(sim));
    expect(nodeOf(sim, wedged)).not.toEqual(NOOK); // pushed out…
    expect(standable(sim, wedged)).toBe(true); // …onto ground it can stand on and leave
  });

  it('leaves a settler beside the body alone while any orthogonal side stays open', () => {
    const sim = sealNook(null); // no U neighbour — (7,4), (8,5), (7,6) stay free
    const beside = settlerAtNode(sim, NOOK.x, NOOK.y, PLAYER);
    constructionSystem(sim.world, ctxOf(sim));
    expect(nodeOf(sim, beside)).toEqual(NOOK);
  });

  it('spares a door cell even when the stamp seals it — a door is a designated stand', () => {
    const sim = sealNook(U_WALLS_DOORED); // the nook cell is the U building's own door
    const atDoor = settlerAtNode(sim, NOOK.x, NOOK.y, PLAYER);
    constructionSystem(sim.world, ctxOf(sim));
    expect(nodeOf(sim, atDoor)).toEqual(NOOK);
  });
});

/** A bare flag marker at a node — a gatherer-less `Position + DeliveryFlag`, which is all the geometry
 *  half of the push-out reads. */
function flagAtNode(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, DeliveryFlag, {});
  return e;
}

/** The HUT's family body anchored at ANCHOR: the level-0 walls plus the growth cell a level-0 house
 *  already reserves. Wider than BODY (the walk-block set) — flag legality is family-body-wide. */
const FAMILY_BODY = HUT_FOOTPRINT.familyBody.map((c) => ({ x: ANCHOR.x + c.dx, y: ANCHOR.y + c.dy }));

describe('footprint displacement — a work flag is never sealed inside a placed house', () => {
  it('a house placed onto a flag pushes it to a legal field it could be re-planted on', () => {
    const sim = mappedSim();
    const flag = flagAtNode(sim, ANCHOR.x, ANCHOR.y); // on the anchor, under the walls-to-be
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    const at = nodeOf(sim, flag);
    expect(FAMILY_BODY).not.toContainEqual(at); // off the body…
    const terrain = terrainOf(sim);
    // …and onto ground the plant rule actually accepts — the invariant the push exists to restore.
    // Ignoring the flag itself, exactly as `setWorkFlag` does: a marker occupies its own cell.
    expect(canPlaceWorkFlag(sim.world, ctxOf(sim), terrain, terrain.nodeAt(at.x, at.y), flag)).toBe(true);
  });

  it('evicts a flag on a growth cell the level-0 walls do not yet cover', () => {
    // (6,6) is in familyBody but NOT in `blocked` — the settler twin's walk-block set would leave it.
    // A flag there is still illegal ground (`workFlagPlacementBlocks` is family-body-wide), so it moves.
    const sim = mappedSim();
    const growth = { x: ANCHOR.x + 1, y: ANCHOR.y + 1 };
    expect(BODY).not.toContainEqual(growth); // the fixture proves itself: not walk-blocked…
    expect(FAMILY_BODY).toContainEqual(growth); // …but inside the family body
    const flag = flagAtNode(sim, growth.x, growth.y);
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    expect(nodeOf(sim, flag)).not.toEqual(growth);
  });

  it('leaves a flag on open ground beside the plot alone', () => {
    const sim = mappedSim();
    const flag = flagAtNode(sim, 10, 10);
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    expect(nodeOf(sim, flag)).toEqual({ x: 10, y: 10 });
  });

  it('never pushes a flag onto a cell another flag already holds', () => {
    // Derived, not hardcoded: run the push once to learn where a lone flag lands, then re-run with a
    // bystander already sitting there. Two flags placed side by side would pass even against a stale
    // blocker set (each has its own nearest cell), so the contested cell has to be the SAME one.
    const lone = mappedSim();
    const solo = flagAtNode(lone, ANCHOR.x, ANCHOR.y);
    lone.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    lone.step();
    const contested = nodeOf(lone, solo);

    const sim = mappedSim();
    const evicted = flagAtNode(sim, ANCHOR.x, ANCHOR.y);
    const bystander = flagAtNode(sim, contested.x, contested.y); // legal ground, outside the body
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    expect(nodeOf(sim, bystander)).toEqual(contested); // the sitting flag never moves…
    expect(nodeOf(sim, evicted)).not.toEqual(contested); // …and the evicted one goes around it
    expect(FAMILY_BODY).not.toContainEqual(nodeOf(sim, evicted));
  });

  it('fans two enclosed flags onto distinct cells', () => {
    const sim = mappedSim();
    const onAnchor = flagAtNode(sim, ANCHOR.x, ANCHOR.y);
    const onWall = flagAtNode(sim, ANCHOR.x + 1, ANCHOR.y);
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    expect(nodeOf(sim, onAnchor)).not.toEqual(nodeOf(sim, onWall));
    for (const f of [onAnchor, onWall]) expect(FAMILY_BODY).not.toContainEqual(nodeOf(sim, f));
  });

  it('evicts a flag from a footprint-less type, which blocks only its anchor', () => {
    const sim = mappedSim();
    const flag = flagAtNode(sim, ANCHOR.x, ANCHOR.y);
    const beside = flagAtNode(sim, ANCHOR.x + 1, ANCHOR.y); // off HQ's anchor — no body to be inside
    sim.enqueue({ kind: 'placeBuilding', buildingType: HQ, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    expect(nodeOf(sim, flag)).not.toEqual({ x: ANCHOR.x, y: ANCHOR.y });
    expect(nodeOf(sim, beside)).toEqual({ x: ANCHOR.x + 1, y: ANCHOR.y });
  });

  it('sheds the gatherer delivery + nav state that cached the old flag position', () => {
    // Called directly: a full step would re-plan the gatherer in the same tick, hiding whether the
    // eviction itself cleared the stale state.
    const sim = mappedSim();
    const flag = flagAtNode(sim, ANCHOR.x, ANCHOR.y);
    const gatherer = settlerAtNode(sim, 10, 10, PLAYER);
    sim.world.add(gatherer, WorkFlag, { flag, radius: DEFAULT_WORK_FLAG_RADIUS });
    sim.world.add(gatherer, YardDeliveryRoute, {
      flag,
      goodType: 1,
      goal: terrainOf(sim).nodeAt(ANCHOR.x, ANCHOR.y), // the yard node beside the OLD position
      failed: false,
    });
    sim.world.add(gatherer, CurrentAtomic, {
      atomicId: 0,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 10,
      effect: { kind: 'pileup', store: flag },
      targetEntity: flag,
      targetTile: null,
    });
    sim.world.add(gatherer, MoveGoal, { cell: terrainOf(sim).nodeAt(ANCHOR.x, ANCHOR.y) });

    const house = sim.world.create();
    sim.world.add(house, Position, positionOfNode(ANCHOR.x, ANCHOR.y));
    sim.world.add(house, Building, { buildingType: HUT, tribe: VIKING, built: ONE, level: 0 });
    evictWorkFlagsFromFootprint(sim.world, ctxOf(sim), house);

    expect(FAMILY_BODY).not.toContainEqual(nodeOf(sim, flag)); // the marker moved…
    expect(sim.world.get(gatherer, WorkFlag).flag).toBe(flag); // …the binding survives (same entity)…
    // …and every cache of the old position is gone, so the gatherer re-plans against the new one.
    expect(sim.world.has(gatherer, YardDeliveryRoute)).toBe(false);
    expect(sim.world.has(gatherer, CurrentAtomic)).toBe(false); // the in-flight pileup into this flag
    expect(sim.world.has(gatherer, MoveGoal)).toBe(false);
  });
});

describe('footprint displacement — loose goods never end up buried under walls', () => {
  const WOOD_GOOD = 1; // testContent wood
  const STONE_GOOD = 4; // testContent stone

  /** Every loose pile (a positioned Stockpile that is not a building store), ascending id. */
  function loosePiles(sim: Simulation): Entity[] {
    return [...sim.world.query(Stockpile, Position)]
      .filter((e) => !sim.world.has(e, Building))
      .sort((a, b) => a - b);
  }

  function pileAtNode(
    sim: Simulation,
    x: number,
    y: number,
    good: number,
    amount: number,
    trunk = false,
  ): Entity {
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(x, y));
    sim.world.add(e, Stockpile, { amounts: new Map([[good, amount]]) });
    if (trunk) sim.world.add(e, GroundDrop, { goodType: good });
    return e;
  }

  /** A hand-raised HUT site at the anchor (empty cost → finishes on the first construction tick). */
  function handRaisedSite(sim: Simulation): Entity {
    const site = sim.world.create();
    sim.world.add(site, Position, positionOfNode(ANCHOR.x, ANCHOR.y));
    sim.world.add(site, Building, { buildingType: HUT, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(site, Stockpile, { amounts: new Map<number, number>() });
    return site;
  }

  it('placing a building onto piles displaces them outside the walls, goods conserved', () => {
    const sim = mappedSim();
    pileAtNode(sim, 5, 5, WOOD_GOOD, 3, true); // a felled trunk on the anchor
    pileAtNode(sim, 6, 5, STONE_GOOD, 2); // a bare heap on the wall cell
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    const piles = loosePiles(sim);
    expect(piles).toHaveLength(2);
    for (const pile of piles) {
      expect(onBody(sim, pile)).toBe(false); // off every wall cell…
      expect(standable(sim, pile)).toBe(true); // …on ground a fetcher can stand on
    }
    // Goods conserved, the trunk marker carried over (a gatherer still reclaims its drop), and the two
    // piles landed on DISTINCT cells (one pile per landing tile — no burying a good under another).
    const trunk = piles.find((p) => sim.world.has(p, GroundDrop));
    const heap = piles.find((p) => !sim.world.has(p, GroundDrop));
    if (trunk === undefined || heap === undefined) throw new Error('expected a trunk and a heap');
    expect(sim.world.get(trunk, Stockpile).amounts.get(WOOD_GOOD)).toBe(3);
    expect(sim.world.get(trunk, GroundDrop).goodType).toBe(WOOD_GOOD);
    expect(sim.world.get(heap, Stockpile).amounts.get(STONE_GOOD)).toBe(2);
    expect(nodeOf(sim, trunk)).not.toEqual(nodeOf(sim, heap));
  });

  it('spares a heap on the door cell — the door stays a reachable stand', () => {
    const sim = mappedSim();
    const door = HUT_FOOTPRINT.door;
    const heap = pileAtNode(sim, ANCHOR.x + door.dx, ANCHOR.y + door.dy, WOOD_GOOD, 2);
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    expect(nodeOf(sim, heap)).toEqual({ x: ANCHOR.x + door.dx, y: ANCHOR.y + door.dy });
  });

  it('a construction finish displaces a pile set down on the plot mid-build', () => {
    const sim = mappedSim();
    handRaisedSite(sim);
    const pile = pileAtNode(sim, 6, 5, WOOD_GOOD, 1);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(pile, Stockpile)).toBe(false); // displacement is destroy + create…
    const [moved] = loosePiles(sim);
    if (moved === undefined) throw new Error('expected the displaced pile');
    expect(onBody(sim, moved)).toBe(false); // …and the successor lies outside the finished walls
    expect(sim.world.get(moved, Stockpile).amounts.get(WOOD_GOOD)).toBe(1);
  });

  it('a finish razes decor standing in the reserved zone — the placement rule, re-applied when a tier can grow', () => {
    const sim = mappedSim();
    handRaisedSite(sim);
    const bush = createBerryBush(sim.world, { x: 6, y: 6 }); // the growth cell — inside the reserved zone
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.tryGet(bush, BerryBush)).toBeUndefined();
  });
});
