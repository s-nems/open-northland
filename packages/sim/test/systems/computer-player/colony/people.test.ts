import { describe, expect, it } from 'vitest';
import { Female, Marriage } from '../../../../src/components/index.js';
import { everySettlerOf } from '../../../../src/systems/ai-shared/home-roster.js';
import { boardOrders, partyFor, pickParty } from '../../../../src/systems/computer-player/colony/people.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { colonyWorld, mooredShip, stepUntil } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT } from '../support.js';

const LARGE_SEAT = 200;
const SPARE_SEAT = 80;
const TIGHT_SEAT = 40;
const THIN_SEAT = 34;
const MARRIED_BY_TICKS = minutesToTicks(5);

describe('a colony party', () => {
  it('is about 15 men and 5 women, scaled to what the seat can spare', () => {
    expect(partyFor(LARGE_SEAT)).toEqual({ men: 15, women: 5 });
    expect(partyFor(SPARE_SEAT)).toEqual({ men: 15, women: 5 });
    expect(partyFor(TIGHT_SEAT)).toEqual({ men: 8, women: 2 });
    expect(partyFor(THIN_SEAT)).toBeNull();
  });

  it('sails a wife with her husband, and a husband alone leaves the home to his family', () => {
    const sim = colonyWorld();
    const ctx = ctxOf(sim);
    const land = ctx.terrain?.componentOf(ctx.terrain.nodeAtClamped(60, 60)) ?? -1;
    stepUntil(sim, MARRIED_BY_TICKS, () => {
      return everySettlerOf(sim.world, SEAT).every(
        (e) => !sim.world.has(e, Female) || sim.world.has(e, Marriage),
      );
    });
    const party = pickParty(sim.world, ctxOf(sim), SEAT, land);
    const sailing = new Set(party);
    const wives = party.filter((e) => sim.world.has(e, Female));
    expect(wives.length).toBeGreaterThan(0);
    for (const wife of wives) expect(sailing.has(sim.world.get(wife, Marriage).spouse)).toBe(true);
    const orders = boardOrders(sim.world, party, mooredShip(sim));
    const gaveUp = new Set(orders.flatMap((c) => (c.kind === 'unassignHouse' ? [c.entity] : [])));
    for (const e of party) {
      const spouse = sim.world.tryGet(e, Marriage)?.spouse;
      expect(gaveUp.has(e)).toBe(spouse === undefined || sailing.has(spouse));
    }
  });

  it('takes the men first and skips the married partner of nobody it takes', () => {
    const sim = colonyWorld();
    const ctx = ctxOf(sim);
    const land = ctx.terrain?.componentOf(ctx.terrain.nodeAtClamped(60, 60)) ?? -1;
    const party = pickParty(sim.world, ctx, SEAT, land);
    expect(party.length).toBeGreaterThanOrEqual(10);
    expect(party.every((e) => !sim.world.has(e, Marriage))).toBe(true);
    const ship = mooredShip(sim);
    const orders = boardOrders(sim.world, party, ship);
    expect(orders.filter((c) => c.kind === 'attachToVehicle')).toHaveLength(party.length);
  });
});
