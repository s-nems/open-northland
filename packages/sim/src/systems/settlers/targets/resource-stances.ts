import type { NodeId } from '../../../nav/terrain/index.js';
import { dynamicBlockOverlay, routeRegions } from '../../footprint/index.js';
import { manhattan } from '../../spatial/metric.js';
import type { PlannerContext } from '../planner/context.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';

/**
 * The gates a stance must pass for this settler to walk there, the same ones the harvest scan applies
 * to its proven cell: open under the walk-block overlay, not a goal its routes just failed on, in its
 * static component and routable from where it stands, inside its signpost area and inside `bound`.
 * The settler's own cell always passes.
 */
export function collectorStanceGates(
  plan: Pick<PlannerContext, 'world' | 'ctx' | 'terrain' | 'entity' | 'here' | 'limit'>,
  bound: { center: NodeId; radius: number } | undefined,
): (cell: NodeId) => boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const unreachable = unreachableGoals(world, ctx, e);
  const regions = routeRegions(world, ctx, terrain);
  const gate = plan.limit ?? undefined;
  return (cell) =>
    cell === here ||
    (!blocked.has(cell) &&
      !isUnreachableGoal(unreachable, cell) &&
      terrain.componentOf(cell) === terrain.componentOf(here) &&
      (gate === undefined || gate.allowsNode(cell)) &&
      (bound === undefined || manhattan(terrain, bound.center, cell) <= bound.radius) &&
      !regions.unroutable(here, cell));
}

/** Select the closest eligible approach without consuming the harvest stance draw. */
export function nearestEligibleStance(
  plan: Pick<PlannerContext, 'terrain' | 'here'>,
  pool: readonly NodeId[],
  passes: (cell: NodeId) => boolean,
): NodeId | undefined {
  let best: NodeId | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pool.length; i++) {
    const cell = pool[i];
    if (cell === undefined || !passes(cell)) continue;
    const d = manhattan(plan.terrain, plan.here, cell);
    if (d < distance || (d === distance && (best === undefined || cell < best))) {
      best = cell;
      distance = d;
    }
  }
  return best;
}
