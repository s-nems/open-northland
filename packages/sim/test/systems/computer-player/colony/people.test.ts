import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Female, JobAssignment, Marriage } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { everySettlerOf } from '../../../../src/systems/ai-shared/home-roster.js';
import {
  boardOrders,
  PARTY_FROM_CIVILIANS,
  partyFor,
  pickParty,
  topUpParty,
} from '../../../../src/systems/computer-player/colony/people.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { colonyContent, colonyWorld, FOOD, mooredShip, stepUntil } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { FARM_TYPE, HQ_TYPE, SEAT, VIKING } from '../support.js';

const LARGE_SEAT = 200;
const SPARE_SEAT = 80;
const TIGHT_SEAT = 40;
const THIN_SEAT = 34;
const MARRIED_BY_TICKS = minutesToTicks(5);

const NOTHING_LACKING = { men: 0, women: 0 };
const WOMEN_LACKING = { men: 0, women: 5 };
const SHIP_SEATS = 15;
const TWO_SEATS = 2;
const FARM_AT = { x: 40, y: 100 };
const SEED = 7;

/** A seat whose every wife is wed, with each husband posted to `type`'s workplace. */
function postedHusbands(type: number): { readonly sim: Simulation; readonly land: number } {
  const content = colonyContent();
  const feeding = parseContentSet({
    ...content,
    buildings: content.buildings.map((b) => (b.typeId === FARM_TYPE ? { ...b, produces: [FOOD] } : b)),
  });
  const sim = colonyWorld(SEED, feeding);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: FARM_TYPE,
    ...FARM_AT,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
  });
  stepUntil(sim, MARRIED_BY_TICKS, () =>
    everySettlerOf(sim.world, SEAT).every((e) => !sim.world.has(e, Female) || sim.world.has(e, Marriage)),
  );
  const workplace = [...sim.world.query(Building)].find(
    (e: Entity) => sim.world.get(e, Building).buildingType === type,
  );
  for (const e of everySettlerOf(sim.world, SEAT)) {
    const husband = sim.world.has(e, Female) ? sim.world.tryGet(e, Marriage)?.spouse : undefined;
    if (husband !== undefined && workplace !== undefined)
      sim.world.add(husband, JobAssignment, { workplace });
  }
  const ctx = ctxOf(sim);
  return { sim, land: ctx.terrain?.componentOf(ctx.terrain.nodeAtClamped(60, 60)) ?? -1 };
}

describe('a colony top-up', () => {
  it('takes nobody for a colony at its figure, and couples past a post for one with no women', () => {
    const { sim, land } = postedHusbands(HQ_TYPE);
    const ctx = ctxOf(sim);
    expect(topUpParty(sim.world, ctx, SEAT, land, NOTHING_LACKING, SHIP_SEATS)).toEqual([]);
    const party = topUpParty(sim.world, ctx, SEAT, land, WOMEN_LACKING, SHIP_SEATS);
    const wives = party.filter((e) => sim.world.has(e, Female));
    expect(wives.length).toBeGreaterThan(0);
    for (const wife of wives) expect(party).toContain(sim.world.get(wife, Marriage).spouse);
    expect(topUpParty(sim.world, ctx, SEAT, land, WOMEN_LACKING, TWO_SEATS)).toHaveLength(TWO_SEATS);
  });

  it('leaves a husband who feeds the seat at his post, and his wife with him', () => {
    const { sim, land } = postedHusbands(FARM_TYPE);
    const party = topUpParty(sim.world, ctxOf(sim), SEAT, land, WOMEN_LACKING, SHIP_SEATS);
    expect(party.filter((e) => sim.world.has(e, Marriage))).toEqual([]);
  });
});

describe('a colony party', () => {
  it('is about 15 men and 5 women, scaled to what the seat can spare', () => {
    expect(partyFor(LARGE_SEAT)).toEqual({ men: 15, women: 5 });
    expect(partyFor(SPARE_SEAT)).toEqual({ men: 15, women: 5 });
    expect(partyFor(TIGHT_SEAT)).toEqual({ men: 8, women: 2 });
    expect(partyFor(THIN_SEAT)).toBeNull();
  });

  it('is spared from the fewest civilians the seat names for it, not one fewer', () => {
    expect(partyFor(PARTY_FROM_CIVILIANS)).not.toBeNull();
    expect(partyFor(PARTY_FROM_CIVILIANS - 1)).toBeNull();
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
