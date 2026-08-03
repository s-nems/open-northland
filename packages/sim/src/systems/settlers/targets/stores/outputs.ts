import { Stockpile, sameSideAs, stockpileEntries, UnderConstruction } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { mergedRecipeOf } from '../../../stores/index.js';
import { type InteractionCellIndex, qualifiedGood } from '../cell-index.js';

/**
 * Whether any workplace holds a haulable output this tick, the population-level dormancy gate for
 * {@link nearestWorkplaceOutput}. It applies the same "holds an output" test as that scan's inner loop,
 * so a false here means every per-settler scan would return null. It is deliberately weaker (no "a store
 * can take it" check), so a true still runs the real scan and only a provably empty scan is elided.
 */
export function hasHaulableOutput(world: World, ctx: SystemContext, stockpiles: readonly Entity[]): boolean {
  for (const e of stockpiles) {
    if (world.has(e, UnderConstruction)) continue; // a site's stock is construction material, not output
    const recipe = mergedRecipeOf(world, ctx, e);
    if (recipe === undefined) continue;
    const stock = world.get(e, Stockpile);
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount > 0 && recipe.outputs.some((o) => o.goodType === goodType)) return true;
    }
  }
  return false;
}

/**
 * The nearest workplace with a finished output good a carrier should haul away, with the good to haul,
 * or null when nothing needs hauling. A candidate is a building whose type carries a recipe, so a
 * stocked good is finished output rather than a passive store's reserve. The `deliverable` check keeps
 * the carrier from picking up a good it could never deliver and would shuttle back and forth.
 */
export function nearestWorkplaceOutput(
  index: InteractionCellIndex,
  deliverable: (goodType: number) => boolean,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  /** The carrier's owning player. It never hauls another player's workplace output. */
  owner: number | undefined,
  /** The carrier's signpost confinement: an out-of-area workplace is not one it fetches from. */
  gate?: SpatialGate,
  /** The carrier's failed-goal veto. */
  avoid?: (cell: NodeId) => boolean,
): { workplace: Entity; goodType: number } | null {
  // The good that qualified the winner is the good it hauls.
  const winner = index.nearest(
    here,
    (e) => qualifiedGood(haulableOutputGood(world, ctx, deliverable, e)),
    gate,
    avoid,
    sameSideAs(world, owner),
  );
  return winner === null ? null : { workplace: winner.entity, goodType: winner.payload };
}

/** The lowest-goodType output a workplace stocks that its recipe produces and the carrier could deliver,
 *  or null. Canonical order, and side-effect-free so the ring may re-evaluate it on the fallback scan. */
function haulableOutputGood(
  world: World,
  ctx: SystemContext,
  deliverable: (goodType: number) => boolean,
  entity: Entity,
): number | null {
  // A construction site's stock is its delivered materials, never finished output: an upgrading sawmill
  // would otherwise offer its own construction wood as a recipe output and a carrier would strip it.
  if (world.has(entity, UnderConstruction)) return null;
  const recipe = mergedRecipeOf(world, ctx, entity);
  if (recipe === undefined) return null; // not a workplace - passive stores aren't hauled from
  for (const [goodType, amount] of stockpileEntries(world.get(entity, Stockpile))) {
    if (amount <= 0) continue;
    if (!recipe.outputs.some((o) => o.goodType === goodType)) continue; // only haul outputs
    if (!deliverable(goodType)) continue; // no reachable sink
    return goodType;
  }
  return null;
}
