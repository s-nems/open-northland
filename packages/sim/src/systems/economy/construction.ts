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
import { destroyFieldsUnderBuilding } from './fields.js';
import { evictLooseGoodsFromFootprint } from './goods-evict.js';
import { destroyStumpsInReserved } from './stumps.js';

/**
 * Raise placed foundations into finished buildings: `built` is the lower of builder labor and the
 * delivered-material fraction, and a site finishes once both are complete.
 *
 * Source basis: the per-tier material cost (`construction`, graphics-table `LogicConstructionGoods`), the
 * level chain (`upgradeTarget`, the record's `LogicType` table), and the per-building max HP
 * (`logichitpoints`) are extracted; the upgrade re-opening a building as a site with a separate build store
 * and kept occupants is observed. The builder-driven pace, consuming the cost at completion, and a
 * directly-placed higher tier paying its whole cumulative chain bill are approximations. No construction-HP
 * rule is readable (`atomicanimations.ini`'s build atomic carries no CHANGE_HITPOINTS event), so the
 * built-proportional ceiling and the pool a finish opens with are approximations around one observed fact:
 * a fresh foundation falls to a single blow.
 */
export const constructionSystem: System = (world, ctx) => {
  for (const e of world.query(Building, Stockpile)) {
    if (!world.has(e, UnderConstruction)) continue;
    // A site drained to 0 HP earlier this tick is rubble awaiting the cleanupSystem; raising it here
    // would resurrect it swing after swing.
    const health = world.tryGet(e, Health);
    if (health !== undefined && health.hitpoints <= 0) continue;
    const building = world.get(e, Building);
    // A type missing from content has an empty bill and a zero labor total, which would read as complete
    // and finish the site for free.
    if (!contentIndex(ctx.content).buildings.has(building.buildingType)) continue;
    advanceSite(world, ctx, e, building, constructionBillOf(world, ctx, e));
  }
};

type BuildingState = NonNullable<(typeof Building)['__value']>;

/**
 * Advance one construction site this tick. `cost` is the site's bill (cumulative from scratch, or the
 * upgrade tier difference), spent into the structure on completion.
 */
function advanceSite(
  world: World,
  ctx: SystemContext,
  e: Entity,
  building: BuildingState,
  cost: ReadonlyArray<{ goodType: number; amount: number }>,
): void {
  const labor = world.get(e, UnderConstruction).labor;
  // A free (empty-cost) type has nothing to install, so its labor requirement is waived.
  const laborComplete = constructionTotalUnits(world, ctx, e) === 0 || labor >= ONE;
  if (laborComplete && constructionMaterialsPresent(world, ctx, e)) {
    consumeMaterials(world, e, cost);
    finishSite(world, ctx, e, building);
    return;
  }

  const delivered = deliveredConstructionFraction(world, ctx, e);
  const before = building.built;
  building.built = labor < delivered ? labor : delivered;
  // An upgrade site keeps the standing building's Health; ramping by `built` would drop a whole house to
  // 1 HP (approximation - the original's upgrade HP behavior is unobserved).
  if (!world.has(e, Upgrading)) rampHealth(world, e, before, building.built);
}

/**
 * Flip one construction site to finished. An upgrade site additionally adopts the target tier and merges
 * its stashed pre-upgrade inventory back into the stockpile, so the build hold's surplus and the old
 * inventory coexist rather than replace one another.
 */
