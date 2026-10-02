import { CurrentAtomic, Residence, type SettlerIdentity } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { homeQualityActive } from '../../family/home-quality.js';
import { builtHomeType, homeUsedBy } from '../../family/households.js';
import { atomicDuration } from '../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL } from '../../readviews/index.js';
import type { NavigationLimit } from '../../signposts/index.js';
import { PRAY_ATOMIC_ID, SLEEP_ATOMIC_ID, startAtomic, startMeal } from '../atomics/start.js';
import { enterBuilding, isInside } from '../indoors.js';
import { interactionCell, storedFoodGood } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import { homeClipServes } from './at-home.js';

// Sleeping at home: a settler with a house walks to its door, goes inside, and comes back out rested; the
// homeless keep the open-ground rule.
//
// Original behavior: a settler sleeps at home on the same clip as outdoors. Away from home only half the
// rest counts, at home all of it, and twice that on a bed the home's furniture pays for
// (`applyAtomicNeedEvents`). The data's `<clip>_home` and `<body>_eat_athome` clips are never played: no
// `setatomic` binds them. The approximation is the trigger: this rung fires whenever the settler is housed,
// with no distance or time-of-day gate.
//
// Praying at home: original behavior, a settler whose house keeps its holy fire burning prays there before
// it looks for a temple.
//
// Eating at home: original behavior, a hungry settler eats from its own larder before it looks for the
// nearest food, and a meal there counts double. Approximation: it steps inside to eat, as it does to
// sleep, so the at-home top-up serves its other bars after the meal.

/**
 * Send `e` to bed in its own house: walk to the home's door, step inside and run the sleep atomic there.
 * Returns `false` when the settler has no home it uses ({@link homeUsedBy}), its home is gone or still a
 * building site, or the door lies outside its signpost area - the caller then falls back to the
 * open-ground rule.
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
  const home = homeUsedBy(world, ctx, e);
  if (home === undefined || builtHomeType(world, ctx, home) === undefined) return false;
  return goHomeFor(world, ctx, terrain, e, home, here, limit, () =>
    startAtomic(
      world,
      e,
      SLEEP_ATOMIC_ID,
      { kind: 'sleep' },
      atomicDuration(ctx.content, settler, SLEEP_ATOMIC_ID),
      e,
    ),
  );
}

/**
 * Send `e` home to pray at its holy fire. Returns `false` when it uses no home, the fire is out or
 * forbidden, the settler's pray clip pays no religion, or the door is out of reach - the caller then
 * looks for a temple.
 */
export function prayAtHome(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: SettlerIdentity,
  here: NodeId,
  limit: NavigationLimit | null,
): boolean {
  const home = homeUsedBy(world, ctx, e);
  if (home === undefined || !homeQualityActive(world, ctx, home, 'piety')) return false;
  if (!homeClipServes(ctx, settler, PRAY_ATOMIC_ID, ATOMIC_EVENT_CHANNEL.PIETY)) return false;
  return goHomeFor(world, ctx, terrain, e, home, here, limit, () =>
    startAtomic(
      world,
      e,
      PRAY_ATOMIC_ID,
      { kind: 'pray' },
      atomicDuration(ctx.content, settler, PRAY_ATOMIC_ID),
      home,
    ),
  );
}

/**
 * Send `e` home to eat one unit off its family larder. Returns `false` when it uses no built home, the
 * larder holds nothing edible, or the door is out of reach - the caller then looks for the nearest food.
 */
export function eatAtHome(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: SettlerIdentity,
  here: NodeId,
  limit: NavigationLimit | null,
): boolean {
  const home = homeUsedBy(world, ctx, e);
  if (home === undefined || builtHomeType(world, ctx, home) === undefined) return false;
  const goodType = storedFoodGood(world, ctx, home);
  if (goodType === null) return false;
  return goHomeFor(world, ctx, terrain, e, home, here, limit, () =>
    startMeal(world, ctx, e, settler, { kind: 'eat', goodType, from: home }, home),
  );
}

/** Walk `e` to its home's door and run `start` once inside; `false` when the door is barred to it. */
function goHomeFor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  home: Entity,
  here: NodeId,
  limit: NavigationLimit | null,
  start: () => void,
): boolean {
  const door = interactionCell(world, ctx, terrain, home, here);
  if (limit !== null && !limit.allowsNode(door)) return false;
  // Give up on a door the settler's routes just failed to reach, such as a house walled in by later
  // building: this rung takes the whole tick, so looping on it would pin the settler at the top of its
  // need bar forever.
  if (isUnreachableGoal(unreachableGoals(world, ctx, e), door)) return false;
  enterBuilding(world, e, home, here, door, start);
  return true;
}

/**
 * Whether `e` is inside its own house mid-sleep, mid-prayer or mid-meal. Testing the house and not just the
 * atomic is load-bearing: the open-ground rung starts an identical `sleep` atomic, so the atomic alone
 * would also match a settler behind a stale indoors marker. A prayer must also target the home: a temple's
 * or the headquarters' door can share the node the settler stepped in by, and that prayer is said outside.
 * A meal must come off the home's own larder for the same reason.
 */
export function isServedAtHome(world: World, e: Entity): boolean {
  const home = world.tryGet(e, Residence)?.home;
  if (home === undefined || !isInside(world, e, home)) return false;
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic === undefined) return false;
  const { effect } = atomic;
  return (
    effect.kind === 'sleep' ||
    (effect.kind === 'pray' && atomic.targetEntity === home) ||
    (effect.kind === 'eat' && effect.from === home)
  );
}
