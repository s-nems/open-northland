import { Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { evictSettlerFromBlockedSpawn } from '../movement/evict.js';
import { clearNavState } from '../movement/nav-state.js';
import { stepOut } from '../settlers/indoors.js';
import { sendUnit } from './movement.js';

/**
 * Put `e` on the destination node, push it off if the landing is blocked, and hand it the same walk
 * order the original issues after its own teleport, so the planner takes the unit back from there.
 * That order carries a player walk's whole teardown: a guard's post moves to the destination, and a
 * carrier sets its load down where it lands rather than where it was lifted. `claimed` threads one
 * batch so a group fans out instead of stacking. The destination needs no explicit reveal: the moved
 * unit's own eye covers it on the next vision pass, which is what the original's explore result
 * achieves. Approximation: a unit inside a non-interruptible clip finishes it where it no longer
 * stands, because the walk order parks behind that clip rather than cancelling it. A human aboard a
 * vehicle has no position and stays put.
 */
export function teleportHuman(
  world: World,
  ctx: SystemContext,
  e: Entity,
  point: HalfCellNode,
  claimed?: Set<NodeId>,
): void {
  const at = world.tryMut(e, Position);
  if (at === undefined) return;
  // Landing outdoors, so the marker that says it is inside a building goes with the old position.
  stepOut(world, e);
  const centre = positionOfNode(point.hx, point.hy);
  at.x = centre.x;
  at.y = centre.y;
  // The route it was walking points back at where it came from, so it goes before anything re-aims.
  clearNavState(world, e);
  evictSettlerFromBlockedSpawn(world, ctx, e, claimed);
  sendUnit(world, ctx, e, point.hx, point.hy);
}
