import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import { Settler, setSettlerJob } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import {
  BABY_MALE,
  CHILD_AGE_TICKS,
  CHILD_MALE,
  NEED_DRAIN_UNITS_PER_TICK,
  needBar,
  needsSystem,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, settlerWithHunger } from './support.js';

/** What one tick of doing nothing costs a bar. */
const DRAIN = needBar(NEED_DRAIN_UNITS_PER_TICK);

/** A soldier job id (jobtypes.ini soldiers 31..41) - a fighter, whose company need is frozen. */
const SOLDIER_JOB = 31;
/** The fixture hero class, classified from its `hero_*` content id. */
const HERO_JOB = 45;
/** The fixture bear (tribe 10), a tribe with an `[animaltype]` record - what `isAnimalTribe` reads. */
const ANIMAL_TRIBE = 10;
/** The fixture monster tribe (16): no `[animaltype]` record, so not wildlife, and no `jobEnables`. */
const MONSTER_TRIBE = 16;
/** A tribe id the fixture content declares no `[tribetype]` for at all. */
const UNRECORDED_TRIBE = 99;

describe('needsSystem - hunger rises over time', () => {
  it('raises a settler hunger by exactly one drain unit each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).hunger).toBe(DRAIN);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).hunger).toBe(fx.add(DRAIN, DRAIN));
  });

  it('clamps hunger at ONE (never above - the needsInRange invariant ceiling)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Start one step below the ceiling: the next rise would overshoot ONE and must clamp.
    const e = settlerWithHunger(sim, fx.sub(ONE, fx.div(DRAIN, fx.fromInt(2))));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).hunger).toBe(ONE);

    // A fully-hungry settler stays pinned at ONE, never overflowing the invariant range.
    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).hunger).toBe(ONE);
  });

  it('leaves a settler whose drained bars have all pinned unwritten', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Jobless, so a pinned hunger costs no hitpoints and the Settler store is the only one in play.
    const e = settlerWithHunger(sim, ONE, { jobType: null });
    const pinned = sim.world.mut(e, Settler);
    pinned.fatigue = ONE;
    pinned.enjoyment = ONE;
    const writes = sim.world.componentValueGeneration(Settler);

    needsSystem(sim.world, ctxOf(sim));

    expect(sim.world.componentValueGeneration(Settler)).toBe(writes);
  });

  it('rises every settler independently (each reads/writes only its own hunger)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const a = settlerWithHunger(sim, fx.fromInt(0));
    const b = settlerWithHunger(sim, fx.div(ONE, fx.fromInt(2)));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(a, Settler).hunger).toBe(DRAIN);
    expect(sim.world.get(b, Settler).hunger).toBe(fx.add(fx.div(ONE, fx.fromInt(2)), DRAIN));
  });

  it('runs through the real Simulation.step() schedule and stays invariant-clean', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    for (let i = 0; i < 100; i++) sim.step();
    // 100 ticks of rise: well below ONE, monotonically increasing, invariant-clean throughout.
    const hunger = sim.world.get(e, Settler).hunger;
    expect(hunger).toBe(fx.mul(DRAIN, fx.fromInt(100)));
    expect(hunger).toBeLessThan(ONE);
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('needsSystem: the wildlife exemption, and only wildlife', () => {
  it('freezes every need of an animal-tribe settler (no bar could ever be satisfied)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // As spawnAnimalHerd places it: an animal tribe, and wildlife takes no trade.
    const bear = settlerWithHunger(sim, fx.fromInt(0), { tribe: ANIMAL_TRIBE, jobType: null });
    const settler = sim.world.get(bear, Settler);

    for (let i = 0; i < 100; i++) needsSystem(sim.world, ctxOf(sim));
    expect(settler.hunger).toBe(fx.fromInt(0));
    expect(settler.fatigue).toBe(fx.fromInt(0));
    expect(settler.enjoyment).toBe(fx.fromInt(0));
  });

  it('rises the needs of a JOBLESS civilization settler (only wildlife is exempt, not joblessness)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const idle = settlerWithHunger(sim, fx.fromInt(0));
    setSettlerJob(sim.world, idle, null); // e.g. its workplace was just demolished

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(idle, Settler).hunger).toBe(DRAIN);
  });
});

describe('needsSystem: heroes carry no needs', () => {
  it('keeps all four bars fixed for a hero of a trading civilization', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hero = settlerWithHunger(sim, fx.fromInt(0), { jobType: HERO_JOB });
    const initial = sim.world.get(hero, Settler);
    const before = {
      hunger: initial.hunger,
      fatigue: initial.fatigue,
      piety: initial.piety,
      enjoyment: initial.enjoyment,
    };

    for (let i = 0; i < 100; i++) needsSystem(sim.world, ctxOf(sim));

    const after = sim.world.get(hero, Settler);
    expect(after.hunger).toBe(before.hunger);
    expect(after.fatigue).toBe(before.fatigue);
    expect(after.piety).toBe(before.piety);
    expect(after.enjoyment).toBe(before.enjoyment);
  });
});

