import { describe, expect, it } from 'vitest';
import { Position } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, type Simulation } from '../../src/index.js';
import {
  ROUTE_REGION_POCKET_CAP,
  routeRegions,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../../src/systems/index.js';
import { ctxOf } from '../fixtures/context.js';
import { grassMap, mappedSim, terrainOf } from './resource-footprint/support.js';

/**
 * The route-region memo: a clear node sealed inside blocker walls is provably unroutable from
 * outside, while everything the memo cannot prove stays routable (fail-open). The veto direction
 * must be exact — a wrong "unroutable" would retire a reachable node with no expiry, unlike the
 * time-bounded failed-goal memo.
 */

/** A walk-blocking wall entity anchored at half-cell NODE (x, y) with the given cell offsets. */
function wallAt(sim: Simulation, x: number, y: number, offsets: Array<{ dx: number; dy: number }>): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  stampResourceFootprintData(sim.world, e, { walk: offsets, build: [], work: [] });
  return e;
}

/** The 8 step-neighbour offsets of the anchor — a ring that seals the anchor node alone. */
const SEAL_RING = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 2 },
  { dx: 1, dy: -2 },
  { dx: -1, dy: 2 },
  { dx: -1, dy: -2 },
];

/** A rectangle wall in anchor-relative offsets: rows dy=0 and dy=height-1 span the full width, and
 *  the two side columns fill the rows between — a one-node-thick perimeter, which the 8-direction
 *  step set cannot cross (straight steps hit a blocked destination, diagonals a blocked flank pair). */
function rectangleWall(width: number, height: number): Array<{ dx: number; dy: number }> {
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (let dx = 0; dx < width; dx++) offsets.push({ dx, dy: 0 }, { dx, dy: height - 1 });
  for (let dy = 1; dy < height - 1; dy++) offsets.push({ dx: 0, dy }, { dx: width - 1, dy });
  return offsets;
}

describe('routeRegions', () => {
  it('proves a clear node sealed by a blocker ring unroutable, in both directions', () => {
    const sim = mappedSim(grassMap(12, 6));
    const terrain = terrainOf(sim);
    wallAt(sim, 10, 6, SEAL_RING);
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);
    const sealed = terrain.nodeAt(10, 6);
    const outside = terrain.nodeAt(2, 2);

    expect(regions.unroutable(outside, sealed)).toBe(true);
    expect(regions.unroutable(sealed, outside)).toBe(true);
  });

  it('keeps two nodes of the same pocket routable to each other', () => {
    const sim = mappedSim(grassMap(12, 6));
    const terrain = terrainOf(sim);
    // A 3-wide, 7-tall perimeter sealing the interior column (11, 3..7) — a 5-node pocket.
    wallAt(sim, 10, 2, rectangleWall(3, 7));
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);

    expect(regions.unroutable(terrain.nodeAt(11, 3), terrain.nodeAt(11, 5))).toBe(false);
    expect(regions.unroutable(terrain.nodeAt(2, 2), terrain.nodeAt(11, 4))).toBe(true);
  });

  it('proves two separate pockets mutually unroutable', () => {
    const sim = mappedSim(grassMap(14, 6));
    const terrain = terrainOf(sim);
    wallAt(sim, 4, 6, SEAL_RING);
    wallAt(sim, 20, 6, SEAL_RING);
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);

    expect(regions.unroutable(terrain.nodeAt(4, 6), terrain.nodeAt(20, 6))).toBe(true);
  });

  it('re-opens a pocket when the sealing footprint is unstamped', () => {
    const sim = mappedSim(grassMap(12, 6));
    const terrain = terrainOf(sim);
    const wall = wallAt(sim, 10, 6, SEAL_RING);
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);
    const sealed = terrain.nodeAt(10, 6);
    const outside = terrain.nodeAt(2, 2);
    expect(regions.unroutable(outside, sealed)).toBe(true);

    unstampResourceFootprint(sim.world, wall);

    // The same instance re-keys per verdict, so the freed route is visible without re-resolving.
    expect(regions.unroutable(outside, sealed)).toBe(false);
  });

  it('never vetoes from a blocked start — the walker may step off its own blocked node', () => {
    const sim = mappedSim(grassMap(12, 6));
    const terrain = terrainOf(sim);
    wallAt(sim, 10, 6, SEAL_RING);
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);
    const onWall = terrain.nodeAt(9, 6);

    expect(regions.unroutable(onWall, terrain.nodeAt(2, 2))).toBe(false);
  });

  it('never mints a pocket from the un-swept remainder of a large confined region', () => {
    // A 648-node walled yard (beyond the cap). The first verdict's flood from one corner caps and
    // stamps a 512-node ball; the far corner's flood then drains the remainder against those stamps.
    // Joining an earlier sweep must read as open, or two corners of one yard become "unroutable" -
    // a false veto with no expiry (the regression the PENDING_REGION join rule pins).
    const sim = mappedSim(grassMap(40, 20));
    const terrain = terrainOf(sim);
    wallAt(sim, 2, 2, rectangleWall(38, 20));
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);

    expect(regions.unroutable(terrain.nodeAt(3, 3), terrain.nodeAt(38, 20))).toBe(false);
  });

  it('keeps a corridor end routable after a capped flood swept in through its mouth', () => {
    // An 80x40-node map cut by one wall row at y = 3 whose only gap sits at the right edge: the top
    // corridor and the open field connect through that mouth alone. Probing the mouth first sweeps a
    // capped ball over the mouth-side corridor and the near field; the corridor's far end then
    // drains only the un-swept left remainder, which must join the sweep and stay routable.
    const sim = mappedSim(grassMap(40, 20));
    const terrain = terrainOf(sim);
    const row: Array<{ dx: number; dy: number }> = [];
    for (let dx = 0; dx < 78; dx++) row.push({ dx, dy: 0 });
    wallAt(sim, 0, 3, row);
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);
    const field = terrain.nodeAt(40, 30);
    const mouth = terrain.nodeAt(78, 1);
    const corridorFarEnd = terrain.nodeAt(2, 1);

    expect(regions.unroutable(field, mouth)).toBe(false);
    expect(regions.unroutable(corridorFarEnd, field)).toBe(false);
  });

  it('reads a pocket larger than the flood cap as open (fail-open to the route + memo path)', () => {
    // 80×40 nodes; the perimeter seals a (38-2)×(20-2) = 648-node interior — beyond the cap.
    const sim = mappedSim(grassMap(40, 20));
    const terrain = terrainOf(sim);
    const wallWidth = 38;
    const wallHeight = 20;
    expect((wallWidth - 2) * (wallHeight - 2)).toBeGreaterThan(ROUTE_REGION_POCKET_CAP);
    wallAt(sim, 2, 2, rectangleWall(wallWidth, wallHeight));
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);

    const inside = terrain.nodeAt(10, 10);
    const outside = terrain.nodeAt(2, 30);
    expect(regions.unroutable(outside, inside)).toBe(false);
  });
});
