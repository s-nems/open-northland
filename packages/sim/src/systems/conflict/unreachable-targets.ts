import { type UnreachableTarget, UnreachableTargets } from '../../components/index.js';
import { liveEntries, remember } from '../../core/expiring-list.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { UNREACHABLE_GOAL_MEMO_SIZE, UNREACHABLE_GOAL_MEMO_TICKS } from '../settlers/unreachable-goals.js';

// The given-up-enemy memo: the combat twin of settlers/unreachable-goals.ts, keyed by enemy because what the
// chase could not reach is the enemy's whole contact band, not one cell of it.

/** How long a given-up enemy stays skipped: the economy memo's pacing, here the ceiling on how long a
 *  breached compound goes unstormed. Approximation. */
export const UNREACHABLE_TARGET_MEMO_TICKS = UNREACHABLE_GOAL_MEMO_TICKS;

/** How many given-up enemies one combatant remembers, the economy memo's cap for the same cycling reason. */
export const UNREACHABLE_TARGET_MEMO_SIZE = UNREACHABLE_GOAL_MEMO_SIZE;

/** Record that `e`'s chase gave `target` up, so its acquisition skips the enemy. Re-noting a remembered enemy
 *  refreshes its deadline rather than adding a duplicate. */
export function noteUnreachableTarget(world: World, ctx: SystemContext, e: Entity, target: Entity): void {
  const memo = world.tryGet(e, UnreachableTargets);
  const entries = remember(
    memo?.entries ?? [],
    ctx.tick,
    { target, until: ctx.tick + UNREACHABLE_TARGET_MEMO_TICKS },
    (entry) => entry.target === target,
    UNREACHABLE_TARGET_MEMO_SIZE,
  );
  if (memo === undefined) world.add(e, UnreachableTargets, { entries });
  else world.mut(e, UnreachableTargets).entries = entries;
}

/** Drop `e`'s lapsed entries, shedding the component once none are left. */
export function pruneUnreachableTargets(world: World, ctx: SystemContext, e: Entity): void {
  const memo = world.tryGet(e, UnreachableTargets);
  if (memo === undefined) return;
  const entries = liveEntries(memo.entries, ctx.tick);
  if (entries.length === 0) world.remove(e, UnreachableTargets);
  else if (entries.length !== memo.entries.length) world.mut(e, UnreachableTargets).entries = entries;
}

/** The enemies `e` gave up, or undefined when it remembers none, so an untroubled seeker adds no
 *  per-candidate work. Prunes first, so a lapsed entry never vetoes. */
export function givenUpTargets(
  world: World,
  ctx: SystemContext,
  e: Entity,
): readonly UnreachableTarget[] | undefined {
  pruneUnreachableTargets(world, ctx, e);
  return world.tryGet(e, UnreachableTargets)?.entries;
}

/** Whether `entries` name `t`. */
export function gaveUp(entries: readonly UnreachableTarget[], t: Entity): boolean {
  for (const entry of entries) if (entry.target === t) return true;
  return false;
}

/** {@link givenUpTargets} as a veto over candidates, or undefined when `e` remembers no enemy. */
export function givenUpTargetVeto(
  world: World,
  ctx: SystemContext,
  e: Entity,
): ((t: Entity) => boolean) | undefined {
  return vetoOf(givenUpTargets(world, ctx, e));
}

/** `entries` as a veto over candidates, or undefined for none. */
export function vetoOf(
  entries: readonly UnreachableTarget[] | undefined,
): ((t: Entity) => boolean) | undefined {
  if (entries === undefined) return undefined;
  return (t) => gaveUp(entries, t);
}

/** Whether `e` gave `t` up, without building a veto. */
export function hasGivenUpTarget(world: World, ctx: SystemContext, e: Entity, t: Entity): boolean {
  const entries = givenUpTargets(world, ctx, e);
  return entries !== undefined && gaveUp(entries, t);
}
