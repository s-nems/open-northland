import { CurrentAtomic, Residence, type SettlerIdentity } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { homeQualityActive } from '../../family/home-quality.js';
import { builtHomeType, homeUsedBy } from '../../family/households.js';
import { wearLodging } from '../../family/lodging.js';
import { atomicDuration } from '../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL } from '../../readviews/index.js';
import type { NavigationLimit } from '../../signposts/index.js';
import { atOrWalk, PRAY_ATOMIC_ID, SLEEP_ATOMIC_ID, startAtomic } from '../atomics/start.js';
import { enterBuilding, isInside } from '../indoors.js';
import type { PlannerSpacing } from '../planner/spacing.js';
import { homeErrandDoor } from '../targets/index.js';
import { unreachableGoals } from '../unreachable-goals.js';
import { fillCompanyOnComingHome, homeClipServes } from './at-home.js';
import { prayerStand } from './prayer-stand.js';

// Sleeping at home: a settler with a house walks to its door, goes inside, and comes back out rested; the
// homeless keep the open-ground rule.
//
// Original behavior: a settler sleeps at home on the same clip as outdoors. Away from home only half the
// rest counts, at home all of it (`applyAtomicNeedEvents`). The original's furniture bonus to rest is
// replaced by the owner's housing rule: furniture lets a home take extra families, and a sleep there wears
// it (`family/lodging.ts`). The data's `<clip>_home` and `<body>_eat_athome` clips are never played: no
// `setatomic` binds them. The approximation is the trigger: this rung fires whenever the settler is housed
// within the home errand range of its door, with no time-of-day gate.
//
// Praying at home: original behavior, a settler whose house keeps its holy fire burning prays there before
// it looks for a temple.
//
// Eating at home: a meal there counts double. Approximation: the settler steps inside to eat, as it
// does to sleep, so the at-home top-up serves its other bars after the meal. Meal selection lives in
// targets/food: the larder comes first within the same home errand range as the bed.

/**
 * Send `e` to bed in its own house: walk to the home's door, step inside and run the sleep atomic there.
 * Returns `false` when the settler has no home it uses ({@link homeUsedBy}), its home is gone or still a
 * building site, or its door is barred or out of range ({@link homeErrandDoor}) - the caller then falls
 * back to the open-ground rule.
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
  const door = homeErrandDoor(world, ctx, terrain, home, here, limit, unreachableGoals(world, ctx, e));
  if (door === null) return false;
  enterBuilding(world, e, home, here, door, () => {
    fillCompanyOnComingHome(world, ctx, e);
    startAtomic(
      world,
      e,
      SLEEP_ATOMIC_ID,
      { kind: 'sleep' },
      atomicDuration(ctx.content, settler, SLEEP_ATOMIC_ID),
      e,
    );
    wearLodging(world, ctx, home, 'sleep');
  });
  return true;
}

/**
 * Pray at an available outdoor stand. Falls back to a public site when the fire is out,
 * the clip pays no religion, or no stand can be reached.
 */
export function prayAtHome(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: SettlerIdentity,
  here: NodeId,
  limit: NavigationLimit | null,
  spacing: PlannerSpacing,
): boolean {
  const home = homeUsedBy(world, ctx, e);
  if (home === undefined || !homeQualityActive(world, ctx, home, 'piety')) return false;
  if (!homeClipServes(ctx, settler, PRAY_ATOMIC_ID, ATOMIC_EVENT_CHANNEL.PIETY)) return false;
  const door = prayerStand(world, ctx, terrain, e, home, here, spacing, limit);
  if (door === null) return false;
  spacing.claim(door);
  atOrWalk(world, e, here, door, () =>
    startAtomic(
      world,
      e,
      PRAY_ATOMIC_ID,
      { kind: 'pray' },
      atomicDuration(ctx.content, settler, PRAY_ATOMIC_ID),
      home,
    ),
  );
  return true;
}

/**
 * Whether `e` is inside its own house mid-sleep or mid-meal. Testing the house and not just the
 * atomic is load-bearing: the open-ground rung starts an identical `sleep` atomic, so the atomic alone
 * would also match a settler behind a stale indoors marker. A meal must come off the home's own larder.
 * Prayer is always outdoors and never keeps the indoor top-up chain running.
 */
export function isServedAtHome(world: World, e: Entity): boolean {
  const home = world.tryGet(e, Residence)?.home;
  if (home === undefined || !isInside(world, e, home)) return false;
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic === undefined) return false;
  const { effect } = atomic;
  return effect.kind === 'sleep' || (effect.kind === 'eat' && effect.from === home);
}
