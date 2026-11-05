import { describe, expect, it } from 'vitest';
import { VehicleStock } from '../../../../../src/components/index.js';
import { contentIndex } from '../../../../../src/core/content-index.js';
import { colonyManifest, wantManifest } from '../../../../../src/systems/computer-player/colony/sea/cargo.js';
import { colonyStoreType } from '../../../../../src/systems/computer-player/colony/store-type.js';
import { colonyWorld, FOOD, mooredShip } from '../../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { SEAT, STOCK_TOP_TYPE } from '../../support.js';

const PARTY = 12;
const FOOD_PER_COLONIST = 2;

describe('a colony manifest', () => {
  it('carries the whole bill of a level-3 store placed at once, and food for the party', () => {
    const sim = colonyWorld();
    const ctx = ctxOf(sim);
    const ship = mooredShip(sim);
    expect(colonyStoreType(sim.world, ctx, SEAT)?.typeId).toBe(STOCK_TOP_TYPE);
    const manifest = colonyManifest(sim.world, ctx, SEAT, PARTY);
    for (const command of wantManifest(ship, manifest)) sim.enqueueSetup(command);
    sim.step();
    const wanted = sim.world.get(ship, VehicleStock).lines;
    for (const line of contentIndex(ctx.content).constructionBillByBuilding.get(STOCK_TOP_TYPE) ?? [])
      expect(wanted.get(line.goodType)?.wanted ?? 0).toBeGreaterThanOrEqual(line.amount);
    expect(wanted.get(FOOD)?.wanted).toBe(FOOD_PER_COLONIST * PARTY);
  });
});
