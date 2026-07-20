import { CurrentAtomic, Residence, Resting, type SettlerIdentity } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { builtHomeType } from '../family/households.js';
import {
  atomicAnimationByName,
  atomicAnimationName,
  atomicDurationForName,
} from '../readviews/animations.js';
import type { NavigationLimit } from '../signposts/index.js';
import { atOrWalk, SLEEP_ATOMIC_ID, startAtomic } from './actions.js';
import { interactionCell } from './targets/index.js';

/**
 * Sleeping at home — a settler with a house walks to its door, goes inside, and comes back out rested,
 * instead of lying down in the open ({@link import('./rest-spot.js').restingCell}, still the rule for the
 * homeless).
 *
 * Source basis: the data carries a dedicated home clip beside every outdoor one — `viking_civilist_sleep`
 * (`length 237`) and `viking_civilist_sleep_home` (`length 50`), and the same pair for the other four
 * tribes. Both pulse the rest channel twice at `+4000` (`event <at> 1 +4000`), so a bed indoors is worth
 * the same rest in under a quarter of the time. That is the whole mechanic, and it is why a housed
 * settler should prefer its own roof.
 */

/**
 * The suffix that turns a tribe's bound sleep clip into its at-home twin — the data names the pair
 * `<clip>` / `<clip>_home` in every tribe. No `setatomic` binds the home clip (the original's house logic
 * plays it, not the atomic table), so it is resolved by name rather than through the binding table, the
 * same way the make-love clips are.
 */
const HOME_SLEEP_SUFFIX = '_home';

/**
 * Send `e` to bed in its own house: walk to the home's door, then step inside ({@link Resting} — the
 * render hides a settler that has gone in) and run the sleep atomic there. Returns `false` when the
 * settler has no home, its home is gone or still a building site, or the door lies outside its signpost
 * area — the caller then falls back to the open-ground rule.
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
  atOrWalk(world, e, here, door, () => {
    world.add(e, Resting, { at: home });
    startAtomic(world, e, SLEEP_ATOMIC_ID, { kind: 'sleep' }, homeSleepDuration(ctx, settler), e);
  });
  return true;
}

/**
 * Whether `e` is inside its house mid-sleep — the test that stops the planner shedding the marker that
 * put it there. Every other drive treats a lingering {@link Resting} as stale (`ai.ts`, `replan.ts`), so
 * without this the settler would be turfed out of its own bed the tick it got in.
 */
export function isSleepingAtHome(world: World, e: Entity): boolean {
  return world.has(e, Resting) && world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep';
}

/** How long one sleep indoors takes: the settler's `<clip>_home` length (50 ticks for the civilist), or
 *  its outdoor sleep length when its body has no home clip — only the civilist authors one, so every
 *  other trade sleeps indoors at the outdoor pace (named approximation). */
function homeSleepDuration(ctx: SystemContext, settler: SettlerIdentity): number {
  const outdoor = atomicAnimationName(ctx.content, settler, SLEEP_ATOMIC_ID);
  if (outdoor === undefined) return atomicDurationForName(ctx.content, undefined);
  const atHome = `${outdoor}${HOME_SLEEP_SUFFIX}`;
  // Resolve the home name explicitly rather than letting an unresolved one fall to the default: a body
  // with no home clip must sleep at its OWN outdoor pace, not at the 4-tick "nothing resolved" stub.
  const resolved = atomicAnimationByName(ctx.content, atHome) !== undefined ? atHome : outdoor;
  return atomicDurationForName(ctx.content, resolved);
}
