import { Position } from '../../components/index.js';
import type { GroupMember } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';

/**
 * The members a group order tries at `target`, nearest its door first (half-cell Manhattan distance,
 * then ascending id). While any member has no place, only those are tried, so a second click on another
 * target places the rest of a group instead of pulling back the ones the first click placed; a group
 * that is all placed elsewhere relocates. Members already placed at `target` are left out, and a
 * repeated settler keeps its first entry. `placeOf` reads the binding the order replaces, such as a home
 * or a workplace.
 */
export function groupPlacementOrder<M extends GroupMember>(
  world: World,
  ctx: SystemContext,
  members: readonly M[],
  target: Entity,
  placeOf: (e: Entity) => Entity | undefined,
): M[] {
  const door = interactionNode(world, ctx, target);
  const seen = new Set<Entity>();
  const ranked: Array<{ readonly member: M; readonly placed: boolean; readonly dist: number }> = [];
  for (const member of members) {
    const e = member.entity;
    if (seen.has(e)) continue;
    seen.add(e);
    if (!world.isAlive(e)) continue;
    const place = placeOf(e);
    if (place === target) continue;
    const p = world.tryGet(e, Position);
    let dist = Number.MAX_SAFE_INTEGER; // nothing to measure: ranks after every measured member
    if (p !== undefined && door !== null) {
      const node = nodeOfPosition(p.x, p.y);
      dist = Math.abs(node.hx - door.x) + Math.abs(node.hy - door.y);
    }
    ranked.push({ member, placed: place !== undefined, dist });
  }
  const unplaced = ranked.filter((entry) => !entry.placed);
  const tried = unplaced.length > 0 ? unplaced : ranked;
  tried.sort((a, b) => a.dist - b.dist || a.member.entity - b.member.entity);
  return tried.map((entry) => entry.member);
}
