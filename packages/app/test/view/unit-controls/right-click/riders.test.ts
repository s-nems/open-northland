import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_TRADER } from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import { sandboxContent, VEHICLE_HANDCART, VEHICLE_SHIP_SMALL } from '../../../../src/game/sandbox/index.js';
import type { RightClickHit } from '../../../../src/view/unit-controls/right-click/context.js';
import { type RiderPlan, resolveRiderTrade } from '../../../../src/view/unit-controls/right-click/riders.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

/** The trade-route toggle of the selected traders off the map and of a selected cart's crew and puller. */

const INDOORS = 1;
const ROUTED = 2;
const CART_TRADER = 3;
const SHIP_TRADER = 4;
const PULLER = 5;
const PULLED_CREW = 6;
const CART = 10;
const SHIP = 11;
const PULLED_CART = 12;
const PINNED_SHIP = 13;
const HOUSE = 20;
const MARKED_HOUSE = 21;
const TILE = { col: 6, row: 8 };

/** A trader off the map: inside a house, or riding the vehicle `riding`. */
const trader = (
  id: number,
  { riding, route = [] }: { riding?: number; route?: readonly number[] } = {},
): Ent => ({
  id,
  components: {
    Settler: { jobType: JOB_TRADER },
    Owner: { player: HUMAN_PLAYER },
    TradeRoute: { stops: route.map((house) => ({ house })) },
    ...(riding === undefined ? {} : { Rider: { vehicle: riding, boarding: false, leaving: null } }),
  },
});

const vehicle = (id: number, vehicleType: number, crew: number, hauler: number | null = null): Ent => ({
  id,
  components: {
    Vehicle: {
      vehicleType,
      tribe: 1,
      moored: false,
      passengers: [{ entity: crew, inside: true }],
      vehicles: [],
      carrier: null,
      hauler,
    },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: 2 * ONE, y: 2 * ONE },
  },
});

const WORLD = snapshotOf([
  trader(INDOORS),
  trader(ROUTED, { route: [HOUSE] }),
  trader(CART_TRADER, { riding: CART }),
  trader(SHIP_TRADER, { riding: SHIP }),
  // On foot beside its cart, so only the cart's click reaches it.
  { ...trader(PULLER), components: { ...trader(PULLER).components, Position: { x: ONE, y: ONE } } },
  trader(PULLED_CREW, { riding: PULLED_CART }),
  vehicle(CART, VEHICLE_HANDCART, CART_TRADER),
  vehicle(SHIP, VEHICLE_SHIP_SMALL, SHIP_TRADER),
  vehicle(PULLED_CART, VEHICLE_HANDCART, PULLED_CREW, PULLER),
  vehicle(PINNED_SHIP, VEHICLE_SHIP_SMALL, SHIP_TRADER, ROUTED),
]);

const OVER_HOUSE: RightClickHit = {
  ownSettler: null,
  ownVehicle: null,
  ownBuilding: null,
  site: null,
  building: HOUSE,
  enemy: null,
  enemySettler: null,
  wildlife: null,
  claimableLivestock: null,
  creature: null,
  chest: null,
  pile: null,
  resource: null,
  tile: TILE,
};

function resolve(
  selected: readonly number[],
  {
    queued = false,
    onBuilding = null,
    hit = OVER_HOUSE,
  }: Partial<{
    queued: boolean;
    onBuilding: number | null;
    hit: RightClickHit;
  }> = {},
): RiderPlan {
  return resolveRiderTrade(
    {
      snapshot: WORLD,
      content: sandboxContent(),
      asks: { tradeHouse: true, equip: false, formation: false },
    },
    new Set(selected),
    hit,
    queued,
    onBuilding,
  );
}

describe("the riders' trade-route toggle", () => {
  it('takes a house off the route that holds it and asks to put it on the others', () => {
    expect(resolve([INDOORS, ROUTED])).toEqual({
      kind: 'tradeHouse',
      house: HOUSE,
      detach: [ROUTED],
      ask: [INDOORS],
      pending: 'tradeAttach',
    });
    expect(resolve([ROUTED])).toEqual({ kind: 'tradeHouse', house: HOUSE, detach: [ROUTED], ask: [] });
  });

  it("toggles for a selected cart's crew, never a ship's, which takes the click itself", () => {
    expect(resolve([CART])).toMatchObject({ kind: 'tradeHouse', ask: [CART_TRADER] });
    expect(resolve([SHIP])).toEqual({ kind: 'none' });
  });

  it('leaves the trader of a selected pinned ship alone: no route window speaks for it', () => {
    expect(resolve([PINNED_SHIP])).toEqual({ kind: 'none' });
  });

  it('toggles for the trader pulling a selected cart beside its crew', () => {
    expect(resolve([PULLED_CART])).toMatchObject({ kind: 'tradeHouse', ask: [PULLED_CREW, PULLER] });
    expect(resolve([PULLED_CART], { queued: true })).toEqual({ kind: 'none' });
  });

  it('leaves a queued click to the cart, while a trader inside a house still toggles', () => {
    expect(resolve([CART], { queued: true })).toEqual({ kind: 'none' });
    expect(resolve([CART_TRADER], { queued: true })).toEqual({ kind: 'none' });
    expect(resolve([INDOORS], { queued: true })).toMatchObject({ kind: 'tradeHouse', ask: [INDOORS] });
  });

  it("names a marker's building over the point, and nothing without a house", () => {
    expect(resolve([INDOORS], { onBuilding: MARKED_HOUSE })).toMatchObject({ house: MARKED_HOUSE });
    expect(resolve([INDOORS], { hit: { ...OVER_HOUSE, building: null } })).toEqual({ kind: 'none' });
  });
});
