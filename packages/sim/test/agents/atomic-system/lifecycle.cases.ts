import { describe, expect, it } from 'vitest';
import { CurrentAtomic } from '../../../src/components/index.js';
import { ONE, Simulation } from '../../../src/index.js';
import { atomicSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, startAtomic } from './support.js';

describe('atomicSystem — progress + completion', () => {
  it('advances progress and completes on the duration-th tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    startAtomic(sim, e, { kind: 'idle' }, 4);

    // Ticks 1..3: still running, progress climbing.
    for (let i = 0; i < 3; i++) {
      atomicSystem(sim.world, ctxOf(sim));
      expect(sim.world.has(e, CurrentAtomic)).toBe(true);
      expect(sim.world.get(e, CurrentAtomic).progress).toBeLessThan(ONE);
    }
    // Tick 4: reaches ONE, applies + removes.
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
  });

  it('completes on the exact tick even for a duration ONE does not divide evenly', () => {
    // Regression: ONE/3 truncates, so accumulating a fixed-point step would sum to < ONE after 3
    // ticks and hang. Integer `elapsed` makes completion exact. Try several odd durations.
    for (const duration of [3, 6, 7]) {
      CurrentAtomic.store.clear();
      const sim = new Simulation({ seed: 1, content: testContent() });
      const e = sim.world.create();
      startAtomic(sim, e, { kind: 'idle' }, duration);
      for (let i = 0; i < duration - 1; i++) {
        atomicSystem(sim.world, ctxOf(sim));
        expect(sim.world.has(e, CurrentAtomic)).toBe(true);
      }
      atomicSystem(sim.world, ctxOf(sim)); // duration-th tick
      expect(sim.world.has(e, CurrentAtomic)).toBe(false);
    }
  });

  it('a zero/one-tick animation completes on the first tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    startAtomic(sim, e, { kind: 'idle' }, 0); // clamped to >= 1
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
  });

  it('emits an atomicCompleted event with the atomicId on completion', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    sim.events.clear();
    startAtomic(sim, e, { kind: 'idle' }, 1, 24);
    atomicSystem(sim.world, ctxOf(sim));
    const evts = sim.events.current().filter((ev) => ev.kind === 'atomicCompleted');
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({ kind: 'atomicCompleted', entity: e, atomicId: 24 });
  });
});
