import { describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The snapshot PERF machinery a decoded map depends on (tens of thousands of standing entities, golden
 * rule 6): `Simulation.snapshot()` is memoized per tick, and `takeSnapshot` reuses a cached clone for
 * ANY entity the World's touched-entity log did not name since the previous snapshot
 * (`add`/`remove`/`destroy` auto-log; an in-place write logs through `World.mut`).
 * These tests pin the identity contract (reuse) and, more importantly, the INVALIDATION paths - a
 * stale clone would render a harvested node as still full - plus the `verifyCaches` verifier that
 * catches a write that bypassed the seam in invariant-checked runs.
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

/** Spawn a bare mobile entity: Position only, the shape the scenery-only cache used to re-clone. */
function bareMover(sim: Simulation) {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: 0, y: 0 });
  return e;
}

describe('Simulation.snapshot() per-tick memo', () => {
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

  it('rebuilds after a bare create() with no components added', () => {
    const sim = newSim();
    bareResource(sim, 5);
    const a = sim.snapshot();
    // A snapshot emits one entry per alive id, so a component-less entity still changes it - `create`
    // must bump the version on its own rather than relying on a following `add`.
    sim.world.create();
    const b = sim.snapshot();
    expect(b).not.toBe(a);
    expect(b.entities).toHaveLength(2);
  });
});

describe('takeSnapshot entity clone cache', () => {
  it('reuses an unchanged entity clone VERBATIM across snapshots (identity)', () => {
    const sim = newSim();
    const node = bareResource(sim, 5);
    const mover = bareMover(sim); // not scenery: the cache covers every untouched entity
    const a = sim.snapshot();
    sim.step(); // advances the tick; the untouched entities' clones must be reused, not re-cloned
    const b = sim.snapshot();
    for (const id of [node as number, mover as number]) {
      const inA = a.entities.find((e) => e.id === id);
      const inB = b.entities.find((e) => e.id === id);
      expect(inA).toBeDefined();
      expect(inB).toBe(inA);
    }
  });

  it('re-clones an entity after an in-place write through world.mut (the harvest path)', () => {
    const sim = newSim();
    const node = bareResource(sim, 5);
    const a = sim.snapshot();
    // The harvest effect's exact idiom: mutate the stored value through the tracked seam. No step
    // separates the two snapshots, so this also pins that `mut` invalidates the same-tick memo.
    sim.world.mut(node, Resource).remaining = 4;
    const b = sim.snapshot();
    const inA = a.entities.find((e) => e.id === (node as number));
    const inB = b.entities.find((e) => e.id === (node as number));
    expect(inB).not.toBe(inA);
    expect(inB?.components.Resource).toMatchObject({ remaining: 4 });
    // The earlier snapshot stays what it observed - clones never alias the live store.
    expect(inA?.components.Resource).toMatchObject({ remaining: 5 });
  });

  it('drops a destroyed entity from the next snapshot (destroy auto-logs)', () => {
    const sim = newSim();
    const node = bareResource(sim, 5);
    sim.snapshot();
    sim.world.destroy(node);
    const b = sim.snapshot();
    expect(b.entities.find((e) => e.id === (node as number))).toBeUndefined();
  });

  it('verifyCaches accepts a tracked mutation awaiting its drain (scheduled eviction, not stale)', () => {
    const sim = newSim();
    const node = bareResource(sim, 5);
    sim.snapshot(); // fills the cache (and registers its verifier)
    expect(sim.world.verifyCaches()).toEqual([]);
    sim.world.mut(node, Resource).remaining = 4; // logged: the next snapshot evicts this clone
    expect(sim.world.verifyCaches()).toEqual([]);
    expect(sim.snapshot().entities[0]?.components.Resource).toMatchObject({ remaining: 4 });
  });

  it('verifyCaches reports a stale clone when an in-place write BYPASSES the tracked seam', () => {
    const sim = newSim();
    const node = bareResource(sim, 5);
    sim.snapshot(); // fills the cache (and registers its verifier)
    expect(sim.world.verifyCaches()).toEqual([]);
    // The bug the verifier exists to catch: defeating the readonly view to write without logging.
    (sim.world.get(node, Resource) as { remaining: number }).remaining = 1;
    const findings = sim.world.verifyCaches();
    expect(findings.some((f) => f.includes('snapshot clone'))).toBe(true);
  });
});
