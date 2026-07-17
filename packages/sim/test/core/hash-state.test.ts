import { describe, expect, it } from 'vitest';
import { ChildOrder } from '../../src/components/family.js';
import { CurrentAtomic } from '../../src/components/settler.js';
import type { AtomicEffect } from '../../src/core/atomic-effect.js';
import { fx, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * `hashState()` is the determinism tripwire: any state a run can diverge in must move the hash.
 * String-typed component fields carry real state (an `AtomicEffect`'s `kind` discriminant,
 * `ChildOrder.child`), so these guard the branch that mixes them — without it two runs differing
 * only in such a field hash identically and the divergence surfaces much later, somewhere else.
 */

const SLEEP_ATOMIC = 5;
const ATOMIC_DURATION = 10;

/** A sim holding exactly one entity with `effect` as its current atomic. */
function simWithAtomicEffect(effect: AtomicEffect): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent() });
  const e = sim.world.create();
  sim.world.add(e, CurrentAtomic, {
    atomicId: SLEEP_ATOMIC,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: ATOMIC_DURATION,
    effect,
    targetEntity: null,
    targetTile: null,
  });
  return sim;
}

describe('hashState string values', () => {
  it('distinguishes payload-free atomic effects that differ only by kind', () => {
    const sleep = simWithAtomicEffect({ kind: 'sleep' });
    const pray = simWithAtomicEffect({ kind: 'pray' });
    expect(sleep.hashState()).not.toBe(pray.hashState());
  });

  it('distinguishes the two ChildOrder sexes', () => {
    const female = new Simulation({ seed: 1, content: testContent() });
    const male = new Simulation({ seed: 1, content: testContent() });
    female.world.add(female.world.create(), ChildOrder, { child: 'female' });
    male.world.add(male.world.create(), ChildOrder, { child: 'male' });
    expect(female.hashState()).not.toBe(male.hashState());
  });

  it('is byte-identical for equal string state', () => {
    expect(simWithAtomicEffect({ kind: 'sleep' }).hashState()).toBe(
      simWithAtomicEffect({ kind: 'sleep' }).hashState(),
    );
  });
});
