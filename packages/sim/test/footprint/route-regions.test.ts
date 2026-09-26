import { parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { Building, Position } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { vehicleBlockedCells } from '../../src/systems/footprint/index.js';
import {
  ROUTE_REGION_POCKET_CAP,
  routeRegions,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../../src/systems/index.js';
import { createVehicle, removeVehicle } from '../../src/systems/vehicles/index.js';
import { TEST_MANIFEST, testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap, grassNodeMap } from '../fixtures/terrain.js';
import { grassMap, mappedSim, terrainOf } from './resource-footprint/support.js';

/**
 * The route-region memo: a clear node sealed inside blocker walls is provably unroutable from
 * outside, while everything the memo cannot prove stays routable (fail-open). The veto direction
 * must be exact - a wrong "unroutable" would retire a reachable node with no expiry, unlike the
 * time-bounded failed-goal memo.
 */

/** A walk-blocking wall entity anchored at half-cell NODE (x, y) with the given cell offsets. */
function wallAt(sim: Simulation, x: number, y: number, offsets: Array<{ dx: number; dy: number }>): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  stampResourceFootprintData(sim.world, e, { walk: offsets, build: [], work: [] });
  return e;
}

/** The 8 step-neighbour offsets of the anchor - a ring that seals the anchor node alone. */
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
 *  the two side columns fill the rows between - a one-node-thick perimeter, which the 8-direction
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
    // A 3-wide, 7-tall perimeter sealing the interior column (11, 3..7) - a 5-node pocket.
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

  it('keeps its labels through construction progress and re-opens on a building type swap', () => {
    const { sim, site } = ringSite();
    const terrain = terrainOf(sim);
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);
    const sealed = terrain.nodeAt(10, 6);
    const outside = terrain.nodeAt(2, 2);
    expect(regions.unroutable(outside, sealed)).toBe(true);

    // A labeled verdict floods nothing, so a flood after progress would mean the labels were dropped.
    const floods = vi.spyOn(terrain, 'stepsInto');
    sim.world.mut(site, Building).built = ONE;
    expect(regions.unroutable(outside, sealed)).toBe(true);
    expect(floods).not.toHaveBeenCalled();
    floods.mockRestore();

    sim.world.mut(site, Building).buildingType = OPEN_TYPE;
    expect(regions.unroutable(outside, sealed)).toBe(false);
  });

  it('leaves a cart standing in a wall gap out of its labels, so a warm cache agrees with a cold one', () => {
    const map = grassCellMap(CART_MAP_CELLS, CART_MAP_CELLS);
    const cartSim = new Simulation({ seed: 1, content: testContent(), map });
    const twin = new Simulation({ seed: 1, content: testContent(), map });
    const terrain = terrainOf(cartSim);
    const cart = createVehicle(cartSim.world, ctxOf(cartSim), {
      vehicleType: HANDCART,
      x: CART_GAP_X,
      y: CART_GAP_Y,
      tribe: VIKING,
      owner: 0,
    });
    if (cart === null) throw new Error('handcart missing from the fixture');
    // The yard's east side is the cart: every wall node its disc covers is left out of the wall.
    const cartCells = vehicleBlockedCells(cartSim.world, ctxOf(cartSim), terrain);
    const wall = rectangleWall(YARD_WIDTH, YARD_HEIGHT);
    const gapped = wall.filter(({ dx, dy }) => !cartCells.has(terrain.nodeAt(YARD_X + dx, YARD_Y + dy)));
    expect(gapped.length).toBeLessThan(wall.length);
    wallAt(cartSim, YARD_X, YARD_Y, gapped);
    wallAt(twin, YARD_X, YARD_Y, gapped);
    const inside = terrain.nodeAt(YARD_X + 2, CART_GAP_Y);
    const outside = terrain.nodeAt(CART_GAP_X + YARD_WIDTH, CART_GAP_Y);
    const warm = routeRegions(cartSim.world, ctxOf(cartSim), terrain);

    expect(warm.unroutable(outside, inside)).toBe(false);
    removeVehicle(cartSim.world, ctxOf(cartSim), cart, 'script');
    const cold = routeRegions(twin.world, ctxOf(twin), terrainOf(twin));
    expect(warm.unroutable(outside, inside)).toBe(cold.unroutable(outside, inside));
    expect(cold.unroutable(outside, inside)).toBe(false);
  });

  it('never vetoes from a blocked start - the walker may step off its own blocked node', () => {
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
    // 80×40 nodes; the perimeter seals a (38-2)×(20-2) = 648-node interior - beyond the cap.
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

const VIKING = 1;
const HANDCART = 1;
const CART_MAP_CELLS = 16;
/** A yard perimeter whose east side runs through the cart's anchor node. */
const YARD_X = 4;
const YARD_Y = 8;
const YARD_WIDTH = 9;
const YARD_HEIGHT = 17;
const CART_GAP_X = YARD_X + YARD_WIDTH - 1;
const CART_GAP_Y = YARD_Y + (YARD_HEIGHT - 1) / 2;

const RING_TYPE = 30; // walls off its anchor node alone
const OPEN_TYPE = 31; // no walk-block

/** A construction site whose footprint is {@link SEAL_RING} around node (10, 6). */
function ringSite(): { sim: Simulation; site: Entity } {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      { typeId: RING_TYPE, id: 'ring', kind: 'storage', footprint: { blocked: SEAL_RING } },
      { typeId: OPEN_TYPE, id: 'open', kind: 'storage' },
    ],
  });
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(24, 12) });
  const site = sim.world.create();
  sim.world.add(site, Position, positionOfNode(10, 6));
  sim.world.add(site, Building, { buildingType: RING_TYPE, tribe: 1, built: fx.fromInt(0), level: 0 });
  return { sim, site };
}
