import { Age, Building, Health, Position, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import { DEFAULT_SETTLER_HITPOINTS } from '../conflict/spawn/index.js';
import type { System, SystemContext } from '../context.js';
import { canonicalById } from '../spatial.js';
import { housingCapacity, tribePopulation } from '../stores/index.js';
import { NEWBORN_AGE_CLASS } from './ageclass.js';

/**
 * ReproductionSystem (birth half) — grow a tribe's population while it has spare housing. The first writer of
 * the housing read model ({@link housingCapacity}/{@link tribePopulation}): the read side measures the
 * ceiling-vs-count, and this closes the births→housing→births loop by creating a settler whenever a tribe's
 * population is below the capacity its built homes provide.
 *
 * One birth per tribe per tick while `tribePopulation(tribe) < housingCapacity(tribe)`. That cadence is itself
 * the gate: deterministic (no RNG, no birth-rate constant) and self-limiting — once population reaches capacity
 * the gate is false and growth stops, so the population-vs-housing invariant ({@link populationWithinHousing})
 * can never be breached by a birth. The newborn is placed at the tribe's home anchor ({@link homeAnchorFor}):
 * the lowest-id built `home` building's tile. A tribe eligible for a birth always has a built home; one with no
 * position (a mapless fixture) skips the birth that tick rather than spawning a position-less settler.
 *
 * A newborn is born a baby ({@link NEWBORN_AGE_CLASS}), not an instantly-employable adult: in the original the
 * first `jobtypes` records are age/sex classes a settler passes through (`baby`→`child`→adult trade), not jobs.
 * The JobSystem leaves a baby unemployed (its `jobType` is non-null, so idle-only assignment skips it, and no
 * workplace lists a baby in its `workers` slots). The growth transition baby→child→adult is a separate,
 * deferred mechanic (its cadence has no readable oracle — see {@link NEWBORN_AGE_CLASS} / source basis).
 *
 * Source basis: the housing capacity is the data-pinned `homeSize` and the newborn's age class is the
 * data-pinned baby job id — both faithful by extraction. The birth cadence (one per tick per tribe), the anchor
 * tile, and the sex are approximated — the original's birth rate / family model / where a child appears / which
 * sex live below the readable `.ini` (no birth-rate key in `houses.ini`/`tribetypes.ini`; `make_love` restores
 * the leisure channel, it carries no birth yield). The faithful baseline is "grow to the housing ceiling and
 * stop, as babies", which this matches (see source basis).
 *
 * Determinism: tribes are processed in ascending order and the anchor is the lowest-id home — both the tribe
 * iteration and the anchor pick are canonical, so a birth never depends on component-store insertion order. The
 * population/capacity reads are commutative counts/sums.
 */
export const reproductionSystem: System = (world, ctx) => {
  for (const tribe of tribesWithHousing(world, ctx)) {
    if (tribePopulation(world, tribe) >= housingCapacity(world, ctx, tribe)) continue; // no room
    const anchor = homeAnchorFor(world, ctx, tribe);
    if (anchor === null) continue; // no positioned home to be born at (mapless fixture) — skip
    bornAt(world, ctx, tribe, anchor);
  }
};

/** Create one newborn settler of `tribe` at the `anchor` tile — born a **baby**
 * ({@link NEWBORN_AGE_CLASS}, the youngest age class, NOT an adult trade), every need at 0 and no
 * experience, otherwise the `spawnSettler` shape. Emits `settlerBorn`. */
function bornAt(world: World, ctx: SystemContext, tribe: number, anchor: { x: Fixed; y: Fixed }): void {
  const e = world.create();
  world.add(e, Position, { x: anchor.x, y: anchor.y });
  world.add(e, Settler, {
    tribe,
    jobType: NEWBORN_AGE_CLASS,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  // Born young: the {@link Age} component starts the settler at tick 0 of its life so the GrowthSystem
  // matures it baby→child→adult-eligible over GROWUP_TICKS. Only a borne settler carries an Age; an
  // adult (every `spawnSettler`) has none, so the system is inert for them (and the goldens).
  world.add(e, Age, { ticks: 0 });
  // Every settler carries a Health pool (see createSettler) — a newborn gets the same default one (no
  // per-age human pool is readable; `hitpoints_adult` implies the original scales by age — approximated).
  world.add(e, Health, { hitpoints: DEFAULT_SETTLER_HITPOINTS, max: DEFAULT_SETTLER_HITPOINTS });
  ctx.events.emit({ kind: 'settlerBorn', entity: e });
}

/** The ascending distinct set of tribes that own at least one built `home` building — the only tribes
 * that can have housing capacity, so the only ones a birth can fire for. A count/membership build (not
 * a pick), sorted so the per-tribe iteration order is canonical. */
function tribesWithHousing(world: World, ctx: SystemContext): number[] {
  const tribes = new Set<number>();
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.built < ONE) continue; // a home still under construction houses no one yet
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type?.kind === 'home') tribes.add(b.tribe);
  }
  return [...tribes].sort((a, b) => a - b);
}

/** The tile a `tribe` settler is born at: the lowest-id built `home` building's {@link Position}, or
 * null if none of its built homes has a position (a mapless fixture). Canonical (lowest-id) pick. */
function homeAnchorFor(world: World, ctx: SystemContext, tribe: number): { x: Fixed; y: Fixed } | null {
  // canonicalById over the Building query = the same ascending-id pick the old full-world scan made
  // (store ⊆ alive), at O(buildings) instead of O(world) per tribe.
  for (const e of canonicalById(world.query(Building))) {
    const b = world.get(e, Building);
    if (b.tribe !== tribe || b.built < ONE) continue;
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type?.kind !== 'home') continue;
    const p = world.tryGet(e, Position);
    if (p !== undefined) return { x: p.x, y: p.y };
  }
  return null;
}
