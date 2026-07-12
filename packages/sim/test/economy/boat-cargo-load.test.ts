import { type ContentSet, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  JobAssignment,
  Position,
  Settler,
  Stockpile,
  Vehicle,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation, type TerrainMap } from '../../src/index.js';
import { type SystemContext, stockCapacity } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { clearComponentStores } from '../fixtures/stores.js';

/**
 * The cargo-LOAD gate for **boats as mobile stores** — the *load half* of the empty hull `placeBoat`
 * sets up. A carrier deposits a hauled good into a placed {@link Vehicle} hull's {@link Stockpile}
 * exactly like a building store, but the per-good capacity is now read off the ship's `VehicleType`:
 *  - a good on the ship's `cargoGoods` (`logicgood`) allow-list gets the whole `stockSlots` hold
 *    capacity (it may ride),
 *  - a good NOT on the allow-list gets capacity 0 (refused — never deposited into the hull).
 *
 * This is `stockCapacity` gaining a Vehicle branch (`systems/stores.ts`); the existing
 * `nearestStoreFor` store scan + `pileup` deposit route through it unchanged, so the whole load path
 * inherits the filter with no new system. Movement/embark and water valency stay map-decode-blocked.
 *
 * Fixture: the carrier hauls PLANKs (good 2) out of the sawmill. The boat allows PLANK but NOT WOOD
 * (good 1), and its `stockSlots` hold is small (`HOLD`), so the deposit gate (allow-list + capacity)
 * is observable both ways.
 */

const GRASS = 0;
const WOOD = 1;
const PLANK = 2;
const CARRIER = 36; // fixture job with no allowedAtomics — it can only haul
const SAWMILL = 2; // workplace: recipe wood->plank
const VIKING = 1;
const BOAT = 3; // a ship: passengers => isShipVehicle, allows PLANK only
const HOLD = 1; // the boat's stockSlots — a tiny hold so the capacity cap is observable

/** `testContent()` plus a single boat vehicle that carries PLANK (not WOOD) with a `HOLD`-slot hold. */
function boatContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    vehicles: [{ typeId: BOAT, id: 'ship', stockSlots: HOLD, passengerSlots: 9, cargoGoods: [PLANK] }],
  });
}

function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

beforeEach(clearComponentStores);

/** A carrier POSTED to `boundTo` (the hull's loader) — the haul rung works only through a binding. */
function carrierAt(sim: Simulation, x: number, y: number, boundTo?: Entity): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: CARRIER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (boundTo !== undefined) sim.world.add(e, JobAssignment, { workplace: boundTo });
  return e;
}

function sawmillAt(sim: Simulation, x: number, y: number, planks: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: SAWMILL, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[PLANK, planks]]) });
  return e;
}

/** Place a boat hull (Vehicle + empty Stockpile) directly — the post-`placeBoat` state. */
function boatAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Vehicle, { vehicleType: BOAT, tribe: VIKING });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

describe('boat cargo-load gate — stockCapacity over a Vehicle hull', () => {
  it('allows a carryable good up to the hold capacity, refuses a non-carryable good', () => {
    const sim = new Simulation({ seed: 1, content: boatContent(), map: grassMap(3, 1) });
    const boat = boatAt(sim, 0, 0);
    const ctx = ctxOf(sim);

    // PLANK is on the allow-list -> the whole stockSlots hold; WOOD is not -> 0 (refused).
    expect(stockCapacity(sim.world, ctx, boat, PLANK)).toBe(HOLD);
    expect(stockCapacity(sim.world, ctx, boat, WOOD)).toBe(0);
  });

  it('a carrier hauls a carryable plank INTO the boat hull (deposited via the real schedule)', () => {
    const sim = new Simulation({ seed: 1, content: boatContent(), map: grassMap(3, 1) });
    const boat = boatAt(sim, 2, 0); // the only store that can take them
    const carrier = carrierAt(sim, 0, 0, boat); // posted to the hull — its loader
    const mill = sawmillAt(sim, 1, 0, 2); // 2 planks waiting

    let inHold = 0;
    for (let i = 0; i < 80 && inHold === 0; i++) {
      sim.step();
      inHold = sim.world.get(boat, Stockpile).amounts.get(PLANK) ?? 0;
    }

    expect(inHold).toBe(HOLD); // a unit reached the hold, capped at its capacity
    // Goods conserved: 2 planks total, one now in the hold, one still at the sawmill.
    const atMill = sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0;
    expect(atMill + inHold).toBe(2);
    void carrier;
  });

  it('does not over-fill the hold past its capacity — surplus stays at the source', () => {
    // 3 planks but a HOLD=1 hold: the boat takes exactly 1, the carrier keeps hauling but the hold is
    // full for plank so nothing more is deposited (no nowhere-else store -> the rest stays at the mill).
    const sim = new Simulation({ seed: 1, content: boatContent(), map: grassMap(3, 1) });
    const boat = boatAt(sim, 2, 0);
    carrierAt(sim, 0, 0, boat); // posted to the hull — its loader
    const mill = sawmillAt(sim, 1, 0, 3);

    for (let i = 0; i < 200; i++) sim.step();

    expect(sim.world.get(boat, Stockpile).amounts.get(PLANK) ?? 0).toBe(HOLD); // never exceeds capacity
    const atMill = sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0;
    expect(atMill + HOLD).toBe(3); // conserved: the surplus the full hold can't take stays put
  });

  it('refuses a forbidden good directly even when a unit is already in the carrier-deposit path', () => {
    // A carrier standing ON the boat, already carrying WOOD (not on the allow-list): the deposit gate
    // (`stockCapacity(boat, WOOD) === 0`) means the pileup atomic moves nothing — the load stays on the
    // carrier's back, the hold stays empty. This is the allow-list refusal at the deposit seam.
    const sim = new Simulation({ seed: 1, content: boatContent(), map: grassMap(3, 1) });
    const carrier = carrierAt(sim, 2, 0); // standing on the boat's tile
    sim.world.add(carrier, Carrying, { goodType: WOOD, amount: 1 });
    const boat = boatAt(sim, 2, 0);

    for (let i = 0; i < 40; i++) sim.step();

    // Wood never lands in the boat (forbidden cargo); the carrier still holds its unit.
    expect(sim.world.get(boat, Stockpile).amounts.get(WOOD) ?? 0).toBe(0);
    expect(sim.world.has(carrier, Carrying)).toBe(true);
  });

  it('is deterministic: two same-seed runs of the load reach the same state hash', () => {
    const run = (): string => {
      clearComponentStores();
      const sim = new Simulation({ seed: 9, content: boatContent(), map: grassMap(3, 1) });
      carrierAt(sim, 0, 0);
      sawmillAt(sim, 1, 0, 2);
      boatAt(sim, 2, 0);
      for (let i = 0; i < 120; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
