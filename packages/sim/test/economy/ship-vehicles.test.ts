import { type ContentSet, parseContentSet, type VehicleType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  isShipVehicle,
  largestShipCapacity,
  shipVehicles,
  vehicleCargoGoods,
  vehicleMayCarry,
  vehicleSizeOf,
} from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';

/** Resolve a vehicle by its `id` from a content set (throws if absent — a test-fixture programmer error). */
function vehicle(content: ContentSet, id: string): VehicleType {
  const found = content.vehicles.find((v) => v.id === id);
  if (found === undefined) throw new Error(`fixture has no vehicle "${id}"`);
  return found;
}

/**
 * The ship-vehicle read view — `shipVehicles`/`isShipVehicle`/`largestShipCapacity` classify the
 * `vehicle_ship` rows out of `content.vehicles` *by the data alone* (a vehicle that carries passengers,
 * `passengerSlots > 0`), the seed the Sea/Northland slice (water travel, boats as mobile stores) builds
 * on — never by a hardcoded name. A pure read over content; no world, no mechanic added.
 *
 * The fixture mirrors the real `vehicletypes.ini` shape: two land carts (`handcart`/`oxcart`,
 * `passengerslots 0`), a `catapult` (a siege engine, also `passengerslots 0`), and the two ships
 * (`ship small` `passengerslots 19` / `ship big` `passengerslots 9`) — declared OUT of typeId order so
 * the sort is exercised. The `stockSlots`/`logicSize` values are the real ones (carts 15/30, catapult 0,
 * ships 50/200; ship `logicsize 2` vs cart `0`/catapult `1`), so the classification rests on the same
 * params the pipeline pins.
 */
function vehicleContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    vehicles: [
      // ship big (typeId 4) declared first — a ship: passengerSlots > 0. Proves the sort, not order.
      // cargoGoods mirrors the real ships' full haulable-goods enumeration (sampled to a few ids here).
      {
        typeId: 4,
        id: 'ship_big',
        stockSlots: 200,
        passengerSlots: 9,
        logicSize: 2,
        cargoGoods: [16, 17, 1],
      },
      // handcart (typeId 1) — a land cart: no passengers.
      { typeId: 1, id: 'handcart', stockSlots: 15, passengerSlots: 0, logicSize: 0, cargoGoods: [16, 17] },
      // ship small (typeId 3) declared after the big ship — proves the sort puts it first.
      {
        typeId: 3,
        id: 'ship_small',
        stockSlots: 50,
        passengerSlots: 19,
        logicSize: 2,
        cargoGoods: [16, 17, 1],
      },
      // catapult (typeId 5) — a siege engine, NOT a ship: it carries no passengers (logicSize 1) or cargo.
      { typeId: 5, id: 'catapult', stockSlots: 0, passengerSlots: 0, logicSize: 1 },
      // oxcart (typeId 2) — a land cart: no passengers.
      { typeId: 2, id: 'oxcart', stockSlots: 30, passengerSlots: 0, logicSize: 0, cargoGoods: [16, 17] },
    ],
  });
}

describe('isShipVehicle', () => {
  it('is true for a vehicle that carries passengers (a ship) and false for a cart / catapult', () => {
    const content = vehicleContent();
    expect(isShipVehicle(vehicle(content, 'ship_small'))).toBe(true);
    expect(isShipVehicle(vehicle(content, 'ship_big'))).toBe(true);
    expect(isShipVehicle(vehicle(content, 'handcart'))).toBe(false); // a cart — no passengers
    expect(isShipVehicle(vehicle(content, 'oxcart'))).toBe(false);
    expect(isShipVehicle(vehicle(content, 'catapult'))).toBe(false); // siege engine — passengerSlots 0
  });
});

describe('shipVehicles', () => {
  it('returns only the passenger-carrying vehicles (the ships)', () => {
    const ids = shipVehicles(vehicleContent()).map((v) => v.id);
    expect(ids).toEqual(['ship_small', 'ship_big']); // carts/catapult excluded
  });

  it('sorts ascending by typeId regardless of declaration order', () => {
    // Declared ship_big(4) before ship_small(3); the view must still put ship_small first.
    const typeIds = shipVehicles(vehicleContent()).map((v) => v.typeId);
    expect(typeIds).toEqual([3, 4]);
  });

  it('is empty when no vehicle carries passengers (a carts-only set)', () => {
    const content = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      vehicles: [{ typeId: 1, id: 'handcart', stockSlots: 15 }],
    });
    expect(shipVehicles(content)).toEqual([]);
  });

  it('is empty for content with no vehicles at all (parseContentSet defaults vehicles to [])', () => {
    const content = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    });
    expect(shipVehicles(content)).toEqual([]);
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = vehicleContent();
    expect(shipVehicles(content)).toEqual(shipVehicles(content));
  });
});

