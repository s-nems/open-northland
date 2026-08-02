import { type UnreachableGoal, UnreachableGoals } from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';

/**
 * The failed-goal memo ({@link UnreachableGoals}) - written when the planner sheds a dead route
 * (`releaseStaleIntent`), read by the target scans so a re-plan skips what it just failed to reach.
 *
 * Keyed by cell alone and therefore drive-agnostic: routing failed to reach that node, which is true
 * whoever wanted to go there, so a failed delivery also retires the node for the harvest pick. The
 * searched target picks and the rest/sleep stand picks veto remembered cells, each keyed at the cell
 * the route actually walks (a construction site at its perimeter stand, not its bucketed door). A
 * settler's BOUND work targets (its own workplace/flag/storage/crew site, its home as the family
 * delivery sink - the sleep walk still vetoes a failed home door) are exempt, mirroring the signpost
 * gate: a settler always knows the way home, and vetoing the one legal sink would strand its load.
 * The loiter/de-stack stands and the flag yard (its own failed-route resume, `YardDeliveryRoute`)
 * stay outside it.
 */

/**
 * How long a failed goal stays excluded. Comfortably longer than the stranded park
 * (`STRANDED_RETRY_TICKS`, 4 s) so the settler actually commits to a different target instead of
 * flipping back the moment it re-plans, and short enough that ground freed meanwhile - a felled tree,
 * a colleague who moved on - comes back into play within the minute. The target stays retired for the
 * full window even if the blocker clears sooner; the settler works elsewhere meanwhile, which is the
 * trade this memo exists to make. Our recovery pacing; the original's is not readable.
 */
export const UNREACHABLE_GOAL_MEMO_TICKS = 30 * TICKS_PER_SECOND;

/**
 * How many failed goals one settler remembers. Above 1 so a settler ringed by several walled-off
 * targets cannot cycle between them (each eviction re-admitting the last), small enough that the memo
 * stays a handful of numbers per settler.
 */
export const UNREACHABLE_GOAL_MEMO_SIZE = 8;

/** Drop expired entries, returning the stored array untouched when none expired - the memo is read up
 *  to four times per gatherer per tick, so the common path must not allocate. Sound because deadlines
 *  ascend along the array: entries are appended with a constant lifetime, and a re-noted cell moves to
 *  the tail, so an unexpired head means nothing behind it expired either. */
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
  // Not written through `world.write`: the memo is a planner-private decision input no snapshot consumer reads,
  // so nothing identity-keyed can go stale on this write.
  if (memo === undefined) world.add(e, UnreachableGoals, { entries });
  else memo.entries = entries;
}

/**
 * Drop `e`'s expired entries, shedding the component once none are left - the memo's lifecycle step,
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
 * The goals `e` should not re-target, or null when it remembers none - the fast path every settler
 * whose routes all succeeded takes. A pure read: {@link pruneUnreachableGoals} owns expiry. Probe it
 * with {@link isUnreachableGoal}; the array stays an array because at {@link UNREACHABLE_GOAL_MEMO_SIZE}
 * entries a linear probe beats building a `Set` per scan.
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

/** The memo as the cell veto the index scans take (`InteractionCellIndex.nearest`'s `avoid`), or
 *  undefined when this settler remembers no failures - so the common all-routes-succeeded settler
 *  adds no per-candidate work to its scans. */
export function unreachableGoalVeto(
  world: World,
  ctx: SystemContext,
  e: Entity,
): ((cell: NodeId) => boolean) | undefined {
  const memo = unreachableGoals(world, ctx, e);
  if (memo === null) return undefined;
  return (cell) => isUnreachableGoal(memo, cell);
}
