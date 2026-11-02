import { describe, expect, it } from 'vitest';
import { VehicleStock } from '../../../../src/components/index.js';
import { colonyManifest, wantManifest } from '../../../../src/systems/computer-player/colony/cargo.js';
import { colonyWorld, mooredShip, WHEAT } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { MUD, STONE, WOOD } from '../support.js';

/** What a store and a home cost in the real content, by good. */
const FOUNDING_BILL = new Map([
  [WOOD, 4],
  [STONE, 1],
  [MUD, 2],
  [WHEAT, 2],
]);
const SMALL_HOLD = 50;

describe('a colony manifest', () => {
  it('fits a small hold and covers the founding bill', () => {
    const sim = colonyWorld();
    const ctx = ctxOf(sim);
    const ship = mooredShip(sim);
    const lines = colonyManifest(ctx);
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBeLessThanOrEqual(SMALL_HOLD);
    for (const command of wantManifest(ctx, ship)) sim.enqueueSetup(command);
    sim.step();
    const wanted = sim.world.get(ship, VehicleStock).lines;
    for (const [good, bill] of FOUNDING_BILL)
      expect(wanted.get(good)?.wanted ?? 0).toBeGreaterThanOrEqual(bill);
  });
});
