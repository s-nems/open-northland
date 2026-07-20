import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { nearestWorkFlagPlacement } from '../../src/systems/index.js';
import { ctxOf, mappedSim, terrainOf } from './building-placement/support.js';

/**
 * {@link nearestWorkFlagPlacement}'s two bounded-search options, the ones the player's `setWorkFlag`
 * snap rides on: `withinRadius` (give up near rather than fall back to the whole-map winner) and
 * `accept` (an extra per-node gate — the settler's signpost confinement). The `accept` gate belongs in
 * the search rather than on its winner: applied afterwards, a click near the confinement edge snaps
 * outward and is then rejected, which is the silent no-op the snap exists to remove.
 */
describe('nearestWorkFlagPlacement bounded options', () => {
  it('returns the origin itself when it is already legal', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const from = terrain.nodeAt(8, 8);

    expect(nearestWorkFlagPlacement(sim.world, ctxOf(sim), terrain, from)).toBe(from);
  });

  it('honours `accept`, picking the nearest node that also passes the extra gate', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const from = terrain.nodeAt(8, 8);
    // Everything west of x=12 is refused, so the origin no longer qualifies and the winner must be the
    // nearest ACCEPTED node — not the origin, and not merely the nearest unblocked one.
    const eastOnly = (node: NodeId): boolean => terrain.coordsOf(node).x >= 12;

    const picked = nearestWorkFlagPlacement(sim.world, ctxOf(sim), terrain, from, { accept: eastOnly });

    expect(picked).not.toBeNull();
    expect(terrain.coordsOf(picked as NodeId).x).toBe(12); // the first accepted column, straight east
  });

  it('gives up inside `withinRadius` instead of reaching for a far winner', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const from = terrain.nodeAt(2, 2);
    const farOnly = (node: NodeId): boolean => terrain.coordsOf(node).x >= 14;

    // Unbounded, the whole-map fallback finds the far column…
    expect(
      nearestWorkFlagPlacement(sim.world, ctxOf(sim), terrain, from, { accept: farOnly }),
    ).not.toBeNull();
    // …bounded, nothing legal is near, so the caller learns "not here" rather than being teleported.
    expect(
      nearestWorkFlagPlacement(sim.world, ctxOf(sim), terrain, from, { accept: farOnly, withinRadius: 6 }),
    ).toBeNull();
  });
});
