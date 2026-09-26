import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Position, Signpost, stampOwner } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { halfCellMapFromCells, type Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { canPlaceBuilding, createSignpost, signpostNetwork } from '../../src/systems/index.js';
import {
  buildingsPlaced,
  ctxOf,
  GRASS,
  grassMap,
  HUT,
  HUT_FOOTPRINT,
  mappedSim,
  terrainOf,
  VIKING,
  WATER,
} from '../footprint/building-placement/support.js';

/**
 * A player may place a building over their own signposts: the placement pushes each post from under the
 * walls into the building's margin and re-links it there. Another player's post still blocks.
 */

const P0 = 0;
const P1 = 1;
const ANCHOR = { x: 10, y: 10 };
/** Far enough east to sit outside the spacing, close enough to link to a post at the anchor. */
const NEIGHBOUR = { x: 28, y: 10 };
/** The grass cells around {@link ANCHOR}'s reserved zone, nodes 8..13 on both axes; water elsewhere. */
const ISLAND_CELLS = { min: 4, max: 6 };
const ISLAND_MAP_CELLS = 12;
const NODES_PER_CELL = 2;
/** A hut on the tall map with a neighbour 39 hex nodes north, one inside the link range: the preferred
 *  push to the front row would put it 40 away. */
const LINK_ANCHOR = { x: 10, y: 50 };
const FAR_NORTH = { x: 6, y: 11 };
const TALL_MAP = { width: 24, height: 40 };
/** Anchors around a pushed post to try a second hut at, in nodes each way. */
const COVER_SEARCH = 4;

const HUT_WALLS_AND_DOOR: readonly FootprintCell[] = [...HUT_FOOTPRINT.familyBody, HUT_FOOTPRINT.door];

function post(sim: Simulation, x: number, y: number, player: number): Entity {
  const terrain = terrainOf(sim);
  return createSignpost(sim.world, terrain, terrain.nodeAt(x, y), player);
}

function nodeOf(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  return { x: hx, y: hy };
}

/** Whether `at` is one of `cells` of a hut anchored at `anchor`. */
function inHutCells(cells: readonly FootprintCell[], at: { x: number; y: number }, anchor = ANCHOR): boolean {
  return cells.some((c) => anchor.x + footprintCellDx(anchor.y, c) === at.x && anchor.y + c.dy === at.y);
}

/** Read every signpost-keyed cache, then prove each matches a fresh derivation: a verifier only checks a
 *  cache that has caught up with the world. */
function expectCachesExact(sim: Simulation): void {
  sim.placementProbe(HUT, P0)?.canPlace(ANCHOR.x, ANCHOR.y);
  sim.signpostProbe(P0)?.canPlace(ANCHOR.x, ANCHOR.y);
  signpostNetwork(sim.world);
  expect(sim.world.verifyCaches()).toEqual([]);
}

function placeHut(sim: Simulation, owner: number, at = ANCHOR): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
}

function islandSim(): Simulation {
  const typeIds: number[] = [];
  for (let r = 0; r < ISLAND_MAP_CELLS; r++) {
    for (let c = 0; c < ISLAND_MAP_CELLS; c++) {
      const land = [c, r].every((v) => v >= ISLAND_CELLS.min && v <= ISLAND_CELLS.max);
      typeIds.push(land ? GRASS : WATER);
    }
  }
  return mappedSim(halfCellMapFromCells({ width: ISLAND_MAP_CELLS, height: ISLAND_MAP_CELLS, typeIds }));
}

