import { describe, expect, it } from 'vitest';
import { Building, Position, Resource, type ResourceFootprintData } from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, type Simulation } from '../../src/index.js';
import { placementGridRebuilds } from '../../src/systems/footprint/placement/blocker-grid.js';
import { canPlaceBuilding, stampResourceFootprintData } from '../../src/systems/index.js';
import { setBuildForbidden } from '../../src/systems/landscape/edits.js';
import {
  ctxOf,
  HQ,
  HUT,
  mappedSim,
  referenceCanPlace,
  terrainOf,
  VIKING,
} from './building-placement/support.js';

/**
 * The placement grid is maintained incrementally against the blocker stores' membership journals, so a
 * blocker that appears or leaves must land in the counts without a map-wide re-stamp: an overlapping
 * blocker's removal must leave the node blocked, both removals must free it, and an in-place tier swap
 * must move the cells. The oracle is the independent `referenceCanPlace` derive plus the registered
 * `verifyCaches` verifier, which re-stamps the whole map and compares count for count.
 */

const WOOD = 1;
const HARVEST_ATOMIC = 24;
/** A tree whose trunk fills just its anchor node. */
const TRUNK_ONLY: ResourceFootprintData = { walk: [{ dx: 0, dy: 0 }], build: [], work: [] };

/** The node two fixture trees share, and an anchor whose reserved ring covers it (rows 4..7, x 5..8). */
const SHARED = { hx: 7, hy: 5 };
const COVERING_ANCHOR = { x: 6, y: 5 };

/** Anchors around the mutation sites, every one of them far enough from the map edge to place. */
const ANCHORS = [4, 5, 6, 7, 8, 9].flatMap((y) => [4, 5, 6, 7, 8, 9].map((x) => ({ x, y })));

function tree(sim: Simulation, hx: number, hy: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: HARVEST_ATOMIC });
  stampResourceFootprintData(sim.world, e, TRUNK_ONLY);
  return e;
}

function canPlaceHut(sim: Simulation, x: number, y: number): boolean {
  return canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, x, y);
}

/** Every anchor answers what a from-scratch derive answers, and the grid verifier agrees with a full
 *  re-stamp. */
function expectFreshAnswers(sim: Simulation, step: string): void {
  const terrain = terrainOf(sim);
  const live = ANCHORS.map(({ x, y }) => canPlaceHut(sim, x, y));
  const reference = ANCHORS.map(({ x, y }) => referenceCanPlace(sim, terrain, HUT, x, y));
  expect(live, step).toEqual(reference);
  expect(sim.world.verifyCaches(), step).toEqual([]);
}

describe('placement blocker grid incremental state', () => {
  it('withdraws only the removed blocker from a node two footprints share', () => {
    const sim = mappedSim();
    expectFreshAnswers(sim, 'empty map');
    expect(canPlaceHut(sim, COVERING_ANCHOR.x, COVERING_ANCHOR.y)).toBe(true);
    const rebuilds = placementGridRebuilds(sim.world);

    const first = tree(sim, SHARED.hx, SHARED.hy);
    const second = tree(sim, SHARED.hx, SHARED.hy);
    expect(canPlaceHut(sim, COVERING_ANCHOR.x, COVERING_ANCHOR.y)).toBe(false);
    expectFreshAnswers(sim, 'two trunks on one node');

    sim.world.destroy(first);
    expect(canPlaceHut(sim, COVERING_ANCHOR.x, COVERING_ANCHOR.y)).toBe(false); // the second still stands
    expectFreshAnswers(sim, 'one of the two removed');

    sim.world.destroy(second);
    expect(canPlaceHut(sim, COVERING_ANCHOR.x, COVERING_ANCHOR.y)).toBe(true);
    expectFreshAnswers(sim, 'both removed');

    expect(placementGridRebuilds(sim.world)).toBe(rebuilds); // every change replayed, none re-stamped
  });

  it('tracks a placed building, an in-place type swap and a destroy through the journals', () => {
    const sim = mappedSim();
    expectFreshAnswers(sim, 'empty map');
    const rebuilds = placementGridRebuilds(sim.world);

    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 8, tribe: VIKING });
    sim.step();
    expect(canPlaceHut(sim, 5, 8)).toBe(false); // its own reserved ring
    expectFreshAnswers(sim, 'a hut placed through the command seam');

    // The tier-adoption write: an in-place `buildingType` swap, invisible to the membership journals.
    // HQ is footprint-less (anchor-only), HUT carries a body and a margin ring, so the swap moves cells.
    const site = sim.world.create();
    sim.world.add(site, Position, positionOfNode(9, 4));
    sim.world.add(site, Building, { buildingType: HQ, tribe: VIKING, built: fx.fromInt(1), level: 0 });
    expectFreshAnswers(sim, 'a footprint-less building');
    sim.world.mut(site, Building).buildingType = HUT;
    expectFreshAnswers(sim, 'the same building swapped to a footprinted type');

    // A swap and a destroy inside one catch-up window: the replay must converge on the final state.
    sim.world.mut(site, Building).buildingType = HQ;
    sim.world.destroy(site);
    expectFreshAnswers(sim, 'swapped and destroyed between reads');

    expect(placementGridRebuilds(sim.world)).toBe(rebuilds);
  });

  it('re-derives the scripted layer when a script closes and reopens ground', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    expect(canPlaceHut(sim, 6, 6)).toBe(true);
    const rebuilds = placementGridRebuilds(sim.world);

    // The scripted layer is no store walk, so `referenceCanPlace` cannot see it - the full re-stamp the
    // grid verifier runs is the oracle here.
    setBuildForbidden(sim.world, terrain, { hx: 6, hy: 6 }, 0, true);
    expect(canPlaceHut(sim, 6, 6)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);

    setBuildForbidden(sim.world, terrain, { hx: 6, hy: 6 }, 0, false);
    expect(canPlaceHut(sim, 6, 6)).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);

    expect(placementGridRebuilds(sim.world)).toBe(rebuilds);
  });
});
