import { Building, Health, Stockpile, UnderConstruction } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import {
  constructionMaterialsPresent,
  constructionTotalUnits,
  deliveredConstructionFraction,
  homeNextTier,
} from '../stores.js';

/**
 * ConstructionSystem — raise a placed foundation into a finished building as builders WORK it, then
 * level a built `home` up as its next tier's materials arrive.
 *
 * A building placed `underConstruction` (via {@link placeBuilding}) enters at `built = 0` carrying an
 * {@link UnderConstruction} marker (its own {@link Stockpile} is the delivered-material hold) and — when
 * its type has a hitpoints pool — a {@link Health} pool that ramps up with the build. Each tick, for
 * every building:
 *
 *  - **A construction site (`UnderConstruction` present):** the visible `Building.built` is the LOWER of
 *    two independent gates — **builder work** ({@link UnderConstruction.labor}, advanced a swing at a
 *    time by the `construct` atomic) and **delivered material**
 *    ({@link deliveredConstructionFraction} — Σ delivered / Σ needed). So a site only rises as fast as
 *    BOTH a builder hammers AND material lands: deliver 3 of 10 units → build caps at 30% until more
 *    arrives; hammer nothing → build stays at the grey foundation however much material sits on it. Its
 *    `Health` ramps to `built · max` (floored at 1 so a foundation is never a 0-HP corpse the
 *    CleanupSystem would reap). The site **finishes** the tick its builder work is complete
 *    (`labor >= ONE`, or a free empty-cost type with nothing to install) AND every material is present:
 *    the cost is **consumed** (spent into the structure — goods conserved), `built` flips to ONE, the
 *    marker is removed, `Health` fills to max, and `buildingFinished` fires. Surplus material beyond the
 *    cost stays in the hold.
 *  - **A built `home` (no marker, `kind === 'home'`):** if the next tier in the level chain exists
 *    ({@link homeNextTier}) and the home holds that tier's full cost, the materials are consumed and the
 *    home **upgrades** — `buildingType` becomes the next tier, `level` increments, its larger `homeSize`
 *    immediately raises `housingCapacity`. The top tier never upgrades; a non-home built building is
 *    finished forever.
 *
 * WHO delivers the materials and WHO hammers is the AI planner: a construction site advertises its
 * outstanding materials as delivery demand ({@link import('../stores.js').stockCapacity}) so any carrier
 * routes them there, and the builder drive ({@link import('../agents/economy/index.js').planBuilder})
 * both hammers the site and — when it runs dry — fetches a missing material itself. A built home that can
 * still upgrade advertises its next tier's cost the same way, so the upgrade materials accumulate with no
 * upgrade-specific transport code.
 *
 * source-basis: the site-then-build flow, the material cost (`construction`, graphics-table
 * `LogicConstructionGoods`), and the per-building max HP (`logichitpoints`) are extracted/faithful; the
 * builder-driven *pace* (several hammer strikes per unit) and the consume-when-complete / upgrade-when-paid
 * behaviors are our design — the engine's build/upgrade loop has no oracle (see AGENTS.md). Determinism:
 * no RNG, no wall-clock; buildings are visited in the Building store's deterministic insertion order,
 * every decision reads CONTENT + the site's own components, and every stockpile write goes through the
 * canonical Map (never iterated for a decision). A newly-upgraded home is not re-upgraded the same tick:
 * `world.query` yields each id once and the upgrade mutates the value in place (no add/remove), and even
 * if revisited the new tier's cost isn't present (just spent).
 */
export const constructionSystem: System = (world, ctx) => {
  for (const e of world.query(Building, Stockpile)) {
    const building = world.get(e, Building);
    const type = contentIndex(ctx.content).buildings.get(building.buildingType);
    if (type === undefined) continue; // unknown type — can't price the build (shouldn't happen)

    if (world.has(e, UnderConstruction)) {
      advanceSite(world, ctx, e, building, type.construction);
      continue;
    }

    // A building with no construction marker: only a BUILT one is revisited (for a home upgrade). An
    // unfinished building without the marker is inert — it never auto-builds and never upgrades (a guard
    // against an un-migrated `built < ONE` fixture slipping into the upgrade path).
    if (building.built < ONE) continue;

    // A built `home` levels up once the next tier's materials are present; every other built building
    // (and a maxed-out top-tier home) is finished forever.
    const next = homeNextTier(type, ctx);
    if (next === undefined) continue;
    if (!materialsPresent(world, e, next.construction)) continue; // upgrade materials not yet present

    consumeMaterials(world, e, next.construction);
    building.buildingType = next.typeId; // adopt the larger tier — homeSize/housingCapacity grow
    building.level += 1;
    ctx.events.emit({ kind: 'buildingUpgraded', entity: e, level: building.level });
  }
};

/**
 * Advance one construction site this tick: reflect builder work + delivered material into `built` and
 * `Health`, and finish the build when both gates are complete. `cost` is the site type's `construction`
 * (spent into the structure on completion).
 */
function advanceSite(
  world: World,
  ctx: SystemContext,
  e: Entity,
  building: { built: Fixed },
  cost: ReadonlyArray<{ goodType: number; amount: number }>,
): void {
  const labor = world.get(e, UnderConstruction).labor;
  // A free (empty-cost) type has nothing to install — its labor requirement is waived so it finishes at
  // once (the headquarters/wonder path). Otherwise the build is done only when fully hammered.
  const laborComplete = constructionTotalUnits(world, ctx, e) === 0 || labor >= ONE;
  if (laborComplete && constructionMaterialsPresent(world, ctx, e)) {
    consumeMaterials(world, e, cost); // spend the cost into the structure (surplus stays)
    building.built = ONE; // built — production / housing now count it
    world.remove(e, UnderConstruction); // a finished building is a plain Building again
    setHealth(world, e, ONE); // full life
    ctx.events.emit({ kind: 'buildingFinished', entity: e });
    return;
  }

  // Still rising: built is the lower of builder work and delivered material (the two gates).
  const delivered = deliveredConstructionFraction(world, ctx, e);
  building.built = labor < delivered ? labor : delivered;
  setHealth(world, e, building.built);
}

