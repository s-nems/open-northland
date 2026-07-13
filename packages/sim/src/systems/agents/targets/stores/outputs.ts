import { Position, Stockpile, stockpileEntries } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { manhattan } from '../../../spatial.js';
import { recipeOf } from '../../../stores/index.js';
import { closer } from '../nearest.js';
import { interactionCell } from '../workplaces.js';
import { nearestStoreFor } from './stock.js';

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
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): { workplace: Entity; goodType: number } | null {
  let best: { workplace: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue; // not a workplace — passive stores aren't hauled FROM
    const stock = world.get(e, Stockpile);
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    // Canonical (ascending goodType) so the chosen good never depends on Map insertion history.
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount <= 0) continue;
      if (!recipe.outputs.some((o) => o.goodType === goodType)) continue; // only haul outputs
      // Deliverability check reuses the SAME stockpile candidates (a store is a Stockpile+Position too).
      if (nearestStoreFor(candidates, world, ctx, terrain, cell, goodType) === null) continue;
      if (closer(dist, cell, bestDist, bestCell)) {
        best = { workplace: e, goodType };
        bestDist = dist;
        bestCell = cell;
      }
      break; // this workplace's lowest haulable goodType is its candidate; move to the next workplace
    }
  }
  return best;
}
