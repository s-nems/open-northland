import { describe, expect, it } from 'vitest';
import { Carrying, CurrentAtomic, MoveGoal, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import {
  aiSystem,
  atomicSystem,
  FATIGUE_RISE_PER_TICK,
  SLEEP_FATIGUE_RESTORE,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, grassMap, justAbove, NEED_THRESHOLD, needsSettlerAt, treeAt } from './needs/support.js';

/**
 * Unit + integration tests for the SLEEP DRIVE — the planner choosing a `sleep` atomic (id 8, the
 * original's sleep-slot) when a settler's fatigue crosses the threshold, bedding down on open ground
 * (stepping off a workplace doorstep first) and taking SLEEP_FATIGUE_RESTORE off fatigue on completion,
 * closing the NeedsSystem's rise→sleep→relief loop.
 *
 * The viking tribe binds sleep atomic 8 → "viking_sleep" (length 6); the sleep atomic id (8) is
 * pinned to the original `setatomic <job> 8 "..._sleep"` bindings; the ¾·ONE threshold, the 20% relief
 * per sleep, and the step-aside clearance are approximated from observed original behaviour (source basis).
 */

const SLEEP_ATOMIC = 8;
// Just over the ¾·ONE sleep threshold — a settler this tired rests before any work.
const TIRED: Fixed = justAbove(NEED_THRESHOLD);
// Comfortably below the threshold — a rested settler ignores the sleep drive and works as normal.
const RESTED: Fixed = fx.div(ONE, fx.fromInt(2));

function settlerAt(sim: Simulation, x: number, y: number, fatigue: Fixed, hunger = fx.fromInt(0)): Entity {
  return needsSettlerAt(sim, x, y, { hunger, fatigue });
}

describe('sleepDrive — the planner choosing to sleep', () => {
  it('starts a sleep atomic (duration from content) on the spot when already lying in the open', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 2, 0, TIRED);
    // A tree to harvest exists, but the tired settler rests instead of working.
    treeAt(sim, 3, 0);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, MoveGoal)).toBe(false); // already clear ground — no walk needed
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(SLEEP_ATOMIC);
    expect(atomic.duration).toBe(6); // viking setatomic 8 -> "viking_sleep" length 6
    expect(atomic.effect).toEqual({ kind: 'sleep' });
  });

  it('ignores the sleep drive below the threshold (a rested settler works normally)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, RESTED);
    treeAt(sim, 3, 0);

    aiSystem(sim.world, ctxOf(sim));

    // Headed for the wood, not resting — the sleep drive did not fire.
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    const treeNode = cellAnchorNode(3, 0); // the tree's anchor node on the half-cell lattice
    expect(sim.world.get(settler, MoveGoal).cell).toBe(sim.terrain?.nodeAt(treeNode.hx, treeNode.hy));
  });

  it('eats before sleeping when both needs are over the threshold (eat has priority)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // Both hungry AND tired; the settler carries food so the eat drive resolves on the spot.
    const settler = settlerAt(sim, 0, 0, TIRED, TIRED);
    sim.world.add(settler, Carrying, { goodType: 3 /* food_simple */, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(10); // EAT — eat outranks sleep
    expect(atomic.effect.kind).toBe('eat');
  });
});

describe('sleep atomic — relieving fatigue on completion (AtomicSystem)', () => {
  it('takes one sleep off fatigue and consumes no goods', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, TIRED);
    sim.world.add(settler, CurrentAtomic, {
      atomicId: SLEEP_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1, // completes the first tick
      effect: { kind: 'sleep' },
      targetEntity: settler,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    // One sleep is a partial refill, not a reset — a settler run to the top of its bar beds down again.
    expect(sim.world.get(settler, Settler).fatigue).toBe(fx.sub(TIRED, SLEEP_FATIGUE_RESTORE));
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false); // atomic done
  });
});

describe('sleep drive — closing the rise→sleep→relief loop through the real schedule', () => {
  it('a settler gets tired, sleeps, and a sleep comes off its fatigue bar', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(3, 1) });
    // Start the settler already near the threshold so it crosses within a short headless run.
    const settler = settlerAt(sim, 0, 0, NEED_THRESHOLD);

    let peakFatigue = sim.world.get(settler, Settler).fatigue;
    let troughFatigue = peakFatigue;
    for (let i = 0; i < 200; i++) {
      sim.step();
      const f = sim.world.get(settler, Settler).fatigue;
      if (f > peakFatigue) peakFatigue = f;
      if (f < troughFatigue) troughFatigue = f;
    }

    // The loop closed: fatigue rose to the threshold, the settler slept, and a sleep's worth came off
    // the bar (the tick's own rise may land alongside it).
    const oneSleepBelowPeak = fx.sub(peakFatigue, fx.sub(SLEEP_FATIGUE_RESTORE, FATIGUE_RISE_PER_TICK));
    expect(troughFatigue).toBeLessThanOrEqual(oneSleepBelowPeak);
    expect(troughFatigue).toBeGreaterThan(fx.fromInt(0)); // one sleep is a partial refill, never a reset
    expect(peakFatigue).toBeLessThanOrEqual(ONE); // never breached the fatigueInRange ceiling
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(3, 1) });
      settlerAt(sim, 0, 0, NEED_THRESHOLD);
      for (let i = 0; i < 200; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
