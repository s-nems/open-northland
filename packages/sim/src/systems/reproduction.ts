import { Building, Position, Settler } from '../components/index.js';
import type { World } from '../ecs/world.js';
import { type Fixed, ONE, fx } from '../fixed.js';
import type { System, SystemContext } from './context.js';
import { housingCapacity, tribePopulation } from './shared.js';

/**
 * ReproductionSystem (birth half) — grow a tribe's population while it has spare housing. This is the
 * **first WRITER** of the housing read model ({@link housingCapacity}/{@link tribePopulation}): the
 * read side measured the ceiling-vs-count, and this closes the loop the ROADMAP names —
 * `house leveling → population capacity → births→housing→births` — by creating a settler whenever a
 * tribe's population is below the capacity its built homes provide.
 *
 * In Cultures a colony grows on its own: with room to live, new settlers appear (the population climbs
 * toward the housing ceiling and stops there). This slice models that as **one birth per tribe per
 * tick while there is room** — a settler is created when `tribePopulation(tribe) < housingCapacity
 * (tribe)`. That cadence is itself the gate: it is deterministic (no RNG, no birth-rate constant) and
 * self-limiting — once population reaches capacity the gate is false and growth stops, so the
 * "population vs housing capacity" invariant ({@link populationWithinHousing}) can never be breached by
 * a birth. A newborn is **idle** (`jobType: null`) like the original (a settler isn't born into a
 * trade), so the JobSystem employs it next tick.
 *
 * The newborn is placed at the tribe's **home anchor** ({@link homeAnchorFor}): the lowest-id built
 * `home` building's tile — a settler is born at a residence. A tribe eligible for a birth always has a
 * built home (that is what gives it capacity), so the anchor is always found; if it has no *position*
 * (a mapless fixture), the birth is skipped that tick rather than spawning a position-less settler.
 *
 * FIDELITY (approximated — see docs/FIDELITY.md): the housing *capacity* is the data-pinned `homeSize`,
 * but the **birth cadence** (one per tick per tribe) and the **anchor tile** are unpinned — the
 * original's birth rate / family model / where a child appears live below the readable `.ini` (there is
 * no birth-rate key in `houses.ini`/`tribetypes.ini`; `make_love` restores the leisure channel, it
 * carries no birth yield). The faithful baseline is "grow to the housing ceiling and stop", which this
 * matches; the rate + the family/child-growth model (ROADMAP's next item) are calibration-by-observation.
 *
 * Determinism: tribes are processed in ascending order (a sorted distinct-tribe list derived from the
 * built homes), and the anchor is the lowest-id home via {@link World.canonicalEntities} — both the
 * tribe iteration and the anchor *pick* are canonical, so a birth never depends on component-store
 * insertion history. The population/capacity reads are commutative counts/sums (order-independent). No
 * RNG, no wall-clock.
 */
export const reproductionSystem: System = (world, ctx) => {
  for (const tribe of tribesWithHousing(world, ctx)) {
    if (tribePopulation(world, tribe) >= housingCapacity(world, ctx, tribe)) continue; // no room
    const anchor = homeAnchorFor(world, ctx, tribe);
    if (anchor === null) continue; // no positioned home to be born at (mapless fixture) — skip
    bornAt(world, ctx, tribe, anchor);
  }
};

/** Create one newborn settler of `tribe` at the `anchor` tile — idle (the JobSystem employs it next
 * tick), every need at 0 and no experience, exactly the `spawnSettler` shape. Emits `settlerBorn`. */
function bornAt(world: World, ctx: SystemContext, tribe: number, anchor: { x: Fixed; y: Fixed }): void {
  const e = world.create();
  world.add(e, Position, { x: anchor.x, y: anchor.y });
  world.add(e, Settler, {
    tribe,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
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
    const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
    if (type?.kind === 'home') tribes.add(b.tribe);
  }
  return [...tribes].sort((a, b) => a - b);
}

/** The tile a `tribe` settler is born at: the lowest-id built `home` building's {@link Position}, or
 * null if none of its built homes has a position (a mapless fixture). Canonical (lowest-id) pick. */
function homeAnchorFor(world: World, ctx: SystemContext, tribe: number): { x: Fixed; y: Fixed } | null {
  for (const e of world.canonicalEntities()) {
    const b = world.tryGet(e, Building);
    if (b === undefined || b.tribe !== tribe || b.built < ONE) continue;
    const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
    if (type?.kind !== 'home') continue;
    const p = world.tryGet(e, Position);
    if (p !== undefined) return { x: p.x, y: p.y };
  }
  return null;
}
