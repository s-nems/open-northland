import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { Simulation, clearComponentStores } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { canonicalResources, resourcesNearNode } from '../../src/systems/resource-index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The resource REGION index (`systems/resource-index.ts`) — the golden-rule-6 fix that lets a flag-bound
 * gatherer's `nearestHarvestableFor` scan read only the nodes near its flag instead of every resource
 * on a decoded map (~17k). Correctness contract pinned here: the query is a SUPERSET of the anchors
 * within the reach box, returned ascending-id (the canonical first-wins order the nearest-pick
 * comparator depends on), and the index refreshes when a resource is created or destroyed (the
 * Resource store generation). The winner-parity itself is covered by the flag-bound gatherer suite +
 * the golden slice (both run through the indexed path).
 */

const { Position, Resource } = components;

function newSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent() });
}

/** A bare resource node anchored at half-cell node (hx, hy) — the fixture idiom (no footprint). */
function nodeAt(sim: Simulation, hx: number, hy: number) {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, { goodType: 1, remaining: 3, harvestAtomic: 24 });
  return e;
}

describe('resourcesNearNode (the flag-bound scan index)', () => {
  beforeEach(clearComponentStores);

  it('returns exactly the anchors within the reach box, ascending-id, across region borders', () => {
    const sim = newSim();
    const far = nodeAt(sim, 2, 2); // outside the box
    const b = nodeAt(sim, 31, 31); // inside — one side of the 32-node region border
    const c = nodeAt(sim, 33, 33); // inside — the other side of the border
    const beyond = nodeAt(sim, 60, 60); // outside
    const near = resourcesNearNode(sim.world, 32, 32, 5);
    expect(near).toEqual([b, c]); // ascending id, both border-straddling nodes present
    expect(near).not.toContain(far);
    expect(near).not.toContain(beyond);
  });

  it('refreshes when a resource is created or destroyed (Resource store generation)', () => {
    const sim = newSim();
    const a = nodeAt(sim, 10, 10);
    expect(resourcesNearNode(sim.world, 10, 10, 3)).toEqual([a]);
    const b = nodeAt(sim, 11, 11);
    expect(resourcesNearNode(sim.world, 10, 10, 3)).toEqual([a, b]);
    sim.world.destroy(a);
    expect(resourcesNearNode(sim.world, 10, 10, 3)).toEqual([b]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('canonicalResources memoizes the ascending full list against the same generation', () => {
    const sim = newSim();
    const a = nodeAt(sim, 5, 5);
    const first = canonicalResources(sim.world);
    expect(first).toEqual([a]);
    expect(canonicalResources(sim.world)).toBe(first); // same generation → same array (no re-sort)
    const b = nodeAt(sim, 6, 6);
    expect(canonicalResources(sim.world)).toEqual([a, b]); // generation moved → rebuilt
  });
});
