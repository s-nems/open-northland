import type { ContentSet } from '@vinland/data';
import { Building, Settler, Stockpile, stockpileEntries } from './components/index.js';
import { ONE } from './core/fixed.js';
import type { World } from './ecs/world.js';

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

/** Settler fatigue stays within [0, ONE] (the NeedsSystem clamps the rise; this catches a leak). */
export const fatigueInRange: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Settler)) {
    const f = world.get(e, Settler).fatigue;
    if (f < 0 || f > ONE) out.push(`entity ${e}: fatigue out of range (${f})`);
  }
  return out;
};

/** Settler piety stays within [0, ONE] (the NeedsSystem clamps the rise; this catches a leak). */
export const pietyInRange: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Settler)) {
    const p = world.get(e, Settler).piety;
    if (p < 0 || p > ONE) out.push(`entity ${e}: piety out of range (${p})`);
  }
  return out;
};

/** Settler enjoyment stays within [0, ONE] (the NeedsSystem clamps the rise; this catches a leak). */
export const enjoymentInRange: Invariant = (world) => {
  const out: string[] = [];
  for (const e of world.query(Settler)) {
    const j = world.get(e, Settler).enjoyment;
    if (j < 0 || j > ONE) out.push(`entity ${e}: enjoyment out of range (${j})`);
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

/**
 * No tribe's living population exceeds the housing capacity its built `home` buildings provide — the
 * liveness guard on the births→housing loop (the ReproductionSystem must never spawn a settler past
 * the ceiling). A **content-bound** invariant: it needs the building types' `homeSize` param (the
 * `Invariant` signature carries only the world), so it is a factory that closes over `content` and
 * returns a plain `Invariant` — a scenario opts in via `invariants: [populationWithinHousing(content)]`.
 * It is NOT in {@link CORE_INVARIANTS} (those run content-free against any world).
 *
 * Capacity and population are recomputed here from the world directly (not via `systems/shared.ts`, to
 * keep `invariants` free of a `SystemContext`): capacity = the sum of `homeSize` over a tribe's built
 * `home` buildings, population = its living settler count. Both are commutative reductions, so the
 * `query` store order can't change them.
 */
export function populationWithinHousing(content: ContentSet): Invariant {
  const homeSizeOf = new Map<number, number>();
  for (const t of content.buildings) {
    if (t.kind === 'home') homeSizeOf.set(t.typeId, t.homeSize);
  }
  return (world) => {
    const capacity = new Map<number, number>();
    for (const e of world.query(Building)) {
      const b = world.get(e, Building);
      if (b.built < ONE) continue; // not yet built — shelters no one
      const size = homeSizeOf.get(b.buildingType);
      if (size !== undefined) capacity.set(b.tribe, (capacity.get(b.tribe) ?? 0) + size);
    }
    const population = new Map<number, number>();
    for (const e of world.query(Settler)) {
      const tribe = world.get(e, Settler).tribe;
      population.set(tribe, (population.get(tribe) ?? 0) + 1);
    }
    const out: string[] = [];
    for (const [tribe, pop] of population) {
      const cap = capacity.get(tribe) ?? 0;
      if (pop > cap) out.push(`tribe ${tribe}: population ${pop} exceeds housing capacity ${cap}`);
    }
    return out;
  };
}

export const CORE_INVARIANTS: readonly Invariant[] = [
  stockNonNegative,
  hungerInRange,
  fatigueInRange,
  pietyInRange,
  enjoymentInRange,
  buildingSane,
];

/** Run a set of invariants; returns all violations across them. */
export function checkInvariants(world: World, invariants: readonly Invariant[] = CORE_INVARIANTS): string[] {
  return invariants.flatMap((inv) => inv(world));
}
