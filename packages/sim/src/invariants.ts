import { Building, Settler, Stockpile, stockpileEntries } from './components/index.js';
import type { World } from './ecs/world.js';
import { ONE } from './fixed.js';

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

/** No stock amount is negative or above 2^31 (catches over/underflow in production/transport). */
export const stockNonNegative: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Stockpile)) {
    for (const [good, amount] of stockpileEntries(world.get(e, Stockpile))) {
      if (amount < 0) out.push(`entity ${e}: negative stock of good ${good} (${amount})`);
      if (amount > 0x7fffffff) out.push(`entity ${e}: implausible stock of good ${good} (${amount})`);
    }
  }
  return out;
};

/** Settler hunger stays within [0, ONE]. */
export const hungerInRange: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Settler)) {
    const h = world.get(e, Settler).hunger;
    if (h < 0 || h > ONE) out.push(`entity ${e}: hunger out of range (${h})`);
  }
  return out;
};

/** Building construction progress and level stay sane. */
export const buildingSane: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.built < 0 || b.built > ONE) out.push(`entity ${e}: built out of range (${b.built})`);
    if (b.level < 0 || b.level > 4) out.push(`entity ${e}: level out of range (${b.level})`);
  }
  return out;
};

export const CORE_INVARIANTS: readonly Invariant[] = [stockNonNegative, hungerInRange, buildingSane];

/** Run a set of invariants; returns all violations across them. */
export function checkInvariants(world: World, invariants: readonly Invariant[] = CORE_INVARIANTS): string[] {
  return invariants.flatMap((inv) => inv(world));
}
