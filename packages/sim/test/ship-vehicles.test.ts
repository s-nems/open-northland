import { type ContentSet, IR_VERSION, type VehicleType, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { isShipVehicle, largestShipCapacity, shipVehicles } from '../src/systems/index.js';

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
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    vehicles: [
      // ship big (typeId 4) declared first — a ship: passengerSlots > 0. Proves the sort, not order.
      { typeId: 4, id: 'ship_big', stockSlots: 200, passengerSlots: 9, logicSize: 2 },
      // handcart (typeId 1) — a land cart: no passengers.
      { typeId: 1, id: 'handcart', stockSlots: 15, passengerSlots: 0, logicSize: 0 },
      // ship small (typeId 3) declared after the big ship — proves the sort puts it first.
      { typeId: 3, id: 'ship_small', stockSlots: 50, passengerSlots: 19, logicSize: 2 },
      // catapult (typeId 5) — a siege engine, NOT a ship: it carries no passengers (logicSize 1).
      { typeId: 5, id: 'catapult', stockSlots: 0, passengerSlots: 0, logicSize: 1 },
      // oxcart (typeId 2) — a land cart: no passengers.
      { typeId: 2, id: 'oxcart', stockSlots: 30, passengerSlots: 0, logicSize: 0 },
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
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      vehicles: [{ typeId: 1, id: 'handcart', stockSlots: 15 }],
    });
    expect(shipVehicles(content)).toEqual([]);
  });

  it('is empty for content with no vehicles at all (parseContentSet defaults vehicles to [])', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
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
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      vehicles: [{ typeId: 1, id: 'handcart', stockSlots: 15 }],
    });
    expect(largestShipCapacity(cartsOnly)).toBe(0);
  });
});
