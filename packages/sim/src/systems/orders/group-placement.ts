import { Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';

/**
 * The members a group order tries at `target`, nearest its door first (half-cell Manhattan distance,
 * then ascending id). While any member has no place, only those are tried, so a second click on another
 * target places the rest of a group instead of pulling back the ones the first click placed; a group
 * that is all placed elsewhere relocates. Members already placed at `target` and repeated ids are left
 * out. `placeOf` reads the binding the order replaces, such as a home or a workplace.
 */
export function groupPlacementOrder(
  world: World,
  ctx: SystemContext,
  members: readonly Entity[],
  target: Entity,
  placeOf: (e: Entity) => Entity | undefined,
): Entity[] {
  const door = interactionNode(world, ctx, target);
  const ranked: Array<{ readonly e: Entity; readonly placed: boolean; readonly dist: number }> = [];
  for (const e of new Set(members)) {
    if (!world.isAlive(e)) continue;
    const place = placeOf(e);
    if (place === target) continue;
    const p = world.tryGet(e, Position);
    let dist = Number.MAX_SAFE_INTEGER; // nothing to measure: ranks after every measured member
    if (p !== undefined && door !== null) {
      const node = nodeOfPosition(p.x, p.y);
      dist = Math.abs(node.hx - door.x) + Math.abs(node.hy - door.y);
    }
    ranked.push({ e, placed: place !== undefined, dist });
  }
  const unplaced = ranked.filter((member) => !member.placed);
  const tried = unplaced.length > 0 ? unplaced : ranked;
  tried.sort((a, b) => a.dist - b.dist || a.e - b.e);
  return tried.map((member) => member.e);
}
