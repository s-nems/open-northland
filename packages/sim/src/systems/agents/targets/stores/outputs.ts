import { Stockpile, stockpileEntries } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import type { SpatialGate } from '../../../node-metric.js';
import { recipeOf } from '../../../stores/index.js';
import type { InteractionCellIndex } from '../cell-index.js';
import type { SinkAvailability } from './sinks.js';

/**
 * Whether ANY workplace holds a haulable output this tick — a producing {@link Building} ({@link recipeOf}
 * defined) whose {@link Stockpile} holds ≥1 unit of one of its recipe outputs. The population-level gate
 * for {@link nearestWorkplaceOutput}: if this is false no carrier can haul, so idle settlers skip the
 * per-settler scan entirely (the same "holds an output" test the scan's inner loop applies, so a false
 * here means every scan would return null — identical behavior, done once instead of per settler). It is
 * deliberately WEAKER than the full scan (no "a store can take it" check): a true still runs the real
 * scan, which returns null if delivery is impossible — the gate only ever elides a provably-empty scan.
 */
export function hasHaulableOutput(world: World, ctx: SystemContext, stockpiles: readonly Entity[]): boolean {
  for (const e of stockpiles) {
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue;
    const stock = world.get(e, Stockpile);
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount > 0 && recipe.outputs.some((o) => o.goodType === goodType)) return true;
    }
  }
  return false;
}

/**
 * The nearest workplace with a finished output good a carrier should haul away to a store. A
 * candidate is a {@link Building} with a {@link Stockpile} whose building type carries a `recipe`
 * (it is a workplace, so a stocked good is finished output, not a passive store's reserve), holding
 * at least one unit of one of its recipe's output goods that a *different* store can stock. Returns
 * the workplace and the specific good to haul, or null if nothing needs hauling.
 *
 * Determinism: workplaces are scanned in canonical entity-id order with a Manhattan-distance +
 * ascending-cell-id tie-break; within a workplace the good is chosen by canonical (ascending
 * goodType) order via {@link stockpileEntries} — never raw Map insertion order. The "some other
 * store can take it" check ({@link nearestStoreFor}) keeps the carrier from picking up a good it
 * could never deliver (which would just shuttle it back and forth).
 */
export function nearestWorkplaceOutput(
  index: InteractionCellIndex,
  sinks: SinkAvailability,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  /** The carrier's signpost confinement — an out-of-area workplace is not one it fetches from. */
  gate?: SpatialGate,
): { workplace: Entity; goodType: number } | null {
  // The stockpile index holds every Stockpile+Position candidate; only workplaces with a deliverable output
  // pass `accept`, and the winner's good is re-derived by the same canonical rule below.
  const winner = index.nearest(here, (e) => haulableOutputGood(world, ctx, sinks, e) !== null, gate);
  if (winner === null) return null;
  const goodType = haulableOutputGood(world, ctx, sinks, winner.entity);
  return goodType === null ? null : { workplace: winner.entity, goodType };
}

/** The lowest-goodType output a workplace currently stocks (>0), that its recipe produces and some OTHER
 *  store can take ({@link SinkAvailability}) — or null when the entity is not a workplace holding a
 *  deliverable output. Canonical (ascending goodType via {@link stockpileEntries}) so the chosen good never
 *  depends on Map insertion history; side-effect-free, so the ring may re-evaluate it on the fallback scan. */
function haulableOutputGood(
  world: World,
  ctx: SystemContext,
  sinks: SinkAvailability,
  entity: Entity,
): number | null {
  const recipe = recipeOf(world, ctx, entity);
  if (recipe === undefined) return null; // not a workplace — passive stores aren't hauled FROM
  for (const [goodType, amount] of stockpileEntries(world.get(entity, Stockpile))) {
    if (amount <= 0) continue;
    if (!recipe.outputs.some((o) => o.goodType === goodType)) continue; // only haul outputs
    if (!sinks.has(goodType)) continue; // no store can take it — never pick a good it couldn't deliver
    return goodType;
  }
  return null;
}
