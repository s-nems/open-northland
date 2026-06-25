import { beforeEach, describe, expect, it } from 'vitest';
import { Position, Settler } from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import { ONE, Simulation, fx } from '../src/index.js';
import { HUNGER_RISE_PER_TICK, type SystemContext, needsSystem } from '../src/systems/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Unit tests for the NeedsSystem — settlers get hungry over time. Each tick a settler's `hunger`
 * rises by {@link HUNGER_RISE_PER_TICK}, clamped at ONE (the `hungerInRange` invariant requires
 * `[0, ONE]`); the complementary reset is the `eat` atomic (AtomicSystem), not under test here.
 */

const VIKING = 1;
const WOODCUTTER = 1;

beforeEach(() => {
  Settler.store.clear();
  Position.store.clear();
});

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** Spawn a settler with the given starting hunger. */
function settlerWithHunger(sim: Simulation, hunger: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: hunger as ReturnType<typeof fx.fromInt>,
    experience: new Map<number, number>(),
  });
  return e;
}

describe('needsSystem — hunger rises over time', () => {
  it('raises a settler hunger by exactly HUNGER_RISE_PER_TICK each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, 0);

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
    const a = settlerWithHunger(sim, 0);
    const b = settlerWithHunger(sim, fx.div(ONE, fx.fromInt(2)));

    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(a, Settler).hunger).toBe(HUNGER_RISE_PER_TICK);
    expect(sim.world.get(b, Settler).hunger).toBe(fx.add(fx.div(ONE, fx.fromInt(2)), HUNGER_RISE_PER_TICK));
  });

  it('runs through the real Simulation.step() schedule and stays invariant-clean', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, 0);

    for (let i = 0; i < 100; i++) sim.step();
    // 100 ticks of rise: well below ONE, monotonically increasing, invariant-clean throughout.
    const hunger = sim.world.get(e, Settler).hunger;
    expect(hunger).toBe(fx.mul(HUNGER_RISE_PER_TICK, fx.fromInt(100)));
    expect(hunger).toBeLessThan(ONE);
    expect(sim.checkInvariants()).toEqual([]);
  });
});
