import {
  Building,
  consumeGoods,
  type GoodsLine,
  Health,
  holdsAll,
  Stockpile,
  UnderConstruction,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { evictSettlersFromFootprint } from '../movement/evict.js';
import {
  constructionBillOf,
  constructionMaterialsPresent,
  constructionTotalUnits,
  deliveredConstructionFraction,
  homeNextTier,
} from '../stores/index.js';

/**
 * ConstructionSystem — raise a placed foundation into a finished building as builders work it, then level a
 * built `home` up as its next tier's materials arrive.
 *
 * A building placed `underConstruction` (via {@link placeBuilding}) enters at `built = 0` carrying an
 * {@link UnderConstruction} marker (its own {@link Stockpile} is the delivered-material hold) and — when its
 * type has a hitpoints pool — a {@link Health} pool that ramps up with the build. Each tick, for every
 * building:
 *
 *  - **A construction site (`UnderConstruction` present):** the visible `Building.built` is the lower of two
 *    independent gates — builder work ({@link UnderConstruction.labor}, advanced a swing at a time by the
 *    `construct` atomic) and delivered material ({@link deliveredConstructionFraction} — Σ delivered / Σ
 *    needed). So a site only rises as fast as both a builder hammers and material lands: deliver 3 of 10 units
 *    → build caps at 30% until more arrives; hammer nothing → build stays at the grey foundation however much
 *    material sits on it. Its `Health` ramps to `built · max` (floored at 1 so a foundation is never a 0-HP
 *    corpse the CleanupSystem would reap). The site finishes the tick its builder work is complete
 *    (`labor >= ONE`, or a free empty-cost type) and every material is present: the cost is consumed (spent
 *    into the structure — goods conserved), `built` flips to ONE, the marker is removed, `Health` fills to max,
 *    and `buildingFinished` fires. Surplus material beyond the cost stays in the hold.
 *  - **A built `home` (no marker, `kind === 'home'`):** if the next tier in the level chain exists
 *    ({@link homeNextTier}) and the home holds that tier's full cost, the materials are consumed and the home
 *    upgrades — `buildingType` becomes the next tier, `level` increments, its larger `homeSize` immediately
 *    raises `housingCapacity`. The top tier never upgrades; a non-home built building is finished forever.
 *
 * Who delivers the materials and who hammers is the AI planner: a construction site advertises its outstanding
 * materials as delivery demand ({@link import('../stores/index.js').stockCapacity}) so any carrier routes them
 * there, and the builder drive ({@link import('../agents/economy/index.js').planBuilder}) both hammers the site
 * and — when it runs dry — fetches a missing material itself. A built home that can still upgrade advertises
 * its next tier's cost the same way, so the upgrade materials accumulate with no upgrade-specific transport code.
 *
 * Source basis: the site-then-build flow, the per-tier material cost (`construction`, graphics-table
 * `LogicConstructionGoods`), and the per-building max HP (`logichitpoints`) are extracted/faithful; a
 * directly-placed home tier paying its whole cumulative chain bill is our design invariant (the original
 * only upgrades homes, so direct tier-N placement is an OpenNorthland capability priced to the tier-1-then-
 * upgrade total rather than let it undercut that path — see `constructionBillOf`); the
 * builder-driven pace (several hammer strikes per unit) and the consume-when-complete / upgrade-when-paid
 * behaviors are our design (the engine's build/upgrade loop has no oracle). Determinism: buildings are visited
 * in the Building store's insertion order, every decision reads content + the site's own components, and every
 * stockpile write goes through the canonical Map. A newly-upgraded home is not re-upgraded the same tick:
 * `world.query` yields each id once and the upgrade mutates in place (no add/remove), and even if revisited the
 * new tier's cost isn't present (just spent).
 */
export const constructionSystem: System = (world, ctx) => {
  for (const e of world.query(Building, Stockpile)) {
    const building = world.get(e, Building);
    const type = contentIndex(ctx.content).buildings.get(building.buildingType);
    if (type === undefined) continue; // unknown type — can't price the build (shouldn't happen)

    if (world.has(e, UnderConstruction)) {
      advanceSite(world, ctx, e, building);
      continue;
    }

    // A building with no construction marker: only a built one is revisited (for a home upgrade). An unfinished
    // building without the marker is inert — it never auto-builds and never upgrades (a guard against an
    // un-migrated `built < ONE` fixture slipping into the upgrade path).
    if (building.built < ONE) continue;

    // A built `home` levels up once the next tier's materials are present; every other built building
    // (and a maxed-out top-tier home) is finished forever.
    const next = homeNextTier(type, ctx);
    if (next === undefined) continue;
    if (!materialsPresent(world, e, next.construction)) continue; // upgrade materials not yet present

    consumeMaterials(world, e, next.construction);
    building.buildingType = next.typeId; // adopt the larger tier — homeSize/housingCapacity grow
    building.level += 1;
    // The in-place type swap changes every buildingType-derived answer (stock slots, recipe, produces)
    // — log the value write so version-keyed caches (porter dormancy) re-scan.
    world.touchComponent(Building);
    // The larger tier's footprint may enclose cells settlers were standing on — push them out.
    evictSettlersFromFootprint(world, ctx, e);
    ctx.events.emit({ kind: 'buildingUpgraded', entity: e, level: building.level });
  }
};

/** The {@link Building} component's value — what `world.get(e, Building)` hands back. */
type BuildingState = NonNullable<(typeof Building)['__value']>;

/**
 * Advance one construction site this tick: reflect builder work + delivered material into `built` and
 * `Health`, and finish the build when both gates are complete. The bill spent into the structure on
 * completion is the site type's from-scratch construction cost (for a home tier, every chain stage's —
 * see {@link constructionBillOf}), the same bill the gates below are measured against.
 */
function advanceSite(world: World, ctx: SystemContext, e: Entity, building: BuildingState): void {
  const labor = world.get(e, UnderConstruction).labor;
  // A free (empty-cost) type has nothing to install — its labor requirement is waived so it finishes at
  // once (the headquarters/wonder path). Otherwise the build is done only when fully hammered.
  const laborComplete = constructionTotalUnits(world, ctx, e) === 0 || labor >= ONE;
  if (laborComplete && constructionMaterialsPresent(world, ctx, e)) {
    consumeMaterials(world, e, constructionBillOf(world, ctx, e)); // spend the cost in (surplus stays)
    building.built = ONE; // built — production / housing now count it
    world.remove(e, UnderConstruction); // a finished building is a plain Building again
    setHealth(world, e, ONE); // full life
    // A settler that strayed onto the plot during the build (a stale route, a spawn) must not be
    // left standing inside the finished walls.
    evictSettlersFromFootprint(world, ctx, e);
    ctx.events.emit({ kind: 'buildingFinished', entity: e });
    return;
  }

  // Still rising: built is the lower of builder work and delivered material (the two gates).
  const delivered = deliveredConstructionFraction(world, ctx, e);
  building.built = labor < delivered ? labor : delivered;
  setHealth(world, e, building.built);
}

/**
 * Force a construction site straight to finished — the `debugCompleteConstruction` command's effect, kept here
 * so the "a site becomes a building" transition lives in one module (the debug path and the organic
 * {@link advanceSite} finish flip the same three bits the same way). Skips both gates: unlike the organic
 * finish it does not require delivered material or completed labor, and it does not consume the material cost
 * (a cheat leaves any delivered goods as harmless surplus rather than risk spending a cost that isn't there). A
 * `site` without an {@link UnderConstruction} marker is a no-op. Emits the same `buildingFinished` cue.
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
function materialsPresent(world: World, building: Entity, cost: readonly GoodsLine[]): boolean {
  return holdsAll(world.get(building, Stockpile).amounts, cost);
}

/** Remove the `cost` materials from a building's stockpile (spent into the structure / upgrade). The
 *  caller has verified every material is present in full via {@link materialsPresent}. */
function consumeMaterials(world: World, building: Entity, cost: readonly GoodsLine[]): void {
  consumeGoods(world, world.get(building, Stockpile).amounts, cost);
}

/**
 * Hammer strikes a builder sinks into each unit of construction material. A build swing is a small step —
 * `ONE / (units · this)` of the work, not a whole unit installed — so a builder visibly works a foundation up
 * over many strikes, and the total strikes to raise a building scale with its size through its material cost
 * (a bigger house costs more units → proportionally more swings, and a directly-placed higher home tier pays
 * its whole cumulative bill — see `constructionBillOf` — so it also builds proportionally slower). Our design
 * (the engine's build loop has no oracle), tuned to the observed original's pace: the real base home costs
 * 4 material units, so 4·this ≈ 100 strikes raise it and each hammer strike advances the build a little under
 * 1% — the 0–1%-per-strike pace checked against the original in-game.
 */
const STRIKES_PER_UNIT = 26;

/**
 * Advance a construction site's builder-work `labor` by one swing — the `construct` atomic's effect, applied by
 * the AtomicSystem when a builder completes a build swing. A swing is one hammer strike:
 * `ONE / (totalConstructionUnits · STRIKES_PER_UNIT)` of the build, so a site rises a little per strike and the
 * strike count scales with the building's size via its cost (see {@link STRIKES_PER_UNIT}); clamped so `labor`
 * never exceeds the delivered-material fraction (nor ONE) — a swing can only install material that is actually
 * on hand. A free (empty-cost) type has nothing to install — a single swing completes it. A no-op on a building
 * that is no longer a construction site (finished this tick, or demolished).
 */
export function advanceConstructionLabor(world: World, ctx: SystemContext, site: Entity): void {
  const uc = world.tryGet(site, UnderConstruction);
  if (uc === undefined) return; // struck a finished/removed site — nothing to advance
  const totalStrikes = constructionTotalUnits(world, ctx, site) * STRIKES_PER_UNIT;
  // At least 1 ULP per strike so even an (unrealistically) huge-cost building still finishes rather than
  // stalling on a quantum that truncated to zero: `trunc(ONE / totalStrikes)` floors to 0 once
  // `totalStrikes > ONE`. Inert for real content (the 4-unit base home is 104 strikes → quantum ~630).
  const quantum = totalStrikes > 0 ? (Math.max(1, fx.div(ONE, fx.fromInt(totalStrikes))) as Fixed) : ONE;
  // Cap the swing at the delivered-material fraction: quantum truncation would otherwise park `labor` a
  // hair above `delivered`, and `built = min(labor, delivered)` would then jump when the next material
  // lands rather than when a swing lands. With the cap, `built` always equals `labor` while rising, so the
  // percentage moves only as hammer swings complete.
  const delivered = deliveredConstructionFraction(world, ctx, site);
  const cap = delivered < ONE ? delivered : ONE;
  const advanced = fx.add(uc.labor, quantum);
  uc.labor = (advanced > cap ? cap : advanced) as Fixed;
}
