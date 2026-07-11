import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { Simulation, clearComponentStores } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The snapshot PERF machinery a decoded map depends on (tens of thousands of standing resource nodes,
 * golden rule 6): `Simulation.snapshot()` is memoized per tick, and `takeSnapshot` reuses a cached
 * clone for an unchanged SCENERY entity (one carrying `Resource`/`Stump`) — evicted through the
 * World's touched-entity log (`add`/`remove`/`destroy` auto-log; an in-place write must `touch`).
 * These tests pin the identity contract (reuse) and, more importantly, the INVALIDATION paths — a
 * stale clone would render a harvested node as still full — plus the `verifyCaches` verifier that
 * catches a missed `touch` in invariant-checked runs.
 */

const { Position, Resource } = components;

function newSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent() });
}

/** Spawn a bare scenery node directly (fixture idiom): Position + Resource, no footprint needed. */
function bareResource(sim: Simulation, remaining: number) {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: 0, y: 0 });
  sim.world.add(e, Resource, { goodType: 1, remaining, harvestAtomic: 24 });
  return e;
}

describe('Simulation.snapshot() per-tick memo', () => {
  beforeEach(clearComponentStores);

  it('returns the SAME snapshot object while the tick and world are unchanged', () => {
    const sim = newSim();
    bareResource(sim, 5);
    const a = sim.snapshot();
    expect(sim.snapshot()).toBe(a);
  });

  it('rebuilds after a step (tick advanced)', () => {
    const sim = newSim();
    bareResource(sim, 5);
    const a = sim.snapshot();
    sim.step();
    const b = sim.snapshot();
    expect(b).not.toBe(a);
    expect(b.tick).toBe(a.tick + 1);
  });

  it('rebuilds after a direct same-tick world mutation (a fixture spawn logs itself)', () => {
    const sim = newSim();
    bareResource(sim, 5);
    const a = sim.snapshot();
    bareResource(sim, 3); // world.add auto-logs → the memo must not serve the stale one-entity view
    const b = sim.snapshot();
    expect(b).not.toBe(a);
    expect(b.entities).toHaveLength(2);
  });
});

describe('takeSnapshot scenery clone cache', () => {
  beforeEach(clearComponentStores);

  it('reuses an unchanged scenery entity clone VERBATIM across snapshots (identity)', () => {
    const sim = newSim();
    const node = bareResource(sim, 5);
    const a = sim.snapshot();
    sim.step(); // advances the tick; the untouched node's clone must be reused, not re-cloned
    const b = sim.snapshot();
    const inA = a.entities.find((e) => e.id === (node as number));
    const inB = b.entities.find((e) => e.id === (node as number));
    expect(inA).toBeDefined();
    expect(inB).toBe(inA);
  });

  it('re-clones a scenery entity after an in-place write that calls world.touch (the harvest path)', () => {
    const sim = newSim();
    const node = bareResource(sim, 5);
    const a = sim.snapshot();
    // The harvest effect's exact idiom: mutate the stored value in place, then log the entity.
    sim.world.get(node, Resource).remaining = 4;
    sim.world.touch(node);
    const b = sim.snapshot();
    const inA = a.entities.find((e) => e.id === (node as number));
    const inB = b.entities.find((e) => e.id === (node as number));
    expect(inB).not.toBe(inA);
    expect((inB?.components.Resource as { remaining: number }).remaining).toBe(4);
    // The earlier snapshot stays what it observed — clones never alias the live store.
    expect((inA?.components.Resource as { remaining: number }).remaining).toBe(5);
  });

  it('drops a destroyed scenery entity from the next snapshot (destroy auto-logs)', () => {
    const sim = newSim();
    const node = bareResource(sim, 5);
    sim.snapshot();
    sim.world.destroy(node);
    const b = sim.snapshot();
    expect(b.entities.find((e) => e.id === (node as number))).toBeUndefined();
  });

  it('verifyCaches reports a stale clone when an in-place write MISSES world.touch', () => {
    const sim = newSim();
    const node = bareResource(sim, 5);
    sim.snapshot(); // fills the cache (and registers its verifier)
    expect(sim.world.verifyCaches()).toEqual([]);
    sim.world.get(node, Resource).remaining = 1; // the bug the verifier exists to catch: no touch
    const findings = sim.world.verifyCaches();
    expect(findings.some((f) => f.includes('snapshot scenery clone'))).toBe(true);
  });
});
