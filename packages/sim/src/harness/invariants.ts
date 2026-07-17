import { Building, Settler, Stockpile, stockpileEntries } from '../components/index.js';
import { ONE } from '../core/fixed.js';
import type { World } from '../ecs/world.js';

/**
 * Invariants: properties that must hold after EVERY tick. They are the cheapest, most powerful
 * feedback signal for an agent — a system that breaks the world fails an invariant immediately,
 * with a human-readable message, instead of producing subtly wrong state a golden hash can't
 * explain. Run them in dev/tests via Simulation.checkInvariants(); see docs/TESTING.md.
 *
 * An invariant returns a list of violation strings (empty = ok). Add domain invariants as systems
 * land (goods conservation, no-deadlock/liveness, path validity, population vs housing capacity).
 */
export type Invariant = (world: World) => string[];

/** Stock ceiling past which an amount is an over/underflow artefact rather than a plausible pile. */
const IMPLAUSIBLE_STOCK = 0x7fffffff;

/**
 * Home-level ceiling (`home level 00..04` — {@link Building}). Content owns the real bound: a building
 * upgrades only while its type's `upgradeTarget` chain continues, so this tracks the home chain's length
 * rather than enforcing it. Content adding a sixth tier must move this with it.
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
 * Every incrementally-maintained World cache re-derives to the same value as its live copy —
 * incremental caches are the classic lockstep-desync source, so the derived value is recomputed
 * from scratch and asserted equal on every checked tick. The actual recomputation lives with the
 * caches ({@link World.verifyCaches}); this invariant just runs it, so a missed invalidation is
 * caught at the tick it happens with a named cache, not later as an unexplained golden/hash
 * divergence.
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

export const CORE_INVARIANTS: readonly Invariant[] = [
  stockNonNegative,
  needsInRange,
  buildingSane,
  cachesCoherent,
];

/** Run a set of invariants; returns all violations across them. */
export function checkInvariants(world: World, invariants: readonly Invariant[] = CORE_INVARIANTS): string[] {
  return invariants.flatMap((inv) => inv(world));
}