describe('building over signposts', () => {
  it('lets only the post owner cover it', () => {
    const sim = mappedSim();
    post(sim, ANCHOR.x, ANCHOR.y, P0);

    expect(sim.placementProbe(HUT, P0)?.canPlace(ANCHOR.x, ANCHOR.y)).toBe(true);
    expect(sim.placementProbe(HUT, P1)?.canPlace(ANCHOR.x, ANCHOR.y)).toBe(false);
    // An ownerless placement has nobody's posts to discount.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, ANCHOR.x, ANCHOR.y)).toBe(false);
  });

  it("refuses a building over a rival's post", () => {
    const sim = mappedSim();
    const rival = post(sim, ANCHOR.x, ANCHOR.y, P1);
    placeHut(sim, P0);

    expect(buildingsPlaced(sim)).toBe(0);
    expect(nodeOf(sim, rival)).toEqual(ANCHOR);
  });

  it('follows a post to its new owner and moves the overlay token', () => {
    const sim = mappedSim();
    const handed = post(sim, ANCHOR.x, ANCHOR.y, P0);
    const overlayKey = sim.placementBlockerVersion();

    stampOwner(sim.world, handed, P1);

    expect(sim.placementProbe(HUT, P1)?.canPlace(ANCHOR.x, ANCHOR.y)).toBe(true);
    expect(sim.placementProbe(HUT, P0)?.canPlace(ANCHOR.x, ANCHOR.y)).toBe(false);
    expect(sim.placementBlockerVersion()).not.toBe(overlayKey);
  });

  it('pushes an own post from under the walls into the margin and re-links it', () => {
    const sim = mappedSim();
    const covered = post(sim, ANCHOR.x + 1, ANCHOR.y, P0);
    const neighbour = post(sim, NEIGHBOUR.x, NEIGHBOUR.y, P0);
    expect(sim.world.get(neighbour, Signpost).links).toEqual([covered]);

    placeHut(sim, P0);

    expect(buildingsPlaced(sim)).toBe(1);
    const moved = nodeOf(sim, covered);
    expect(inHutCells(HUT_WALLS_AND_DOOR, moved)).toBe(false);
    expect(inHutCells(HUT_FOOTPRINT.reserved, moved)).toBe(true); // one step off the walls, no further
    expect(sim.world.get(covered, Signpost).links).toEqual([neighbour]);
    expect(sim.world.get(neighbour, Signpost).links).toEqual([covered]);
    const sites = signpostNetwork(sim.world).get(P0) ?? [];
    expect(sites.find((s) => s.entity === covered)).toMatchObject({ hx: moved.x, hy: moved.y });
    expectCachesExact(sim);
  });

  it('leaves the pushed post where no later building of its owner may cover it', () => {
    const sim = mappedSim();
    const covered = post(sim, ANCHOR.x, ANCHOR.y, P0);
    placeHut(sim, P0);
    const pushed = nodeOf(sim, covered);

    const probe = sim.placementProbe(HUT, P0);
    let tried = 0;
    for (let y = pushed.y - COVER_SEARCH; y <= pushed.y + COVER_SEARCH; y++) {
      for (let x = pushed.x - COVER_SEARCH; x <= pushed.x + COVER_SEARCH; x++) {
        if (!inHutCells(HUT_FOOTPRINT.reserved, pushed, { x, y })) continue;
        tried++;
        expect(probe?.canPlace(x, y), `hut at (${x},${y})`).toBe(false);
      }
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('moves a post off the door and several posts to distinct nodes', () => {
    const sim = mappedSim();
    const door = { x: ANCHOR.x + HUT_FOOTPRINT.door.dx, y: ANCHOR.y + HUT_FOOTPRINT.door.dy };
    const posts = [
      post(sim, door.x, door.y, P0),
      ...HUT_FOOTPRINT.familyBody.map((c) => post(sim, ANCHOR.x + c.dx, ANCHOR.y + c.dy, P0)),
    ];

    placeHut(sim, P0);

    const landed = posts.map((e) => nodeOf(sim, e));
    for (const at of landed) expect(inHutCells(HUT_WALLS_AND_DOOR, at)).toBe(false);
    expect(new Set(landed.map((at) => `${at.x},${at.y}`)).size).toBe(posts.length);
    expectCachesExact(sim);
  });

  it('stands the pushed post in front of the building, where it draws over the art', () => {
    const sim = mappedSim();
    const covered = post(sim, ANCHOR.x, ANCHOR.y, P0);

    placeHut(sim, P0);

    const moved = nodeOf(sim, covered);
    expect(moved.y).toBeGreaterThan(ANCHOR.y);
    expect(inHutCells(HUT_WALLS_AND_DOOR, moved)).toBe(false);
  });

  it('keeps a far neighbour in link range before standing the post in front', () => {
    const sim = mappedSim(grassMap(TALL_MAP.width, TALL_MAP.height));
    const covered = post(sim, LINK_ANCHOR.x, LINK_ANCHOR.y, P0);
    const far = post(sim, FAR_NORTH.x, FAR_NORTH.y, P0);
    expect(sim.world.get(covered, Signpost).links).toEqual([far]);

    placeHut(sim, P0, LINK_ANCHOR);

    expect(buildingsPlaced(sim)).toBe(1);
    expect(inHutCells(HUT_WALLS_AND_DOOR, nodeOf(sim, covered), LINK_ANCHOR)).toBe(false);
    expect(sim.world.get(covered, Signpost).links).toEqual([far]);
    expectCachesExact(sim);
  });

  it('takes the post down when only the door is left free on its ground', () => {
    const sim = islandSim();
    const terrain = terrainOf(sim);
    const covered = post(sim, ANCHOR.x, ANCHOR.y, P0);
    // Own posts on every other island node outside the walls and the door.
    const lo = ISLAND_CELLS.min * NODES_PER_CELL;
    const hi = (ISLAND_CELLS.max + 1) * NODES_PER_CELL - 1;
    for (let y = lo; y <= hi; y++) {
      for (let x = lo; x <= hi; x++) {
        if (!inHutCells(HUT_WALLS_AND_DOOR, { x, y }) && terrain.isWalkable(terrain.nodeAt(x, y))) {
          post(sim, x, y, P0);
        }
      }
    }
    expect(sim.placementProbe(HUT, P0)?.canPlace(ANCHOR.x, ANCHOR.y)).toBe(true);

    placeHut(sim, P0);

    expect(buildingsPlaced(sim)).toBe(1);
    expect(sim.world.has(covered, Signpost)).toBe(false);
    const standing = signpostNetwork(sim.world).get(P0) ?? [];
    expect(standing.some((s) => s.entity === covered)).toBe(false);
    for (const s of standing) expect(inHutCells(HUT_WALLS_AND_DOOR, { x: s.hx, y: s.hy })).toBe(false);
    expectCachesExact(sim);
  });
});
