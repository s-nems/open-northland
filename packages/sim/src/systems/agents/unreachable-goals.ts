import { UnreachableGoals } from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';

/**
 * The failed-goal memo ({@link UnreachableGoals}) — written when the planner sheds a dead route
 * (`releaseStaleIntent`), read by the target scans so a re-plan skips what it just failed to reach.
 */

/**
 * How long a failed goal stays excluded. Comfortably longer than the stranded park
 * (`STRANDED_RETRY_TICKS`, 4 s) so the settler actually commits to a different target instead of
 * flipping back the moment it re-plans, and short enough that ground freed meanwhile — a felled tree,
 * a colleague who moved on — comes back into play within the minute. Our recovery pacing; the
 * original's is not readable.
 */
export const UNREACHABLE_GOAL_MEMO_TICKS = 30 * TICKS_PER_SECOND;

/**
 * How many failed goals one settler remembers. Above 1 so a settler ringed by several walled-off
 * targets cannot cycle between them (each eviction re-admitting the last), small enough that the memo
 * stays a handful of numbers per settler.
 */
export const UNREACHABLE_GOAL_MEMO_SIZE = 8;

/** Drop expired entries; returns the live ones. Pruning on every touch is what keeps the component —
 *  and the state hash — from carrying stale cells forever. */
function live(
  entries: readonly { readonly cell: NodeId; readonly until: number }[],
  tick: number,
): readonly { readonly cell: NodeId; readonly until: number }[] {
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
  else memo.entries = entries;
}

/**
 * Drop `e`'s expired entries, shedding the component once none are left — the memo's lifecycle step,
 * run from the planner prologue so a settler that recovered carries no dead state into the hash. Kept
 * out of {@link unreachableGoals} so the target scans stay pure reads.
 */
export function pruneUnreachableGoals(world: World, ctx: SystemContext, e: Entity): void {
  const memo = world.tryGet(e, UnreachableGoals);
  if (memo === undefined) return;
  const entries = live(memo.entries, ctx.tick);
  if (entries.length === 0) world.remove(e, UnreachableGoals);
  else if (entries.length !== memo.entries.length) memo.entries = entries;
}

/**
 * The cells `e` should not re-target, or null when it remembers none — the fast path every settler
 * whose routes all succeeded takes. A pure read: {@link pruneUnreachableGoals} owns expiry.
 */
export function unreachableGoals(world: World, ctx: SystemContext, e: Entity): ReadonlySet<NodeId> | null {
  const memo = world.tryGet(e, UnreachableGoals);
  if (memo === undefined) return null;
  const entries = live(memo.entries, ctx.tick);
  return entries.length === 0 ? null : new Set(entries.map((entry) => entry.cell));
}
