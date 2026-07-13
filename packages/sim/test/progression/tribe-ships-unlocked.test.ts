import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { clearComponentStores } from '../../src/harness/stores.js';
import { fx, Simulation } from '../../src/index.js';
import { type SystemContext, tribeShipsUnlocked } from '../../src/systems/index.js';

/**
 * tribeShipsUnlocked — the ship vehicle types a tribe has currently UNLOCKED: the `vehicle_ship` rows
 * (`passengerSlots > 0`, the `isShipVehicle` classification) whose `jobEnablesVehicle` tech-graph gate
 * is satisfied for the tribe, sorted ascending by `typeId`. It composes the content-only ship split
 * with the SAME `vehicle`-kind tech-graph gate `carrierCarryCapacity` uses — the "ship-unlock tech gate"
 * the Sea/Northland item names — so a boat-building/embark slice can ask which hulls a tribe may field.
 *
 * The fixture mirrors the real `vehicletypes.ini` shape: two land carts (no passengers) plus the two
 * ships (passenger-carrying, `logicSize 2`). A SMALL ship (typeId 3, stockSlots 50) is gated behind a
 * SHIPWRIGHT (job 10) via `jobEnablesVehicle 10 3`; a BIG ship (typeId 4, stockSlots 200) is ungated
 * (no edge — an always-unlocked start ship). The carts are never ships, so they never appear.
 */

const TRIBE = 1;
const SHIPWRIGHT = 10;

const VIKING_VEHICLES = [
  // ship big (typeId 4) declared first — ungated, always unlocked. passengerSlots > 0 → a ship.
  { typeId: 4, id: 'ship_big', stockSlots: 200, passengerSlots: 9, logicSize: 2 },
  // a land cart — never a ship (passengerSlots 0), even though it is a vehicle.
  { typeId: 2, id: 'oxcart', stockSlots: 30, passengerSlots: 0, logicSize: 0 },
  // ship small (typeId 3) declared after the big ship — gated behind a shipwright. Proves the sort.
  { typeId: 3, id: 'ship_small', stockSlots: 50, passengerSlots: 19, logicSize: 2 },
  // another land cart — never a ship.
  { typeId: 1, id: 'handcart', stockSlots: 15, passengerSlots: 0, logicSize: 0 },
];

/** A content set whose tribe gates the small ship behind a shipwright; the big ship is an ungated start
 *  ship and the carts are never ships. `vehicles` carries the passengerSlots; `jobEnables` the unlock. */
function shipContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: 10, id: 'shipwright' },
    ],
    vehicles: VIKING_VEHICLES,
    tribes: [
      {
        typeId: TRIBE,
        id: 'viking',
        jobEnables: [
          { jobType: SHIPWRIGHT, kind: 'vehicle', targetId: 3 }, // a shipwright unlocks the small ship (3)
          // (no edge for the big ship typeId 4 — it is an ungated start ship, always unlocked)
        ],
      },
    ],
  });
}

beforeEach(() => {
  clearComponentStores();
});

function ctxOf(sim: Simulation): SystemContext {
  return { content: sim.content, rng: sim.rng, tick: sim.tick, events: sim.events };
}

function settlerOf(sim: Simulation, jobType: number, tribe: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Settler, {
    tribe,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return e;
}

describe('tribeShipsUnlocked', () => {
  it('is empty when the tribe has no vehicle data at all', () => {
    const sim = new Simulation({
      seed: 1,
      content: parseContentSet({
        manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
        goods: [{ typeId: 0, id: 'none' }],
        jobs: [{ typeId: 0, id: 'idle' }],
        buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      }),
    });
    expect(tribeShipsUnlocked(sim.world, ctxOf(sim), TRIBE)).toEqual([]);
  });

  it('returns only the ungated ship (big) when no enabling-job settler is present', () => {
    const sim = new Simulation({ seed: 1, content: shipContent() });
    // No shipwright alive: the small ship stays locked; only the ungated big ship is fieldable.
    // The carts are excluded because they carry no passengers (not ships).
    const ids = tribeShipsUnlocked(sim.world, ctxOf(sim), TRIBE).map((v) => v.id);
    expect(ids).toEqual(['ship_big']);
  });

  it('unlocks the gated ship once its enabling job (shipwright) is present, sorted by typeId', () => {
    const sim = new Simulation({ seed: 1, content: shipContent() });
    settlerOf(sim, SHIPWRIGHT, TRIBE); // a shipwright unlocks the small ship (typeId 3)
    // Both ships now fieldable; sorted ascending by typeId puts ship_small(3) before ship_big(4)
    // regardless of the declaration order (big was declared first).
    expect(tribeShipsUnlocked(sim.world, ctxOf(sim), TRIBE).map((v) => v.typeId)).toEqual([3, 4]);
  });

  it('counts only the same tribe — a shipwright in another tribe does not unlock the gated ship', () => {
    const sim = new Simulation({ seed: 1, content: shipContent() });
    settlerOf(sim, SHIPWRIGHT, 2); // a shipwright in a DIFFERENT tribe (2) — irrelevant to tribe 1
    const ids = tribeShipsUnlocked(sim.world, ctxOf(sim), TRIBE).map((v) => v.id);
    expect(ids).toEqual(['ship_big']); // still just the ungated start ship
  });

  it('a tribe absent from content gates nothing — every ship is unlocked', () => {
    const sim = new Simulation({ seed: 1, content: shipContent() });
    // Tribe 99 has no jobEnables table, so the gate passes for every ship → both ships.
    expect(tribeShipsUnlocked(sim.world, ctxOf(sim), 99).map((v) => v.typeId)).toEqual([3, 4]);
  });

  it('is empty for a carts-only tribe — a cart is never a ship even when unlocked', () => {
    const sim = new Simulation({
      seed: 1,
      content: parseContentSet({
        manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
        goods: [{ typeId: 0, id: 'none' }],
        jobs: [{ typeId: 0, id: 'idle' }],
        buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
        vehicles: [{ typeId: 1, id: 'handcart', stockSlots: 15, passengerSlots: 0 }],
      }),
    });
    expect(tribeShipsUnlocked(sim.world, ctxOf(sim), TRIBE)).toEqual([]);
  });
});
