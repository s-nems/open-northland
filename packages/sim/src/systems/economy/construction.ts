import {
  Building,
  consumeGoods,
  type GoodsLine,
  Health,
  Stockpile,
  setStockAmount,
  stockpileEntries,
  UnderConstruction,
  Upgrading,
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
  upgradeTierOf,
} from '../stores/index.js';
import { destroyBerryBushesInReserved } from './berries.js';
import { destroyFieldsUnderBuilding } from './farming.js';
import { evictLooseGoodsFromFootprint } from './goods-evict.js';
import { destroyStumpsInReserved } from './stumps.js';

/**
 * ConstructionSystem — raise a placed foundation into a finished building as builders work it.
 *
 * A building placed `underConstruction` (via {@link placeBuilding}) enters at `built = 0` carrying an
 * {@link UnderConstruction} marker (its own {@link Stockpile} is the delivered-material hold) and — when its
 * type has a hitpoints pool — a {@link Health} pool that ramps up with the build. Each tick, for every
 * construction site, the visible `Building.built` is the lower of two independent gates — builder work
 * ({@link UnderConstruction.labor}, advanced a swing at a time by the `construct` atomic) and delivered
 * material ({@link deliveredConstructionFraction} — Σ delivered / Σ needed). So a site only rises as fast as
 * both a builder hammers and material lands: deliver 3 of 10 units → build caps at 30% until more arrives;
 * hammer nothing → build stays at the grey foundation however much material sits on it. Its `Health` ramps to
 * `built · max` (floored at 1 so a foundation is never a 0-HP corpse the CleanupSystem would reap). The site
 * finishes the tick its builder work is complete (`labor >= ONE`, or a free empty-cost type) and every
 * material is present: the cost is consumed (spent into the structure — goods conserved), `built` flips to
 * ONE, the marker is removed, `Health` fills to max, and `buildingFinished` fires. Surplus material beyond
 * the cost stays in the hold.
 *
 * An **upgrade site** ({@link Upgrading} beside the marker — opened by the `upgradeBuilding` command, never
 * spontaneously) runs the same rise, with three differences: its bill is the target tier's own
 * `construction` (the level difference — {@link constructionBillOf}), its `Health` is NOT ramped (the old
 * building still stands at its standing HP; ramping by `built` would drop a whole house to 1 HP — named
 * approximation, the original's upgrade HP behavior is unobserved), and finishing additionally adopts the
 * target tier (`buildingType`/`level`), merges the stashed pre-upgrade inventory back into the stockpile,
 * lifts the `Health` pool to the new tier's max, and fires `buildingUpgraded` instead of `buildingFinished`.
 *
 * Who delivers the materials and who hammers is the AI planner: a construction site advertises its
 * outstanding materials as delivery demand ({@link import('../stores/index.js').stockCapacity}) so any
 * carrier routes them there, and the builder drive ({@link import('../agents/economy/index.js').planBuilder})
 * both hammers the site and — when it runs dry — fetches a missing material itself.
 *
 * Source basis: the site-then-build flow, the per-tier material cost (`construction`, graphics-table
 * `LogicConstructionGoods`), the level chain (`upgradeTarget`, the record's `LogicType` table), and the
 * per-building max HP (`logichitpoints`) are extracted/faithful; the upgrade re-opening the building as a
 * site with a separate build store and kept occupants is observed original behavior; the builder-driven pace
 * (several hammer strikes per unit) and the consume-when-complete behavior are our design (the engine's
 * build/upgrade loop has no oracle). A directly-placed higher tier paying its whole cumulative chain bill is
 * our design invariant (the original only ever upgrades into higher tiers, so direct tier-N placement is an
 * OpenNorthland capability priced to the tier-1-then-upgrade total — see `constructionBillOf`).
 * Determinism: buildings are visited in the Building store's insertion order, every decision reads content +
 * the site's own components, and every stockpile write goes through the canonical Map.
 */
export const constructionSystem: System = (world, ctx) => {
  for (const e of world.query(Building, Stockpile)) {
    if (!world.has(e, UnderConstruction)) continue; // built (or inert unmigrated fixture) — nothing to raise
    const building = world.get(e, Building);
    // A type absent from content has an empty bill and a zero labor total, which would read as
    // "complete" and finish the site for free — a malformed-content site stays inert instead.
    if (!contentIndex(ctx.content).buildings.has(building.buildingType)) continue;
    advanceSite(world, ctx, e, building, constructionBillOf(world, ctx, e));
  }
};

/** The {@link Building} component's value — what `world.get(e, Building)` hands back. */
type BuildingState = NonNullable<(typeof Building)['__value']>;

/**
 * Advance one construction site this tick: reflect builder work + delivered material into `built` (and,
 * for a from-scratch site, `Health`), and finish the build when both gates are complete. `cost` is the
 * site's bill ({@link constructionBillOf} — cumulative from-scratch, or the upgrade difference), spent
 * into the structure on completion.
 */
function advanceSite(
  world: World,
  ctx: SystemContext,
  e: Entity,
  building: BuildingState,
  cost: ReadonlyArray<{ goodType: number; amount: number }>,
): void {
  const labor = world.get(e, UnderConstruction).labor;
  // A free (empty-cost) type has nothing to install — its labor requirement is waived so it finishes at
  // once (the headquarters/wonder path). Otherwise the build is done only when fully hammered.
  const laborComplete = constructionTotalUnits(world, ctx, e) === 0 || labor >= ONE;
  if (laborComplete && constructionMaterialsPresent(world, ctx, e)) {
    consumeMaterials(world, e, cost); // spend the cost into the structure (surplus stays)
    finishSite(world, ctx, e, building);
    return;
  }

  // Still rising: built is the lower of builder work and delivered material (the two gates). An upgrade
  // site keeps its standing Health while the new tier rises over it (see the system doc).
  const delivered = deliveredConstructionFraction(world, ctx, e);
  building.built = labor < delivered ? labor : delivered;
  if (!world.has(e, Upgrading)) setHealth(world, e, building.built);
}

