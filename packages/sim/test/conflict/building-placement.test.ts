import { type ContentSet, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import {
  Building,
  PathFollow,
  PathRequest,
  Position,
  Resource,
  Settler,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, type TerrainMap, findPath, fx } from '../../src/index.js';
import type { TerrainGraph } from '../../src/nav/terrain.js';
import type { SystemContext } from '../../src/systems/index.js';
import { buildingBlockedCells, canPlaceBuilding, interactionTile } from '../../src/systems/index.js';
import { workerPresentAt } from '../../src/systems/shared.js';
import { testContent } from '../fixtures/content.js';

/**
 * The building GROUND-FOOTPRINT mechanics — the original's free placement model:
 *  - a house places anywhere its footprint FITS (no grid fields): its reserved zone on walkable
 *    ground, clear of resource nodes, and body-vs-zone clear of every existing house;
 *  - a standing house (from the grey foundation on) walk-blocks its body cells — paths route around;
 *  - a level-0 house reserves its whole family's space (the `reserved` zone is family-constant);
 *  - settlers interact with a footprinted house at its DOOR cell, not its anchor tile.
 * The footprint fixture mirrors the extracted `[GfxHouse]` shape (blocked ⊂ familyBody ⊂ reserved,
 * door outside the walls); synthetic footprint-less types keep the old behavior — also pinned here.
 */

const GRASS = 0;
const WATER = 1;
const VIKING = 1;
const WOODCUTTER = 1;
const HQ = 1; // testContent headquarters — footprint-less
const HUT = 10; // the footprinted fixture type added below

// A 2-cell body at level 0 that grows to 3 cells at the family max, with a one-cell margin ring
// around the max body (the reserved zone) and a door on the west side, outside the walls.
const HUT_FOOTPRINT = {
  blocked: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  familyBody: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 }, // the max level's growth — reserved from level 0
  ],
  // familyBody + a 1-cell margin: rows y=-1..2, x=-1..2 (16 cells).
  reserved: [-1, 0, 1, 2].flatMap((dy) => [-1, 0, 1, 2].map((dx) => ({ dx, dy }))),
  door: { dx: -1, dy: 0 },
};

function placementContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: HUT,
        id: 'hut',
        kind: 'workplace',
        workers: [{ jobType: WOODCUTTER, count: 1 }],
        stock: [
          { goodType: 1, capacity: 10, initial: 0 },
          { goodType: 2, capacity: 10, initial: 0 },
        ],
        recipe: { inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 2, amount: 1 }], ticks: 20 },
        footprint: HUT_FOOTPRINT,
      },
    ],
  });
}

/** A flat all-grass map. */
function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

function mappedSim(map: TerrainMap = grassMap(16, 16)): Simulation {
  return new Simulation({ seed: 1, content: placementContent(), map });
}

/** The sim's terrain graph — every test here builds a mapped sim, so absence is a fixture bug. */
function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('mapped sim expected');
  return sim.terrain;
}

/** The `index`-th placed building entity in ascending-id order — throws when absent (a fixture bug). */
function placedBuilding(sim: Simulation, index = 0): Entity {
  const e = [...sim.world.query(Building)].sort((a, b) => a - b)[index];
  if (e === undefined) throw new Error(`no building at index ${index}`);
  return e;
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    commands: sim.commands,
    terrain: sim.terrain,
  };
}

function buildingsPlaced(sim: Simulation): number {
  return [...sim.world.query(Building)].length;
}

// Component stores are module-level singletons shared across Simulation instances — clear ALL of
// them (not a hand-picked subset) so no earlier test's entity leaks in (docs/LESSONS.md [ac6a287]).
function clearStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c && c.store instanceof Map) {
      c.store.clear();
    }
  }
}
beforeEach(clearStores);

