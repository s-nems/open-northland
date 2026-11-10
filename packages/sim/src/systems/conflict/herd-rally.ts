import {
  Engagement,
  engagementRecord,
  Frightened,
  isWildlife,
  Owner,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { herdLeaderOf } from '../movement/herd-leader.js';
import { herdRoster } from '../movement/herd-roster.js';
import { settlerMovementNode } from '../movement/traversal.js';
import { herdParams } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { keepsWildTarget } from './targeting.js';

/**
 * Original behavior: while a wild herd leader attacks, each follower within `maximumleaderdistance` of it
 * that holds no target of its own takes up the leader's, with no anger of its own asked. The pass start
 * rallies every attacking leader, the engaged units alone, so a pass costs the fights, not the wild
 * population; a leader that takes a target up inside the pass rallies right after its turn.
 */
export function rallyAttackingHerds(world: World, ctx: SystemContext, terrain: TerrainGraph): void {
  const attacking: Entity[] = [];
  const engaged = world.canonicalQuery(Engagement);
  for (let i = 0; i < engaged.length; i++) {
    const e = engaged[i] as Entity;
    if (wildTargetOfLeader(world, e) !== null) attacking.push(e);
  }
  for (const leader of attacking) rallyFollowers(world, ctx, terrain, leader);
}

/** Hand `leader`'s target to its followers when it is a wild herd leader attacking. */
export function rallyFollowers(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  leader: Entity,
): void {
  const target = wildTargetOfLeader(world, leader);
  if (target === null) return;
  const members = herdRoster(world).membersOf(leader);
  const herd = herdParams(ctx.content, world.get(leader, Settler).tribe);
  if (herd === null) return;
  const at = settlerMovementNode(world, terrain, leader);
  for (const m of members) {
    if (m === leader || world.has(m, Frightened) || !keepsWildTarget(world, m, target)) continue;
    const own = world.tryGet(m, Engagement)?.target;
    if (own === target || (own !== undefined && keepsWildTarget(world, m, own))) continue;
    if (hexNodeDistance(terrain, settlerMovementNode(world, terrain, m), at) > herd.leaderDistance) continue;
    const engagement = world.tryMut(m, Engagement);
    if (engagement === undefined) world.add(m, Engagement, engagementRecord(ctx.tick, target));
    else engagement.target = target;
  }
}

/** The live target of `e` when it is an unowned animal leading itself, else null. */
function wildTargetOfLeader(world: World, e: Entity): Entity | null {
  if (world.has(e, Owner) || !isWildlife(world, e) || herdLeaderOf(world, e) !== e) return null;
  const target = world.tryGet(e, Engagement)?.target;
  return target !== undefined && keepsWildTarget(world, e, target) ? target : null;
}
