import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import { adminCommand, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';

/**
 * A scene that diverges here means the driver enqueued something the plain loop did not, or skipped a
 * tick.
 */

/** Enough ticks past a scene's authored setup to run its systems; the scene tests own the full runs. */
const PARITY_TICKS = 120;

function ticksFor(runTicks: number): number {
  return Math.min(runTicks, PARITY_TICKS);
}

function raise(message: string): never {
  throw new Error(message);
}

function drive(sim: Simulation, ticks: number): Simulation {
  const driver = new LockstepDriver({ sim, transport: new LoopbackTransport() });
  for (let i = 0; i < ticks; i++) expect(driver.runTick()).toBe(true);
  return sim;
}

describe('loopback driver parity', () => {
  for (const scene of SCENES) {
    it(`reaches the same state as the direct loop on '${scene.id}'`, () => {
      const ticks = ticksFor(scene.runTicks);
      const direct = createSceneSim(scene);
      direct.run(ticks);
      const driven = drive(createSceneSim(scene), ticks);
      expect(driven.tick).toBe(direct.tick);
      expect(driven.hashState()).toBe(direct.hashState());
    });
  }

  it('logs a HUD command at the tick after the one it was issued on', () => {
    const scene = SCENES[0] ?? raise('the scene registry is empty');
    const sim = createSceneSim(scene);
    const driver = new LockstepDriver({ sim, transport: new LoopbackTransport() });
    driver.runTick();
    driver.runTick();
    const issuedAt = sim.tick;
    driver.submit(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
    driver.runTick();
    const last = sim.commands.log.at(-1);
    expect(last?.command.kind).toBe('setNeedsEnabled');
    expect(last?.applyTick).toBe(issuedAt + 1);
  });
});
