import { type ContentSet, parseContentSet } from '@vinland/data';
import { beforeEach } from 'vitest';
import * as components from '../../../src/components/index.js';
import { Building } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation, type TerrainMap } from '../../../src/index.js';
import type { TerrainGraph } from '../../../src/nav/terrain/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

/**
 * The building GROUND-FOOTPRINT mechanics — the original's free placement model:
 *  - a house places anywhere its footprint FITS (no grid fields): its reserved zone on walkable
 *    ground, clear of resource nodes, and body-vs-zone clear of every existing house;
 *  - a standing house (from the grey foundation on) walk-blocks its body cells — paths route around;
 *  - a level-0 house reserves its whole family's space (the `reserved` zone is family-constant);
 *  - settlers interact with a footprinted house at its DOOR cell, not its anchor tile.
 * The footprint fixture mirrors the extracted `[GfxHouse]` shape (blocked ⊂ familyBody ⊂ reserved,
 * door outside the walls); synthetic footprint-less types keep the old behavior — also pinned here.
 *
 * ALL integer grid coordinates here (anchors, command payloads, footprint offsets) are HALF-CELL
 * NODE coords on the 2W×2H lattice — the original's logic grid, which the extracted
 * LogicWalkBlockArea/LogicBuildBlockArea offsets always addressed.
 */

export const GRASS = 0;
export const WATER = 1;
export const VIKING = 1;
export const WOODCUTTER = 1;
export const HQ = 1; // testContent headquarters — footprint-less
export const HUT = 10; // the footprinted fixture type added below

// A 2-node body at level 0 that grows to 3 nodes at the family max, with a one-node margin ring
// around the max body (the reserved zone) and a door on the west side, outside the walls.
export const HUT_FOOTPRINT = {
  blocked: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  familyBody: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 }, // the max level's growth — reserved from level 0
  ],
  // familyBody + a 1-node margin: rows y=-1..2, x=-1..2 (16 nodes).
  reserved: [-1, 0, 1, 2].flatMap((dy) => [-1, 0, 1, 2].map((dx) => ({ dx, dy }))),
  door: { dx: -1, dy: 0 },
};

export function placementContent(): ContentSet {
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

/** A flat all-grass map (cell-dims signature; the sim's graph is the upsampled 2W×2H lattice). */
export function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

/** A W×H cell-resolution grass grid whose cells a test can overwrite before upsampling — each cell
 *  stamps its 2×2 half-cell block, so one water/margin CELL blocks four NODES. */
export function grassCells(
  width: number,
  height: number,
): { width: number; height: number; typeIds: number[] } {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

export function mappedSim(map: TerrainMap = grassMap(16, 16)): Simulation {
  return new Simulation({ seed: 1, content: placementContent(), map });
}

/** The sim's terrain graph — every test here builds a mapped sim, so absence is a fixture bug. */
export function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('mapped sim expected');
  return sim.terrain;
}

/** The `index`-th placed building entity in ascending-id order — throws when absent (a fixture bug). */
export function placedBuilding(sim: Simulation, index = 0): Entity {
  const e = [...sim.world.query(Building)].sort((a, b) => a - b)[index];
  if (e === undefined) throw new Error(`no building at index ${index}`);
  return e;
}

export function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    commands: sim.commands,
    terrain: sim.terrain,
  };
}

export function buildingsPlaced(sim: Simulation): number {
  return [...sim.world.query(Building)].length;
}

// Component stores are module-level singletons shared across Simulation instances — clear ALL of
// them (not a hand-picked subset) so no earlier test's entity leaks in (AGENTS.md [ac6a287]).
export function clearComponentStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c && c.store instanceof Map) {
      c.store.clear();
    }
  }
}
beforeEach(clearComponentStores);
