import { HerdMember, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/** Whether `e` can lead a herd: it stands on the map and follows no other animal. A reaped leader has no
 *  position; a claimed one has left its wild herd, which capture re-leads. */
export function leadsHerd(world: World, e: Entity): boolean {
  if (!world.has(e, Position)) return false;
  const leader = world.tryGet(e, HerdMember)?.leader;
  return leader === undefined || leader === e;
}

/** The leader `e` follows, or `e` itself when it leads, walks alone or its leader no longer leads. */
export function herdLeaderOf(world: World, e: Entity): Entity {
  const leader = world.tryGet(e, HerdMember)?.leader;
  return leader !== undefined && leadsHerd(world, leader) ? leader : e;
}

/**
 * Re-point the followers of `former`, a leader that no longer leads (claimed, reaped or off the map),
 * onto their lowest-id member on the map, which then leads itself. Returns that successor, or null when
 * none is left. One pass over the herd store per lost leader.
 *
 * Original behavior: an orphaned follower joins another leader of its tribe within 40 map points, or
 * else leads itself. Approximation: the orphans stay together under one successor.
 */
export function promoteHerdSuccessor(world: World, former: Entity): Entity | null {
  let successor: Entity | null = null;
  for (const f of world.query(HerdMember, Position)) {
    if (f === former || world.get(f, HerdMember).leader !== former) continue;
    if (successor === null || f < successor) successor = f;
  }
  if (successor === null) return null;
  for (const f of world.query(HerdMember)) {
    if (f === former || world.get(f, HerdMember).leader !== former) continue;
    world.mut(f, HerdMember).leader = successor;
  }
  return successor;
}
