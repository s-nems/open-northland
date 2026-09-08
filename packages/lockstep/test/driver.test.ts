import { adminCommand, type CommandEnvelope, MS_PER_TICK, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { LockstepDriver, LoopbackTransport, type SessionTransport, type TickFrame } from '../src/index.js';

/**
 * The driver is the one loop every session runs, so single-player through loopback has to reach the
 * same state the direct `sim.step()` path did, and a session whose inputs have not arrived must hold
 * rather than run the tick without them.
 */

const SEED = 5;
const TICKS = 12;

function sim(): Simulation {
  return new Simulation({ seed: SEED, content: testContent() });
}

function driverOver(transport: SessionTransport, simulation = sim()): LockstepDriver {
  return new LockstepDriver({ sim: simulation, transport });
}

/** A trusted rules toggle: mapless, and its effect is readable straight off the sim. */
function setNeeds(enabled: boolean): CommandEnvelope {
  return adminCommand({ kind: 'setNeedsEnabled', enabled });
}

describe('lockstep driver', () => {
  it('reaches the state the direct step path reaches', () => {
    const direct = sim();
    for (let i = 0; i < TICKS; i++) direct.step();
    const driven = sim();
    const driver = driverOver(new LoopbackTransport(), driven);
    for (let i = 0; i < TICKS; i++) expect(driver.runTick()).toBe(true);
    expect(driven.tick).toBe(direct.tick);
    expect(driven.hashState()).toBe(direct.hashState());
  });

  it('applies a submitted command one tick on, exactly where an enqueue applied it', () => {
    const enqueued = sim();
    enqueued.step();
    enqueued.enqueue(setNeeds(false));
    enqueued.step();

    const driven = sim();
    const driver = driverOver(new LoopbackTransport(), driven);
    driver.runTick();
    driver.submit(setNeeds(false));
    driver.runTick();

    expect(driven.hashState()).toBe(enqueued.hashState());
    const logged = driven.commands.log.map((entry) => [entry.applyTick, entry.sequence]);
    expect(logged).toEqual(enqueued.commands.log.map((entry) => [entry.applyTick, entry.sequence]));
    expect(logged).toEqual([[2, 0]]);
  });

  it("lands a submitted command behind the tick's own emissions, where an enqueue landed it", () => {
    // The old path held one queue in enqueue order: a seat's AI command, emitted during the previous
    // tick, then the person's order. A stamped order has to land in the same place.
    const enqueued = sim();
    enqueued.step();
    enqueued.enqueue(setNeeds(true)); // stands in for an AI seat's command
    enqueued.enqueue(setNeeds(false));
    enqueued.step();

    const driven = sim();
    const driver = driverOver(new LoopbackTransport(), driven);
    driver.runTick();
    driven.enqueue(setNeeds(true));
    driver.submit(setNeeds(false));
    driver.runTick();

    expect(driven.hashState()).toBe(enqueued.hashState());
    expect(driven.commands.log.map((entry) => entry.command)).toEqual(
      enqueued.commands.log.map((entry) => entry.command),
    );
  });

  it('orders two commands submitted on the same tick by their assigned position', () => {
    const driven = sim();
    const driver = driverOver(new LoopbackTransport(), driven);
    driver.submit(setNeeds(false));
    driver.submit(setNeeds(true));
    driver.runTick();
    expect(driven.commands.log.map((entry) => entry.sequence)).toEqual([0, 1]);
    expect(driven.needsEnabled()).toBe(true);
  });

  it('holds a tick whose frame has not arrived, and keeps its time owed', () => {
    let held: TickFrame | null = null;
    const stalled: SessionTransport = {
      submit: () => undefined,
      take: (tick) => (held !== null && held.tick === tick ? held : null),
    };
    const driven = sim();
    const driver = driverOver(stalled, driven);
    expect(driver.advance(MS_PER_TICK * 3)).toBe(1); // the alpha never runs past the last tick drawn
    expect(driven.tick).toBe(0);
    held = { tick: 1, commands: [] };
    // The three ticks of waiting are still owed, so the first one runs without any new elapsed time.
    driver.advance(0);
    expect(driven.tick).toBe(1);
  });

  it('runs no tick while paused and scales elapsed time by the speed', () => {
    const driven = sim();
    const driver = driverOver(new LoopbackTransport(), driven);
    driver.setPaused(true);
    driver.advance(MS_PER_TICK * 4);
    expect(driven.tick).toBe(0);
    expect(driver.runTick()).toBe(false);
    driver.setPaused(false);
    driver.setSpeed(2);
    driver.advance(MS_PER_TICK);
    expect(driven.tick).toBe(2);
  });

  it('refuses a speed that would stop or reverse the session', () => {
    const driver = driverOver(new LoopbackTransport());
    expect(() => driver.setSpeed(0)).toThrow(/positive/);
    expect(() => driver.setSpeed(Number.NaN)).toThrow(/positive/);
  });
});
