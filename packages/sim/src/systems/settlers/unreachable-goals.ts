import { type UnreachableGoal, UnreachableGoals } from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';

// The failed-goal memo is keyed by cell alone and therefore drive-agnostic, since routing failed to reach
// that node whoever wanted to go there. A settler's bound work targets are exempt, mirroring the signpost
// gate: vetoing its one legal sink would strand its load.

/**
 * How long a failed goal stays excluded, whether or not the blocker clears sooner. Longer than the stranded
 * park so the settler commits to a different target instead of flipping back the moment it re-plans, and
 * short enough that ground freed meanwhile returns to play within the minute. Approximation: the original's
 * recovery pacing is not readable.
 */
export const UNREACHABLE_GOAL_MEMO_TICKS = 30 * TICKS_PER_SECOND;

/**
 * How many failed goals one settler remembers. Above 1 so a settler ringed by several walled-off
 * targets cannot cycle between them (each eviction re-admitting the last), small enough that the memo
 * stays a handful of numbers per settler.
 */
export const UNREACHABLE_GOAL_MEMO_SIZE = 8;

/** Drop expired entries, returning the stored array untouched when none expired, so the common path does
 *  not allocate. Sound because deadlines ascend along the array: entries are appended with a constant
 *  lifetime and a re-noted cell moves to the tail. */
function live(entries: readonly UnreachableGoal[], tick: number): readonly UnreachableGoal[] {
  const oldest = entries[0];
  if (oldest === undefined || oldest.until > tick) return entries;
  return entries.filter((e) => e.until > tick);
}

/** Record that `cell` could not be routed to, so the next target pick skips it. Re-noting a remembered
 *  cell refreshes its deadline rather than adding a duplicate. */
export function noteUnreachableGoal(world: World, ctx: SystemContext, e: Entity, cell: NodeId): void {
  const until = ctx.tick + UNREACHABLE_GOAL_MEMO_TICKS;
  const memo = world.tryGet(e, UnreachableGoals);
  const kept = [
    ...live(memo?.entries ?? [], ctx.tick).filter((entry) => entry.cell !== cell),
    { cell, until },
  ];
  // Oldest-first eviction: the array is append-ordered, so the head is the least recent failure.
  const entries = kept.slice(Math.max(0, kept.length - UNREACHABLE_GOAL_MEMO_SIZE));
  if (memo === undefined) world.add(e, UnreachableGoals, { entries });
  else world.mut(e, UnreachableGoals).entries = entries;
}

/**
 * Drop `e`'s expired entries, shedding the component once none are left, so a settler that recovered
 * carries no dead state into the hash. Kept out of `unreachableGoals` so the target scans stay pure reads.
 */
export function pruneUnreachableGoals(world: World, ctx: SystemContext, e: Entity): void {
  const memo = world.tryGet(e, UnreachableGoals);
  if (memo === undefined) return;
  const entries = live(memo.entries, ctx.tick);
  if (entries.length === 0) world.remove(e, UnreachableGoals);
  else if (entries.length !== memo.entries.length) world.mut(e, UnreachableGoals).entries = entries;
}

/**
 * The goals `e` should not re-target, or null when it remembers none. A pure read: `pruneUnreachableGoals`
 * owns expiry. It stays an array because at this memo size a linear probe beats building a `Set` per scan.
 */
export function unreachableGoals(
  world: World,
  ctx: SystemContext,
  e: Entity,
): readonly UnreachableGoal[] | null {
  const memo = world.tryGet(e, UnreachableGoals);
  if (memo === undefined) return null;
  const entries = live(memo.entries, ctx.tick);
  return entries.length === 0 ? null : entries;
}

/** Whether `cell` is one of the goals this settler's routes just failed on. */
export function isUnreachableGoal(memo: readonly UnreachableGoal[] | null, cell: NodeId): boolean {
  return memo?.some((entry) => entry.cell === cell) === true;
}

/** The memo as the cell veto the index scans take, or undefined when this settler remembers no failures, so
 *  a settler whose routes all succeeded adds no per-candidate work to its scans. */
export function unreachableGoalVeto(
  world: World,
  ctx: SystemContext,
  e: Entity,
): ((cell: NodeId) => boolean) | undefined {
  const memo = unreachableGoals(world, ctx, e);
  if (memo === null) return undefined;
  return (cell) => isUnreachableGoal(memo, cell);
}
