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
 * A player may place a building over their own signposts: the placement pushes each post out of the new
 * reserved zone and re-links it there. Another player's post still blocks, as every post did before.
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

function inHutReserved(at: { x: number; y: number }, anchor = ANCHOR): boolean {
  // On an even anchor row every footprint cell keeps its plain dx.
  return HUT_FOOTPRINT.reserved.some((c) => anchor.x + c.dx === at.x && anchor.y + c.dy === at.y);
}

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

  it('pushes an own post out of the reserved zone and re-links it', () => {
    const sim = mappedSim();
    const covered = post(sim, ANCHOR.x + 1, ANCHOR.y, P0);
    const neighbour = post(sim, NEIGHBOUR.x, NEIGHBOUR.y, P0);
    expect(sim.world.get(neighbour, Signpost).links).toEqual([covered]);

    placeHut(sim, P0);

    expect(buildingsPlaced(sim)).toBe(1);
    const moved = nodeOf(sim, covered);
    expect(inHutReserved(moved)).toBe(false);
    expect(sim.world.get(covered, Signpost).links).toEqual([neighbour]);
    expect(sim.world.get(neighbour, Signpost).links).toEqual([covered]);
    const sites = signpostNetwork(sim.world).get(P0) ?? [];
    expect(sites.find((s) => s.entity === covered)).toMatchObject({ hx: moved.x, hy: moved.y });
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it("keeps a post pushed by a second building out of the first one's zone", () => {
    const sim = mappedSim();
    const covered = post(sim, ANCHOR.x, ANCHOR.y, P0);
    placeHut(sim, P0);
    const first = nodeOf(sim, covered);
    expect(inHutReserved(first, NORTH_ANCHOR)).toBe(true); // the second hut must push it again

    placeHut(sim, P0, NORTH_ANCHOR);

    expect(buildingsPlaced(sim)).toBe(2);
    const second = nodeOf(sim, covered);
    expect(inHutReserved(second, NORTH_ANCHOR)).toBe(false);
    expect(inHutReserved(second)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
