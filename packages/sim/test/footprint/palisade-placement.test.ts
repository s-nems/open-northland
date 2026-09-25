import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Position, Resource, type ResourceFootprintData } from '../../src/components/index.js';
import { positionOfNode, type ScriptLandscapeType, type Simulation } from '../../src/index.js';
import { canPlaceBuilding, stampResourceFootprintData } from '../../src/systems/index.js';
import {
  ctxOf,
  grassMap,
  HUT,
  HUT_FOOTPRINT,
  mappedSim,
  terrainOf,
  VIKING,
} from './building-placement/support.js';

/** A single-post wall with the source's hexagon build margin, which placement no longer reads. */
const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: -1, dy: -1 },
    { dx: 0, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: 0, dy: 1 },
  ],
  groups: [],
  wall: {
    maxHitpoints: 100,
    repairPerStrike: 3,
    construction: [{ goodType: 5, amount: 1 }],
  },
};

const WOOD = 1;
const HARVEST_ATOMIC = 24;
/** A tree whose trunk fills its anchor and whose build margin rings it. */
const TREE: ResourceFootprintData = {
  walk: [{ dx: 0, dy: 0 }],
  build: WALL.build,
  work: [],
};

function wallSim(): Simulation {
  const map = grassMap(16, 16);
  return mappedSim({ ...map, landscapes: { types: [WALL], placements: [] } });
}

function canPlaceWall(sim: Simulation, x: number, y: number): boolean {
  return sim.palisadeProbe(WALL.typeId)?.canPlace(x, y) === true;
}

function cellsAt(cells: readonly FootprintCell[], x: number, y: number): { hx: number; hy: number }[] {
  return cells.map((c) => ({ hx: x + footprintCellDx(y, c), hy: y + c.dy }));
}

describe('palisade placement', () => {
  it('stands in a tree margin and beside the trunk, never on it', () => {
    const sim = wallSim();
    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(10, 10));
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: HARVEST_ATOMIC });
    stampResourceFootprintData(sim.world, tree, TREE);

    expect(canPlaceWall(sim, 10, 10)).toBe(false);
    for (const { hx, hy } of cellsAt(TREE.build, 10, 10)) {
      if (hx === 10 && hy === 10) continue;
      expect(canPlaceWall(sim, hx, hy), `${hx},${hy}`).toBe(true);
    }
  });

  it('runs up to a building wall, and a building may rise against a wall, neither on the other', () => {
    const sim = wallSim();
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 8, y: 8, tribe: VIKING });
    sim.step();
    const body = cellsAt(HUT_FOOTPRINT.familyBody, 8, 8);
    const key = ({ hx, hy }: { hx: number; hy: number }): string => `${hx},${hy}`;
    const bodyKeys = new Set(body.map(key));
    for (const at of body) expect(canPlaceWall(sim, at.hx, at.hy), key(at)).toBe(false);
    const margin = cellsAt(HUT_FOOTPRINT.reserved, 8, 8).filter((at) => !bodyKeys.has(key(at)));
    for (const at of margin) expect(canPlaceWall(sim, at.hx, at.hy), key(at)).toBe(true);

    // A post just east of a second hut's east wall: in its margin, off its body.
    sim.enqueueSetup({ kind: 'placePalisade', gfxIndex: WALL.typeId, x: 22, y: 20, tribe: VIKING });
    sim.step();
    const ctx = ctxOf(sim);
    const terrain = terrainOf(sim);
    expect(canPlaceBuilding(sim.world, ctx, terrain, HUT, 20, 20)).toBe(true);
    expect(canPlaceBuilding(sim.world, ctx, terrain, HUT, 22, 20)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
