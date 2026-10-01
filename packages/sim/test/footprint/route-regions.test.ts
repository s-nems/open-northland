import { parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { Building, Position } from '../../src/components/index.js';
import { writeLandscapeEdits } from '../../src/components/landscape.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { type BlockOverlay, LayeredBlocks } from '../../src/nav/block-overlay.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../src/nav/terrain/index.js';
import {
  buildingBlockedCells,
  resourceBlockedCells,
  vehicleBlockedCells,
} from '../../src/systems/footprint/index.js';
import {
  ROUTE_REGION_POCKET_CAP,
  routeRegions,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../../src/systems/index.js';
import { landscapeBlocks } from '../../src/systems/landscape/view.js';
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

  it('judges a blocked start by the nodes it can step off to', () => {
    const sim = mappedSim(grassMap(12, 6));
    const terrain = terrainOf(sim);
    wallAt(sim, 10, 6, SEAL_RING);
    wallAt(sim, 2, 2, [{ dx: 0, dy: 0 }]);
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);
    const onWall = terrain.nodeAt(9, 6); // steps off into the pocket and into the open
    const onStone = terrain.nodeAt(2, 2); // steps off into the open only
    const sealed = terrain.nodeAt(10, 6);

    expect(regions.unroutable(onWall, terrain.nodeAt(4, 4))).toBe(false);
    expect(regions.unroutable(onWall, sealed)).toBe(false);
    expect(regions.unroutable(onStone, terrain.nodeAt(4, 4))).toBe(false);
    expect(regions.unroutable(onStone, sealed)).toBe(true);
  });

  it('calls a blocked node pocketed only when no node it steps off to lies in the open', () => {
    const sim = mappedSim(grassMap(40, 20)); // larger than the flood cap, so the open ground reads open
    const terrain = terrainOf(sim);
    wallAt(sim, 10, 2, rectangleWall(3, 7)); // seals the column (11, 3..7)
    wallAt(sim, 11, 5, [{ dx: 0, dy: 0 }]); // a stone inside the pocket
    wallAt(sim, 2, 2, [{ dx: 0, dy: 0 }]); // a stone in the open
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);

    expect(regions.pocketed(terrain.nodeAt(11, 5))).toBe(true);
    expect(regions.pocketed(terrain.nodeAt(2, 2))).toBe(false);
    expect(regions.pocketed(terrain.nodeAt(10, 4))).toBe(false); // the wall steps off both ways
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

  it('keeps two pockets apart when the pocket ids run out within a verdict', () => {
    const sim = mappedSim(grassMap(14, 6));
    const terrain = terrainOf(sim);
    wallAt(sim, 4, 6, SEAL_RING);
    wallAt(sim, 20, 6, SEAL_RING);
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);
    const first = terrain.nodeAt(4, 6);
    const second = terrain.nodeAt(20, 6);
    expect(regions.unroutable(second, first)).toBe(true);

    // A long session's id counter at the limit, with the first pocket's low id still valid and the
    // second's retired, so the next verdict reads the one label and re-floods the other.
    const cache = (regions as unknown as { cache: PocketIdState }).cache;
    const secondLabel = cache.labels[second];
    if (secondLabel === undefined) throw new Error('second pocket unlabeled');
    cache.retired[secondLabel] = 1;
    cache.nextPocket = POCKET_ID_LIMIT;

    expect(regions.unroutable(second, first)).toBe(true);
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

describe('routeRegions under changing blockers', () => {
  it('answers like a cold flood after every random wall, building and landscape change', {
    timeout: RANDOM_TEST_TIMEOUT_MS,
  }, () => {
    const sim = new Simulation({
      seed: 1,
      content: blockerContent(),
      map: {
        ...grassMap(RANDOM_MAP_COLS, RANDOM_MAP_ROWS),
        landscapes: {
          types: [{ typeId: WALL_LANDSCAPE, walk: SEAL_RING, build: [], groups: [] }],
          placements: [],
        },
      },
    });
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    const regions = routeRegions(sim.world, ctx, terrain);
    const random = lcg(RANDOM_SEED);
    const pick = (n: number): number => Math.floor(random() * n);
    const sites = Array.from({ length: RANDOM_SITES }, () =>
      siteAt(sim, pick(terrain.width), pick(terrain.height), RING_TYPE),
    );
    const walls: Entity[] = [];
    let pocketsSeen = 0;
    for (let round = 0; round < RANDOM_ROUNDS; round++) {
      // Several changes per round, so one refresh sees blocks and frees together.
      const changes = 1 + pick(MAX_CHANGES_PER_ROUND);
      for (let c = 0; c < changes; c++) {
        if (walls.length > 0 && pick(3) === 0) {
          const [gone] = walls.splice(pick(walls.length), 1);
          if (gone !== undefined) unstampResourceFootprint(sim.world, gone);
        } else {
          const width = 2 + pick(MAX_WALL_SPAN);
          const height = 2 + pick(MAX_WALL_SPAN);
          const shape = rectangleWall(width, height).filter(() => pick(GAP_ODDS) !== 0);
          walls.push(wallAt(sim, pick(terrain.width - width), pick(terrain.height - height), shape));
        }
      }
      const site = sites[pick(sites.length)];
      if (site !== undefined)
        sim.world.mut(site, Building).buildingType = SITE_TYPES[pick(SITE_TYPES.length)] ?? OPEN_TYPE;
      const hx = pick(terrain.width);
      const hy = pick(terrain.height);
      // A moved placement takes a fresh id, as a script edit mints one.
      writeLandscapeEdits(sim.world, (edit) => {
        edit.topologyRevision++;
        edit.added =
          pick(LANDSCAPE_ODDS) === 0 ? [] : [{ id: round, typeId: WALL_LANDSCAPE, hx, hy, level: 0 }];
      });
      const layers = new LayeredBlocks([
        resourceBlockedCells(sim.world, terrain),
        buildingBlockedCells(sim.world, ctx, terrain),
        landscapeBlocks(sim.world, terrain).walk,
      ]);
      const reference = coldRegions(terrain, layers);
      for (let q = 0; q < QUERIES_PER_ROUND; q++) {
        const a = terrain.nodeAt(pick(terrain.width), pick(terrain.height));
        const b = terrain.nodeAt(pick(terrain.width), pick(terrain.height));
        const want = reference.unroutable(a, b);
        if (want) pocketsSeen += 1;
        expect(regions.unroutable(a, b), `round ${round}: ${a} -> ${b}`).toBe(want);
        expect(regions.pocketed(a), `round ${round}: ${a} pocketed`).toBe(reference.pocketed(a));
      }
      expect(sim.world.verifyCaches()).toEqual([]);
    }
    // The walk has to have exercised sealed pockets, not only open ground.
    expect(pocketsSeen).toBeGreaterThan(0);
  });

  it('seals a pocket a new building closes around warm open labels, and frees it again', () => {
    const { sim, site } = ringSite();
    const terrain = terrainOf(sim);
    sim.world.mut(site, Building).buildingType = OPEN_TYPE;
    const regions = routeRegions(sim.world, ctxOf(sim), terrain);
    const sealed = terrain.nodeAt(10, 6);
    const outside = terrain.nodeAt(2, 2);
    expect(regions.unroutable(outside, sealed)).toBe(false);

    sim.world.mut(site, Building).buildingType = RING_TYPE;
    expect(regions.unroutable(outside, sealed)).toBe(true);
    expect(regions.pocketed(sealed)).toBe(true);

    sim.world.mut(site, Building).buildingType = OPEN_TYPE;
    expect(regions.unroutable(outside, sealed)).toBe(false);
  });
});

/** A reference that floods every query from scratch: the region key of a passable node is its lowest
 *  node id when the region fits within the cap, else open. */
function coldRegions(terrain: TerrainGraph, blocked: BlockOverlay) {
  const steps = new StepBuffer();
  const passable = (n: NodeId): boolean => terrain.isWalkable(n) && !blocked.has(n);
  const keys = new Map<NodeId, number | 'open'>();
  const keyOf = (start: NodeId): number | 'open' => {
    const known = keys.get(start);
    if (known !== undefined) return known;
    const key = flood(start);
    keys.set(start, key);
    return key;
  };
  const flood = (start: NodeId): number | 'open' => {
    const seen = new Set<NodeId>([start]);
    const queue = [start];
    for (let at = 0; at < queue.length; at++) {
      const cur = queue[at];
      if (cur === undefined) break;
      if (seen.size > ROUTE_REGION_POCKET_CAP) return 'open';
      terrain.stepsInto(cur, blocked, steps);
      for (let i = 0; i < steps.length; i++) {
        const next = steps.at(i).node;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen.size > ROUTE_REGION_POCKET_CAP ? 'open' : Math.min(...seen);
  };
  const exitKeys = (n: NodeId): Array<number | 'open'> =>
    terrain.steps(n, blocked).map((step) => keyOf(step.node));
  return {
    unroutable(from: NodeId, to: NodeId): boolean {
      if (from === to || !terrain.isWalkable(from) || !passable(to)) return false;
      const target = keyOf(to);
      if (passable(from)) return keyOf(from) !== target;
      const exits = exitKeys(from);
      return exits.length > 0 && !exits.includes(target);
    },
    pocketed(node: NodeId): boolean {
      if (!terrain.isWalkable(node)) return false;
      if (passable(node)) return keyOf(node) !== 'open';
      const exits = exitKeys(node);
      return exits.length > 0 && !exits.includes('open');
    },
  };
}

/** A deterministic [0, 1) stream for the randomized walk. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return state / LCG_MODULUS;
  };
}

const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 2 ** 31;
const RANDOM_SEED = 7;
/** Cells; the node lattice is twice as wide and tall, past the flood cap so open ground exists. */
const RANDOM_MAP_COLS = 24;
const RANDOM_MAP_ROWS = 16;
const RANDOM_ROUNDS = 80;
/** Eighty rounds of cold-flood reference checks: slow by design, and slower on a loaded machine. */
const RANDOM_TEST_TIMEOUT_MS = 60_000;
const MAX_CHANGES_PER_ROUND = 3;
const QUERIES_PER_ROUND = 20;
/** Walls up to this many nodes plus two on a side. */
const MAX_WALL_SPAN = 12;
/** One wall node in this many is left out, opening gaps that some walls seal and some leak through. */
const GAP_ODDS = 12;

/** The cache fields the pocket-id test drives directly. */
interface PocketIdState {
  readonly labels: Int32Array;
  readonly retired: Uint8Array;
  nextPocket: number;
}
/** Mirrors the module's private id ceiling. */
const POCKET_ID_LIMIT = 2 ** 20;

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
const YARD_TYPE = 32; // walls off a five-node column
const SITE_TYPES = [RING_TYPE, OPEN_TYPE, YARD_TYPE];
/** Construction sites the randomized walk swaps one type of per round. */
const RANDOM_SITES = 4;
const WALL_LANDSCAPE = 1;
/** One landscape edit in this many clears the script placement instead of moving it. */
const LANDSCAPE_ODDS = 4;

function blockerContent() {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      { typeId: RING_TYPE, id: 'ring', kind: 'storage', footprint: { blocked: SEAL_RING } },
      { typeId: OPEN_TYPE, id: 'open', kind: 'storage' },
      { typeId: YARD_TYPE, id: 'yard', kind: 'storage', footprint: { blocked: rectangleWall(3, 7) } },
    ],
  });
}

/** An unbuilt construction site of `buildingType` anchored at half-cell NODE (x, y). */
function siteAt(sim: Simulation, x: number, y: number, buildingType: number): Entity {
  const site = sim.world.create();
  sim.world.add(site, Position, positionOfNode(x, y));
  sim.world.add(site, Building, { buildingType, tribe: 1, built: fx.fromInt(0), level: 0 });
  return site;
}

/** A construction site whose footprint is {@link SEAL_RING} around node (10, 6). */
function ringSite(): { sim: Simulation; site: Entity } {
  const sim = new Simulation({ seed: 1, content: blockerContent(), map: grassNodeMap(24, 12) });
  return { sim, site: siteAt(sim, 10, 6, RING_TYPE) };
}
