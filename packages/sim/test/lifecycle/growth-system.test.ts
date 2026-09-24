import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Age, addPerson, Health, Position, Residence, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation, TICKS_PER_SECOND } from '../../src/index.js';
import {
  ADULT_AGE_TICKS,
  BABY_FEMALE,
  BABY_MALE,
  CHILD_AGE_TICKS,
  CHILD_FEMALE,
  CHILD_MALE,
  CIVILIST_JOB,
  DEFAULT_SETTLER_HITPOINTS,
  growthSystem,
  isNonWorkingAge,
  TICKS_PER_AGE_YEAR,
  WOMAN_JOB,
} from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * GrowthSystem - a settler born young ({@link Age}-bearing) matures baby → child → adult over
 * two measured stages ({@link CHILD_AGE_TICKS}, {@link ADULT_AGE_TICKS}), sex preserved (a boy grows into a civilian, a girl into
 * the adult woman role), losing its Age component and its childhood home once grown and trading the childhood health pool for
 * its tribe's adult one. Adults never carry an Age, so the system is a no-op for them (the goldens stay untouched).
 */

const VIKING = 1;
const ADULT_HP = 5000; // the real-content scale, ~16x the childhood pool
const SMALL_ADULT_HP = 100; // a tribe whose adults are frailer than its children - the shrink direction

/** `tribeHitpoints` is the tribe's ADULT pool; 0 leaves it unset (the fallback path). */
function growthContent(tribeHitpoints = 0): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 2, id: 'home_small', kind: 'home', homeSize: 3 }],
    // The one `jobEnables` edge keeps the tribe playable rather than wildlife (`isAnimalTribe`), which
    // decides whether its settlers live a needs life under the full schedule.
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        hitpoints: tribeHitpoints,
        jobEnables: [{ jobType: 0, kind: 'job', targetId: 0 }],
      },
    ],
  });
}

/** Add a settler in a given non-working age class WITH an Age component at `ticks`, on the childhood
 *  health pool a birth stamps. */
function bornSettler(sim: Simulation, jobType: number, ticks: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Age, { ticks });
  sim.world.add(e, Health, {
    hitpoints: DEFAULT_SETTLER_HITPOINTS,
    max: DEFAULT_SETTLER_HITPOINTS,
  });
  return e;
}

function run(sim: Simulation, n: number): void {
  for (let i = 0; i < n; i++) growthSystem(sim.world, ctxOf(sim));
}

/** Drop a settler to `hitpoints` - what a sword blow or a starvation bite leaves behind. */
function wound(sim: Simulation, e: Entity, hitpoints: number): void {
  sim.world.mut(e, Health).hitpoints = hitpoints;
}

