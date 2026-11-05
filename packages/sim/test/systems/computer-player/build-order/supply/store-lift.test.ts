import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { Simulation } from '../../../../../src/index.js';
import { homeBuildings } from '../../../../../src/systems/ai-shared/home-roster.js';
import { seatBaseOf } from '../../../../../src/systems/computer-player/base.js';
import { homeStoreLift } from '../../../../../src/systems/computer-player/build-order/supply/store-lift.js';
import { LATE_GAME_FROM_TICKS } from '../../../../../src/systems/computer-player/game-phase.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';
import {
  aiSim,
  entityOfBuilding,
  HQ_TYPE,
  placeHq,
  SEAT,
  STOCK_TOP_TYPE,
  STOCK_TYPE,
  VIKING,
} from '../../support.js';

/** A warehouse west of the HQ. */
const STORE_AT = { x: 12, y: 16 };

/** The fixture with its store chain joined, base tier to top. */
function chainedStores(): ContentSet {
  const content = aiContent();
  const buildings = content.buildings.map((b) =>
    b.typeId === STOCK_TYPE ? { ...b, upgradeTarget: STOCK_TOP_TYPE } : b,
  );
  return { ...content, buildings };
}

/** A seat with its HQ and a built base-tier warehouse, as a placing paper leaves one. */
function seatWithLowStore(): Simulation {
  const sim = aiSim(1, chainedStores());
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: STOCK_TYPE,
    ...STORE_AT,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
  });
  sim.step();
  return sim;
}

describe('a home warehouse below the top tier', () => {
  it('goes straight up to the top tier from the late game', () => {
    const sim = seatWithLowStore();
    const opening = ctxOf(sim);
    const early = seatBaseOf(sim.world, opening, SEAT);
    if (early === null) throw new Error('setup: no base');
    expect(
      homeStoreLift(sim.world, opening, SEAT, homeBuildings(sim.world, opening, SEAT), early),
    ).toBeNull();
    const ctx = { ...opening, tick: LATE_GAME_FROM_TICKS };
    const base = seatBaseOf(sim.world, ctx, SEAT);
    if (base === null) throw new Error('setup: no base');
    const store = entityOfBuilding(sim, STOCK_TYPE);
    expect(homeStoreLift(sim.world, ctx, SEAT, homeBuildings(sim.world, ctx, SEAT), base)).toEqual({
      kind: 'upgradeBuilding',
      building: store,
      target: STOCK_TOP_TYPE,
    });
  });

  it('stays as it is while it is the seat’s base, the hub the seat would lose as it rose', () => {
    const sim = seatWithLowStore();
    sim.world.destroy(entityOfBuilding(sim, HQ_TYPE));
    const ctx = { ...ctxOf(sim), tick: LATE_GAME_FROM_TICKS };
    const base = seatBaseOf(sim.world, ctx, SEAT);
    expect(base).toBe(entityOfBuilding(sim, STOCK_TYPE));
    if (base === null) throw new Error('setup: no base');
    expect(homeStoreLift(sim.world, ctx, SEAT, homeBuildings(sim.world, ctx, SEAT), base)).toBeNull();
  });
});
