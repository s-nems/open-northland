import { Building, holdsAll, Stockpile, SupplyRun } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

// Construction-material accounting: what a site's `construction` cost demands, how much is delivered,
// and the next good a builder must fetch. Read by the ConstructionSystem, the builder drive, and the
// store capacity math (a site advertises room for exactly its outstanding materials).

/** The `construction` material cost of a building entity's type — the goods that must be delivered and
 *  hammered in to raise it — or an empty list when the entity is not a typed building (a bare fixture)
 *  or its type declares no cost (a free type). The shared read behind {@link deliveredConstructionFraction},
 *  {@link constructionMaterialsPresent}, {@link nextNeededConstructionGood}, and {@link constructionTotalUnits}. */
function constructionCostOf(
  world: World,
  ctx: SystemContext,
  site: Entity,
): readonly { goodType: number; amount: number }[] {
  const b = world.tryGet(site, Building);
  if (b === undefined) return EMPTY_CONSTRUCTION;
  return contentIndex(ctx.content).buildings.get(b.buildingType)?.construction ?? EMPTY_CONSTRUCTION;
}

const EMPTY_CONSTRUCTION: readonly { goodType: number; amount: number }[] = [];

/** Total material units a construction site's cost sums to (Σ amount) — the denominator the delivered
 *  fraction and the per-swing labor quantum divide against. 0 for a free (empty-cost) type. */
export function constructionTotalUnits(world: World, ctx: SystemContext, site: Entity): number {
  let units = 0;
  for (const line of constructionCostOf(world, ctx, site)) units += line.amount;
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
  for (const line of constructionCostOf(world, ctx, site)) {
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
  return holdsAll(world.tryGet(site, Stockpile)?.amounts, constructionCostOf(world, ctx, site));
}

/**
 * Units of `goodType` already COMMITTED toward `site` by settlers' live supply errands ({@link SupplyRun}
 * — a builder walking to fetch it, or a hauler carrying it over) — the in-flight amount the outstanding
 * need must subtract so idle builders don't race to fetch the same last unit. A commutative sum over the
 * SupplyRun store, so store order can't leak into the result.
 */
export function inboundSupply(world: World, site: Entity, goodType: number): number {
  let inbound = 0;
  for (const e of world.query(SupplyRun)) {
    const run = world.get(e, SupplyRun);
    if (run.site === site && run.goodType === goodType) inbound += run.amount;
  }
  return inbound;
}

/**
 * The `construction` material a site still lacks, with the unclaimed shortfall (`need − held − inbound`)
 * — the good, and how much, a builder fetches to keep its OWN site supplied — or null when every
 * material is on hand or already inbound ({@link inboundSupply}). Picks the LEAST-COVERED line
 * (`(held+inbound)/need`, compared by integer cross-multiplication), so a crew spreads over different
 * materials instead of queueing on the first one; ties keep the ascending-goodType scan's first hit, so
 * the pick never depends on Map insertion order.
 */
export function nextNeededConstructionGood(
  world: World,
  ctx: SystemContext,
  site: Entity,
): { goodType: number; amount: number } | null {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  const cost = [...constructionCostOf(world, ctx, site)].sort((a, b) => a.goodType - b.goodType);
  let best: { goodType: number; amount: number } | null = null;
  let bestCovered = 0;
  let bestNeed = 1;
  for (const line of cost) {
    const held = Math.max(stock?.get(line.goodType) ?? 0, 0);
    const covered = Math.min(held + inboundSupply(world, site, line.goodType), line.amount);
    if (covered >= line.amount) continue; // fully on hand or inbound
    if (best === null || covered * bestNeed < bestCovered * line.amount) {
      best = { goodType: line.goodType, amount: line.amount - covered };
      bestCovered = covered;
      bestNeed = line.amount;
    }
  }
  return best;
}
