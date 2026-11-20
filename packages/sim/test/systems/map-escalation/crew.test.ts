import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  HaulFlag,
  HaulingCart,
  JobAssignment,
  Owner,
  Settler,
  Vehicle,
  VehicleStock,
} from '../../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { createGroundGoods } from '../../../src/systems/economy/ground-goods.js';
import { reap } from '../../../src/systems/lifecycle/death.js';
import { vehicleIndex } from '../../../src/systems/vehicles/registry.js';
import { removeVehicle } from '../../../src/systems/vehicles/remove.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { ctxOf } from '../../fixtures/context.js';
import {
  distance,
  FORTRESS,
  HQ_TYPE,
  KEEP,
  keepWorld,
  REFILL_EVERY_SECONDS,
  runToSecond,
  SIEGE,
} from '../../fixtures/map-escalation/keep.js';

const BUILDER = 7;
const CARRIER = 24;
const FOOD = 3;
const BUILDERS = 2;
const PORTERS = 2;
const PORTER_RADIUS = 50;
/** Inside the porters' area, past the reach a store porter without a flag collects in. */
const PILE = { x: KEEP.x + 44, y: KEEP.y };

/** {@link aiContent} with a hauling cart the carriers pull. */
function cartContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    vehicles: [
      {
        typeId: 1,
        id: 'handcart',
        jobId: 50,
        stockSlots: 15,
        logicSize: 0,
        cargoGoods: [FOOD],
        passengerJobs: [CARRIER],
        commanderJob: CARRIER,
        hitpoints: 1000,
      },
    ],
  });
}

function crewWorld(): Simulation {
  const siege = {
    ...SIEGE,
    builders: { count: BUILDERS },
    porters: { count: PORTERS, vehicle: 'handcart', ...KEEP, radius: PORTER_RADIUS },
  };
  return keepWorld({ siege }, cartContent(), { scriptedFortress: true }).sim;
}

function fortressOf(sim: Simulation, jobType: number): Entity[] {
  return [...sim.world.query(Settler, Owner)].filter(
    (e) => sim.world.get(e, Owner).player === FORTRESS && sim.world.get(e, Settler).jobType === jobType,
  );
}

/** Food in the porter's hands and in his cart. */
function heldFood(sim: Simulation, e: Entity): number {
  const hands = sim.world.tryGet(e, Carrying);
  const cart = sim.world.tryGet(e, HaulingCart)?.vehicle;
  const aboard = cart === undefined ? undefined : sim.world.tryGet(cart, VehicleStock)?.lines.get(FOOD);
  return (hands?.goodType === FOOD ? hands.amount : 0) + (aboard?.current ?? 0);
}

function keepEntity(sim: Simulation): Entity {
  const keep = [...sim.world.query(Building, Owner)].find(
    (e) => sim.world.get(e, Owner).player === FORTRESS && sim.world.get(e, Building).buildingType === HQ_TYPE,
  );
  if (keep === undefined) throw new Error('no keep');
  return keep;
}

describe('map escalation - fortress crew', () => {
  it('makes the missing builders at the keep on each refill beat', () => {
    const sim = crewWorld();
    expect(fortressOf(sim, BUILDER)).toEqual([]);
    runToSecond(sim, REFILL_EVERY_SECONDS);
    const first = fortressOf(sim, BUILDER);
    expect(first).toHaveLength(BUILDERS);
    for (const e of first) expect(distance(sim, e, KEEP)).toBeLessThan(10);

    const [lost] = first;
    if (lost === undefined) throw new Error('no builder');
    sim.world.destroy(lost);
    runToSecond(sim, 2 * REFILL_EVERY_SECONDS);
    const now = fortressOf(sim, BUILDER);
    expect(now).toHaveLength(BUILDERS);
    expect(now).not.toContain(lost);
  });

  it('posts porters at the store with the flag and a cart, gives a cartless porter a new cart, and carts a pile in', () => {
    const sim = crewWorld();
    const keep = keepEntity(sim);
    runToSecond(sim, REFILL_EVERY_SECONDS);
    const porters = fortressOf(sim, CARRIER);
    expect(porters).toHaveLength(PORTERS);
    for (const e of porters) {
      expect(sim.world.get(e, JobAssignment).workplace).toBe(keep);
      expect(sim.world.get(e, HaulFlag).radius).toBe(PORTER_RADIUS);
      expect(sim.world.has(e, HaulingCart)).toBe(true);
    }

    const [porter] = porters;
    if (porter === undefined) throw new Error('no porter');
    const cart = sim.world.get(porter, HaulingCart).vehicle;
    removeVehicle(sim.world, ctxOf(sim), cart, 'destroyed');
    const pile = createGroundGoods(sim.world, { goodType: FOOD, amount: 3, ...PILE });
    runToSecond(sim, 2 * REFILL_EVERY_SECONDS);
    expect(sim.world.get(porter, HaulingCart).vehicle).not.toBe(cart);

    // The town pass levels the store's slots, so the haul is watched on its way: a porter lifts the pile
    // and brings it home, and nothing of it is left in hands, carts or on the ground.
    const PICKUP_TICKS = 90 * TICKS_PER_SECOND;
    const lifted = new Set<Entity>();
    for (let t = 0; t < PICKUP_TICKS && sim.world.isAlive(pile); t++) {
      sim.step();
      for (const e of porters) if (heldFood(sim, e) > 0) lifted.add(e);
    }
    expect(sim.world.isAlive(pile)).toBe(false);
    expect(lifted.size).toBeGreaterThan(0);
    runToSecond(sim, Math.ceil(sim.tick / TICKS_PER_SECOND) + 60);
    for (const e of porters) expect(heldFood(sim, e)).toBe(0);
  });

  it("hands a dead porter's cart to the porter made in his place instead of a new cart", () => {
    const sim = crewWorld();
    runToSecond(sim, REFILL_EVERY_SECONDS);
    const [dead] = fortressOf(sim, CARRIER);
    if (dead === undefined) throw new Error('no porter');
    const cart = sim.world.get(dead, HaulingCart).vehicle;
    const carts = vehicleIndex(sim.world).ownedBy(FORTRESS).length;
    reap(sim.world, ctxOf(sim), dead);
    expect(sim.world.get(cart, Vehicle).hauler).toBeNull();

    runToSecond(sim, 2 * REFILL_EVERY_SECONDS);
    const porters = fortressOf(sim, CARRIER);
    expect(porters).toHaveLength(PORTERS);
    expect(vehicleIndex(sim.world).ownedBy(FORTRESS)).toHaveLength(carts);
    const heir = porters.find((e) => sim.world.tryGet(e, HaulingCart)?.vehicle === cart);
    expect(heir).toBeDefined();
    expect(sim.world.get(cart, Vehicle).hauler).toBe(heir);
  });
});
