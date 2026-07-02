import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, fx } from '../../src/index.js';
import { type SystemContext, carrierCarryCapacity } from '../../src/systems/index.js';

/**
 * carrierCarryCapacity — a carrier hauls a batch sized by the largest `stockSlots` (vehicle carry
 * capacity, `vehicletypes`) among the vehicle types its tribe has UNLOCKED via the `jobEnablesVehicle`
 * tech-graph, falling back to one unit carried on foot when no vehicle is available. This is the sim's
 * first consumer of the `vehicle` kind of the `jobEnables` edge + the `stockSlots` param.
 *
 * The tribe (typeId 1) gates a handcart (vehicle typeId 5, stockSlots 15) behind a CARTER job (job 9)
 * via `jobEnablesVehicle 9 5`. An OXCART (vehicle typeId 6, stockSlots 30) is ungated (no edge), so it
 * is always unlocked. A SHIP (vehicle typeId 7, stockSlots 200) is gated behind a SHIPWRIGHT (job 10).
 */

const TRIBE = 1;
const CARTER = 9;
const SHIPWRIGHT = 10;

const VIKING_VEHICLES = [
  { typeId: 5, id: 'handcart', stockSlots: 15 },
  { typeId: 6, id: 'oxcart', stockSlots: 30 },
  { typeId: 7, id: 'ship', stockSlots: 200 },
];

/** A content set whose tribe gates a handcart behind a carter and a ship behind a shipwright; the
 *  oxcart is ungated. `vehicles` carries the `stockSlots` capacities; `jobEnables` the unlock edges. */
function vehicleContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: 9, id: 'carter' },
      { typeId: 10, id: 'shipwright' },
      { typeId: 36, id: 'carrier' },
    ],
    vehicles: VIKING_VEHICLES,
    tribes: [
      {
        typeId: TRIBE,
        id: 'viking',
        jobEnables: [
          { jobType: CARTER, kind: 'vehicle', targetId: 5 }, // a carter unlocks the handcart (15)
          { jobType: SHIPWRIGHT, kind: 'vehicle', targetId: 7 }, // a shipwright unlocks the ship (200)
          // (no edge for the oxcart typeId 6 — it is an ungated start vehicle, always unlocked)
        ],
      },
    ],
  });
}

beforeEach(() => {
  Settler.store.clear();
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

describe('carrierCarryCapacity', () => {
  it('falls back to a single on-foot unit when the tribe has no vehicle data at all', () => {
    // parseContentSet defaults `vehicles` to [] — no vehicle exists, so the floor is 1.
    const sim = new Simulation({
      seed: 1,
      content: parseContentSet({
        manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
        goods: [{ typeId: 0, id: 'none' }],
        jobs: [{ typeId: 0, id: 'idle' }],
        buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      }),
    });
    expect(carrierCarryCapacity(sim.world, ctxOf(sim), TRIBE)).toBe(1);
  });

  it('uses the ungated vehicle (oxcart=30) when no enabling-job settler is present', () => {
    const sim = new Simulation({ seed: 1, content: vehicleContent() });
    // No carter/shipwright alive: the handcart and ship stay locked; only the ungated oxcart counts.
    expect(carrierCarryCapacity(sim.world, ctxOf(sim), TRIBE)).toBe(30);
  });

  it('unlocks a bigger gated vehicle (ship=200) once its enabling job is present', () => {
    const sim = new Simulation({ seed: 1, content: vehicleContent() });
    settlerOf(sim, SHIPWRIGHT, TRIBE); // a shipwright unlocks the ship (200 > the ungated oxcart 30)
    expect(carrierCarryCapacity(sim.world, ctxOf(sim), TRIBE)).toBe(200);
  });

  it('a smaller gated vehicle cannot beat a bigger already-unlocked one (still the oxcart=30)', () => {
    const sim = new Simulation({ seed: 1, content: vehicleContent() });
    settlerOf(sim, CARTER, TRIBE); // a carter unlocks the handcart (15), but the oxcart (30) is bigger
    expect(carrierCarryCapacity(sim.world, ctxOf(sim), TRIBE)).toBe(30);
  });

  it('counts only the same tribe — an enabling-job settler in another tribe does not unlock it', () => {
    const sim = new Simulation({ seed: 1, content: vehicleContent() });
    settlerOf(sim, SHIPWRIGHT, 2); // a shipwright in a DIFFERENT tribe (2) — irrelevant to tribe 1
    expect(carrierCarryCapacity(sim.world, ctxOf(sim), TRIBE)).toBe(30); // still just the ungated oxcart
  });

  it('a tribe absent from content gates nothing — every vehicle is unlocked (max stockSlots=200)', () => {
    const sim = new Simulation({ seed: 1, content: vehicleContent() });
    // Tribe 99 has no jobEnables table, so tribeUnlockEnabled returns true for every vehicle → the max.
    expect(carrierCarryCapacity(sim.world, ctxOf(sim), 99)).toBe(200);
  });
});