describe('canPlaceBuilding — the free-placement collision rule', () => {
  it('accepts a footprinted type on open ground and places it through the command seam', () => {
    const sim = mappedSim();
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 5, 5)).toBe(true);
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();
    expect(buildingsPlaced(sim)).toBe(1);
  });

  it('rejects a placement whose walls would land in an existing building’s reserved zone', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();
    // Anchor (3,5): the new hut's body cell (4,5) falls inside the first hut's reserved ring
    // (x∈[4..7] × y∈[4..7]) — rejected even though the WALLS themselves wouldn't touch.
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 3, y: 5, tribe: VIKING });
    sim.step();
    expect(buildingsPlaced(sim)).toBe(1);
    // The zones may OVERLAP as long as both bodies stay out of them: anchor (9,5) puts the new
    // body at x∈[9..10], clear of the first's zone (≤7), while the two margin rings share cells.
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 9, y: 5, tribe: VIKING });
    sim.step();
    expect(buildingsPlaced(sim)).toBe(2);
  });

  it('reserves the family’s FULL footprint from level 0 (the max-level body blocks neighbours)', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();
    // (6,6) is the level-max growth cell — blocked for OTHERS via the family zone even though the
    // level-0 walls don't cover it: a placement whose body would take it is rejected.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 5, 6)).toBe(false);
  });

  it('keeps the reserved zone clear of blocking terrain (minimum distance from water)', () => {
    const map = grassMap(16, 16);
    // A water cell at (8,5): the hut's reserved ring at anchor (7,5) covers x∈[6..9] — too close.
    map.typeIds[5 * 16 + 8] = WATER;
    const sim = new Simulation({ seed: 1, content: placementContent(), map });
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 7, 5)).toBe(false);
    // One cell further west the ring (x∈[4..7]) misses the water — accepted.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 5, 5)).toBe(true);
    // And a zone hanging off the map edge is rejected, not clamped.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 0, 5)).toBe(false);
  });

  it('keeps the reserved zone clear of resource nodes (minimum distance from a tree)', () => {
    const sim = mappedSim();
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(7), y: fx.fromInt(5) });
    sim.world.add(tree, Resource, { goodType: 1, remaining: 5, harvestAtomic: 24 });
    // Anchor (6,5): reserved ring x∈[5..8] covers the tree at (7,5) — rejected.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 6, 5)).toBe(false);
    // Anchor (4,5): ring x∈[3..6] misses it — accepted.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 4, 5)).toBe(true);
  });

  it('keeps a footprinted house away from a footprint-less building (1-cell body/zone) and vice versa', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HQ, x: 6, y: 6, tribe: VIKING });
    sim.step();
    // The HQ (no footprint) occupies its anchor (6,6); a hut at (5,5) would reserve that cell.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 5, 5)).toBe(false);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 9, 9)).toBe(true);
  });

  it('places a footprint-less type freely (synthetic content keeps the pre-footprint behavior)', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HQ, x: 5, y: 5, tribe: VIKING });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HQ, x: 5, y: 5, tribe: VIKING }); // same tile!
    sim.step();
    expect(buildingsPlaced(sim)).toBe(2); // no collision model — both land, like before footprints
  });
});

describe('building walk-block — houses have collision', () => {
  it('walk-blocks the body cells from the foundation tick and routes paths around them', () => {
    const sim = mappedSim(grassMap(8, 5));
    // A hut whose body occupies (3,1)-(4,1): the straight west→east line along y=1 is blocked.
    // (5 rows so the reserved ring y∈[0..3] fits the map — a ring off the edge rejects placement.)
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HUT,
      x: 3,
      y: 1,
      tribe: VIKING,
      underConstruction: true,
    });
    sim.step();
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim));
    expect(blocked.has(terrainOf(sim).cellAt(3, 1))).toBe(true); // a grey foundation already occupies
    expect(blocked.has(terrainOf(sim).cellAt(4, 1))).toBe(true);
    expect(blocked.has(terrainOf(sim).cellAt(2, 1))).toBe(false); // the door cell stays walkable

    const walker = sim.world.create();
    sim.world.add(walker, Position, { x: fx.fromInt(0), y: fx.fromInt(1) });
    sim.world.add(walker, PathRequest, {
      start: terrainOf(sim).cellAt(0, 1),
      goal: terrainOf(sim).cellAt(7, 1),
      failed: false,
    });
    sim.step();
    const path = sim.world.get(walker, PathFollow).waypoints.map((w) => `${fx.toInt(w.x)},${fx.toInt(w.y)}`);
    expect(path).not.toContain('3,1');
    expect(path).not.toContain('4,1');
    expect(path[path.length - 1]).toBe('7,1'); // still reaches the far side, routed around the walls
  });

  it('fails a path whose goal is inside a building', () => {
    const sim = mappedSim(grassMap(8, 5));
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 3, y: 1, tribe: VIKING });
    sim.step();
    const walker = sim.world.create();
    sim.world.add(walker, Position, { x: fx.fromInt(0), y: fx.fromInt(1) });
    sim.world.add(walker, PathRequest, {
      start: terrainOf(sim).cellAt(0, 1),
      goal: terrainOf(sim).cellAt(3, 1), // the wall cell itself
      failed: false,
    });
    sim.step();
    expect(sim.world.get(walker, PathRequest).failed).toBe(true);
    expect(sim.world.has(walker, PathFollow)).toBe(false);
  });
});

