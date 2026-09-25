import {
  Building,
  CraftSelection,
  consumeGoods,
  type GoodsLine,
  Health,
  Palisade,
  PalisadeBlocking,
  Settler,
  Stockpile,
  setStockAmount,
  stockpileEntries,
  UnderConstruction,
  Upgrading,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { toolWorkFactorPct } from '../equipment/index.js';
import { evictSettlersFromFootprint } from '../movement/evict.js';
import { settleClosedWall, WallSiteOccupancy } from '../palisades/index.js';
import { dropLapsedClaim, holdsPalisadeClaim } from '../palisades/reservation.js';
import { buildStepsPerSwing, jobExperiencePercent } from '../progression/index.js';
import { assignedWorkers } from '../stores/assigned-workers.js';
import {
  constructionBillOf,
  constructionMaterialsPresent,
  constructionTotalUnits,
  deliveredConstructionFraction,
  isWorkplaceOperator,
  upgradeTierOf,
} from '../stores/index.js';
import { destroyBerryBushesInReserved } from './berries.js';
import { destroyFieldsUnderBuilding } from './fields.js';
import { evictLooseGoodsFromFootprint } from './goods-evict.js';
import { clearRepairedDamage } from './repair.js';
import { destroyStumpsInReserved } from './stumps.js';

/**
 * Raise placed foundations into finished buildings: a site finishes once builder labor and the delivered
 * material are both complete.
 *
 * Source basis: the level chain (`upgradeTarget`, the record's `LogicType` table) and the per-building max
 * HP (`logichitpoints`) are extracted. Consuming the cost at completion and a directly-placed higher tier
 * paying its whole cumulative chain bill are approximations. No construction-HP rule is readable
 * (`atomicanimations.ini`'s build atomic carries no CHANGE_HITPOINTS event), so the built-proportional
 * ceiling and the pool a finish opens with are approximations around one observed fact: a fresh foundation
 * falls to a single blow.
 */
export const constructionSystem: System = (world, ctx) => {
  const occupancy = new WallSiteOccupancy(world, ctx);
  // Sites only, in ascending id: the pass scales with what is being built, and two sites finishing on
  // one tick settle their plots in a canonical order.
  for (const e of world.canonicalQuery(UnderConstruction)) {
    if (!world.has(e, Stockpile)) continue;
    const wall = world.tryGet(e, Palisade);
    if (wall !== undefined) dropLapsedClaim(world, e);
    // A site drained to 0 HP earlier this tick is rubble awaiting the cleanupSystem; raising it here
    // would resurrect it swing after swing.
    const health = world.tryGet(e, Health);
    if (health !== undefined && health.hitpoints <= 0) continue;
    const building = world.tryGet(e, Building);
    if (building !== undefined) {
      // A type missing from content has an empty bill and a zero labor total, which would read as
      // complete and finish the site for free.
      if (!contentIndex(ctx.content).buildings.has(building.buildingType)) continue;
      advanceBuildingSite(world, ctx, e, building, constructionBillOf(world, ctx, e));
    } else if (wall !== undefined) {
      advanceWallSite(world, ctx, e, wall, constructionBillOf(world, ctx, e), occupancy);
    }
  }
};

type BuildingState = NonNullable<(typeof Building)['__value']>;
type PalisadeState = NonNullable<(typeof Palisade)['__value']>;

/** Advance one building site this tick. `cost` is the site's bill, spent into the structure on
 *  completion. */
function advanceBuildingSite(
  world: World,
  ctx: SystemContext,
  e: Entity,
  building: DeepReadonly<BuildingState>,
  cost: ReadonlyArray<{ goodType: number; amount: number }>,
): void {
  const labor = world.get(e, UnderConstruction).labor;
  // A free (empty-cost) type has nothing to install, so its labor requirement is waived.
  const laborComplete = constructionTotalUnits(world, ctx, e) === 0 || labor >= ONE;
  if (laborComplete && constructionMaterialsPresent(world, ctx, e)) {
    consumeMaterials(world, e, cost);
    finishBuilding(world, ctx, e, building);
    return;
  }
  const before = building.built;
  const next = builtProgress(world, ctx, e, labor);
  if (next === before) return; // mut only on a real move, or every idle site would churn version keys
  world.mut(e, Building).built = next;
  // An upgrade site keeps the standing building's Health; ramping by `built` would drop a whole house to
  // 1 HP (approximation - the original's upgrade HP behavior is unobserved).
  if (!world.has(e, Upgrading)) rampHealth(world, e, before, next);
}

/** Advance one wall site this tick. A hammered segment stands once no traveller is on its cells or on the
 *  joint seals it would make; whoever idles there is pushed off as it rises. */
function advanceWallSite(
  world: World,
  ctx: SystemContext,
  e: Entity,
  wall: DeepReadonly<PalisadeState>,
  cost: ReadonlyArray<{ goodType: number; amount: number }>,
  occupancy: WallSiteOccupancy,
): void {
  const labor = world.get(e, UnderConstruction).labor;
  if (labor >= ONE && constructionMaterialsPresent(world, ctx, e)) {
    if (ctx.terrain !== undefined && occupancy.travellerOnClosing(ctx.terrain, e)) return;
    consumeMaterials(world, e, cost);
    finishWall(world, ctx, e);
    return;
  }
  const before = wall.built;
  const next = builtProgress(world, ctx, e, labor);
  if (next === before) return;
  world.mut(e, Palisade).built = next;
  rampHealth(world, e, before, next);
}

/** A site's `built` fraction: its labor, capped by the delivered material. */
function builtProgress(world: World, ctx: SystemContext, e: Entity, labor: Fixed): Fixed {
  const delivered = deliveredConstructionFraction(world, ctx, e);
  return labor < delivered ? labor : delivered;
}

/** Raise a wall site: it starts blocking and settles the ground it closes. */
function finishWall(world: World, ctx: SystemContext, e: Entity): void {
  const wall = world.mut(e, Palisade);
  wall.built = ONE;
  wall.reservation = null;
  world.remove(e, UnderConstruction);
  world.add(e, PalisadeBlocking, {});
  if (ctx.terrain !== undefined) settleClosedWall(world, ctx, ctx.terrain, e);
  fillHealth(world, e);
}

/**
 * Flip one building site to finished. An upgrade site additionally adopts the target tier and merges
 * its stashed pre-upgrade inventory back into the stockpile, so the build hold's surplus and the old
 * inventory coexist rather than replace one another.
 */
function finishBuilding(
  world: World,
  ctx: SystemContext,
  e: Entity,
  building: DeepReadonly<BuildingState>,
): void {
  const upgrading = world.tryGet(e, Upgrading);
  let adoptedTier = false;
  if (upgrading !== undefined) {
    const type = contentIndex(ctx.content).buildings.get(building.buildingType);
    const target = type === undefined ? undefined : upgradeTierOf(type, ctx);
    // Malformed content only: the site then finishes as its old tier, reported as a plain finish.
    if (target !== undefined) {
      adoptedTier = true;
      preserveProductionChoices(world, ctx, e, building.buildingType, target.typeId);
      // The type swap changes every buildingType-derived answer, so it goes through the mut seam and
      // version-keyed caches re-scan.
      const b = world.mut(e, Building);
      b.buildingType = target.typeId;
      b.level += 1;
      const health = world.tryMut(e, Health);
      if (health !== undefined && target.hitpoints !== undefined) health.max = target.hitpoints;
    }
    // Canonical good order, so the merge cannot depend on the stashed map's insertion order.
    const amounts = world.get(e, Stockpile).amounts;
    for (const [goodType, amount] of stockpileEntries({ amounts: upgrading.savedStock })) {
      setStockAmount(world, e, goodType, (amounts.get(goodType) ?? 0) + amount);
    }
    world.remove(e, Upgrading);
  }
  world.mut(e, Building).built = ONE;
  world.remove(e, UnderConstruction);
  fillHealth(world, e);
  settleFootprint(world, ctx, e);
  ctx.events.emit(
    adoptedTier
      ? { kind: 'buildingUpgraded', entity: e, level: building.level }
      : { kind: 'buildingFinished', entity: e },
  );
}

/** Pin an implicit "all products" choice to the old tier's products when an upgrade adds recipes,
 * so workers start making the new products only after the player selects them. */
function preserveProductionChoices(
  world: World,
  ctx: SystemContext,
  building: Entity,
  oldType: number,
  newType: number,
): void {
  const recipes = contentIndex(ctx.content).recipeByProductByBuilding;
  const oldProducts = recipes.get(oldType);
  const newProducts = recipes.get(newType);
  if (oldProducts === undefined || newProducts === undefined) return;
  if (![...newProducts.keys()].some((good) => !oldProducts.has(good))) return;
  const retained = [...oldProducts.keys()].filter((good) => newProducts.has(good)).sort((a, b) => a - b);
  if (retained.length === 0) return;
  for (const worker of assignedWorkers(world, building)) {
    const jobType = world.tryGet(worker, Settler)?.jobType;
    if (jobType == null || !isWorkplaceOperator(world, ctx, building, jobType)) continue;
    const selection = world.tryGet(worker, CraftSelection);
    if (selection !== undefined && selection.goods.length > 0) continue;
    if (selection === undefined) world.add(worker, CraftSelection, { goods: retained.slice(), cursor: 0 });
    else world.mut(worker, CraftSelection).goods = retained.slice();
  }
}

/**
 * Clear a finished body's plot: settlers, piles and decor can occupy it during a build, and a larger
 * tier's reserved zone can grow over decor the smaller placement never covered. Work flags need no
 * re-pass: flag legality is family-body-wide from the moment the Building appears.
 */
export function settleFootprint(world: World, ctx: SystemContext, e: Entity): void {
  evictSettlersFromFootprint(world, ctx, e);
  evictLooseGoodsFromFootprint(world, ctx, e);
  destroyBerryBushesInReserved(world, ctx, e);
  destroyStumpsInReserved(world, ctx, e);
  destroyFieldsUnderBuilding(world, ctx, e);
}

/**
 * The `debugCompleteConstruction` command's effect: finish a site without either gate and without
 * consuming the material cost, so anything already delivered stays as surplus.
 */
export function forceFinishConstruction(world: World, ctx: SystemContext, site: Entity): void {
  if (!world.has(site, UnderConstruction)) return;
  const building = world.tryGet(site, Building);
  if (building !== undefined) finishBuilding(world, ctx, site, building);
  else if (world.has(site, Palisade)) finishWall(world, ctx, site);
}

/** Ramp a site's {@link Health} for a rise from `before` to `after`: the pool gains what the ceiling gained
 *  and is clamped to it, so a build that shrank never leaves the pool above the ceiling. */
function rampHealth(world: World, e: Entity, before: Fixed, after: Fixed): void {
  const health = world.tryMut(e, Health);
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
  const health = world.tryMut(e, Health);
  if (health !== undefined) health.hitpoints = health.max;
  clearRepairedDamage(world, e);
}

/** Spend the `cost` materials into the structure; the caller has verified
 *  {@link constructionMaterialsPresent}. */
function consumeMaterials(world: World, building: Entity, cost: readonly GoodsLine[]): void {
  consumeGoods(world, building, cost);
}

/**
 * Construction steps one unit of construction material takes to install, so the steps to raise a
 * building scale with its size through its material cost: the 4-unit base home takes 120. Original
 * behavior.
 */
const STEPS_PER_UNIT = 30;

/** Labor installed by one construction step at `site`. */
function constructionLaborPerStep(world: World, ctx: SystemContext, site: Entity): Fixed {
  // A wall segment rises in a single strike once its wood is in. Project rule, approximation: the readable
  // data gives no count.
  if (world.has(site, Palisade)) return ONE;
  const totalSteps = constructionTotalUnits(world, ctx, site) * STEPS_PER_UNIT;
  // At least 1 ULP per step so a huge-cost building still finishes: `trunc(ONE / totalSteps)` floors
  // to 0 once `totalSteps > ONE`.
  return totalSteps > 0 ? (Math.max(1, fx.div(ONE, fx.fromInt(totalSteps))) as Fixed) : ONE;
}

/**
 * Construction steps which can still install already-delivered material. Planner-tick claims subtract
 * from this count so a crew can work in parallel without assigning more builders than the current
 * material cap can use; a claim counts as one step, a bare-handed novice's swing.
 */
export function remainingConstructionSteps(world: World, ctx: SystemContext, site: Entity): number {
  const labor = world.tryGet(site, UnderConstruction)?.labor;
  if (labor === undefined) return 0;
  const delivered = deliveredConstructionFraction(world, ctx, site);
  const cap = delivered < ONE ? delivered : ONE;
  if (labor >= cap) return 0;
  return Math.ceil((cap - labor) / constructionLaborPerStep(world, ctx, site));
}

/**
 * Advance a site's builder-work `labor` by one hammer swing of `builder` - the `construct` atomic's
 * effect. A swing installs the steps the builder's experience and tool are worth. A free (empty-cost)
 * type has nothing to install, so a single swing completes it. A wall segment takes the swing only from
 * the one builder holding its claim.
 */
export function advanceConstructionLabor(
  world: World,
  ctx: SystemContext,
  site: Entity,
  builder: Entity,
): boolean {
  const uc = world.tryMut(site, UnderConstruction);
  if (uc === undefined) return false;
  const before = uc.labor;
  if (world.has(site, Palisade) && !holdsPalisadeClaim(world, site, builder)) return false;
  const steps = buildStepsPerSwing(
    jobExperiencePercent(world, ctx, builder, null),
    toolWorkFactorPct(world, ctx, builder),
  );
  const quantum = fx.mul(constructionLaborPerStep(world, ctx, site), fx.fromInt(steps));
  // Cap the swing at the delivered-material fraction, so `built = min(labor, delivered)` moves as swings
  // land rather than jumping when the next material arrives. Original behavior: the steps past the
  // delivered material are lost, not carried.
  const delivered = deliveredConstructionFraction(world, ctx, site);
  const cap = delivered < ONE ? delivered : ONE;
  const advanced = fx.add(uc.labor, quantum);
  uc.labor = (advanced > cap ? cap : advanced) as Fixed;
  return uc.labor > before;
}
