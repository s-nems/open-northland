import {
  AttackOrder,
  diplomacyStance,
  Health,
  MAX_PLAYERS,
  Owner,
  Position,
  Settler,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../../../nav/halfcell.js';
import { type NodeBox, nodeBoxOfCircles, withinNodeRadius } from '../../../nav/node-circle.js';
import { standsAtPost } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { isFighterJob } from '../../readviews/index.js';
import { anchorNodeOf } from '../node-geometry.js';
import { ownedSettlers } from '../seat-roster.js';

/** How near a hostile fighter comes to one of the seat's building anchors before the seat counts as under
 *  attack, in world-metric nodes (authored): the longest soldier reach in the extracted weapons (catapult
 *  `maxRange` 24, long bow 23), so a shooter hitting a building from his full reach still counts. */
export const SIEGE_RADIUS_NODES = 24;

/**
 * Whether the seat is under attack: a live fighter of a player it holds an `enemy` stance toward either
 * carries an {@link AttackOrder} on something the seat owns, or stands within {@link SIEGE_RADIUS_NODES}
 * of one of its buildings. An `Engagement` names no target, so a man trading blows counts by where he
 * stands. A man holding his own tower is left out, as the defence's raider scan does: a garrison parked
 * near the seat's edge would otherwise hold its building for good.
 *
 * Cost: one pass over each enemy's memoized roster; a fighter outside the box around every anchor costs
 * a compare, one inside it at most one circle test per building before the first hit ends the scan.
 */
export function seatUnderAttack(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): boolean {
  const anchors: HalfCellNode[] = [];
  for (const e of owned) {
    const node = anchorNodeOf(world, e);
    if (node !== null) anchors.push(node);
  }
  const box = nodeBoxOfCircles(anchors.map((a) => ({ x: a.hx, y: a.hy, r: SIEGE_RADIUS_NODES })));
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === player || diplomacyStance(world, player, other) !== 'enemy') continue;
    for (const e of ownedSettlers(world, other)) {
      if (!isFighterJob(ctx.content, world.get(e, Settler).jobType)) continue;
      if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
      if (standsAtPost(world, e) !== null) continue;
      if (targetsSeat(world, e, player) || besieges(world, e, anchors, box)) return true;
    }
  }
  return false;
}

function targetsSeat(world: World, e: Entity, player: number): boolean {
  const order = world.tryGet(e, AttackOrder);
  return order !== undefined && world.tryGet(order.target, Owner)?.player === player;
}

function besieges(world: World, e: Entity, anchors: readonly HalfCellNode[], box: NodeBox): boolean {
  const pos = world.tryGet(e, Position);
  if (pos === undefined) return false;
  const at = nodeOfPosition(pos.x, pos.y);
  if (at.hx < box.minX || at.hx > box.maxX || at.hy < box.minY || at.hy > box.maxY) return false;
  return anchors.some((a) => withinNodeRadius(a.hx, a.hy, at.hx, at.hy, SIEGE_RADIUS_NODES));
}
