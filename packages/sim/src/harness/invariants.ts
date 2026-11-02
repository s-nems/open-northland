import type { ContentSet } from '@open-northland/data';
import {
  AtomicClock,
  Building,
  CurrentAtomic,
  Engagement,
  HaulingCart,
  HuntFocus,
  MAX_BUILDING_LEVEL,
  PathFollow,
  PathRoute,
  Person,
  Position,
  Rider,
  Settler,
  SettlerNeeds,
  SettlerProgress,
  Stockpile,
  stockpileEntries,
  TradeShip,
  Vehicle,
  VehicleDrive,
  VehicleMarchRoute,
  VehicleRoute,
  vehicleCommander,
} from '../components/index.js';
import { contentIndex } from '../core/content-index.js';
import { ONE } from '../core/fixed.js';
import type { Component, World } from '../ecs/world.js';
import { NEED_OVERFILL_FLOOR } from '../systems/lifecycle/needs/index.js';
import { isAnimalTribe, isTraderJob } from '../systems/readviews/index.js';
import { isShipVehicle } from '../systems/readviews/vehicles.js';
import { worksWithHaulingCart } from '../systems/vehicles/hauling-cart.js';
import { playerPlacementRulesValid } from './player-placement-invariant.js';

/**
 * A property that must hold after every tick, returning one message per violation and an empty list
 * when the world is sound. Run through `Simulation.checkInvariants()`.
 */
export type Invariant = (world: World, content: ContentSet) => string[];

/** Stock ceiling past which an amount is an over/underflow artefact rather than a plausible pile. */
const IMPLAUSIBLE_STOCK = 0x7fffffff;

/** The settler needs clamped into `[NEED_OVERFILL_FLOOR, ONE]`; the invariant catches a leak past the
 *  clamp, at either end. */
const CLAMPED_NEEDS = ['hunger', 'fatigue', 'piety', 'enjoyment'] as const;

/** No stock amount is negative or implausibly large (catches over/underflow in production/transport). */
const stockNonNegative: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Stockpile)) {
    for (const [good, amount] of stockpileEntries(world.get(e, Stockpile))) {
      if (amount < 0) out.push(`entity ${e}: negative stock of good ${good} (${amount})`);
      if (amount > IMPLAUSIBLE_STOCK) out.push(`entity ${e}: implausible stock of good ${good} (${amount})`);
    }
  }
  return out;
};

/** Every {@link CLAMPED_NEEDS} need stays within `[NEED_OVERFILL_FLOOR, ONE]`. */
const needsInRange: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(SettlerNeeds)) {
    const s = world.get(e, SettlerNeeds);
    for (const need of CLAMPED_NEEDS) {
      const v = s[need];
      if (v < NEED_OVERFILL_FLOOR || v > ONE) out.push(`entity ${e}: ${need} out of range (${v})`);
    }
  }
  return out;
};

/** Every incrementally-maintained World cache re-derives to its live value. */
const cachesCoherent: Invariant = (world) => world.verifyCaches();

/** Building construction progress and level stay sane. */
const buildingSane: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.built < 0 || b.built > ONE) out.push(`entity ${e}: built out of range (${b.built})`);
    if (b.level < 0 || b.level > MAX_BUILDING_LEVEL) out.push(`entity ${e}: level out of range (${b.level})`);
  }
  return out;
};

/**
 * A hunter's prey hold never outlives its {@link Engagement}. Only the consuming branch reaps the hold,
 * so a seam that sheds the engagement alone would strand a dead entity id in the state hash.
 */
const preyHoldWithinEngagement: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(HuntFocus)) {
    if (!world.has(e, Engagement)) out.push(`entity ${e}: HuntFocus without an Engagement`);
  }
  return out;
};

/**
 * A {@link Settler} carries {@link Person} exactly when its tribe has no `[animaltype]` record, and a
 * {@link Person} always carries a {@link Settler}, which every `query(Person, …)` sweep reads. The
 * `addPerson`/`addWildlife` constructors keep both true.
 *
 * The rule keys on the animal record, not the tech graph: a monster tribe has neither, which makes it a
 * person whose tribe declares no trade rather than a third personhood state.
 */
const personhoodMatchesTribe: Invariant = (world, content) => {
  const out: string[] = [];
  for (const e of world.query(Settler)) {
    const tribe = world.get(e, Settler).tribe;
    if (world.has(e, Person) === isAnimalTribe(content, tribe)) {
      out.push(`entity ${e}: tribe ${tribe} ${world.has(e, Person) ? 'has' : 'lacks'} Person`);
    }
  }
  for (const e of world.query(Person)) {
    if (!world.has(e, Settler)) out.push(`entity ${e}: Person without a Settler`);
  }
  return out;
};

/** Components split so a hot write does not re-fold a rarely written payload, which exist together. */
const SPLIT_PAIRS: readonly (readonly [Component<unknown>, Component<unknown>])[] = [
  [PathFollow, PathRoute],
  [Settler, SettlerProgress],
  [Settler, SettlerNeeds],
  [CurrentAtomic, AtomicClock],
];

