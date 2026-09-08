import { existsSync } from 'node:fs';
import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import { adminCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapPath, realMapWorld } from './real-map-world.js';

/**
 * The scene parity test proves the driver on clean-room worlds; this proves it on the map a session is
 * actually played on, where six AI seats and their settlers push thousands of sim-emitted commands
 * through the queue the driver now shares.
 */

const MAP_ID = 'magiczny_las';
const AI_SEATS = [1, 2, 3, 4, 5, 6];
const RUN_TICKS = 200;
/** Often enough to share ticks with the AI seats, which decide on a per-seat cadence. */
const ORDER_EVERY_TICKS = 10;

/** A trusted rules toggle: it needs no entity, so the two runs order the same command on the same tick. */
function order(tick: number) {
  return adminCommand({ kind: 'setNeedsEnabled', enabled: tick % (ORDER_EVERY_TICKS * 2) === 0 });
}

describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))('loopback driver on a decoded map', () => {
  it('reaches the same state as the direct loop', { timeout: 120_000 }, async () => {
    // Orders land on shared ticks, so this covers the one case the queue has to order twice over: a
    // seat's stamped order against the AI seats' own commands for the same tick.
    const direct = (await realMapWorld({ mapId: MAP_ID, aiSeats: AI_SEATS, berryBushes: true })).sim;
    for (let i = 0; i < RUN_TICKS; i++) {
      if (direct.tick % ORDER_EVERY_TICKS === 0) direct.enqueue(order(direct.tick));
      direct.step();
    }

    const driven = (await realMapWorld({ mapId: MAP_ID, aiSeats: AI_SEATS, berryBushes: true })).sim;
    const driver = new LockstepDriver({ sim: driven, transport: new LoopbackTransport() });
    for (let i = 0; i < RUN_TICKS; i++) {
      if (driven.tick % ORDER_EVERY_TICKS === 0) driver.submit(order(driven.tick));
      expect(driver.runTick()).toBe(true);
    }

    expect(driven.tick).toBe(direct.tick);
    expect(driven.hashState()).toBe(direct.hashState());
    expect(driven.commands.log.map((entry) => [entry.applyTick, entry.sequence, entry.command])).toEqual(
      direct.commands.log.map((entry) => [entry.applyTick, entry.sequence, entry.command]),
    );
  });
});
