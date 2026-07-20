import { CurrentAtomic, Residence, Resting, type SettlerIdentity } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { builtHomeType } from '../family/households.js';
import {
  atomicAnimationByName,
  atomicDurationForName,
  needAtomicAnimationName,
  needAtomicDuration,
} from '../readviews/animations.js';
import type { NavigationLimit } from '../signposts/index.js';
import { atOrWalk, SLEEP_ATOMIC_ID, startAtomic } from './actions.js';
import { interactionCell } from './targets/index.js';
import { isUnreachableGoal, unreachableGoals } from './unreachable-goals.js';

// Sleeping at home — a settler with a house walks to its door, goes inside, and comes back out rested;
// the homeless keep the open-ground rule (./rest-spot.ts).
//
// Source basis: each tribe authors ONE at-home sleep clip, the civilist's — `viking_civilist_sleep_home`
// (length 50) against the outdoor `viking_civilist_sleep` (length 237), and the same single pair in the
// other four tribes. Both pulse the rest channel twice at `+4000` (`event <at> 1 +4000`), so for that
// body a bed indoors buys the same rest in a fifth of the time. The other six outdoor clips (baby ×2,
// child ×2, woman, soldier) have no twin and differ in their own pulses, so they sleep indoors at their
// outdoor pace.
//
// APPROXIMATED — the trigger, not the clip: no `setatomic` binds the home clip, so the original's own
// rule for choosing it is not readable. This rung fires it whenever the settler is housed, with no
// distance or time-of-day gate.
//
// The render draws no at-home clip: it knows only SLEEP_ATOMIC and would play the 237-entry outdoor
// list against this 50-tick atomic. That is invisible only because `Resting` hides the sleeper — anyone
// changing the hide rule has to bind the home clip too.

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
  // A door this settler's routes just failed to reach — a house walled in by later building. Give up on
  // the bed rather than re-picking it every re-plan: this rung takes the settler for the tick, so a
  // settler looping on an unroutable door would never fall through to the open-ground rule and would
  // stay pinned at the top of its fatigue bar forever.
  if (isUnreachableGoal(unreachableGoals(world, ctx, e), door)) return false;
  atOrWalk(world, e, here, door, () => {
    world.add(e, Resting, { at: home });
    startAtomic(world, e, SLEEP_ATOMIC_ID, { kind: 'sleep' }, homeSleepDuration(ctx, settler), e);
  });
  return true;
}

/**
 * Whether `e` is inside its OWN house mid-sleep — the test that stops the planner shedding the marker
 * that put it there. Every other drive treats a lingering {@link Resting} as stale (`ai.ts`,
 * `replan.ts`), so without this the settler would be turfed out of its own bed the tick it got in.
 *
 * The `at === home` check is load-bearing, not belt-and-braces: the open-ground rung starts an
 * identical `sleep` atomic, and a settler on `FamilyDuty` keeps its `Resting` through a re-plan
 * (`replan.ts`), so testing the atomic alone would hide a settler asleep in a field behind a stale
 * marker pointing at some workplace it waited in earlier.
 */
export function isSleepingAtHome(world: World, e: Entity): boolean {
  const restingAt = world.tryGet(e, Resting)?.at;
  return (
    restingAt !== undefined &&
    restingAt === world.tryGet(e, Residence)?.home &&
    world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep'
  );
}

/** How long one sleep indoors takes: the settler's `<clip>_home` length (50 ticks for the civilist), or
 *  its outdoor sleep length when its body has no home clip — only the civilist authors one, so every
 *  other trade sleeps indoors at the outdoor pace (named approximation). */
function homeSleepDuration(ctx: SystemContext, settler: SettlerIdentity): number {
  const outdoor = needAtomicAnimationName(ctx.content, settler, SLEEP_ATOMIC_ID);
  if (outdoor === undefined) return needAtomicDuration(ctx.content, settler, SLEEP_ATOMIC_ID);
  const atHome = `${outdoor}${HOME_SLEEP_SUFFIX}`;
  // Resolve the home name explicitly rather than letting an unresolved one fall to the default: a body
  // with no home clip must sleep at its own outdoor pace, not at the "nothing resolved" stub.
  const resolved = atomicAnimationByName(ctx.content, atHome) !== undefined ? atHome : outdoor;
  return atomicDurationForName(ctx.content, resolved);
}
