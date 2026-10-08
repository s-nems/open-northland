import type { BuildingType } from '@open-northland/data';
import {
  Building,
  type GoodsLine,
  holdsAll,
  Palisade,
  RoadSite,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext, SystemContext } from '../context.js';
import type { SupplyTally } from './supply-tally.js';

/**
 * The next level in `type`'s upgrade chain, or undefined for a top-level or unchained type. Source basis:
 * extracted - the `[GfxHouse]` record's `LogicType` table gives the typeId at the next `sizeIdx`; the
 * wonder maps every size level to one typeId, a self-link the extractor skips.
 */
export function upgradeTierOf(type: BuildingType, ctx: ContentContext): BuildingType | undefined {
  if (type.upgradeTarget === undefined) return undefined;
  return contentIndex(ctx.content).buildings.get(type.upgradeTarget);
}

/**
 * The material cost of raising a building: a plain site carries its type's from-scratch bill, merged over
 * every chain stage for a leveled type, while an {@link Upgrading} building costs the target tier's own
 * `construction`, the level difference the source encodes per tier.
 */
export function constructionBillOf(world: World, ctx: ContentContext, site: Entity): readonly GoodsLine[] {
  const solo = world.tryGet(site, Palisade) ?? world.tryGet(site, RoadSite);
  if (solo !== undefined) return solo.construction;
  const b = world.tryGet(site, Building);
  if (b === undefined) return EMPTY_CONSTRUCTION;
  if (world.has(site, Upgrading)) {
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined) return EMPTY_CONSTRUCTION;
    return upgradeTierOf(type, ctx)?.construction ?? EMPTY_CONSTRUCTION;
  }
  return contentIndex(ctx.content).constructionBillByBuilding.get(b.buildingType) ?? EMPTY_CONSTRUCTION;
}

/** A razed standing building gives back each bill line divided by this, rounded up. */
const RAZE_SALVAGE_DIVISOR = 2;

/**
 * The materials a building leaves when it comes down, on top of its hold: half of each line of the
 * standing house's from-scratch bill, rounded up, whether combat razed it or its owner demolished it. A
 * plain site pays its bill only at completion, so its delivered hold is all it leaves; an upgrading house
 * still stands under its site and salvages as its current tier.
 *
 * Source basis: remembered behavior of the original, not confirmed against the running original.
 */
export function razeSalvageOf(world: World, ctx: ContentContext, building: Entity): readonly GoodsLine[] {
  const b = world.tryGet(building, Building);
  if (b === undefined) return EMPTY_CONSTRUCTION;
  if (world.has(building, UnderConstruction) && !world.has(building, Upgrading)) return EMPTY_CONSTRUCTION;
  const bill = contentIndex(ctx.content).constructionBillByBuilding.get(b.buildingType) ?? EMPTY_CONSTRUCTION;
  return bill.map((line) => ({
    goodType: line.goodType,
    amount: Math.ceil(line.amount / RAZE_SALVAGE_DIVISOR),
  }));
}

const EMPTY_CONSTRUCTION: readonly GoodsLine[] = [];

export function constructionTotalUnits(world: World, ctx: SystemContext, site: Entity): number {
  let units = 0;
  for (const line of constructionBillOf(world, ctx, site)) units += line.amount;
  return units;
}

/**
 * The delivered-material fraction of a construction site, 0..ONE, each line capped at its own need so an
 * over-delivery of one good cannot mask a missing other. This is the material cap on `Building.built`: the
 * ConstructionSystem sets `built = min(labor, this)`.
 */
export function deliveredConstructionFraction(world: World, ctx: SystemContext, site: Entity): Fixed {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  let needed = 0;
  let delivered = 0;
  for (const line of constructionBillOf(world, ctx, site)) {
    needed += line.amount;
    delivered += Math.min(Math.max(stock?.get(line.goodType) ?? 0, 0), line.amount);
  }
  if (needed <= 0) return ONE; // free type - trivially "fully delivered"
  return fx.div(fx.fromInt(delivered), fx.fromInt(needed));
}

/** Whether a site holds every `construction` material in full; a free type is trivially satisfied. */
export function constructionMaterialsPresent(world: World, ctx: SystemContext, site: Entity): boolean {
  return holdsAll(world.tryGet(site, Stockpile)?.amounts, constructionBillOf(world, ctx, site));
}

/**
 * Every `construction` material a site still lacks, each line's shortfall net of the units inbound to
 * it. Ordered least-covered first so a crew spreads over different materials instead of queueing on one,
 * ties broken by ascending goodType so the order never depends on map insertion order.
 */
export function neededConstructionGoods(
  world: World,
  ctx: SystemContext,
  site: Entity,
  supply: SupplyTally,
): ReadonlyArray<{ goodType: number; amount: number }> {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  const shortfalls: Array<{ goodType: number; amount: number; covered: number; need: number }> = [];
  for (const line of constructionBillOf(world, ctx, site)) {
    const held = Math.max(stock?.get(line.goodType) ?? 0, 0);
    const covered = Math.min(held + supply.inboundOf(site, line.goodType), line.amount);
    if (covered >= line.amount) continue;
    shortfalls.push({ goodType: line.goodType, amount: line.amount - covered, covered, need: line.amount });
  }
  shortfalls.sort((a, b) => a.covered * b.need - b.covered * a.need || a.goodType - b.goodType);
  return shortfalls.map(({ goodType, amount }) => ({ goodType, amount }));
}

/** Whether every line of `site`'s bill is on site or on its way under `supply`: nothing is left to fetch. */
export function constructionBillCovered(
  world: World,
  ctx: SystemContext,
  site: Entity,
  supply: SupplyTally,
): boolean {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  for (const line of constructionBillOf(world, ctx, site)) {
    const held = Math.max(stock?.get(line.goodType) ?? 0, 0);
    if (held + supply.inboundOf(site, line.goodType) < line.amount) return false;
  }
  return true;
}

/** Add to `goods` each good of `site`'s bill not yet on site in full, whatever is inbound: a superset of
 *  {@link neededConstructionGoods} under any tally. */
export function addUndeliveredConstructionGoods(
  world: World,
  ctx: ContentContext,
  site: Entity,
  goods: Set<number>,
): void {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  for (const line of constructionBillOf(world, ctx, site)) {
    if (Math.max(stock?.get(line.goodType) ?? 0, 0) < line.amount) goods.add(line.goodType);
  }
}
