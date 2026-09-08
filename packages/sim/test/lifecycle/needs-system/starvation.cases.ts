import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import { Health, Settler, setSettlerJob } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../../src/index.js';
import {
  BABY_MALE,
  CHILD_AGE_TICKS,
  CHILD_MALE,
  HEALING_TICKS_TO_FULL,
  STARVATION_TICKS_TO_DIE,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { settlerWithHunger } from './support.js';

/** The fixture monster tribe (16): no `[animaltype]` record and no `jobEnables`, as the map monsters are. */
const MONSTER_TRIBE = 16;
/** The soldier trade the decoded maps give every placed monster. */
const MONSTER_JOB = 31;
/** The hitpoint pool the original gives a human, where its rates read as whole points per tick. */
const ORIGINAL_POOL = 5000;
/** Ticks that leave a starving pool one step short of empty: the first step lands on tick 1, so a pool
 *  never gets tick 0's share of its span. */
const ONE_STEP_SHORT = STARVATION_TICKS_TO_DIE - 2;

/** A window long enough for a 300-point pool to take several steps, so an exemption that holds across it
 *  is a real exemption and not a settler between steps. */
const SEVERAL_STEPS = 100;

/** A settler carrying a Health pool, hungry or fed as `hunger` says. */
function settlerWithPool(sim: Simulation, hunger: Fixed, hitpoints: number, max = hitpoints): Entity {
  const e = settlerWithHunger(sim, hunger);
  sim.world.add(e, Health, { hitpoints, max });
  return e;
}

function pool(sim: Simulation, e: Entity): number {
  return sim.world.tryGet(e, Health)?.hitpoints ?? 0;
}

describe('needsSystem - starvation (a pinned hunger drains hitpoints)', () => {
  it("spends the original's own pool at its two-points-a-tick rate", () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const starving = settlerWithPool(sim, ONE, ORIGINAL_POOL);
    const fed = settlerWithPool(sim, fx.fromInt(0), ORIGINAL_POOL);

    sim.step();
    expect(pool(sim, starving)).toBe(ORIGINAL_POOL - 2);
    sim.step();
    expect(pool(sim, starving)).toBe(ORIGINAL_POOL - 4);
    // The fed one is at its ceiling already, so it neither starves nor heals.
    expect(pool(sim, fed)).toBe(ORIGINAL_POOL);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('empties any pool over the same span, so the pool size sets the step and not the pace', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const small = settlerWithPool(sim, ONE, 300);
    const large = settlerWithPool(sim, ONE, 2400);

    for (let i = 0; i < ONE_STEP_SHORT; i++) sim.step();
    expect(pool(sim, small)).toBe(1);
    expect(pool(sim, large)).toBe(1);

    sim.step();
    expect(sim.world.has(small, Settler)).toBe(false); // emptied and reaped on the same tick
    expect(sim.world.has(large, Settler)).toBe(false);
  });

  it('starves a settler to death: the drained pool is reaped with a settlerDied event', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // A nearly dead settler off a big pool: the step scales with the pool, so this dies in a few ticks
    // rather than the whole span.
    const e = settlerWithPool(sim, ONE, 2, 2400);
    let died = false;
    for (let i = 0; i < 10 && !died; i++) {
      sim.step();
      died = sim.events.current().some((ev) => ev.kind === 'settlerDied' && ev.entity === e);
    }
    expect(died).toBe(true);
    expect(sim.world.has(e, Settler)).toBe(false); // reaped by cleanupSystem
  });

  it('exempts animals and jobless settlers (jobType null - no eat/graze path to save them)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithPool(sim, ONE, 300);
    setSettlerJob(sim.world, e, null);
    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, e)).toBe(300);
  });

  it('exempts a monster-tribe soldier - its tribe declares no trades, so no store is ever its own', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // The decoded maps place 2341 of these as owned soldiers. Their bars are frozen, so this pins the
    // other half of the exemption: an already-pinned one still takes no bite.
    const e = settlerWithHunger(sim, ONE, { tribe: MONSTER_TRIBE, jobType: MONSTER_JOB });
    sim.world.add(e, Health, { hitpoints: 300, max: 300 });
    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, e)).toBe(300);
  });

  for (const [stage, jobType, ageTicks] of [
    ['baby', BABY_MALE, 0],
    ['child', CHILD_MALE, CHILD_AGE_TICKS],
  ] as const) {
    it(`exempts a growing settler in the ${stage} stage - it carries no needs to starve on`, () => {
      const sim = new Simulation({ seed: 1, content: testContent() });
      // An authored pinned bar is the only way a growing settler reaches one: nothing in play moves it.
      // Age matters - an adult fixture whose synthetic job id collides with an age class must still starve.
      const e = settlerWithPool(sim, ONE, 300);
      setSettlerJob(sim.world, e, jobType);
      sim.world.add(e, components.Age, { ticks: ageTicks });
      for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
      expect(pool(sim, e)).toBe(300);
    });
  }

  it('stops starving while needs are disabled', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithPool(sim, ONE, 300);
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, e)).toBe(300);
  });
});

describe('needsSystem - healing (a fed settler regains hitpoints)', () => {
  it("returns the original's own pool at its one-point-a-tick rate", () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithPool(sim, fx.fromInt(0), 1, ORIGINAL_POOL);

    sim.step();
    expect(pool(sim, e)).toBe(2);
    sim.step();
    expect(pool(sim, e)).toBe(3);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('refills any pool over the same span, at half the pace starvation empties it', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const small = settlerWithPool(sim, fx.fromInt(0), 1, 300);
    const large = settlerWithPool(sim, fx.fromInt(0), 1, 4800);

    for (let i = 0; i < STARVATION_TICKS_TO_DIE; i++) sim.step();
    // Half the healing span in: both are about half full, where a starving settler would already be dead.
    expect(pool(sim, small)).toBe(151);
    expect(pool(sim, large)).toBe(2401);

    for (let i = 0; i < HEALING_TICKS_TO_FULL - STARVATION_TICKS_TO_DIE; i++) sim.step();
    expect(pool(sim, small)).toBe(300);
    expect(pool(sim, large)).toBe(4800);
    expect(HEALING_TICKS_TO_FULL).toBe(STARVATION_TICKS_TO_DIE * 2);
  });

  it('never heals a starving settler, and never past the ceiling', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const starving = settlerWithPool(sim, ONE, 100, 300);
    const whole = settlerWithPool(sim, fx.fromInt(0), 300);

    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, starving)).toBeLessThan(100);
    expect(pool(sim, whole)).toBe(300);
  });

  it('heals nothing while needs are disabled', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithPool(sim, fx.fromInt(0), 100, 300);
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });

    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, e)).toBe(100);
  });
});
