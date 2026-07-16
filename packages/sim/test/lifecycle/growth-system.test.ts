import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Age, Position, Residence, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import {
  BABY_FEMALE,
  BABY_MALE,
  CHILD_FEMALE,
  CHILD_MALE,
  CIVILIST_JOB,
  GROWUP_TICKS,
  growthSystem,
  isNonWorkingAge,
  WOMAN_JOB,
} from '../../src/systems/index.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * GrowthSystem — a settler born young ({@link Age}-bearing) matures baby → child → adult over
 * {@link GROWUP_TICKS} per stage, sex preserved (a boy grows into a civilian, a girl into
 * the adult woman role), losing its Age component and its childhood home once grown. Adults never carry an Age, so the system
 * is a no-op for them (the goldens stay untouched).
 */

const VIKING = 1;

function growthContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 2, id: 'home_small', kind: 'home', homeSize: 3 }],
  });
}

/** Add a settler in a given non-working age class WITH an Age component at `ticks`. */
function bornSettler(sim: Simulation, jobType: number, ticks: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Age, { ticks });
  return e;
}

function run(sim: Simulation, n: number): void {
  for (let i = 0; i < n; i++) growthSystem(sim.world, ctxOf(sim));
}

describe('GrowthSystem — non-working settlers mature into workers', () => {
  it('a baby becomes a child of the same sex after GROWUP_TICKS', () => {
    const sim = new Simulation({ seed: 1, content: growthContent() });
    const she = bornSettler(sim, BABY_FEMALE, 0);
    const he = bornSettler(sim, BABY_MALE, 0);

    run(sim, GROWUP_TICKS - 1); // one short of the boundary: still babies
    expect(sim.world.get(she, Settler).jobType).toBe(BABY_FEMALE);
    expect(sim.world.get(he, Settler).jobType).toBe(BABY_MALE);

    run(sim, 1); // crosses GROWUP_TICKS: baby → child, sex preserved
    expect(sim.world.get(she, Settler).jobType).toBe(CHILD_FEMALE);
    expect(sim.world.get(he, Settler).jobType).toBe(CHILD_MALE);
    expect(sim.world.has(she, Age)).toBe(true); // a child is still a non-working age
    expect(isNonWorkingAge(sim.world.get(she, Settler).jobType)).toBe(true);
  });

  it('a child grows up after the second stage, losing Age and its home — a boy a civilian, a girl a woman', () => {
    const sim = new Simulation({ seed: 1, content: growthContent() });
    const she = bornSettler(sim, BABY_FEMALE, 0);
    const he = bornSettler(sim, BABY_MALE, 0);
    const home = 999 as Entity; // any id — graduation must drop the binding regardless
    sim.world.add(she, Residence, { home });
    sim.world.add(he, Residence, { home });

    run(sim, GROWUP_TICKS * 2 - 1); // one short of adulthood: children
    expect(sim.world.get(she, Settler).jobType).toBe(CHILD_FEMALE);
    expect(sim.world.has(she, Age)).toBe(true);
    expect(sim.world.has(she, Residence)).toBe(true); // a minor lives with its parents

    run(sim, 1); // crosses 2*GROWUP_TICKS: child → adult
    expect(sim.world.get(he, Settler).jobType).toBe(CIVILIST_JOB); // a grown boy is a civilian
    expect(sim.world.get(she, Settler).jobType).toBe(WOMAN_JOB); // the adult woman role
    expect(sim.world.has(she, Age)).toBe(false); // grown — no age bookkeeping
    expect(sim.world.has(he, Age)).toBe(false);
    expect(sim.world.has(she, Residence)).toBe(false); // moved out — its family slot frees
    expect(sim.world.has(he, Residence)).toBe(false);
  });

  it('does not touch an adult settler (no Age component)', () => {
    const sim = new Simulation({ seed: 1, content: growthContent() });
    const adult = sim.world.create();
    sim.world.add(adult, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(adult, Settler, {
      tribe: VIKING,
      jobType: 6, // an adult trade (civilist)
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map<number, number>(),
    });

    run(sim, GROWUP_TICKS * 3);
    expect(sim.world.get(adult, Settler).jobType).toBe(6); // unchanged
    expect(sim.world.has(adult, Age)).toBe(false);
  });

  it('is deterministic: two runs from the same seed hash-equal across the full maturation', () => {
    const hashAfter = (): string => {
      const sim = new Simulation({ seed: 7, content: growthContent() });
      bornSettler(sim, BABY_FEMALE, 0);
      bornSettler(sim, BABY_MALE, 0);
      // Use the full step schedule (not just growthSystem) so the hash covers the real tick — but
      // mapless, so the AI/movement systems are inert and only growth advances state.
      sim.run(GROWUP_TICKS * 2 + 5);
      return sim.hashState();
    };
    expect(hashAfter()).toBe(hashAfter());
  });
});