describe('door cell — settlers interact with a house at its entry point', () => {
  it('resolves the interaction tile to the door (footprinted) or the anchor (footprint-less)', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HQ, x: 9, y: 9, tribe: VIKING });
    sim.step();
    const hut = placedBuilding(sim, 0);
    const hq = placedBuilding(sim, 1);
    expect(interactionTile(sim.world, ctxOf(sim), hut)).toEqual({ x: 4, y: 5 }); // anchor + door(-1,0)
    expect(interactionTile(sim.world, ctxOf(sim), hq)).toEqual({ x: 9, y: 9 }); // anchor itself
  });

  it('counts a worker standing at the DOOR as present (and one on the anchor as absent)', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();
    const hut = placedBuilding(sim);
    const worker = sim.world.create();
    sim.world.add(worker, Settler, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map<number, number>(),
    });
    sim.world.add(worker, Position, { x: fx.fromInt(5), y: fx.fromInt(5) }); // ON the walls — not at work
    expect(workerPresentAt(sim.world, ctxOf(sim), hut)).toBe(false);
    sim.world.get(worker, Position).x = fx.fromInt(4); // at the door (4,5)
    expect(workerPresentAt(sim.world, ctxOf(sim), hut)).toBe(true);
  });
});

describe('determinism', () => {
  it('two same-seed runs through placement + rejection + pathing hash identically', () => {
    const run = (): string => {
      clearStores();
      const sim = mappedSim();
      sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
      sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 6, y: 5, tribe: VIKING }); // rejected
      sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 5, tribe: VIKING });
      for (let i = 0; i < 50; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('wall gate — a door listed inside the walls stays walkable', () => {
  // The real data's defence wall (`work_pottery_02`, the "Mur" records) puts its LogicDoorPoint
  // INSIDE its own LogicWalkBlockArea: the door IS the wall's passable gate. Without the carve-out
  // a walk-to-door goal would be a blocked cell → findPath fails → the request is never re-issued →
  // the settler wedges forever. Pinned here on a synthetic gate fixture of the same shape.
  const GATE = 11;
  const GATE_FOOTPRINT = {
    blocked: [
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 }, // the gate cell — ALSO the door below, like the real wall records
      { dx: 1, dy: 0 },
    ],
    familyBody: [
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    reserved: [-1, 0, 1].flatMap((dy) => [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy }))),
    door: { dx: 0, dy: 0 },
  };

  function gateContent(): ContentSet {
    const base = placementContent();
    return parseContentSet({
      ...base,
      buildings: [
        ...base.buildings,
        { typeId: GATE, id: 'wall_gate', kind: 'tower', footprint: GATE_FOOTPRINT },
      ],
    });
  }

  it('leaves the door cell out of the walk-block overlay and routes THROUGH the gate', () => {
    const sim = new Simulation({ seed: 1, content: gateContent(), map: grassMap(9, 7) });
    sim.enqueue({ kind: 'placeBuilding', buildingType: GATE, x: 4, y: 3, tribe: VIKING });
    sim.step();
    const terrain = terrainOf(sim);
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(blocked.has(terrain.cellAt(3, 3))).toBe(true); // wall segment
    expect(blocked.has(terrain.cellAt(5, 3))).toBe(true); // wall segment
    expect(blocked.has(terrain.cellAt(4, 3))).toBe(false); // the gate/door — carved out, passable
    // A path to the gate cell itself (the interaction tile) succeeds instead of wedging.
    expect(interactionTile(sim.world, ctxOf(sim), placedBuilding(sim))).toEqual({ x: 4, y: 3 });
    const walker = sim.world.create();
    sim.world.add(walker, Position, { x: fx.fromInt(0), y: fx.fromInt(3) });
    sim.world.add(walker, PathRequest, {
      start: terrain.cellAt(0, 3),
      goal: terrain.cellAt(4, 3),
      failed: false,
    });
    sim.step();
    expect(sim.world.has(walker, PathFollow)).toBe(true);
  });
});

describe('findPath — the blocked-start/goal exemptions', () => {
  it('trivially succeeds when start === goal even on a building cell (already there)', () => {
    const sim = mappedSim(grassMap(8, 5));
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 3, y: 1, tribe: VIKING });
    sim.step();
    const terrain = terrainOf(sim);
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    const wall = terrain.cellAt(3, 1);
    expect(blocked.has(wall)).toBe(true);
    expect(findPath(terrain, wall, wall, blocked)).toEqual([wall]); // standing on it — not "unreachable"
  });
});
