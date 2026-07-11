import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { Health, Position, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import {
  ENJOYMENT_RISE_PER_TICK,
  FATIGUE_RISE_PER_TICK,
  HUNGER_RISE_PER_TICK,
  needsSystem,
  PIETY_RISE_PER_TICK,
  STARVATION_BITES_TO_DIE,
  STARVATION_DAMAGE_INTERVAL_TICKS,
  type SystemContext,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { clearComponentStores } from '../fixtures/stores.js';

/**
 * Unit tests for the NeedsSystem — settlers get hungry AND tired over time. Each tick a settler's
 * `hunger` rises by {@link HUNGER_RISE_PER_TICK} and `fatigue` by {@link FATIGUE_RISE_PER_TICK}, each
 * clamped at ONE (the `hungerInRange`/`fatigueInRange` invariants require `[0, ONE]`); the
 * complementary resets (the `eat` atomic for hunger, a `sleep` atomic for fatigue) are AtomicSystem's
 * job, not under test here. The rest *drive* (heading off to sleep) is a later slice.
 */

const VIKING = 1;
const WOODCUTTER = 1;

beforeEach(clearComponentStores);

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** Spawn a settler with the given starting hunger (a `Fixed`, minted via `fx.*`). */
function settlerWithHunger(sim: Simulation, hunger: Fixed): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger,
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return e;
}

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

describe('needsSystem — fatigue rises over time', () => {
  it('raises a settler fatigue by exactly FATIGUE_RISE_PER_TICK each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0)); // starts with fatigue 0 too

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(FATIGUE_RISE_PER_TICK);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).fatigue).toBe(fx.add(FATIGUE_RISE_PER_TICK, FATIGUE_RISE_PER_TICK));
  });

  it('rises slower than hunger (a settler eats more often than it sleeps)', () => {
    // The cadence choice: fatigue at ONE/8192 vs hunger at ONE/4096 — fatigue fills in twice the ticks.
    expect(FATIGUE_RISE_PER_TICK).toBeLessThan(HUNGER_RISE_PER_TICK);
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

  it('rises hunger and fatigue independently in the same tick, invariant-clean', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    for (let i = 0; i < 100; i++) sim.step();
    const settler = sim.world.get(e, Settler);
    expect(settler.hunger).toBe(fx.mul(HUNGER_RISE_PER_TICK, fx.fromInt(100)));
    expect(settler.fatigue).toBe(fx.mul(FATIGUE_RISE_PER_TICK, fx.fromInt(100)));
    expect(settler.fatigue).toBeLessThan(settler.hunger); // slower rate ⇒ lower after equal ticks
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('needsSystem — piety rises over time (the first target-bound need)', () => {
  it('raises a settler piety by exactly PIETY_RISE_PER_TICK each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0)); // starts with piety 0 too

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).piety).toBe(PIETY_RISE_PER_TICK);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).piety).toBe(fx.add(PIETY_RISE_PER_TICK, PIETY_RISE_PER_TICK));
  });

  it('rises slower than fatigue (a settler prays far less often than it sleeps)', () => {
    // The cadence choice: piety at ONE/16384 vs fatigue at ONE/8192 — piety fills in twice the ticks.
    expect(PIETY_RISE_PER_TICK).toBeLessThan(FATIGUE_RISE_PER_TICK);
  });

  it('clamps piety at ONE (never above — the pietyInRange invariant ceiling)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    // Start one half-step below the ceiling: the next rise would overshoot ONE and must clamp.
    sim.world.get(e, Settler).piety = fx.sub(ONE, fx.div(PIETY_RISE_PER_TICK, fx.fromInt(2)));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).piety).toBe(ONE);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).piety).toBe(ONE);
  });

  it('rises three needs independently in the same tick, invariant-clean', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    for (let i = 0; i < 100; i++) sim.step();
    const settler = sim.world.get(e, Settler);
    expect(settler.piety).toBe(fx.mul(PIETY_RISE_PER_TICK, fx.fromInt(100)));
    expect(settler.piety).toBeLessThan(settler.fatigue); // slower than fatigue ⇒ lower after equal ticks
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('needsSystem — enjoyment rises over time (the recreation/leisure need)', () => {
  it('raises a settler enjoyment by exactly ENJOYMENT_RISE_PER_TICK each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0)); // starts with enjoyment 0 too

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(ENJOYMENT_RISE_PER_TICK);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(
      fx.add(ENJOYMENT_RISE_PER_TICK, ENJOYMENT_RISE_PER_TICK),
    );
  });

  it('rises slower than piety (recreation is the least-pressing of the bars)', () => {
    // The cadence choice: enjoyment at ONE/32768 vs piety at ONE/16384 — enjoyment fills in twice the ticks.
    expect(ENJOYMENT_RISE_PER_TICK).toBeLessThan(PIETY_RISE_PER_TICK);
  });

  it('clamps enjoyment at ONE (never above — the enjoymentInRange invariant ceiling)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    // Start one half-step below the ceiling: the next rise would overshoot ONE and must clamp.
    sim.world.get(e, Settler).enjoyment = fx.sub(ONE, fx.div(ENJOYMENT_RISE_PER_TICK, fx.fromInt(2)));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(ONE);

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Settler).enjoyment).toBe(ONE);
  });

  it('rises all four needs independently in the same tick, invariant-clean', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    for (let i = 0; i < 100; i++) sim.step();
    const settler = sim.world.get(e, Settler);
    expect(settler.enjoyment).toBe(fx.mul(ENJOYMENT_RISE_PER_TICK, fx.fromInt(100)));
    expect(settler.enjoyment).toBeLessThan(settler.piety); // slowest rate ⇒ lowest after equal ticks
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('needsSystem — the setNeedsEnabled world rule (the dev/admin toggle)', () => {
  it('freezes every need while disabled and resumes on re-enable', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
    for (let i = 0; i < 50; i++) sim.step();
    const frozen = sim.world.get(e, Settler);
    expect(frozen.hunger).toBe(fx.fromInt(0));
    expect(frozen.fatigue).toBe(fx.fromInt(0));
    expect(frozen.piety).toBe(fx.fromInt(0));
    expect(frozen.enjoyment).toBe(fx.fromInt(0));

    sim.enqueue({ kind: 'setNeedsEnabled', enabled: true });
    sim.step(); // the toggle applies (commandSystem) before needsSystem the same tick
    expect(sim.world.get(e, Settler).hunger).toBe(HUNGER_RISE_PER_TICK);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('reuses the one WorldRules singleton across repeated toggles', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
    sim.step();
    sim.enqueue({ kind: 'setNeedsEnabled', enabled: true });
    sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
    sim.step();
    expect([...components.WorldRules.store.keys()]).toHaveLength(1);
    expect(components.needsEnabled(sim.world)).toBe(false);
  });
});

describe('needsSystem — starvation (a pinned hunger drains hitpoints)', () => {
  /** A settler whose hunger is already pinned at ONE, carrying an explicit Health pool. */
  function starvingSettler(sim: Simulation, hitpoints: number): Entity {
    const e = settlerWithHunger(sim, ONE);
    sim.world.add(e, Health, { hitpoints, max: hitpoints });
    return e;
  }

  it('bites hitpoints on the interval beat only while hunger is pinned at ONE', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const starving = starvingSettler(sim, 300);
    const fed = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.add(fed, Health, { hitpoints: 300, max: 300 });

    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 3; i++) sim.step();
    // 300/240 truncates to 1 → the 1-damage floor, one bite per interval; the fed settler is untouched.
    expect(sim.world.get(starving, Health).hitpoints).toBe(300 - 3);
    expect(sim.world.get(fed, Health).hitpoints).toBe(300);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('scales the bite with the pool so any pool empties in ~STARVATION_BITES_TO_DIE intervals', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 2400);
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(2400 - 2400 / STARVATION_BITES_TO_DIE);
  });

  it('starves a settler to death: the drained pool is reaped with a settlerDied event', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 2); // two bites to die (fast-forward the death without 2400 ticks)
    let died = false;
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 2 + 1 && !died; i++) {
      sim.step();
      died = sim.events.current().some((ev) => ev.kind === 'settlerDied' && ev.entity === e);
    }
    expect(died).toBe(true);
    expect(sim.world.has(e, Settler)).toBe(false); // reaped by cleanupSystem
  });

  it('exempts animals and jobless settlers (jobType null — no eat/graze path to save them)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 300);
    sim.world.get(e, Settler).jobType = null;
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300);
  });

  it('exempts a growing baby/child (Age carrier) — a newborn must reach adulthood, not starve first', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // A newborn's jobType is an age-class id (non-null), so only the Age component marks it as cared-for;
    // the AI planner runs no needs-drives for it, so without this exemption every borne baby would die
    // of hunger before its GROWUP_TICKS boundary and reproduction would be a death loop.
    const e = starvingSettler(sim, 300);
    sim.world.add(e, components.Age, { ticks: 0 });
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300);
  });

  it('stops starving while needs are disabled', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 300);
    sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300);
  });
});
