import { describe, expect, it } from 'vitest';
import { VehicleStock } from '../../../../src/components/index.js';
import { colonyManifest, wantManifest } from '../../../../src/systems/computer-player/colony/cargo.js';
import { colonyWorld, mooredShip, WHEAT } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { MUD, STONE, WOOD } from '../support.js';

/** What a store, four homes and a second store cost in the real content, by good. */
const FOUNDING_BILL = new Map([
  [WOOD, 12],
  [STONE, 2],
  [MUD, 6],
  [WHEAT, 6],
]);
const SMALL_HOLD = 50;

describe('a colony manifest', () => {
  it('fills a small hold, cut on its last line, and still covers the founding bill', () => {
    const sim = colonyWorld();
    const ctx = ctxOf(sim);
    const ship = mooredShip(sim);
    const lines = colonyManifest(ctx);
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBeGreaterThan(SMALL_HOLD);
    for (const command of wantManifest(ctx, ship)) sim.enqueueSetup(command);
    sim.step();
    const wanted = sim.world.get(ship, VehicleStock).lines;
    let total = 0;
    for (const [good, bill] of FOUNDING_BILL) {
      const line = wanted.get(good)?.wanted ?? 0;
      total += line;
      expect(line).toBeGreaterThanOrEqual(bill);
    }
    expect(total).toBe(SMALL_HOLD);
    expect(wanted.get(WOOD)?.wanted).toBe(22);
  });
});
