import {
  AttackOrder,
  Carrying,
  CurrentAtomic,
  Engagement,
  ErectSignpostOrder,
  Fleeing,
  MoveGoal,
  Owner,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  Stranded,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { startDrop } from '../agents/actions.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { MILITARY_MODE } from '../readviews/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { clearNavState, isTravelling } from '../spatial.js';

/**
 * The player-order handlers (`moveUnit` / `setJob`) + the {@link playerOrderSystem} that plays a move order
 * out as a soft override — the direct control the human exerts over its own units.
 *
 * The design is faithful to *Cultures*: settlers are autonomous, so a move order does not seize a unit
 * permanently — it sends the unit somewhere, then hands it back to the economy AI the tick it arrives. There
 * is no post-arrival stand (DEFEND's stance anchor is the position-holding tool), and the needs drives
 * (eat/sleep/pray) can pull the unit away at any time (see {@link playerOrderSystem}). RTS-style
 * box-select-and-move for civilians is itself a deviation from the original's hand/profession control
 * (recorded in source basis).
 */

/**
 * Resolve a raw clicked node to a node the unit can actually stand on. A click on a resource footprint
 * (tree/stone/iron/gold), a building body, or an unwalkable tile (water/rock) has no standable goal there —
 * the pathfinder rejects it outright and the order would fail with the unit standing still. Snap such a goal
 * to the nearest walkable, unblocked node so the unit walks to the edge of what was clicked. A standable click
 * is returned untouched.
 *
 * Only static blockers (resource + building footprints) and terrain are considered; transient unit bodies are
 * ignored, so this stays consistent with the economy's exact node-coincidence walks (re-aiming a goal off a
 * standing unit is the routing surround rule's job, applied only to colliders — see movement/routing.ts). The
 * overlay is a membership view ({@link dynamicBlockOverlay}), so a box-select issuing one move order per unit
 * never re-copies the resource overlay per order.
 */
function reachableMoveGoal(world: World, ctx: SystemContext, terrain: TerrainGraph, clicked: NodeId): NodeId {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  if (terrain.isWalkable(clicked) && !blocked.has(clicked)) return clicked; // standable — no snap
  return nearestUnblockedNode(terrain, clicked, blocked) ?? clicked;
}

/** Drop a player order and the nav state it drove, returning the unit to full autonomy. */
function clearPlayerOrder(world: World, e: Entity): void {
  world.remove(e, PlayerOrder);
  clearNavState(world, e);
}

/**
 * Order one owned settler to walk to (x,y) — the RTS "go there" order. It drops whatever the unit was doing
 * (a mid-action atomic, a stale route, an old goal) so the order takes effect immediately, sets a fresh
 * {@link MoveGoal} (the existing pathfinding→movement pipeline carries it out), and stamps the
 * {@link PlayerOrder} en-route marker so the autonomous drives leave the walk alone until arrival (see
 * {@link playerOrderSystem}).
 *
 * A settler ordered to walk while carrying a load sets the load down first — it can't walk with its hands
 * full. The order starts the drop atomic (the same set-it-down animation a profession change / enemy uses) and
 * parks the destination on {@link PlayerOrder}'s `pendingGoal`; {@link playerOrderSystem} launches the walk the
 * tick the drop finishes. So an ordered porter drops its wood where it stands, then walks off empty-handed —
 * never hauling the load to the ordered spot, and never ignoring the order.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale target, a non-settler, or a
 * neutral entity with no {@link Owner} (only a player-owned unit is orderable). A mapless sim is a no-op too.
 * The command carries no issuing-player yet, so it doesn't verify which player owns the unit — the app only
 * issues orders for the human's own units, and the per-player check lands with lockstep (source basis).
 */
export function moveUnit(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveUnit' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to navigate over
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Position) || !world.has(e, Owner)) return;

  const goal = reachableMoveGoal(world, ctx, terrain, terrain.nodeAtClamped(command.x, command.y));
  // Signpost confinement: a civilian ordered beyond its allowed area doesn't know the way — the order
  // is refused and the unit stays put (source basis: observed original guidepost behaviour). Scouts and
  // fighters are exempt (navigationLimitFor returns null for them, and whenever confinement is off).
  const limit = navigationLimitFor(world, terrain, e);
  if (limit !== null && !limit.allowsNode(goal)) return;
  // The order is authoritative — cancel the unit's current action + any pending route request so it obeys
  // now, then set the new goal. (A non-interruptible-atomic exception is a deferred refinement.) A live
  // PathFollow is deliberately kept: the planner sees a route whose destination no longer matches the goal and
  // re-routes the same tick, and the routing splice replaces the path while carrying the walker's momentum
  // through the turn (movement inertia) — dropping it here made every redirect stop dead and re-accelerate.
  world.remove(e, CurrentAtomic);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, Stranded); // a fresh order ends a stranded park — the next strand re-paces from zero
  // A move order supersedes combat: drop any auto-engagement and attack focus so the unit walks off and holds
  // instead of re-acquiring its target — otherwise the CombatSystem re-chases and the order only ever moves it
  // one step.
  world.remove(e, Engagement);
  world.remove(e, AttackOrder);
  world.remove(e, Fleeing); // a move order supersedes the flee drive too
  world.remove(e, ErectSignpostOrder); // a fresh move order supersedes a pending erect intent
  // A move order relocates a DEFEND unit's post: the guard defends the spot it was sent to, not the tile the
  // stance was set on. Without the re-anchor, the arrived-hold combat pass would march the guard back to its
  // old anchor the moment it found no enemy there.
  const stance = world.tryGet(e, Stance);
  if (stance !== undefined && stance.mode === MILITARY_MODE.DEFEND) stance.anchorCell = goal;

  // Hands full: halt and set the load down first (the drop atomic stops any walk in progress — startDrop
  // clears the nav state), parking the destination. The walk starts once the drop completes
  // (playerOrderSystem). CurrentAtomic was just cleared above, so startDrop always takes.
  if (world.has(e, Carrying)) {
    startDrop(world, ctx, e);
    world.add(e, PlayerOrder, { pendingGoal: goal });
    return;
  }
  world.add(e, MoveGoal, { cell: goal });
  world.add(e, PlayerOrder, {});
}

