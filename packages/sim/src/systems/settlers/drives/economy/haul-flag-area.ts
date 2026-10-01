import type { Entity } from '../../../../ecs/world.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { liveHaulFlag } from '../../../economy/work-flag.js';
import { entityNode } from '../../../spatial/nodes.js';
import { atOrWalk } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell } from '../../targets/index.js';

/** Where a flagged carrier lifts loose goods: ranked from its flag, within the flag's Manhattan radius as a
 *  gatherer's work area is, and still inside the carrier's signpost confinement. */
export interface HaulFlagArea {
  readonly flag: Entity;
  readonly center: NodeId;
  readonly gate: SpatialGate;
}

/** The carrier's pickup area, or null while it holds no live flag. */
export function haulFlagArea(plan: PlannerContext): HaulFlagArea | null {
  const { world, terrain, limit } = plan;
  const live = liveHaulFlag(world, plan.entity);
  if (live === undefined) return null;
  const center = entityNode(world, terrain, live.flag);
  const cx = terrain.xOf(center);
  const cy = terrain.yOf(center);
  const r = live.radius;
  return {
    flag: live.flag,
    center,
    gate: {
      bounds: { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r },
      allowsNode: (node) =>
        Math.abs(terrain.xOf(node) - cx) + Math.abs(terrain.yOf(node) - cy) <= r &&
        (limit === null || limit.allowsNode(node)),
    },
  };
}

/** Walk to the flag and wait there: a flagged carrier with nothing to lift stays at its post in the field. */
export function waitAtHaulFlag(plan: PlannerContext, area: HaulFlagArea): void {
  const { world, ctx, terrain, entity, here } = plan;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, area.flag, here), () => {});
}
