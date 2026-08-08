import {
  HerdMember,
  Livestock,
  LivestockVisit,
  Owner,
  ownerOf,
  Person,
  Position,
  Resting,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { isScoutJob } from '../readviews/index.js';
import { clearNavState, entityNode, manhattan } from '../spatial/nodes.js';

/** Node-Manhattan contact distance at which a scout claims an animal. Approximated: the original's scout
 *  claims by walking into the creature, but no radius is readable. */
export const LIVESTOCK_CAPTURE_RANGE_NODES = 1;

/**
 * A player's scout claims livestock by contact: an owned scout within
 * {@link LIVESTOCK_CAPTURE_RANGE_NODES} of a {@link Livestock} creature stamps his player's
 * {@link Owner} on it, another player's stock included (observed original behaviour: only the scout
 * captures, and enemy livestock can be taken the same way). The claimed animal leaves its wild herd, and
 * a claimed leader's followers are re-pointed onto a successor.
 *
 * Determinism: scouts claim in ascending id order, so two scouts touching one animal in the same tick
 * leave the higher-id claim standing, and two enemy scouts in contact trade it each tick. No-ops in a
 * mapless sim.
 */
export const livestockCaptureSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  const terrain = ctx.terrain;
  // The candidate store first, so a map with no livestock never walks the settler population. No
  // canonical sort: every in-range animal is claimed, so order cannot change the result.
  const herds = [...world.query(Livestock, Position)];
  if (herds.length === 0) return;
  const scouts: Entity[] = [];
  for (const e of world.query(Person, Owner, Position)) {
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
      // Only an animal still in a wild herd can have followers, so a re-claim skips the successor scan.
      const wasHerded = world.has(animal, HerdMember);
      world.add(animal, Owner, { player });
      world.remove(animal, HerdMember);
      // A steal mid-walk abandons the booked visit and the walk to the victim's door with it.
      if (world.has(animal, LivestockVisit)) {
        world.remove(animal, LivestockVisit);
        clearNavState(world, animal);
      }
      if (wasHerded) promoteWildLeader(world, animal);
    }
  }
};

/** Re-point a claimed leader's wild followers onto their lowest-id remaining member, which then leads
 *  itself, so the wild herd does not follow the claimed animal to the farm. */
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
    world.mut(f, HerdMember).leader = leader;
  }
}
