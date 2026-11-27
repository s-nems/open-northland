import { adminCommand, type LoggedCommand, MS_PER_TICK, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { LockstepDriver, LoopbackTransport, ReplayDriver, ReplayTransport } from '../src/index.js';

/**
 * A replay is the same session driven by its recording: the recorded commands reapply on the exact
 * ticks and in the exact order they originally took, the replaying sim's own re-emissions drop, and
 * the clock stands once the recording is over.
 */

const SEED = 5;
const TICKS = 12;

function sim(): Simulation {
  return new Simulation({ seed: SEED, content: testContent() });
}

/** A trusted rules toggle: mapless, and its effect is readable straight off the sim. */
function setNeeds(enabled: boolean) {
  return adminCommand({ kind: 'setNeedsEnabled', enabled });
}

/** A driven session with a few commands on it, and the recording it leaves behind. */
function recordedSession(): {
  readonly sim: Simulation;
  readonly log: readonly LoggedCommand[];
  readonly driverFor: (replayed: Simulation) => ReplayDriver;
} {
  const driven = sim();
  const driver = new LockstepDriver({ sim: driven, transport: new LoopbackTransport() });
  for (let tick = 1; tick <= TICKS; tick++) {
    if (tick === 3) driver.submit(setNeeds(false));
    if (tick === 7) driver.submit(setNeeds(true));
    if (tick === 9) driver.submit(setNeeds(false));
    driver.runTick();
  }
  const log = driven.commands.log;
  return {
    sim: driven,
    log,
    driverFor: (replayed) =>
      new ReplayDriver({
        sim: replayed,
        transport: new ReplayTransport(log, 0, driven.tick),
      }),
  };
}

describe('replay driver', () => {
  it('replays a driven session to the exact state it recorded', () => {
    const { sim: driven, driverFor } = recordedSession();
    const replayed = sim();
    const driver = driverFor(replayed);
    while (driver.runTick());
    expect(replayed.tick).toBe(driven.tick);
    expect(replayed.hashState()).toBe(driven.hashState());
    expect(driver.ended).toBe(true);
    expect(driver.paused).toBe(true);
  });

  it('renumbers the replayed log like the run it reconstructs', () => {
    const { sim: driven, log, driverFor } = recordedSession();
    const replayed = sim();
    const driver = driverFor(replayed);
    while (driver.runTick());
    expect(replayed.commands.log.map((entry) => [entry.applyTick, entry.sequence])).toEqual(
      log.map((entry) => [entry.applyTick, entry.sequence]),
    );
    expect(driven.tick).toBe(TICKS);
  });

  it('discards a replaying sim\u2019s own pending commands and admits the recorded copy', () => {
    const { sim: driven, driverFor } = recordedSession();
    const replayed = sim();
    // A sim-emitted command the original run recorded: the replaying sim re-emits it live, and the
    // recorded copy must be the only one that applies.
    replayed.enqueue(setNeeds(true));
    const driver = driverFor(replayed);
    while (driver.runTick());
    expect(replayed.hashState()).toBe(driven.hashState());
  });

  it('runs ticks the recording carries no command for, as its empty frames', () => {
    const { sim: driven, log, driverFor } = recordedSession();
    // The last command applies at tick 9; the recording still covers the quiet ticks to 12.
    expect(log.map((entry) => entry.applyTick)).toEqual([3, 7, 9]);
    const replayed = sim();
    const driver = driverFor(replayed);
    while (driver.runTick());
    expect(replayed.tick).toBe(driven.tick);
    expect(replayed.hashState()).toBe(driven.hashState());
  });

  it('pauses the clock at the recording\u2019s end and holds it there', () => {
    const { sim: driven, driverFor } = recordedSession();
    const replayed = sim();
    const driver = driverFor(replayed);
    for (let tick = 1; tick < driven.tick; tick++) expect(driver.runTick()).toBe(true);
    expect(driver.runTick()).toBe(true);
    expect(driver.runTick()).toBe(false);
    expect(driver.paused).toBe(true);
    driver.setPaused(false);
    expect(driver.paused).toBe(true);
  });

  it('refuses a tick past the recording without running it', () => {
    const { sim: driven, driverFor } = recordedSession();
    const replayed = sim();
    const driver = driverFor(replayed);
    driver.setPaused(true);
    expect(driver.runTick()).toBe(false);
    expect(replayed.tick).toBe(0);
    driver.setPaused(false);
    // One frame steps a capped number of ticks; keep feeding frames until the recording is over.
    for (let frames = 0; frames < 10 && replayed.tick < driven.tick; frames++)
      driver.advance(MS_PER_TICK * 2 * TICKS);
    expect(replayed.tick).toBe(driven.tick);
  });

  it('rejects a recording whose commands reach past its end', () => {
    const { log } = recordedSession();
    expect(() => new ReplayTransport(log, 0, 5)).toThrow(/past the recording/);
  });

  it('rejects a live command', () => {
    const driver = new ReplayDriver({
      sim: sim(),
      transport: new ReplayTransport([], 0, 0),
    });
    expect(() => driver.submit(setNeeds(true))).toThrow(/no live commands/);
  });

  it('scales elapsed time by the speed like the live driver does', () => {
    const { sim: driven } = recordedSession();
    const replayed = sim();
    const driver = new ReplayDriver({
      sim: replayed,
      transport: new ReplayTransport(driven.commands.log, 0, driven.tick),
      speed: 2,
    });
    driver.advance(MS_PER_TICK);
    expect(replayed.tick).toBe(2);
  });
});