describe('GrowthSystem - non-working settlers mature into workers', () => {
  // The measured cadence itself - every other case below is written in terms of the stage constants, so
  // only this one fails if they drift off what was observed in the original.
  it('childhood runs the observed 4 minutes of x1 play: a child at 4 years, an adult at 12', () => {
    expect(ADULT_AGE_TICKS / TICKS_PER_SECOND).toBe(4 * 60);
    expect(ADULT_AGE_TICKS / TICKS_PER_AGE_YEAR).toBe(12);
    expect(CHILD_AGE_TICKS / TICKS_PER_AGE_YEAR).toBe(4);
  });

  it('a baby becomes a child of the same sex at CHILD_AGE_TICKS', () => {
    const sim = new Simulation({ seed: 1, content: growthContent() });
    const she = bornSettler(sim, BABY_FEMALE, 0);
    const he = bornSettler(sim, BABY_MALE, 0);

    run(sim, CHILD_AGE_TICKS - 1); // one short of the boundary: still babies
    expect(sim.world.get(she, Settler).jobType).toBe(BABY_FEMALE);
    expect(sim.world.get(he, Settler).jobType).toBe(BABY_MALE);

    run(sim, 1); // crosses CHILD_AGE_TICKS: baby → child, sex preserved
    expect(sim.world.get(she, Settler).jobType).toBe(CHILD_FEMALE);
    expect(sim.world.get(he, Settler).jobType).toBe(CHILD_MALE);
    expect(sim.world.has(she, Age)).toBe(true); // a child is still a non-working age
    expect(isNonWorkingAge(sim.world.get(she, Settler).jobType)).toBe(true);
  });

  it('a child grows up at ADULT_AGE_TICKS, losing Age and its home - a boy a civilian, a girl a woman', () => {
    const sim = new Simulation({ seed: 1, content: growthContent() });
    const she = bornSettler(sim, BABY_FEMALE, 0);
    const he = bornSettler(sim, BABY_MALE, 0);
    const home = 999 as Entity; // any id - graduation must drop the binding regardless
    sim.world.add(she, Residence, { home });
    sim.world.add(he, Residence, { home });

    run(sim, ADULT_AGE_TICKS - 1); // one short of adulthood: children
    expect(sim.world.get(she, Settler).jobType).toBe(CHILD_FEMALE);
    expect(sim.world.has(she, Age)).toBe(true);
    expect(sim.world.has(she, Residence)).toBe(true); // a minor lives with its parents

    run(sim, 1); // crosses ADULT_AGE_TICKS: child → adult
    expect(sim.world.get(he, Settler).jobType).toBe(CIVILIST_JOB); // a grown boy is a civilian
    expect(sim.world.get(she, Settler).jobType).toBe(WOMAN_JOB); // the adult woman role
    expect(sim.world.has(she, Age)).toBe(false); // grown - no age bookkeeping
    expect(sim.world.has(he, Age)).toBe(false);
    expect(sim.world.has(she, Residence)).toBe(false); // moved out - its family slot frees
    expect(sim.world.has(he, Residence)).toBe(false);
  });

  it('announces each graduation once, so the HUD can note a child reaching adulthood', () => {
    const sim = new Simulation({ seed: 1, content: growthContent() });
    const she = bornSettler(sim, BABY_FEMALE, 0);
    const he = bornSettler(sim, BABY_MALE, 0);

    run(sim, ADULT_AGE_TICKS - 1);
    expect(sim.events.current().filter((ev) => ev.kind === 'settlerGrewUp')).toEqual([]);

    run(sim, 1);
    expect(sim.events.current().filter((ev) => ev.kind === 'settlerGrewUp')).toEqual([
      { kind: 'settlerGrewUp', entity: she },
      { kind: 'settlerGrewUp', entity: he },
    ]);

    run(sim, 1); // grown settlers carry no Age, so nothing repeats
    expect(sim.events.current().filter((ev) => ev.kind === 'settlerGrewUp')).toHaveLength(2);
  });

  it("grows a child's childhood health pool into its tribe's adult one", () => {
    const sim = new Simulation({ seed: 1, content: growthContent(ADULT_HP) });
    const he = bornSettler(sim, BABY_MALE, 0);

    run(sim, ADULT_AGE_TICKS - 1); // still a child: the small pool it was born with
    expect(sim.world.get(he, Health)).toEqual({
      hitpoints: DEFAULT_SETTLER_HITPOINTS,
      max: DEFAULT_SETTLER_HITPOINTS,
    });

    run(sim, 1); // grown - the same pool an adult of this tribe spawns with
    expect(sim.world.get(he, Health)).toEqual({ hitpoints: ADULT_HP, max: ADULT_HP });
  });

  it('carries a wounded child over as a fraction of the adult pool', () => {
    const sim = new Simulation({ seed: 1, content: growthContent(ADULT_HP) });
    const half = bornSettler(sim, BABY_MALE, 0);
    const dying = bornSettler(sim, BABY_FEMALE, 0);
    wound(sim, half, DEFAULT_SETTLER_HITPOINTS / 2);
    wound(sim, dying, 1);

    run(sim, ADULT_AGE_TICKS);
    expect(sim.world.get(half, Health)).toEqual({ hitpoints: ADULT_HP / 2, max: ADULT_HP });
    // 1/300 of 5000 truncates to 16 - growing up does not heal the wound away.
    expect(sim.world.get(dying, Health)).toEqual({ hitpoints: 16, max: ADULT_HP });
  });

  it('floors the carried wound at 1 HP when the adult pool is the smaller one', () => {
    const sim = new Simulation({ seed: 1, content: growthContent(SMALL_ADULT_HP) });
    const he = bornSettler(sim, BABY_MALE, 0);
    wound(sim, he, 1); // 1/300 of 100 truncates to 0 - growing up must not kill

    run(sim, ADULT_AGE_TICKS);
    expect(sim.world.get(he, Health)).toEqual({ hitpoints: 1, max: SMALL_ADULT_HP });
  });

  it('leaves a child killed this tick dead - CleanupSystem reaps it, growth must not revive it', () => {
    const sim = new Simulation({ seed: 1, content: growthContent(ADULT_HP) });
    const he = bornSettler(sim, BABY_MALE, 0);
    wound(sim, he, 0); // combat and needs run before growth, so a corpse can graduate

    run(sim, ADULT_AGE_TICKS);
    expect(sim.world.get(he, Health)).toEqual({
      hitpoints: 0,
      max: DEFAULT_SETTLER_HITPOINTS, // the whole pool is left as the reap will find it
    });
  });

  it('leaves the pool alone when the tribe declares none - its adults spawn on the same default', () => {
    const sim = new Simulation({ seed: 1, content: growthContent() });
    const he = bornSettler(sim, BABY_MALE, 0);

    run(sim, ADULT_AGE_TICKS);
    expect(sim.world.get(he, Settler).jobType).toBe(CIVILIST_JOB); // it did grow up
    expect(sim.world.get(he, Health)).toEqual({
      hitpoints: DEFAULT_SETTLER_HITPOINTS,
      max: DEFAULT_SETTLER_HITPOINTS,
    });
  });

  it('does not touch an adult settler (no Age component)', () => {
    const sim = new Simulation({ seed: 1, content: growthContent() });
    const adult = sim.world.create();
    sim.world.add(adult, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    addPerson(sim.world, adult, {
      tribe: VIKING,
      jobType: 6, // an adult trade (civilist)
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });

    run(sim, ADULT_AGE_TICKS * 2);
    expect(sim.world.get(adult, Settler).jobType).toBe(6); // unchanged
    expect(sim.world.has(adult, Age)).toBe(false);
  });

  it('is deterministic: two runs from the same seed hash-equal across the full maturation', () => {
    const hashAfter = (): string => {
      // A tribe WITH an adult pool, so the graduation health write is under the hash contract too.
      const sim = new Simulation({ seed: 7, content: growthContent(ADULT_HP) });
      bornSettler(sim, BABY_FEMALE, 0);
      bornSettler(sim, BABY_MALE, 0);
      // Use the full step schedule (not just growthSystem) so the hash covers the real tick - but
      // mapless, so the AI/movement systems are inert and only growth advances state.
      sim.run(ADULT_AGE_TICKS + 5);
      return sim.hashState();
    };
    expect(hashAfter()).toBe(hashAfter());
  });
});
