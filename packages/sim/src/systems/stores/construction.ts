import type { BuildingType } from '@open-northland/data';
import { Building, type GoodsLine, holdsAll, Stockpile, Upgrading } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { type InboundSupplyTally, inboundSupplyOf } from './supply-tally.js';

// Construction-material accounting: what a site's `construction` cost demands, how much is delivered,
// and the next good a builder must fetch. Read by the ConstructionSystem, the builder drive, and the
// store capacity math (a site advertises room for exactly its outstanding materials).

/**
 * The next level in `type`'s upgrade chain, or undefined for a top-level / unchained type. The chain is
 * the extracted `upgradeTarget` join (the `[GfxHouse]` record's `LogicType` table — the typeId at the
 * next `sizeIdx`), so it is data-driven across every leveled kind: homes, storages, workplaces, the
 * tower, the wonder's stages. Undefined too when the target id is absent from content (malformed data).
 */
export function upgradeTierOf(type: BuildingType, ctx: SystemContext): BuildingType | undefined {
  if (type.upgradeTarget === undefined) return undefined;
  return contentIndex(ctx.content).buildings.get(type.upgradeTarget);
}

/**
 * The material cost of raising a building entity: for a plain site its type's FROM-SCRATCH construction
 * bill (for a leveled type, the merged cost of every chain stage up to it — see
 * {@link import('../../core/content-index.js').ContentIndex.constructionBillByBuilding}); for an
 * **upgrading** building ({@link Upgrading}) the target tier's OWN `construction` — the level
 * difference, which the source encodes per tier. Empty when the entity is not a typed building (a bare
 * fixture) or its type declares no cost (a free type). The shared read behind
 * {@link deliveredConstructionFraction}, {@link constructionMaterialsPresent},
 * {@link neededConstructionGoods}, {@link constructionTotalUnits}, and the site branch of
 * {@link import('./capacity.js').stockCapacity}.
 */
export function constructionBillOf(world: World, ctx: SystemContext, site: Entity): readonly GoodsLine[] {
  const b = world.tryGet(site, Building);
  if (b === undefined) return EMPTY_CONSTRUCTION;
  if (world.has(site, Upgrading)) {
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined) return EMPTY_CONSTRUCTION;
    return upgradeTierOf(type, ctx)?.construction ?? EMPTY_CONSTRUCTION;
  }
  return contentIndex(ctx.content).constructionBillByBuilding.get(b.buildingType) ?? EMPTY_CONSTRUCTION;
}

const EMPTY_CONSTRUCTION: readonly GoodsLine[] = [];

/** Total material units a construction site's cost sums to (Σ amount) — the denominator the delivered
 *  fraction and the per-swing labor quantum divide against. 0 for a free (empty-cost) type. */
export function constructionTotalUnits(world: World, ctx: SystemContext, site: Entity): number {
  let units = 0;
  for (const line of constructionBillOf(world, ctx, site)) units += line.amount;
  return units;
}

/**
 * The delivered-material fraction of a construction site, 0..ONE — Σ min(held, need) / Σ need over the
 * `construction` cost, each line capped at its own need so an over-delivery of one good can't mask a
 * missing other. ONE for a free (empty-cost) type. This is the MATERIAL cap on `Building.built`: the
 * ConstructionSystem sets `built = min(labor, this)`, and the builder drive hammers a site only while
 * its builder-work `labor` is below this fraction (there is material on hand to install).
 */
export function deliveredConstructionFraction(world: World, ctx: SystemContext, site: Entity): Fixed {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  let needed = 0;
  let delivered = 0;
  for (const line of constructionBillOf(world, ctx, site)) {
    needed += line.amount;
    delivered += Math.min(Math.max(stock?.get(line.goodType) ?? 0, 0), line.amount);
  }
  if (needed <= 0) return ONE; // free type — trivially "fully delivered"
  return fx.div(fx.fromInt(delivered), fx.fromInt(needed));
}

/** Whether a construction site holds every `construction` material in full (delivered fraction == ONE).
 *  A free (empty-cost) type is trivially satisfied. The completion gate the ConstructionSystem ANDs with
 *  a fully-hammered `labor`. */
export function constructionMaterialsPresent(world: World, ctx: SystemContext, site: Entity): boolean {
  return holdsAll(world.tryGet(site, Stockpile)?.amounts, constructionBillOf(world, ctx, site));
}

/**
 * Every `construction` material a site still lacks, with each line's unclaimed shortfall
 * (`need − held − inbound`, the `inbound` tally per {@link inboundSupplyOf}) — the fetch menu a builder
 * works through to keep its OWN site supplied. Ordered LEAST-COVERED first (`(held+inbound)/need`,
 * compared by integer cross-multiplication) so a crew spreads over different materials instead of
 * queueing on one; ties break by ascending goodType, so the order never depends on Map insertion order.
 * Empty when every material is on hand or already inbound.
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
    if (covered >= line.amount) continue; // fully on hand or inbound
    shortfalls.push({ goodType: line.goodType, amount: line.amount - covered, covered, need: line.amount });
  }
  shortfalls.sort((a, b) => a.covered * b.need - b.covered * a.need || a.goodType - b.goodType);
  return shortfalls.map(({ goodType, amount }) => ({ goodType, amount }));
}
