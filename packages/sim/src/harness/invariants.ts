import {
  Building,
  Engagement,
  HuntFocus,
  Settler,
  Stockpile,
  stockpileEntries,
} from '../components/index.js';
import { ONE } from '../core/fixed.js';
import type { World } from '../ecs/world.js';

/**
 * A property that must hold after every tick, returning one message per violation and an empty list
 * when the world is sound. Run through `Simulation.checkInvariants()`.
 */
export type Invariant = (world: World) => string[];

/** Stock ceiling past which an amount is an over/underflow artefact rather than a plausible pile. */
const IMPLAUSIBLE_STOCK = 0x7fffffff;

/**
 * Tracks the length of the `home level 00..04` upgrade chain. Content owns the real bound through
 * `upgradeTarget`, so a sixth tier in content must move this with it.
 */
const MAX_HOME_LEVEL = 4;

/** The settler needs the NeedsSystem clamps into [0, ONE]; the invariant catches a leak past the clamp. */
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

/** Every {@link CLAMPED_NEEDS} need stays within [0, ONE]. */
const needsInRange: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Settler)) {
    const s = world.get(e, Settler);
    for (const need of CLAMPED_NEEDS) {
      const v = s[need];
      if (v < 0 || v > ONE) out.push(`entity ${e}: ${need} out of range (${v})`);
    }
  }
  return out;
};

/**
 * Every incrementally-maintained World cache re-derives to its live value, so a missed invalidation
 * names its cache at the tick it happens instead of surfacing later as a hash divergence.
 */
const cachesCoherent: Invariant = (world) => world.verifyCaches();

/** Building construction progress and level stay sane. */
const buildingSane: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.built < 0 || b.built > ONE) out.push(`entity ${e}: built out of range (${b.built})`);
    if (b.level < 0 || b.level > MAX_HOME_LEVEL) out.push(`entity ${e}: level out of range (${b.level})`);
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

export const CORE_INVARIANTS: readonly Invariant[] = [
  stockNonNegative,
  needsInRange,
  buildingSane,
  preyHoldWithinEngagement,
  cachesCoherent,
];

/** Run a set of invariants; returns all violations across them. */
export function checkInvariants(world: World, invariants: readonly Invariant[] = CORE_INVARIANTS): string[] {
  return invariants.flatMap((inv) => inv(world));
}