/**
 * PlayerOrderSystem — retires a move order the moment its walk is done and hands the unit back to the
 * autonomous economy. It runs just before {@link aiSystem} so an arriving unit is re-tasked the same tick.
 *
 * Per unit under a {@link PlayerOrder}, in priority order:
 *  1. **Pending drop** (a `pendingGoal` parked on the order): the ordered unit was carrying and is setting its
 *     load down first (`moveUnit`). While the drop atomic runs, wait; the tick it finishes (no
 *     {@link CurrentAtomic}), launch the parked walk — set the {@link MoveGoal} and clear `pendingGoal`, so
 *     from here it is an ordinary en-route order.
 *  2. **Route failed** (an unwalkable/off-map target): abandon the order and clear the dead nav state (a
 *     failed {@link PathRequest} is never retried, so without this the unit would freeze on it forever).
 *  3. **Acting** (a {@link CurrentAtomic} appeared): a need drive took over (the economy branch is gated off
 *     by this order, so only a need could) — drop the order, leave the atomic running.
 *  4. **Travelling** (goal/request/path present): the order's own walk — keep it.
 *  5. **Arrived & idle**: remove the order so {@link aiSystem} re-tasks the unit this tick; no post-arrival
 *     stand.
 *
 * While the order stands, {@link aiSystem}'s economy branch skips the unit but its needs drives still run.
 */
export const playerOrderSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no orders were issuable
  for (const e of world.query(Settler, PlayerOrder)) {
    const pendingGoal = world.get(e, PlayerOrder).pendingGoal;
    if (pendingGoal !== undefined) {
      if (world.has(e, CurrentAtomic)) continue; // still setting the load down — the walk waits
      world.add(e, MoveGoal, { cell: pendingGoal }); // drop done — start the parked walk now
      world.add(e, PlayerOrder, {}); // clear pendingGoal: an ordinary en-route order from here
      continue;
    }
    if (world.tryGet(e, PathRequest)?.failed) {
      clearPlayerOrder(world, e); // target unreachable — return to autonomy
      continue;
    }
    if (world.has(e, CurrentAtomic)) {
      world.remove(e, PlayerOrder); // a need took over — went off to do its own thing
      continue;
    }
    if (isTravelling(world, e)) {
      continue; // still walking the order out
    }
    world.remove(e, PlayerOrder); // arrived — economy resumes (aiSystem re-tasks this tick)
  }
};