/**
 * Flip one construction site to finished — the shared tail of the organic {@link advanceSite} completion
 * and the debug {@link forceFinishConstruction}, kept in one place so the "a site becomes a building"
 * transition can't drift between the two. For an upgrade site it additionally adopts the target tier:
 * `buildingType` becomes the target, `level` increments, the stashed pre-upgrade inventory merges back
 * into the stockpile (goods conserved — the build hold's surplus and the old inventory coexist), the
 * `Health` pool takes the new tier's max, and the footprint is re-evicted (the larger tier may enclose
 * cells settlers stood on). Emits `buildingUpgraded` for an upgrade, `buildingFinished` otherwise.
 */
function finishSite(world: World, ctx: SystemContext, e: Entity, building: BuildingState): void {
  const upgrading = world.tryGet(e, Upgrading);
  let adoptedTier = false;
  if (upgrading !== undefined) {
    const type = contentIndex(ctx.content).buildings.get(building.buildingType);
    const target = type === undefined ? undefined : upgradeTierOf(type, ctx);
    // The command validated the chain at start; content is immutable per sim, so target is present. The
    // guard keeps a malformed-content world from crashing: the site then finishes as its old tier
    // (reported as a plain finish — no tier was adopted, so `buildingUpgraded` would lie).
    if (target !== undefined) {
      adoptedTier = true;
      building.buildingType = target.typeId;
      building.level += 1;
      // The in-place type swap changes every buildingType-derived answer (stock slots, recipe, produces)
      // — log the value write so version-keyed caches (porter dormancy) re-scan.
      world.touchComponent(Building);
      const health = world.tryGet(e, Health);
      if (health !== undefined && target.hitpoints !== undefined) health.max = target.hitpoints;
    }
    // Restore the stashed pre-upgrade inventory into the (now post-build) stockpile, canonical order.
    const amounts = world.get(e, Stockpile).amounts;
    for (const [goodType, amount] of stockpileEntries({ amounts: upgrading.savedStock })) {
      setStockAmount(world, amounts, goodType, (amounts.get(goodType) ?? 0) + amount);
    }
    world.remove(e, Upgrading);
  }
  building.built = ONE; // built — production / housing now count it
  world.remove(e, UnderConstruction); // a finished building is a plain Building again
  setHealth(world, e, ONE); // full life (an upgrade fills the new tier's larger pool)
  // A settler that strayed onto the plot during the build (a stale route, a spawn) must not be
  // left standing inside the finished walls — nor a pile set down there mid-build, nor one an
  // upgraded tier's larger footprint newly encloses. Bushes and stumps get the placement treatment
  // too: the reserved zone is per TIER (unlike the family-constant flag body), so an upgraded tier
  // can grow over decor the level-0 placement never covered. Work flags alone need no re-pass — flag
  // legality is family-body-wide from the moment the Building appears (see evictWorkFlagsFromFootprint).
  evictSettlersFromFootprint(world, ctx, e);
  evictLooseGoodsFromFootprint(world, ctx, e);
  destroyBerryBushesInReserved(world, ctx, e);
  destroyStumpsInReserved(world, ctx, e);
  // Fields the same way, and for the same per-tier reason — an upgrade never re-runs the placement gate
  // that would have rejected the site, so its grown walls can close over a plot sown beside the old ones.
  destroyFieldsUnderBuilding(world, ctx, e);
  ctx.events.emit(
    adoptedTier
      ? { kind: 'buildingUpgraded', entity: e, level: building.level }
      : { kind: 'buildingFinished', entity: e },
  );
}

/**
 * Force a construction site straight to finished — the `debugCompleteConstruction` command's effect, kept
 * here so the "a site becomes a building" transition lives in one module (the debug path and the organic
 * {@link advanceSite} finish share {@link finishSite}). Skips both gates: unlike the organic finish it does
 * not require delivered material or completed labor, and it does not consume the material cost (a cheat
 * leaves any delivered goods as harmless surplus rather than risk spending a cost that isn't there). An
 * upgrade site force-finishes into its target tier, stash restored, like the organic path. A `site` without
 * an {@link UnderConstruction} marker is a no-op.
 */
export function forceFinishConstruction(world: World, ctx: SystemContext, site: Entity): void {
  if (!world.has(site, UnderConstruction)) return; // not a site (built already, or wrong kind) — no-op
  finishSite(world, ctx, site, world.get(site, Building));
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

/** Remove the `cost` materials from a building's stockpile (spent into the structure / upgrade). The
 *  caller has verified every material is present in full via {@link constructionMaterialsPresent}. */
function consumeMaterials(world: World, building: Entity, cost: readonly GoodsLine[]): void {
  consumeGoods(world, world.get(building, Stockpile).amounts, cost);
}

/**
 * Hammer strikes a builder sinks into each unit of construction material. A build swing is a small step —
 * `ONE / (units · this)` of the work, not a whole unit installed — so a builder visibly works a foundation up
 * over many strikes, and the total strikes to raise a building scale with its size through its material cost
 * (a bigger house costs more units → proportionally more swings, and a directly-placed higher tier pays
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