/** Each {@link SPLIT_PAIRS} half is present exactly when the other is. */
const splitHalvesPaired: Invariant = (world) => {
  const out: string[] = [];
  for (const pair of SPLIT_PAIRS) {
    for (const [held, partner] of [pair, [pair[1], pair[0]] as const]) {
      for (const e of world.query(held)) {
        if (!world.has(e, partner)) out.push(`entity ${e}: ${held.name} without a ${partner.name}`);
      }
    }
  }
  return out;
};

/** A running atomic is an in-place action: a walker that keeps its route while one plays slides along it
 *  in the action's clip. */
const atomicStandsStill: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(CurrentAtomic)) {
    if (world.has(e, PathFollow)) {
      out.push(`entity ${e}: atomic ${world.get(e, CurrentAtomic).atomicId} runs while following a path`);
    }
  }
  return out;
};

/** A vehicle's route lives with its drive or its goto held for the crew, and a kept march route with its
 *  march, so neither outlives what it was found for into saves and hashes. */
const vehicleRoutesOwned: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(VehicleRoute)) {
    if (world.has(e, VehicleDrive) || world.tryGet(e, Vehicle)?.heldGoal != null) continue;
    out.push(`entity ${e}: VehicleRoute with neither a drive nor a held goal`);
  }
  for (const e of world.query(VehicleMarchRoute)) {
    if (world.tryGet(e, Vehicle)?.march != null) continue;
    out.push(`entity ${e}: VehicleMarchRoute without a march`);
  }
  return out;
};

/** A hauling cart and its puller name each other, a taken cart stands nowhere and rides no ship, and a
 *  cart nobody pulls names no hauler, so no exit path leaves a one-sided link behind. */
const haulingCartsLinked: Invariant = (world, content) => {
  const out: string[] = [];
  for (const e of world.query(HaulingCart)) {
    const held = world.get(e, HaulingCart);
    if (!worksWithHaulingCart(world, content, e)) {
      out.push(`entity ${e}: holds hauling cart ${held.vehicle} without being a posted carrier or a trader`);
    }
    const state = world.tryGet(held.vehicle, Vehicle);
    if (state === undefined || state.hauler !== e) {
      out.push(`entity ${e}: HaulingCart names vehicle ${held.vehicle}, which does not name it back`);
      continue;
    }
    if (held.taken && (world.has(held.vehicle, Position) || state.carrier !== null)) {
      out.push(`entity ${e}: taken hauling cart ${held.vehicle} stands on the map or rides a ship`);
    }
    if (held.taken && held.parked) {
      out.push(`entity ${e}: hauling cart ${held.vehicle} is both in hand and parked`);
    }
    if (held.lift !== null && (held.taken || !world.has(held.vehicle, Position))) {
      out.push(`entity ${e}: hauling cart ${held.vehicle} is in a lift while in hand or off the map`);
    }
    if (state.carrier !== null && world.tryGet(e, Rider)?.vehicle !== state.carrier) {
      out.push(`entity ${e}: hauling cart ${held.vehicle} rides a ship without its puller aboard`);
    }
  }
  for (const e of world.query(Vehicle)) {
    const hauler = world.get(e, Vehicle).hauler;
    if (hauler === null) continue;
    const pulls = world.tryGet(hauler, HaulingCart)?.vehicle === e;
    if (!pulls && world.tryGet(hauler, TradeShip)?.vehicle !== e) {
      out.push(`entity ${e}: hauler ${hauler} neither pulls it nor has it pinned`);
    }
  }
  return out;
};

/** A pinned ship and its trader name each other, the ship is a ship, its commander's slot is the trader's
 *  alone, and its hauler link never leads a cart reader astray. */
const tradeShipsLinked: Invariant = (world, content) => {
  const out: string[] = [];
  for (const e of world.query(TradeShip)) {
    const { vehicle } = world.get(e, TradeShip);
    const state = world.tryGet(vehicle, Vehicle);
    if (state === undefined || state.hauler !== e) {
      out.push(`entity ${e}: TradeShip names vehicle ${vehicle}, which does not name it back`);
      continue;
    }
    const type = contentIndex(content).vehicles.get(state.vehicleType);
    if (type === undefined || !isShipVehicle(type)) {
      out.push(`entity ${e}: TradeShip names vehicle ${vehicle}, which is no ship`);
    }
    if (!isTraderJob(content, world.tryGet(e, Settler)?.jobType ?? null)) {
      out.push(`entity ${e}: holds trade ship ${vehicle} without being a trader`);
    }
    const commander = vehicleCommander(state);
    if (commander !== null && commander !== e) {
      out.push(`entity ${e}: rider ${commander} holds the commander's slot of its trade ship ${vehicle}`);
    }
  }
  return out;
};

export const CORE_INVARIANTS: readonly Invariant[] = [
  stockNonNegative,
  needsInRange,
  buildingSane,
  preyHoldWithinEngagement,
  personhoodMatchesTribe,
  splitHalvesPaired,
  atomicStandsStill,
  vehicleRoutesOwned,
  haulingCartsLinked,
  tradeShipsLinked,
  cachesCoherent,
  playerPlacementRulesValid,
];

/** Run a set of invariants; returns all violations across them. */
export function checkInvariants(
  world: World,
  content: ContentSet,
  invariants: readonly Invariant[] = CORE_INVARIANTS,
): string[] {
  return invariants.flatMap((inv) => inv(world, content));
}