function finishSite(world: World, ctx: SystemContext, e: Entity, building: BuildingState): void {
  const upgrading = world.tryGet(e, Upgrading);
  let adoptedTier = false;
  if (upgrading !== undefined) {
    const type = contentIndex(ctx.content).buildings.get(building.buildingType);
    const target = type === undefined ? undefined : upgradeTierOf(type, ctx);
    // The command validated the chain and content is immutable per sim, so this only catches malformed
    // content: the site then finishes as its old tier, reported as a plain finish.
    if (target !== undefined) {
      adoptedTier = true;
      // The type swap changes every buildingType-derived answer, so it goes through the write seam and
      // version-keyed caches re-scan.
      world.write(e, Building, (b) => {
        b.buildingType = target.typeId;
        b.level += 1;
      });
      const health = world.tryGet(e, Health);
      if (health !== undefined && target.hitpoints !== undefined) health.max = target.hitpoints;
    }
    // Restore the stashed pre-upgrade inventory into the post-build stockpile, in canonical good order.
    const amounts = world.get(e, Stockpile).amounts;
    for (const [goodType, amount] of stockpileEntries({ amounts: upgrading.savedStock })) {
      setStockAmount(world, e, goodType, (amounts.get(goodType) ?? 0) + amount);
    }
    world.remove(e, Upgrading);
  }
  building.built = ONE;
  world.remove(e, UnderConstruction);
  fillHealth(world, e);
  // Settlers, piles and decor can occupy the plot during a build, and an upgraded tier's reserved zone
  // can grow over decor the level-0 placement never covered. Work flags need no re-pass: flag legality
  // is family-body-wide from the moment the Building appears. A field never refused the site at all,
  // since it declares no build area.
  evictSettlersFromFootprint(world, ctx, e);
  evictLooseGoodsFromFootprint(world, ctx, e);
  destroyBerryBushesInReserved(world, ctx, e);
  destroyStumpsInReserved(world, ctx, e);
  destroyFieldsUnderBuilding(world, ctx, e);
  ctx.events.emit(
    adoptedTier
      ? { kind: 'buildingUpgraded', entity: e, level: building.level }
      : { kind: 'buildingFinished', entity: e },
  );
}

/**
 * The `debugCompleteConstruction` command's effect: finish a site without either gate and without
 * consuming the material cost, so anything already delivered stays as surplus.
 */
export function forceFinishConstruction(world: World, ctx: SystemContext, site: Entity): void {
  if (!world.has(site, UnderConstruction)) return;
  finishSite(world, ctx, site, world.get(site, Building));
}

/** Ramp a site's {@link Health} for a rise from `before` to `after`: the pool gains what the ceiling
 *  gained, clamped to it, so a build that shrank never leaves the pool above the ceiling. */
function rampHealth(world: World, e: Entity, before: Fixed, after: Fixed): void {
  const health = world.tryGet(e, Health);
  if (health === undefined) return;
  const ceiling = poolCeiling(after, health.max);
  const gained = Math.max(0, ceiling - poolCeiling(before, health.max));
  health.hitpoints = Math.min(ceiling, health.hitpoints + gained);
}

/** The hitpoints an undamaged site at `builtFraction` stands at, floored at 1 so a foundation is never a
 *  0-HP entity the CleanupSystem reaps on the tick it is placed. Exact integer arithmetic:
 *  `built · max / ONE` truncated, where `built` is a 0..ONE Fixed and `max` a plain integer. */
function poolCeiling(builtFraction: Fixed, max: number): number {
  return builtFraction >= ONE ? max : Math.max(1, Math.trunc((builtFraction * max) / ONE));
}

function fillHealth(world: World, e: Entity): void {
  const health = world.tryGet(e, Health);
  if (health !== undefined) health.hitpoints = health.max;
}

/** Spend the `cost` materials into the structure; the caller has verified every material is present in
 *  full via {@link constructionMaterialsPresent}. */
function consumeMaterials(world: World, building: Entity, cost: readonly GoodsLine[]): void {
  consumeGoods(world, building, cost);
}

/**
 * Hammer strikes a builder sinks into each unit of construction material, so the strikes to raise a
 * building scale with its size through its material cost. Approximation tuned to the original's observed
 * pace: the 4-unit base home takes about 100 strikes, a little under 1% of the build each.
 */
const STRIKES_PER_UNIT = 26;

/**
 * Advance a site's builder-work `labor` by one hammer strike - the `construct` atomic's effect. A free
 * (empty-cost) type has nothing to install, so a single swing completes it.
 */
export function advanceConstructionLabor(world: World, ctx: SystemContext, site: Entity): void {
  const uc = world.tryGet(site, UnderConstruction);
  if (uc === undefined) return;
  const totalStrikes = constructionTotalUnits(world, ctx, site) * STRIKES_PER_UNIT;
  // At least 1 ULP per strike so a huge-cost building still finishes: `trunc(ONE / totalStrikes)` floors
  // to 0 once `totalStrikes > ONE`.
  const quantum = totalStrikes > 0 ? (Math.max(1, fx.div(ONE, fx.fromInt(totalStrikes))) as Fixed) : ONE;
  // Cap the swing at the delivered-material fraction, so `built = min(labor, delivered)` moves as swings
  // land rather than jumping when the next material arrives.
  const delivered = deliveredConstructionFraction(world, ctx, site);
  const cap = delivered < ONE ? delivered : ONE;
  const advanced = fx.add(uc.labor, quantum);
  uc.labor = (advanced > cap ? cap : advanced) as Fixed;
}
