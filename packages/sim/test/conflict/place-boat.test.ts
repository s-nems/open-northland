import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { Position, Stockpile, Vehicle } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, cellAnchorNode } from '../../src/index.js';
import { clearComponentStores } from '../fixtures/stores.js';

/**
 * `placeBoat` — the **boats as mobile stores** entity slice the plan Phase-4 Sea/Northland item
 * names: a placed {@link Vehicle} hull carrying an (empty) {@link Stockpile}, the boat analogue of
 * `placeBuilding`. The placement is gated by the tribe's ship-unlock tech graph (`tribeShipsUnlocked`):
 * only a `vehicle_ship` row the tribe has currently UNLOCKED is fielded; a cart, a catapult, an unknown
 * id, or a not-yet-unlocked ship is a recoverable bad command — skipped (still logged for replay).
 *
 * Fixture mirrors the real `vehicletypes.ini` shape (as in `tribe-ships-unlocked.test.ts`): two land
 * carts (no passengers) and two ships (passenger-carrying). The SMALL ship (typeId 3, stockSlots 50) is
 * gated behind a SHIPWRIGHT (job 10) via `jobEnablesVehicle 10 3`; the BIG ship (typeId 4, stockSlots
 * 200) is ungated (an always-unlocked start ship).
 */

const VIKING = 1;
const SHIPWRIGHT = 10;
const SHIP_SMALL = 3; // gated behind a shipwright
const SHIP_BIG = 4; // ungated start ship
const HANDCART = 1; // a cart — never a ship, so never placeable as a boat

const VIKING_VEHICLES = [
  { typeId: SHIP_BIG, id: 'ship_big', stockSlots: 200, passengerSlots: 9, logicSize: 2 },
  { typeId: 2, id: 'oxcart', stockSlots: 30, passengerSlots: 0, logicSize: 0 },
  { typeId: SHIP_SMALL, id: 'ship_small', stockSlots: 50, passengerSlots: 19, logicSize: 2 },
  { typeId: HANDCART, id: 'handcart', stockSlots: 15, passengerSlots: 0, logicSize: 0 },
];

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
        typeId: VIKING,
        id: 'viking',
        jobEnables: [{ jobType: SHIPWRIGHT, kind: 'vehicle', targetId: SHIP_SMALL }],
      },
    ],
  });
}

beforeEach(clearComponentStores);

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: shipContent() });
}

/** The nth canonical (ascending-id) entity, asserting it exists. */
function nthEntity(sim: Simulation, n: number): Entity {
  const ids = sim.world.canonicalEntities();
  const e = ids[n];
  if (e === undefined) throw new Error(`no entity at index ${n} (have ${ids.length})`);
  return e;
}

describe('placeBoat', () => {
  it('places an ungated ship as a Vehicle hull with an empty mobile store and emits boatPlaced', () => {
    const sim = fresh();
    // The big ship is ungated, so it places even with no shipwright present. Command coords are
    // half-cell nodes; cell (7,8)'s anchor node (14,16) sits exactly on tile (7,8).
    const anchor = cellAnchorNode(7, 8);
    sim.enqueue({ kind: 'placeBoat', vehicleType: SHIP_BIG, x: anchor.hx, y: anchor.hy, tribe: VIKING });
    sim.step();

    expect(sim.world.canonicalEntities()).toHaveLength(1);
    const e = nthEntity(sim, 0);
    const hull = sim.world.get(e, Vehicle);
    expect(hull.vehicleType).toBe(SHIP_BIG);
    expect(hull.tribe).toBe(VIKING);

    // The mobile store arrives EMPTY (a boat is loaded by hauling, not pre-seeded like a headquarters).
    expect(sim.world.get(e, Stockpile).amounts.size).toBe(0);

    const pos = sim.world.get(e, Position);
    expect([pos.x, pos.y]).toEqual([7 * 65536, 8 * 65536]);

    const placed = sim.events.current().filter((ev) => ev.kind === 'boatPlaced');
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ at: { x: anchor.hx, y: anchor.hy } }); // events echo node coords
  });

  it('gates a tech-locked ship: skipped (still logged) until its enabling job exists', () => {
    const sim = fresh();
    // No shipwright yet — the small ship is locked behind `jobEnablesVehicle 10 3`, so it is skipped.
    sim.enqueue({ kind: 'placeBoat', vehicleType: SHIP_SMALL, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect([...sim.world.query(Vehicle)]).toHaveLength(0); // gated out — no hull placed
    expect(sim.commands.log).toHaveLength(1); // but still recorded for faithful replay

    // Spawn the enabling shipwright, then retry: the small ship now unlocks and is placed.
    sim.enqueue({ kind: 'spawnSettler', jobType: SHIPWRIGHT, x: 1, y: 0, tribe: VIKING });
    sim.step();
    sim.enqueue({ kind: 'placeBoat', vehicleType: SHIP_SMALL, x: 2, y: 2, tribe: VIKING });
    sim.step();

    const hulls = [...sim.world.query(Vehicle)];
    expect(hulls).toHaveLength(1);
    expect(sim.world.get(hulls[0] as Entity, Vehicle).vehicleType).toBe(SHIP_SMALL);
  });

  it('refuses a land cart — a cart is a vehicle but never a ship, so it is not placeable as a boat', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBoat', vehicleType: HANDCART, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect([...sim.world.query(Vehicle)]).toHaveLength(0); // not a ship — skipped
    expect(sim.commands.log).toHaveLength(1); // still logged for faithful replay
  });

  it('refuses an unknown vehicle type id (recoverable bad input — no throw, still logged)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBoat', vehicleType: 999, x: 0, y: 0, tribe: VIKING });
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.entityCount).toBe(0);
    expect(sim.commands.log).toHaveLength(1);
  });

  it('gates per tribe — a shipwright in another tribe does not unlock the gated ship', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'spawnSettler', jobType: SHIPWRIGHT, x: 1, y: 0, tribe: 2 }); // wrong tribe
    sim.step();
    sim.enqueue({ kind: 'placeBoat', vehicleType: SHIP_SMALL, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect([...sim.world.query(Vehicle)]).toHaveLength(0); // the gated ship stays locked for the viking
  });

  it('is deterministic: same seed + same commands on the same ticks => byte-identical state', () => {
    const place = (sim: Simulation): void => {
      sim.enqueue({ kind: 'placeBoat', vehicleType: SHIP_BIG, x: 4, y: 4, tribe: VIKING });
      sim.run(30);
    };
    const runA = fresh(7);
    place(runA);
    const hashA = runA.hashState();

    clearComponentStores();
    const runB = fresh(7);
    place(runB);
    const hashB = runB.hashState();

    expect(hashB).toBe(hashA);
  });
});