/**
 * Force a construction site straight to finished — the `debugCompleteConstruction` command's effect,
 * kept HERE so the "a site becomes a building" transition lives in one module (the debug path and the
 * organic {@link advanceSite} finish flip the same three bits the same way). Skips both gates: unlike
 * the organic finish it does NOT require delivered material or completed labor, and it does NOT consume
 * the material cost (a cheat leaves any delivered goods as harmless surplus rather than risk spending a
 * cost that isn't there). A `site` without an {@link UnderConstruction} marker is a no-op. Emits the
 * same `buildingFinished` cue render/audio already listen for.
 */
export function forceFinishConstruction(world: World, ctx: SystemContext, site: Entity): void {
  if (!world.has(site, UnderConstruction)) return; // not a site (built already, or wrong kind) — no-op
  world.get(site, Building).built = ONE;
  world.remove(site, UnderConstruction);
  setHealth(world, site, ONE);
  ctx.events.emit({ kind: 'buildingFinished', entity: site });
}

/**
 * Ramp a construction site's {@link Health} pool to `builtFraction` of its max. Floored at 1 hitpoint so
 * a foundation (`built = 0`) is never a 0-HP entity the CleanupSystem would reap and announce as a death
 * — combat targeting of buildings (and their safe teardown) is a later slice, so a building only ever
 * rises through this ramp today. A no-op for a type with no hitpoints pool (no `Health` component).
 * Deterministic integer arithmetic: `built · max / ONE` truncated (built is a 0..ONE Fixed, max a plain
 * integer), never an accumulated float.
 */
function setHealth(world: World, e: Entity, builtFraction: Fixed): void {
  const health = world.tryGet(e, Health);
  if (health === undefined) return;
  health.hitpoints =
    builtFraction >= ONE ? health.max : Math.max(1, Math.trunc((builtFraction * health.max) / ONE));
}

/** Whether a stockpile holds every line of a material `cost` in full. */
function materialsPresent(
  world: World,
  building: Entity,
  cost: ReadonlyArray<{ goodType: number; amount: number }>,
): boolean {
  const stock = world.get(building, Stockpile).amounts;
  for (const line of cost) {
    if ((stock.get(line.goodType) ?? 0) < line.amount) return false;
  }
  return true;
}

/** Remove the `cost` materials from a building's stockpile (spent into the structure / upgrade). The
 *  caller has verified every material is present in full, so a count can't go negative. A good that hits
 *  zero is left as a 0 entry (the canonical Map tolerates it; the stockpile is never iterated for a
 *  decision). */
function consumeMaterials(
  world: World,
  building: Entity,
  cost: ReadonlyArray<{ goodType: number; amount: number }>,
): void {
  const stock = world.get(building, Stockpile).amounts;
  for (const line of cost) {
    const have = stock.get(line.goodType) ?? 0;
    stock.set(line.goodType, have - line.amount);
  }
}

/**
 * Hammer strikes a builder sinks into EACH unit of construction material. A build swing is a SMALL step —
 * `ONE / (units · this)` of the work — not a whole unit installed, so a builder visibly WORKS a foundation
 * up over many strikes rather than a few, and the total strikes to raise a building scale with its SIZE
 * through its material cost (a bigger house costs more units → proportionally more swings; the base-tier
 * home the scene builds costs 6 units → two dozen strikes' worth of work). Our design — the engine's build
 * loop has no oracle (see AGENTS.md) — tuned for a satisfying, watchable build.
 */
const STRIKES_PER_UNIT = 4;

/**
 * Advance a construction site's builder-work `labor` by one swing — the `construct` atomic's effect,
 * applied by the AtomicSystem when a builder completes a build swing. A swing is one hammer STRIKE:
 * `ONE / (totalConstructionUnits · STRIKES_PER_UNIT)` of the build, so a site rises a little per strike and
 * the strike COUNT scales with the building's size via its cost (see {@link STRIKES_PER_UNIT}); clamped so
 * `labor` never exceeds ONE. A free (empty-cost) type has nothing to install — a single swing completes it.
 * A no-op on a building that is no longer a construction site (finished this tick, or demolished): the swing
 * struck a building that no longer needs raising. Determinism: a fixed per-swing quantum, no RNG.
 */
export function advanceConstructionLabor(world: World, ctx: SystemContext, site: Entity): void {
  const uc = world.tryGet(site, UnderConstruction);
  if (uc === undefined) return; // struck a finished/removed site — nothing to advance
  const totalStrikes = constructionTotalUnits(world, ctx, site) * STRIKES_PER_UNIT;
  // At least 1 ULP per strike so even an (unrealistically) huge-cost building still finishes rather than
  // stalling on a quantum that truncated to zero: `trunc(ONE / totalStrikes)` floors to 0 once
  // `totalStrikes > ONE`. Inert for real content (a 6-unit home's quantum is ~2730), so goldens hold.
  const quantum = totalStrikes > 0 ? (Math.max(1, fx.div(ONE, fx.fromInt(totalStrikes))) as Fixed) : ONE;
  const advanced = fx.add(uc.labor, quantum);
  uc.labor = (advanced > ONE ? ONE : advanced) as Fixed;
}
