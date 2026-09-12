import { describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { anchorOnlyFootprint, stampResourceFootprintData } from '../../src/systems/index.js';
import {
  anyResourceNear,
  canonicalResources,
  resourceHarvestAtomics,
  resourcesAtNode,
  resourcesNearNode,
} from '../../src/systems/spatial/resources.js';
import { testContent } from '../fixtures/content.js';

/**
 * The resource REGION index (`systems/spatial/resources.ts`) - the golden-rule-6 fix that lets a flag-bound
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

/** A bare resource node anchored at half-cell node (hx, hy) - the fixture idiom (no footprint). */
function nodeAt(sim: Simulation, hx: number, hy: number) {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, { goodType: 1, remaining: 3, harvestAtomic: 24 });
  stampResourceFootprintData(sim.world, e, anchorOnlyFootprint());
  return e;
}

describe('resourcesNearNode (the flag-bound scan index)', () => {
  it('returns exactly the anchors within the reach box, ascending-id, across region borders', () => {
    const sim = newSim();
    const far = nodeAt(sim, 2, 2); // outside the box
    const b = nodeAt(sim, 31, 31); // inside - one side of the 32-node region border
    const c = nodeAt(sim, 33, 33); // inside - the other side of the border
    const beyond = nodeAt(sim, 60, 60); // outside
    const near = resourcesNearNode(sim.world, 32, 32, 5);
    expect(near).toEqual([b, c]); // ascending id, both border-straddling nodes present
    expect(near).not.toContain(far);
    expect(near).not.toContain(beyond);
  });

  it('anyResourceNear agrees with resourcesNearNode over the same box, edge nodes included', () => {
    const sim = newSim();
    const straddling = nodeAt(sim, 31, 31); // one side of the 32-node region border
    const onEdge = nodeAt(sim, 37, 32); // exactly `reach` away - in the box only if the bound is inclusive
    const justOutside = nodeAt(sim, 38, 32); // one node past the edge, in a region the scan still walks
    // The existence twin must answer "does the box hold one that passes?" exactly as the collecting scan
    // does; the `onEdge` / `justOutside` predicates are what catch a divergent bound.
    for (const [label, test] of [
      ['any at all', () => true],
      ['only the edge node', (e: number) => e === onEdge],
      ['only the node just past the edge', (e: number) => e === justOutside],
      ['only the region-straddling node', (e: number) => e === straddling],
      ['none', () => false],
    ] as const) {
      const collected = resourcesNearNode(sim.world, 32, 32, 5).some(test);
      expect(anyResourceNear(sim.world, 32, 32, 5, test), label).toBe(collected);
    }
    // Pin the box itself, so the agreement above is agreement on the RIGHT set.
    expect(resourcesNearNode(sim.world, 32, 32, 5)).toEqual([straddling, onEdge]);
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

  it('stays exact when reads interleave with plants and fells (the mid-dispatch pattern)', () => {
    const sim = newSim();
    // The atomic-dispatch interleave the ticket measured: sow (create) and fell (destroy) between
    // reads of the same index - each read must cost a delta replay, never a wrong answer.
    const standing: ReturnType<typeof nodeAt>[] = [];
    for (let i = 0; i < 20; i++) {
      const planted = nodeAt(sim, 10 + i, 10);
      standing.push(planted);
      expect(resourcesNearNode(sim.world, 10 + i, 10, 0)).toEqual([planted]);
      if (i % 2 === 1) {
        const felled = standing.shift();
        if (felled !== undefined) {
          sim.world.destroy(felled);
          expect(canonicalResources(sim.world)).toEqual(standing);
        }
      }
    }
    expect(canonicalResources(sim.world)).toEqual(standing);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('keeps the canonical list ascending when a lower id re-enters the store', () => {
    const sim = newSim();
    const a = nodeAt(sim, 3, 3);
    const b = nodeAt(sim, 4, 4);
    expect(canonicalResources(sim.world)).toEqual([a, b]);
    sim.world.remove(a, Resource); // the component leaves; the entity (and its Position) stay
    expect(canonicalResources(sim.world)).toEqual([b]);
    sim.world.add(a, Resource, { goodType: 1, remaining: 3, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, a, anchorOnlyFootprint());
    expect(canonicalResources(sim.world)).toEqual([a, b]); // sorted re-entry, not an append
    expect(resourcesNearNode(sim.world, 3, 3, 0)).toEqual([a]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('drops a harvest atomic only when its LAST node goes (the refcounted dormancy set)', () => {
    const sim = newSim();
    const a = nodeAt(sim, 5, 5); // harvestAtomic 24
    const b = nodeAt(sim, 6, 6); // harvestAtomic 24 - the same atomic twice
    expect(resourceHarvestAtomics(sim.world).has(24)).toBe(true);
    sim.world.destroy(a);
    expect(resourceHarvestAtomics(sim.world).has(24)).toBe(true); // one node left
    sim.world.destroy(b);
    expect(resourceHarvestAtomics(sim.world).has(24)).toBe(false); // last one gone
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('atNode answers the node itself, not the region box around it', () => {
    const sim = newSim();
    const on = nodeAt(sim, 20, 20);
    nodeAt(sim, 21, 20); // one node over, same 32-node region - must not answer for (20, 20)
    expect(resourcesAtNode(sim.world, 20, 20)).toEqual([on]);
    expect(resourcesAtNode(sim.world, 22, 20)).toEqual([]);
  });

  it('atNode mints from the standing population and tracks creates and destroys after', () => {
    const sim = newSim();
    const first = nodeAt(sim, 7, 7);
    const second = nodeAt(sim, 7, 7); // stacked BEFORE the mint - the region-walk path, not the incremental one
    expect(resourcesAtNode(sim.world, 7, 7)).toEqual([first, second]); // the mint
    const third = nodeAt(sim, 7, 7);
    expect(resourcesAtNode(sim.world, 7, 7)).toEqual([first, second, third]);
    sim.world.destroy(first);
    expect(resourcesAtNode(sim.world, 7, 7)).toEqual([second, third]);
    sim.world.destroy(second);
    sim.world.destroy(third);
    expect(resourcesAtNode(sim.world, 7, 7)).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('keeps a node bucket ascending when a lower id re-enters the store', () => {
    const sim = newSim();
    const a = nodeAt(sim, 9, 9);
    const b = nodeAt(sim, 9, 9);
    expect(resourcesAtNode(sim.world, 9, 9)).toEqual([a, b]);
    sim.world.remove(a, Resource);
    expect(resourcesAtNode(sim.world, 9, 9)).toEqual([b]);
    sim.world.add(a, Resource, { goodType: 1, remaining: 3, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, a, anchorOnlyFootprint());
    expect(resourcesAtNode(sim.world, 9, 9)).toEqual([a, b]); // sorted re-entry, not an append
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
