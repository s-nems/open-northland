import {
  Chat,
  CurrentAtomic,
  Engagement,
  FamilyDuty,
  Fleeing,
  PathRequest,
  PlayerOrder,
  Resting,
  Stranded,
  Wedding,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { clearNavState, isTravelling } from '../spatial.js';
import { type InboundSupplyTally, releaseSupplyRun } from '../stores/index.js';
import { reconcileYardRoute } from './economy/index.js';
import { type FarmClaims, releaseFarmTask } from './farming/index.js';

// The planner's per-settler prologue: decide whether a settler is idle enough to re-plan this tick and,
// when it is, shed every intent a previous tick left on it — so the drive ladder in ./ai.ts sees a clean
// settler and never re-chooses against its own stale claims.

/** How long a stranded walker parks before shedding its failed route and re-planning — long enough that
 *  a permanently blocked target costs one path query per episode, short enough that a transient blockage
 *  (a footprint stamped mid-walk, a crowd) heals within seconds. Our recovery pacing (the original's
 *  retry cadence is not readable). */
const STRANDED_RETRY_TICKS = 4 * TICKS_PER_SECOND;

/** Whether a drive that runs its own failed-route protocol owns `e`'s walk: the player-order, chase,
 *  flee, wedding, and gossip systems each read the `failed` flag and clear/cancel it themselves — the
 *  planner's stranded recovery must not eat their signal. */
function ownsFailedRoute(world: World, e: Entity): boolean {
  return (
    world.has(e, PlayerOrder) ||
    world.has(e, Engagement) ||
    world.has(e, Fleeing) ||
    world.has(e, Wedding) ||
    world.has(e, Chat)
  );
}

/**
 * Reconcile `e`'s leftover intent and report whether the drive ladder should run for it this tick.
 *
 * Returns false while the settler is spoken for: an atomic is running, it is walking a live route, or it
 * is parking a failed one. A FAILED route is not travel — nothing on the nav side retries it
 * (navigationPlanner skips any entity with a live request; routing skips failed ones), so a settler left in
 * that state stands forever. Drives with their own failure protocol keep the signal
 * ({@link ownsFailedRoute}); for everyone else the planner parks the dead route ({@link Stranded}), then
 * sheds it and re-plans — the pacing costs one path query per retry instead of per tick when the target
 * stays blocked, and a transient blockage heals on its own.
 *
 * Returns true once the settler is genuinely re-planning, having first released what the previous intent
 * held: its {@link YardDeliveryRoute} (reconciled against the live load/flag — see
 * {@link reconcileYardRoute}), its farm claim (so it never blocks ITSELF from re-choosing the field it was
 * walking to), its rest-inside marker, and its supply errand. Each is re-stamped by the drive that still
 * wants it within this same tick, so the render never sees a gap: a settler mid-park keeps its SupplyRun
 * (released only at the re-plan) because the errand may resume after a transient blockage, and a settler
 * on family duty keeps its {@link Resting} marker (the FamilySystem owns that one).
 */
export function releaseStaleIntent(
  world: World,
  ctx: SystemContext,
  e: Entity,
  farmClaims: FarmClaims,
  inbound: InboundSupplyTally,
): boolean {
  reconcileYardRoute(world, e);
  if (world.has(e, CurrentAtomic)) return false;
  // Fresh read — reconcileYardRoute may have cleared the request.
  const request = world.tryGet(e, PathRequest);
  if (request?.failed === true && !ownsFailedRoute(world, e)) {
    const stranded = world.tryGet(e, Stranded);
    if (stranded === undefined) {
      world.add(e, Stranded, { retryAt: ctx.tick + STRANDED_RETRY_TICKS });
      return false;
    }
    if (ctx.tick < stranded.retryAt) return false;
    clearNavState(world, e); // sheds Stranded with the route — fall through and re-plan this tick
  } else if (isTravelling(world, e)) {
    return false;
  }
  releaseFarmTask(world, e, farmClaims);
  if (!world.has(e, FamilyDuty)) world.remove(e, Resting);
  // Releasing through the tally keeps the inbound count in lockstep with the store.
  releaseSupplyRun(world, e, inbound);
  return true;
}