describe('largestShipCapacity', () => {
  it('returns the max stockSlots over the ships (the biggest mobile store), ignoring carts', () => {
    // ship_big (200) beats ship_small (50); the oxcart's 30 and handcart's 15 are not ships, so even
    // though the catapult/carts exist the capacity is the largest SHIP hold, not the largest vehicle.
    expect(largestShipCapacity(vehicleContent())).toBe(200);
  });

  it('is 0 when no ship exists (a carts-only set, or no vehicles at all)', () => {
    const cartsOnly = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      vehicles: [{ typeId: 1, id: 'handcart', stockSlots: 15 }],
    });
    expect(largestShipCapacity(cartsOnly)).toBe(0);
  });
});

describe('vehicleCargoGoods / vehicleMayCarry', () => {
  it('exposes a ship hold cargo allow-list as a membership set', () => {
    const ship = vehicle(vehicleContent(), 'ship_big');
    const carryable = vehicleCargoGoods(ship);
    expect(carryable.has(16)).toBe(true);
    expect(carryable.has(1)).toBe(true);
    expect(carryable.has(99)).toBe(false); // a good not on the allow-list cannot ride
    expect(carryable.size).toBe(3);
  });

  it('vehicleMayCarry is the single-good predicate over the allow-list', () => {
    const ship = vehicle(vehicleContent(), 'ship_small');
    expect(vehicleMayCarry(ship, 17)).toBe(true);
    expect(vehicleMayCarry(ship, 1)).toBe(true);
    expect(vehicleMayCarry(ship, 42)).toBe(false); // not enumerated -> not loadable
  });

  it('applies to a land cart too (the filter is generic, not ship-only)', () => {
    const cart = vehicle(vehicleContent(), 'handcart');
    expect(vehicleMayCarry(cart, 16)).toBe(true);
    expect(vehicleMayCarry(cart, 1)).toBe(false); // cart's sampled list omits good 1
  });

  it('is empty for a vehicle that carries no cargo (the catapult lists no logicgood)', () => {
    const cata = vehicle(vehicleContent(), 'catapult');
    expect(vehicleCargoGoods(cata).size).toBe(0);
    expect(vehicleMayCarry(cata, 16)).toBe(false); // nothing rides in a catapult
  });
});

describe('vehicleSizeOf', () => {
  it('reads the footprint class straight off logicSize: cart 0, catapult 1, ship 2', () => {
    const content = vehicleContent();
    // The three-way partition, the coarser axis than the boat/cart isShipVehicle split.
    expect(vehicleSizeOf(vehicle(content, 'handcart'))).toBe(0);
    expect(vehicleSizeOf(vehicle(content, 'oxcart'))).toBe(0);
    expect(vehicleSizeOf(vehicle(content, 'catapult'))).toBe(1); // siege engine — distinct from a cart
    expect(vehicleSizeOf(vehicle(content, 'ship_small'))).toBe(2);
    expect(vehicleSizeOf(vehicle(content, 'ship_big'))).toBe(2);
  });

  it('is a plain number (defaults to 0, never undefined) — a vehicle with no logicSize reads 0', () => {
    // A minimal vehicle that omits logicSize: the schema default (0, the cart footprint) applies, so the
    // accessor returns a number, not undefined — the weight-field shape, not the class-enum shape.
    const content = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      vehicles: [{ typeId: 1, id: 'handcart', stockSlots: 15 }],
    });
    const v = vehicle(content, 'handcart');
    expect(vehicleSizeOf(v)).toBe(0);
    expect(typeof vehicleSizeOf(v)).toBe('number');
  });

  it('distinguishes the catapult from a cart, which isShipVehicle does not', () => {
    // isShipVehicle lumps catapult + carts as "not a ship" (all passengerSlots 0); logicSize separates them.
    const content = vehicleContent();
    const cata = vehicle(content, 'catapult');
    const cart = vehicle(content, 'handcart');
    expect(isShipVehicle(cata)).toBe(isShipVehicle(cart)); // both false — the boat axis can't tell them apart
    expect(vehicleSizeOf(cata)).not.toBe(vehicleSizeOf(cart)); // the size axis does (1 vs 0)
  });
});