describe('needsSystem: a person of a tribe that declares no trades', () => {
  it('freezes every need of a monster-tribe settler, which is a person and not wildlife', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // As the decoded maps place them: an owned soldier of a tribe with no economy behind it.
    const monster = settlerWithHunger(sim, fx.fromInt(0), {
      tribe: MONSTER_TRIBE,
      jobType: SOLDIER_JOB,
    });
    expect(sim.world.has(monster, components.Person)).toBe(true);

    for (let i = 0; i < 100; i++) needsSystem(sim.world, ctxOf(sim));
    const settler = sim.world.get(monster, Settler);
    expect(settler.hunger).toBe(fx.fromInt(0));
    expect(settler.fatigue).toBe(fx.fromInt(0));
    expect(settler.enjoyment).toBe(fx.fromInt(0));
  });

  it('still ages the needs of a settler whose tribe has no record at all', () => {
    // The gate reads "recorded, and declares no trades". `!isPlayableTribe` would also be true for a tribe
    // the content never described, which would freeze the bars of a settler nothing classified.
    const sim = new Simulation({ seed: 1, content: testContent() });
    const stranger = settlerWithHunger(sim, fx.fromInt(0), { tribe: UNRECORDED_TRIBE });

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(stranger, Settler).hunger).toBe(DRAIN);
  });
});

describe('needsSystem - a settler still growing carries no needs', () => {
  for (const [stage, jobType, ageTicks] of [
    ['baby', BABY_MALE, 0],
    ['child', CHILD_MALE, CHILD_AGE_TICKS],
  ] as const) {
    it(`freezes every need of an Age carrier in the ${stage} stage (its family feeds and rests it)`, () => {
      const sim = new Simulation({ seed: 1, content: testContent() });
      const young = settlerWithHunger(sim, fx.fromInt(0));
      setSettlerJob(sim.world, young, jobType);
      sim.world.add(young, components.Age, { ticks: ageTicks });

      for (let i = 0; i < 100; i++) needsSystem(sim.world, ctxOf(sim));
      const settler = sim.world.get(young, Settler);
      expect(settler.hunger).toBe(fx.fromInt(0));
      expect(settler.fatigue).toBe(fx.fromInt(0));
      expect(settler.enjoyment).toBe(fx.fromInt(0));
    });
  }

  it('rises the needs of an ADULT fixture whose synthetic job id collides with a baby id (no Age)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const adult = settlerWithHunger(sim, fx.fromInt(0));
    setSettlerJob(sim.world, adult, BABY_MALE); // an adult trade in some fixtures - no Age carried

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(adult, Settler).hunger).toBe(DRAIN);
  });
});

describe('needsSystem - fatigue rises over time', () => {
  it('raises a settler fatigue by exactly one drain unit each tick, the same rate as hunger', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0)); // starts with fatigue 0 too

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(DRAIN);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(fx.add(DRAIN, DRAIN));
  });

  it('clamps fatigue at ONE (never above - the needsInRange invariant ceiling)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    // Start one half-step below the ceiling: the next rise would overshoot ONE and must clamp.
    sim.world.mut(e, Settler).fatigue = fx.sub(ONE, fx.div(DRAIN, fx.fromInt(2)));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(ONE);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(ONE);
  });

  it('rises hunger and fatigue together in the same tick, invariant-clean', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    for (let i = 0; i < 100; i++) sim.step();
    const settler = sim.world.get(e, Settler);
    expect(settler.hunger).toBe(fx.mul(DRAIN, fx.fromInt(100)));
    expect(settler.fatigue).toBe(settler.hunger); // same rate ⇒ equal after equal ticks
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('needsSystem - piety no longer rises over time', () => {
  it('leaves a settler piety untouched each tick (forging weapons is its only source)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0)); // starts with piety 0 too

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).piety).toBe(fx.fromInt(0));

    // A non-zero starting piety is also held, not decayed toward the ceiling.
    const held = fx.div(ONE, fx.fromInt(3));
    sim.world.mut(e, Settler).piety = held;
    for (let i = 0; i < 50; i++) needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).piety).toBe(held);
  });
});

describe('needsSystem - enjoyment (company) rises for civilians, frozen for fighters', () => {
  it('raises a civilian enjoyment by exactly one drain unit each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0)); // a woodcutter (civilian), enjoyment 0

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(DRAIN);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(fx.add(DRAIN, DRAIN));
  });

  it('does not raise a fighter enjoyment (a soldier company need is frozen)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    setSettlerJob(sim.world, e, SOLDIER_JOB);

    for (let i = 0; i < 100; i++) needsSystem(sim.world, ctxOf(sim));
    const settler = sim.world.get(e, Settler);
    expect(settler.enjoyment).toBe(fx.fromInt(0)); // never rose
    expect(settler.hunger).toBe(fx.mul(DRAIN, fx.fromInt(100))); // hunger still rises for all
  });

  it('clamps a civilian enjoyment at ONE (never above - the needsInRange invariant ceiling)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    // Start one half-step below the ceiling: the next rise would overshoot ONE and must clamp.
    sim.world.mut(e, Settler).enjoyment = fx.sub(ONE, fx.div(DRAIN, fx.fromInt(2)));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(ONE);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(ONE);
  });
});
