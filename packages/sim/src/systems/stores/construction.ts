import type { BuildingType } from '@open-northland/data';
import {
  Building,
  type GoodsLine,
  holdsAll,
  Palisade,
  Stockpile,
  Upgrading,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { type InboundSupplyTally, inboundSupplyOf } from './supply-tally.js';

/**
 * The next level in `type`'s upgrade chain, or undefined for a top-level or unchained type. Source basis:
 * extracted - the `[GfxHouse]` record's `LogicType` table gives the typeId at the next `sizeIdx`; the
 * wonder maps every size level to one typeId, a self-link the extractor skips.
 */
export function upgradeTierOf(type: BuildingType, ctx: SystemContext): BuildingType | undefined {
  if (type.upgradeTarget === undefined) return undefined;
  return contentIndex(ctx.content).buildings.get(type.upgradeTarget);
}

/**
 * The material cost of raising a building: a plain site carries its type's from-scratch bill, merged over
 * every chain stage for a leveled type, while an {@link Upgrading} building costs the target tier's own
 * `construction`, the level difference the source encodes per tier.
 */
export function constructionBillOf(world: World, ctx: SystemContext, site: Entity): readonly GoodsLine[] {
  const wall = world.tryGet(site, Palisade);
  if (wall !== undefined) return wall.repairing ? EMPTY_CONSTRUCTION : wall.construction;
  const b = world.tryGet(site, Building);
  if (b === undefined) return EMPTY_CONSTRUCTION;
  if (world.has(site, Upgrading)) {
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined) return EMPTY_CONSTRUCTION;
    return upgradeTierOf(type, ctx)?.construction ?? EMPTY_CONSTRUCTION;
  }
  return contentIndex(ctx.content).constructionBillByBuilding.get(b.buildingType) ?? EMPTY_CONSTRUCTION;
}

/** The civilization whose builders may raise this site, independent of the structure kind. */
export function constructionTribeOf(world: World, site: Entity): number | undefined {
  return world.tryGet(site, Building)?.tribe ?? world.tryGet(site, Palisade)?.tribe;
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
 * Every `construction` material a site still lacks, each line's shortfall net of the {@link inboundSupplyOf}
 * tally. Ordered least-covered first so a crew spreads over different materials instead of queueing on one,
 * ties broken by ascending goodType so the order never depends on map insertion order.
 */
export function neededConstructionGoods(
  world: World,
  ctx: SystemContext,
  site: Entity,
  inbound: InboundSupplyTally,
): ReadonlyArray<{ goodType: number; amount: number }> {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  const shortfalls: Array<{ goodType: number; amount: number; covered: number; need: number }> = [];
  for (const line of constructionBillOf(world, ctx, site)) {
    const held = Math.max(stock?.get(line.goodType) ?? 0, 0);
    const covered = Math.min(held + inboundSupplyOf(inbound, site, line.goodType), line.amount);
    if (covered >= line.amount) continue;
    shortfalls.push({ goodType: line.goodType, amount: line.amount - covered, covered, need: line.amount });
  }
  shortfalls.sort((a, b) => a.covered * b.need - b.covered * a.need || a.goodType - b.goodType);
  return shortfalls.map(({ goodType, amount }) => ({ goodType, amount }));
}
