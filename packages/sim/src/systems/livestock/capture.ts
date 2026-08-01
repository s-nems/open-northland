import {
  HerdMember,
  Livestock,
  LivestockVisit,
  Owner,
  ownerOf,
  Position,
  Resting,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { isScoutJob } from '../readviews/index.js';
import { clearNavState, entityNode, manhattan } from '../spatial/nodes.js';

/** Node-Manhattan contact distance at which a scout claims an animal - "walked onto it" read as the
 *  animal's own or an adjacent node. Approximated (observed original behaviour: the scout claims by
 *  walking into the creature; no readable radius). */
export const LIVESTOCK_CAPTURE_RANGE_NODES = 1;

/**
 * LivestockCaptureSystem - a player's scout claims livestock by contact. An owned scout standing
 * within {@link LIVESTOCK_CAPTURE_RANGE_NODES} of a {@link Livestock} creature stamps his player's
 * {@link Owner} on it - including RE-claiming another player's stock (observed original behaviour:
 * only the scout captures, and enemy livestock can be taken the same way). The claimed animal leaves
 * its wild herd's follow drive ({@link HerdMember} removed - its leash is re-anchored by the
 * livestock-assignment drive), and a claimed LEADER's wild followers are re-pointed onto a successor
 * so the wild herd never marches after it ({@link promoteWildLeader}).
 *
 * Determinism: scouts claim in canonical ascending-id order, so when two players' scouts touch the
 * same animal in one tick the higher-id scout's claim stands (last write wins - a canonical, if
 * arbitrary, tiebreak; two enemy scouts holding contact trade the claim each tick, an accepted
 * tug-of-war). Scale: scouts are filtered from the owned-settler query before the small sort, and the
 * candidates are the {@link Livestock} store, not the settler population. No-ops in a mapless sim (no
 * contact distance to measure).
 */
export const livestockCaptureSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  const terrain = ctx.terrain;
  // The candidate store first, so a map carrying no livestock never walks the settler population. No
  // canonical sort: every in-range animal is claimed (no first-found winner), so order cannot change
  // the result.
  const herds = [...world.query(Livestock, Position)];
  if (herds.length === 0) return;
  const scouts: Entity[] = [];
  for (const e of world.query(Settler, Owner, Position)) {
    if (isScoutJob(ctx.content, world.get(e, Settler).jobType)) scouts.push(e);
  }
  if (scouts.length === 0) return;
  scouts.sort((a, b) => a - b);
  for (const scout of scouts) {
    const player = world.get(scout, Owner).player;
    const at = entityNode(world, terrain, scout);
    for (const animal of herds) {
      if (ownerOf(world, animal) === player) continue; // already this player's stock
      if (world.has(animal, Resting)) continue; // inside a workplace - out of reach until released
      if (manhattan(terrain, entityNode(world, terrain, animal), at) > LIVESTOCK_CAPTURE_RANGE_NODES) {
        continue;
      }
      // Only an animal still in a wild herd can have followers pointing at it, so a re-claim (the
      // enemy tug-of-war) skips the successor scans below.
      const wasHerded = world.has(animal, HerdMember);
      world.add(animal, Owner, { player });
      world.remove(animal, HerdMember);
      // A steal mid-walk abandons the booked visit - the batch releases nobody (an accepted free
      // batch) - and drops the walk to the victim's door with it.
      if (world.has(animal, LivestockVisit)) {
        world.remove(animal, LivestockVisit);
        clearNavState(world, animal);
      }
      if (wasHerded) promoteWildLeader(world, animal);
    }
  }
};

/** A claimed LEADER's wild followers must not conga behind it to the farm: re-point them onto their
 *  lowest-id remaining member (the spawn rule's canonical pick), which then leads itself. */
function promoteWildLeader(world: World, claimed: Entity): void {
  let successor: Entity | null = null;
  for (const f of world.query(HerdMember)) {
    if (world.get(f, HerdMember).leader !== claimed) continue;
    if (successor === null || f < successor) successor = f;
  }
  if (successor === null) return;
  const leader = successor;
  for (const f of world.query(HerdMember)) {
    if (world.get(f, HerdMember).leader !== claimed) continue;
    world.write(f, HerdMember, (m) => {
      m.leader = leader;
    });
  }
}
