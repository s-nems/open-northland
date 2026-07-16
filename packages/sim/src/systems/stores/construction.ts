import { Building, type GoodsLine, holdsAll, Stockpile } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { type InboundSupplyTally, inboundSupplyOf } from './supply-tally.js';

// Construction-material accounting: what a site's `construction` cost demands, how much is delivered,
// and the next good a builder must fetch. Read by the ConstructionSystem, the builder drive, and the
// store capacity math (a site advertises room for exactly its outstanding materials).

/** The material cost of raising a building entity FROM SCRATCH — its type's from-scratch construction
 *  bill (for a home tier, the merged cost of every chain stage up to it — see
 *  {@link import('../../core/content-index.js').ContentIndex.constructionBillByBuilding}) — or an empty
 *  list when the entity is not a typed building (a bare fixture) or its type declares no cost (a free
 *  type). The shared read behind {@link deliveredConstructionFraction},
 *  {@link constructionMaterialsPresent}, {@link nextNeededConstructionGood}, and {@link constructionTotalUnits}. */
export function constructionBillOf(world: World, ctx: SystemContext, site: Entity): readonly GoodsLine[] {
  const b = world.tryGet(site, Building);
  if (b === undefined) return EMPTY_CONSTRUCTION;
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
 * The `construction` material a site still lacks, with the unclaimed shortfall (`need − held − inbound`)
 * — the good, and how much, a builder fetches to keep its OWN site supplied — or null when every
 * material is on hand or already inbound (the `inbound` tally, {@link inboundSupplyOf}). Picks the
 * LEAST-COVERED line (`(held+inbound)/need`, compared by integer cross-multiplication), so a crew spreads
 * over different materials instead of queueing on the first one; ties keep the ascending-goodType scan's
 * first hit, so the pick never depends on Map insertion order.
 */
export function nextNeededConstructionGood(
  world: World,
  ctx: SystemContext,
  site: Entity,
  inbound: InboundSupplyTally,
): { goodType: number; amount: number } | null {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  const cost = [...constructionBillOf(world, ctx, site)].sort((a, b) => a.goodType - b.goodType);
  let best: { goodType: number; amount: number } | null = null;
  let bestCovered = 0;
  let bestNeed = 1;
  for (const line of cost) {
    const held = Math.max(stock?.get(line.goodType) ?? 0, 0);
    const covered = Math.min(held + inboundSupplyOf(inbound, site, line.goodType), line.amount);
    if (covered >= line.amount) continue; // fully on hand or inbound
    if (best === null || covered * bestNeed < bestCovered * line.amount) {
      best = { goodType: line.goodType, amount: line.amount - covered };
      bestCovered = covered;
      bestNeed = line.amount;
    }
  }
  return best;
}
