import { describe, expect, it } from 'vitest';
import { Position, Signpost } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { canPlaceBuilding, createSignpost, signpostNetwork } from '../../src/systems/index.js';
import {
  buildingsPlaced,
  ctxOf,
  HUT,
  HUT_FOOTPRINT,
  mappedSim,
  terrainOf,
  VIKING,
} from '../footprint/building-placement/support.js';

/**
 * A player may place a building over their own signposts: the placement pushes each post from under the
 * walls into the building's margin and re-links it there. Another player's post still blocks, as every
 * post did before.
 */

const P0 = 0;
const P1 = 1;
const ANCHOR = { x: 10, y: 10 };
/** Far enough east to sit outside the spacing, close enough to link to a post at the anchor. */
const NEIGHBOUR = { x: 28, y: 10 };

function post(sim: Simulation, x: number, y: number, player: number): Entity {
  const terrain = terrainOf(sim);
  return createSignpost(sim.world, terrain, terrain.nodeAt(x, y), player);
}

function nodeOf(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  return { x: hx, y: hy };
}

/** A hut two rows above {@link ANCHOR}'s zone: its zone abuts the first one without overlapping it. */
const NORTH_ANCHOR = { x: ANCHOR.x, y: ANCHOR.y - 4 };

type Cell = { readonly dx: number; readonly dy: number };

/** Whether `at` is one of `cells` placed at `anchor`; on an even anchor row every cell keeps its plain dx. */
function inHutCells(cells: readonly Cell[], at: { x: number; y: number }, anchor = ANCHOR): boolean {
  return cells.some((c) => anchor.x + c.dx === at.x && anchor.y + c.dy === at.y);
}

const HUT_WALLS_AND_DOOR: readonly Cell[] = [...HUT_FOOTPRINT.familyBody, HUT_FOOTPRINT.door];

function placeHut(sim: Simulation, owner: number, at = ANCHOR): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
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
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('leaves a pushed post alone when a second building goes up beside the first', () => {
    const sim = mappedSim();
    const covered = post(sim, ANCHOR.x, ANCHOR.y, P0);
    placeHut(sim, P0);
    const first = nodeOf(sim, covered);

    placeHut(sim, P0, NORTH_ANCHOR);

    expect(buildingsPlaced(sim)).toBe(2);
    expect(nodeOf(sim, covered)).toEqual(first);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
