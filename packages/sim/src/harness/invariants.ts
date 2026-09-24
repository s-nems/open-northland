import type { ContentSet } from '@open-northland/data';
import {
  AtomicClock,
  Building,
  CurrentAtomic,
  Engagement,
  HuntFocus,
  MAX_BUILDING_LEVEL,
  PathFollow,
  PathRoute,
  Person,
  Settler,
  SettlerProgress,
  Stockpile,
  stockpileEntries,
} from '../components/index.js';
import { ONE } from '../core/fixed.js';
import type { Component, World } from '../ecs/world.js';
import { NEED_OVERFILL_FLOOR } from '../systems/lifecycle/needs/index.js';
import { isAnimalTribe } from '../systems/readviews/index.js';
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
  for (const e of world.query(Settler)) {
    const s = world.get(e, Settler);
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

export const CORE_INVARIANTS: readonly Invariant[] = [
  stockNonNegative,
  needsInRange,
  buildingSane,
  preyHoldWithinEngagement,
  personhoodMatchesTribe,
  splitHalvesPaired,
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
