import { describe, expect, it } from 'vitest';
import type { Simulation } from '../../src/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { nearestWorkFlagPlacement, workFlagPlacementBlocks } from '../../src/systems/index.js';
import { ctxOf } from '../fixtures/context.js';
import { GRASS, HUT, mappedSim, terrainOf, VIKING, WATER } from './building-placement/support.js';

/** The HUT's anchor in every placement fixture — body (5,5)+(6,5), door (4,5). */
const ANCHOR = { x: 5, y: 5 };

/** The uncapped whole-map scan `nearestWorkFlagPlacement`'s ring search replaced — the reference its
 *  `(distance, then lowest node id)` winner must match byte-identically. */
function linearReference(sim: Simulation, from: NodeId): NodeId | null {
  const terrain = terrainOf(sim);
  const origin = terrain.coordsOf(from);
  const blocked = workFlagPlacementBlocks(sim.world, sim.content, terrain);
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      const candidate = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(candidate) || blocked.has(candidate)) continue;
      const distance = Math.abs(x - origin.x) + Math.abs(y - origin.y);
      if (distance < bestDistance || (distance === bestDistance && (best === null || candidate < best))) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

describe('nearestWorkFlagPlacement', () => {
  it('returns the origin itself when it is already legal', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const from = terrain.nodeAt(ANCHOR.x, ANCHOR.y);
    expect(nearestWorkFlagPlacement(sim.world, ctxOf(sim), terrain, from)).toBe(from);
  });

  it('picks the whole-map reference winner from every origin around a placed building', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    const terrain = terrainOf(sim);
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const from = terrain.nodeAt(x, y);
        expect(nearestWorkFlagPlacement(sim.world, ctxOf(sim), terrain, from)).toBe(
          linearReference(sim, from),
        );
      }
    }
  });

  it('falls back to the reference scan when nothing lies within the ring cap', () => {
    // A water strip pushing the nearest walkable node to Manhattan distance 55 from the west edge —
    // past the internal 48-ring cap, so only the fallback can find it.
    const FIRST_LAND_X = 55;
    const WIDTH = 60;
    const HEIGHT = 2;
    const typeIds = Array.from({ length: WIDTH * HEIGHT }, (_, i) =>
      i % WIDTH < FIRST_LAND_X ? WATER : GRASS,
    );
    const sim = mappedSim({ resolution: 'half-cell', width: WIDTH, height: HEIGHT, typeIds });
    const terrain = terrainOf(sim);
    const from = terrain.nodeAt(0, 0);
    const found = nearestWorkFlagPlacement(sim.world, ctxOf(sim), terrain, from);
    expect(found).toBe(terrain.nodeAt(FIRST_LAND_X, 0)); // distance 55, lowest node id of that ring
    expect(found).toBe(linearReference(sim, from));
  });
});
