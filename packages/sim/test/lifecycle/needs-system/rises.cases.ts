import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import { Settler } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import {
  BABY_MALE,
  CHILD_AGE_TICKS,
  CHILD_MALE,
  ENJOYMENT_RISE_PER_TICK,
  FATIGUE_RISE_PER_TICK,
  HUNGER_RISE_PER_TICK,
  needsSystem,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, settlerWithHunger } from './support.js';

/** A soldier job id (jobtypes.ini soldiers 31..41) — a fighter, whose company need is frozen. */
const SOLDIER_JOB = 31;

describe('needsSystem — hunger rises over time', () => {
  it('raises a settler hunger by exactly HUNGER_RISE_PER_TICK each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).hunger).toBe(HUNGER_RISE_PER_TICK);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).hunger).toBe(fx.add(HUNGER_RISE_PER_TICK, HUNGER_RISE_PER_TICK));
  });

  it('clamps hunger at ONE (never above — the hungerInRange invariant ceiling)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Start one step below the ceiling: the next rise would overshoot ONE and must clamp.
    const e = settlerWithHunger(sim, fx.sub(ONE, fx.div(HUNGER_RISE_PER_TICK, fx.fromInt(2))));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).hunger).toBe(ONE);

    // A fully-hungry settler stays pinned at ONE, never overflowing the invariant range.
    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).hunger).toBe(ONE);
  });

  it('rises every settler independently (each reads/writes only its own hunger)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const a = settlerWithHunger(sim, fx.fromInt(0));
    const b = settlerWithHunger(sim, fx.div(ONE, fx.fromInt(2)));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(a, Settler).hunger).toBe(HUNGER_RISE_PER_TICK);
    expect(sim.world.get(b, Settler).hunger).toBe(fx.add(fx.div(ONE, fx.fromInt(2)), HUNGER_RISE_PER_TICK));
  });

  it('runs through the real Simulation.step() schedule and stays invariant-clean', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    for (let i = 0; i < 100; i++) sim.step();
    // 100 ticks of rise: well below ONE, monotonically increasing, invariant-clean throughout.
    const hunger = sim.world.get(e, Settler).hunger;
    expect(hunger).toBe(fx.mul(HUNGER_RISE_PER_TICK, fx.fromInt(100)));
    expect(hunger).toBeLessThan(ONE);
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('needsSystem — a cared-for baby accumulates nothing', () => {
  it('freezes every need of an Age carrier in a baby stage (its family keeps it fed and rested)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const baby = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.get(baby, Settler).jobType = BABY_MALE;
    sim.world.add(baby, components.Age, { ticks: 0 });

    for (let i = 0; i < 100; i++) needsSystem(sim.world, ctxOf(sim));
    const settler = sim.world.get(baby, Settler);
    expect(settler.hunger).toBe(fx.fromInt(0));
    expect(settler.fatigue).toBe(fx.fromInt(0));
    expect(settler.enjoyment).toBe(fx.fromInt(0));
  });

  it('rises the needs of an Age carrier in a CHILD stage (weaned — it self-feeds from here)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const child = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.get(child, Settler).jobType = CHILD_MALE;
    sim.world.add(child, components.Age, { ticks: CHILD_AGE_TICKS });

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(child, Settler).hunger).toBe(HUNGER_RISE_PER_TICK);
  });

  it('rises the needs of an ADULT fixture whose synthetic job id collides with a baby id (no Age)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const adult = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.get(adult, Settler).jobType = BABY_MALE; // an adult trade in some fixtures — no Age carried

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(adult, Settler).hunger).toBe(HUNGER_RISE_PER_TICK);
  });
});

describe('needsSystem — fatigue rises over time', () => {
  it('raises a settler fatigue by exactly FATIGUE_RISE_PER_TICK each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0)); // starts with fatigue 0 too

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(FATIGUE_RISE_PER_TICK);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(fx.add(FATIGUE_RISE_PER_TICK, FATIGUE_RISE_PER_TICK));
  });

  it('rises at the same rate as hunger (both drain 10% in 1min20s at 1×)', () => {
    expect(FATIGUE_RISE_PER_TICK).toBe(HUNGER_RISE_PER_TICK);
  });

  it('clamps fatigue at ONE (never above — the fatigueInRange invariant ceiling)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    // Start one half-step below the ceiling: the next rise would overshoot ONE and must clamp.
    sim.world.get(e, Settler).fatigue = fx.sub(ONE, fx.div(FATIGUE_RISE_PER_TICK, fx.fromInt(2)));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(ONE);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(ONE);
  });

  it('rises hunger and fatigue together at the same rate in the same tick, invariant-clean', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    for (let i = 0; i < 100; i++) sim.step();
    const settler = sim.world.get(e, Settler);
    expect(settler.hunger).toBe(fx.mul(HUNGER_RISE_PER_TICK, fx.fromInt(100)));
    expect(settler.fatigue).toBe(fx.mul(FATIGUE_RISE_PER_TICK, fx.fromInt(100)));
    expect(settler.fatigue).toBe(settler.hunger); // same rate ⇒ equal after equal ticks
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('needsSystem — piety no longer rises over time', () => {
  it('leaves a settler piety untouched each tick (forging weapons is its only source)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0)); // starts with piety 0 too

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).piety).toBe(fx.fromInt(0));

    // A non-zero starting piety is also held, not decayed toward the ceiling.
    const held = fx.div(ONE, fx.fromInt(3));
    sim.world.get(e, Settler).piety = held;
    for (let i = 0; i < 50; i++) needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).piety).toBe(held);
  });

  it('stays at 0 across the real Simulation.step() schedule with no production', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.world.get(e, Settler).piety).toBe(fx.fromInt(0));
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('needsSystem — enjoyment (company) rises for civilians, frozen for fighters', () => {
  it('raises a civilian enjoyment by exactly ENJOYMENT_RISE_PER_TICK each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0)); // a woodcutter (civilian), enjoyment 0

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(ENJOYMENT_RISE_PER_TICK);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(
      fx.add(ENJOYMENT_RISE_PER_TICK, ENJOYMENT_RISE_PER_TICK),
    );
  });

  it('rises at the same rate as hunger for a civilian', () => {
    expect(ENJOYMENT_RISE_PER_TICK).toBe(HUNGER_RISE_PER_TICK);
  });

  it('does not raise a fighter enjoyment (a soldier company need is frozen)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.get(e, Settler).jobType = SOLDIER_JOB;

    for (let i = 0; i < 100; i++) needsSystem(sim.world, ctxOf(sim));
    const settler = sim.world.get(e, Settler);
    expect(settler.enjoyment).toBe(fx.fromInt(0)); // never rose
    expect(settler.hunger).toBe(fx.mul(HUNGER_RISE_PER_TICK, fx.fromInt(100))); // hunger still rises for all
  });

  it('clamps a civilian enjoyment at ONE (never above — the enjoymentInRange invariant ceiling)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    // Start one half-step below the ceiling: the next rise would overshoot ONE and must clamp.
    sim.world.get(e, Settler).enjoyment = fx.sub(ONE, fx.div(ENJOYMENT_RISE_PER_TICK, fx.fromInt(2)));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(ONE);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(ONE);
  });
});
