import { hexagonRing } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { dynamicBlockOverlay, routeRegions } from '../../../footprint/index.js';
import { hexNodeDistance } from '../../../spatial/metric.js';
import type { PlannerContext } from '../../planner/context.js';
import { isUnreachableGoal, unreachableGoals } from '../../unreachable-goals.js';

/** An animal's interpolated position can map to a blocked diagonal flank. Keep a clear target node,
 * otherwise approach within summon range; the normal routing pass verifies the longer route. */
export function livestockApproach(plan: PlannerContext, animal: NodeId, range: number): NodeId {
  const { world, ctx, terrain, entity, here } = plan;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const regions = routeRegions(world, ctx, terrain);
  const memo = unreachableGoals(world, ctx, entity);
  const side = terrain.componentOf(here);
  const accepts = (node: NodeId): boolean =>
    terrain.isWalkable(node) &&
    terrain.componentOf(node) === side &&
    !blocked.has(node) &&
    !isUnreachableGoal(memo, node) &&
    !regions.unroutable(here, node);
  if (accepts(animal)) return animal;
  const centre = { hx: terrain.xOf(animal), hy: terrain.yOf(animal) };
  let best: NodeId | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (let radius = 1; radius <= range; radius++) {
    for (const { point } of hexagonRing(centre, radius)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const node = terrain.nodeAt(point.hx, point.hy);
      if (!accepts(node)) continue;
      const next = hexNodeDistance(terrain, here, node);
      if (next < distance || (next === distance && (best === null || node < best))) {
        best = node;
        distance = next;
      }
    }
  }
  // No eligible stance: leave a real refusal to the existing bounded failed-route recovery.
  return best ?? animal;
}
