import { describe, expect, it } from 'vitest';
import {
  AtomicClock,
  addCurrentAtomic,
  atomicElapsed,
  CurrentAtomic,
} from '../../../src/components/index.js';
import { exportSaveGame, restoreSimulation, Simulation } from '../../../src/index.js';
import { atomicSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { fixtureTick, nextTickCtxOf } from '../../fixtures/context.js';
import { ctxOf, startAtomic } from './support.js';

describe('atomicSystem - clock + completion', () => {
  it('advances its clock and completes on the duration-th tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    startAtomic(sim, e, { kind: 'idle' }, 4);

    // Ticks 1..3: still running, the clock counting up.
    for (let i = 1; i <= 3; i++) {
      atomicSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.has(e, CurrentAtomic)).toBe(true);
      expect(atomicElapsed(sim.world.get(e, AtomicClock), fixtureTick(sim))).toBe(i);
    }
    // Tick 4: reaches the duration, applies + removes.
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
  });

  it('keeps the clock revision stable between start and completion, including after restore', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    startAtomic(sim, e, { kind: 'idle' }, 8);
    sim.run(2);
    const revision = sim.world.revisionOf(e, AtomicClock);
    sim.run(3);
    expect(atomicElapsed(sim.world.get(e, AtomicClock), sim.tick)).toBe(5);
    expect(sim.world.revisionOf(e, AtomicClock)).toBe(revision);
    const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content });
    restored.run(2);
    expect(atomicElapsed(restored.world.get(e, AtomicClock), restored.tick)).toBe(7);
    restored.step();
    expect(restored.world.has(e, AtomicClock)).toBe(false);
    expect(restored.events.current()).toContainEqual({ kind: 'atomicCompleted', entity: e, atomicId: 1 });
  });

  it('starts a clip created after the executor on the following tick, preserving prefilled progress', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    atomicSystem(sim.world, { ...ctxOf(sim), tick: 17 });
    addCurrentAtomic(
      sim.world,
      e,
      { atomicId: 1, duration: 5, effect: { kind: 'idle' }, targetEntity: null, targetTile: null },
      2,
    );
    expect(atomicElapsed(sim.world.get(e, AtomicClock), 17)).toBe(2);
    atomicSystem(sim.world, { ...ctxOf(sim), tick: 18 });
    expect(atomicElapsed(sim.world.get(e, AtomicClock), 18)).toBe(3);
    atomicSystem(sim.world, { ...ctxOf(sim), tick: 19 });
    expect(sim.world.has(e, CurrentAtomic)).toBe(true);
    atomicSystem(sim.world, { ...ctxOf(sim), tick: 20 });
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
  });

  it('completes on the exact tick even for a duration ONE does not divide evenly', () => {
    // Regression: ONE/3 truncates, so accumulating a fixed-point step would sum to < ONE after 3
    // ticks and hang. Integer `elapsed` makes completion exact. Try several odd durations.
    for (const duration of [3, 6, 7]) {
      const sim = new Simulation({ seed: 1, content: testContent() });
      const e = sim.world.create();
      startAtomic(sim, e, { kind: 'idle' }, duration);
      for (let i = 0; i < duration - 1; i++) {
        atomicSystem(sim.world, nextTickCtxOf(sim));
        expect(sim.world.has(e, CurrentAtomic)).toBe(true);
      }
      atomicSystem(sim.world, nextTickCtxOf(sim)); // duration-th tick
      expect(sim.world.has(e, CurrentAtomic)).toBe(false);
    }
  });

  it('a zero/one-tick animation completes on the first tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    startAtomic(sim, e, { kind: 'idle' }, 0); // clamped to >= 1
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
  });

  it('emits an atomicCompleted event with the atomicId on completion', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    sim.events.clear();
    startAtomic(sim, e, { kind: 'idle' }, 1, 24);
    atomicSystem(sim.world, nextTickCtxOf(sim));
    const evts = sim.events.current().filter((ev) => ev.kind === 'atomicCompleted');
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({ kind: 'atomicCompleted', entity: e, atomicId: 24 });
  });
});
