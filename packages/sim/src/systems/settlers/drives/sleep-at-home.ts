import { CurrentAtomic, Residence, type SettlerIdentity } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { builtHomeType } from '../../family/households.js';
import type { NavigationLimit } from '../../signposts/index.js';
import { atHomeDuration, SLEEP_ATOMIC_ID, startAtomic } from '../atomics/start.js';
import { enterBuilding, isInside } from '../indoors.js';
import { interactionCell } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';

// Sleeping at home: a settler with a house walks to its door, goes inside, and comes back out rested; the
// homeless keep the open-ground rule.
//
// Source basis: each tribe authors one at-home sleep clip, the civilist's - `viking_civilist_sleep_home`
// (length 50) against the outdoor `viking_civilist_sleep` (length 237). Both pulse the rest channel twice
// at `+4000` (`event <at> 1 +4000`), so for that body a bed indoors buys the same rest in a fifth of the
// time, and outdoors only half of it counts; the other six outdoor clips have no twin and sleep indoors at
// their outdoor pace. The approximation is the trigger, not the clip: this rung fires whenever the settler
// is housed, with no distance or time-of-day gate.
//
// The render knows only SLEEP_ATOMIC and would play the outdoor list against this 50-tick atomic; that is
// invisible only because `Resting` hides the sleeper.

/**
 * Send `e` to bed in its own house: walk to the home's door, step inside and run the sleep atomic there.
 * Returns `false` when the settler has no home, its home is gone or still a building site, or the door
 * lies outside its signpost area - the caller then falls back to the open-ground rule.
 */
export function sleepAtHome(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: SettlerIdentity,
  here: NodeId,
  limit: NavigationLimit | null,
): boolean {
  const home = world.tryGet(e, Residence)?.home;
  if (home === undefined || builtHomeType(world, ctx, home) === undefined) return false;
  const door = interactionCell(world, ctx, terrain, home, here);
  if (limit !== null && !limit.allowsNode(door)) return false;
  // Give up on a door the settler's routes just failed to reach, such as a house walled in by later
  // building: this rung takes the whole tick, so looping on it would pin the settler at the top of its
  // fatigue bar forever.
  if (isUnreachableGoal(unreachableGoals(world, ctx, e), door)) return false;
  enterBuilding(world, e, home, here, door, () =>
    startAtomic(
      world,
      e,
      SLEEP_ATOMIC_ID,
      { kind: 'sleep' },
      atHomeDuration(ctx, settler, SLEEP_ATOMIC_ID),
      e,
    ),
  );
  return true;
}

/**
 * Whether `e` is inside its own house mid-sleep. Testing the house and not just the atomic is
 * load-bearing: the open-ground rung starts an identical `sleep` atomic, so the atomic alone would also
 * match a settler asleep in a field behind a stale indoors marker.
 */
export function isSleepingAtHome(world: World, e: Entity): boolean {
  const home = world.tryGet(e, Residence)?.home;
  return (
    home !== undefined && isInside(world, e, home) && world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep'
  );
}
