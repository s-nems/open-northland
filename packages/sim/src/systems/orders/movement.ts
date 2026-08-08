import {
  type AttackMoveMarch,
  AttackOrder,
  Carrying,
  CurrentAtomic,
  DeferredOrder,
  Engagement,
  EquipOrder,
  ErectSignpostOrder,
  Fleeing,
  HuntFocus,
  MoveGoal,
  Owner,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  Stranded,
  TrainingOrder,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { MILITARY_MODE } from '../readviews/index.js';
import { startDrop } from '../settlers/atomics/start.js';
import { releaseTowerPost } from '../settlers/drives/tower-post.js';
import { navigationLimitFor } from '../signposts/index.js';
import { clearNavState, isTravelling } from '../spatial/nodes.js';
import { deferOrderDuringAtomic } from './guards.js';

/**
 * Direct player control over owned units. Faithful to *Cultures*, a move order never seizes a unit
 * permanently: the economy AI reclaims it the tick it arrives, with no post-arrival stand, and the needs
 * drives can pull it away at any time. Approximation: RTS-style box-select-and-move for civilians deviates
 * from the original's hand and profession control.
 */

/**
 * Resolve a raw clicked node to one the unit can stand on: a click on a resource footprint, a building body,
 * or unwalkable terrain snaps to the nearest walkable unblocked node, so the unit walks to the edge of what
 * was clicked.
 *
 * Only static blockers and terrain count; re-aiming a goal off a standing unit belongs to the routing
 * surround rule.
 */
function reachableMoveGoal(world: World, ctx: SystemContext, terrain: TerrainGraph, clicked: NodeId): NodeId {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  if (terrain.isWalkable(clicked) && !blocked.has(clicked)) return clicked;
  return nearestUnblockedNode(terrain, clicked, blocked) ?? clicked;
}

/** Drop a player order and the nav state it drove, returning the unit to full autonomy. */
function clearPlayerOrder(world: World, e: Entity): void {
  world.remove(e, PlayerOrder);
  clearNavState(world, e);
}

/**
 * Order one owned settler to walk to (x,y). It drops whatever the unit was doing so the order takes effect
 * immediately, except a non-interruptible atomic, which parks the order instead
 * ({@link deferOrderDuringAtomic}). A settler carrying a load sets it down where it stands first, and
 * {@link playerOrderSystem} launches the walk the tick the drop finishes.
 */
export function moveUnit(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveUnit' }>,
): void {
  startPlayerWalk(world, ctx, command);
}

/** {@link moveUnit}'s walk stamped with an {@link AttackMoveMarch} - the "Attack Position" order. */
export function attackMoveUnit(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'attackMoveUnit' }>,
): void {
  startPlayerWalk(world, ctx, command);
}

/** Issue either flavour of the player's walk order; the command's `kind` decides which. */
function startPlayerWalk(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to navigate over
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Position) || !world.has(e, Owner)) return;

  const goal = reachableMoveGoal(world, ctx, terrain, terrain.nodeAtClamped(command.x, command.y));
  // Signpost confinement: a civilian ordered beyond its allowed area doesn't know the way, so the order is
  // refused and the unit stays put (source basis: observed original guidepost behaviour).
  const limit = navigationLimitFor(world, ctx.content, terrain, e);
  if (limit !== null && !limit.allowsNode(goal)) return;
  // Gated after the refusals above, so a refused click neither parks an order nor displaces a parked one.
  if (deferOrderDuringAtomic(world, ctx, e, command)) return;
  world.remove(e, DeferredOrder); // this order executes now - it supersedes any earlier parked one
  // A live PathFollow is deliberately kept: the planner re-routes the same tick, and the routing splice
  // carries the walker's momentum through the turn.
  world.remove(e, CurrentAtomic);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, Stranded); // a fresh order ends a stranded park - the next strand re-paces from zero
  // A fresh walk order supersedes the current fight, so the unit obeys instead of chasing its old target;
  // an attack-move re-acquires from scratch on the next combat pass.
  world.remove(e, Engagement);
  world.remove(e, AttackOrder);
  world.remove(e, HuntFocus);
  world.remove(e, Fleeing);
  world.remove(e, ErectSignpostOrder);
  // Cancelling the equip errand is the player's only way to call it off; left standing it would resume after
  // the walk and drag the settler back to its stale pre-order return spot.
  world.remove(e, EquipOrder);
  world.remove(e, TrainingOrder); // likewise the player's only way to call a barracks drill off
  // Likewise a tower posting; no other kind of worker is unemployed by a walk order.
  releaseTowerPost(world, ctx, e);
  // A move order relocates a DEFEND unit's post, or the arrived-hold combat pass would march the guard back
  // to its old anchor the moment it found no enemy there.
  const stance = world.tryMut(e, Stance);
  if (stance !== undefined && stance.mode === MILITARY_MODE.DEFEND) stance.anchorCell = goal;

  // An attack-move walk carries its destination on the order itself: a fight overwrites the MoveGoal with
  // chase destinations, so the march would otherwise have nothing left to resume toward.
  const march: { attackMove?: AttackMoveMarch } =
    command.kind === 'attackMoveUnit' ? { attackMove: { goal, resume: false, blockedUntil: 0 } } : {};

  // Hands full: set the load down first and park the destination. CurrentAtomic was cleared above, so
  // startDrop always takes.
  if (world.has(e, Carrying)) {
    startDrop(world, ctx, e);
    world.add(e, PlayerOrder, { ...march, pendingGoal: goal });
    return;
  }
  world.add(e, MoveGoal, { cell: goal });
  world.add(e, PlayerOrder, march);
}

/**
 * Retire a move order the moment its walk is done and hand the unit back to the autonomous economy. It runs
 * just before the planner so an arriving unit is re-tasked the same tick.
 *
 * The branches below are a priority ladder: combat is checked above the failed-route and acting rungs
 * because a swing is a {@link CurrentAtomic} and a failed chase route is not the march's. While the order
 * stands, the planner's economy branch skips the unit but its needs drives still run.
 */
export const playerOrderSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no orders were issuable
  for (const e of world.query(Settler, PlayerOrder)) {
    const order = world.get(e, PlayerOrder);
    const march = order.attackMove;
    if (order.pendingGoal !== undefined) {
      if (world.has(e, CurrentAtomic)) continue; // still setting the load down - the walk waits
      world.add(e, MoveGoal, { cell: order.pendingGoal });
      // Clear pendingGoal so this becomes an ordinary en-route order, keeping any march.
      world.add(e, PlayerOrder, march === undefined ? {} : { attackMove: march });
      continue;
    }
    if (march !== undefined && world.has(e, Engagement)) {
      // The fight has the unit; the march waits it out and resumes below when combat lets go.
      const o = world.mut(e, PlayerOrder);
      if (o.attackMove !== undefined) o.attackMove.resume = true;
      continue;
    }
    if (world.tryGet(e, PathRequest)?.failed) {
      // A failed request is never retried, so the order must be dropped or the unit freezes on it forever.
      clearPlayerOrder(world, e);
      continue;
    }
    if (world.has(e, CurrentAtomic)) {
      world.remove(e, PlayerOrder); // a need drive took over
      continue;
    }
    if (isTravelling(world, e)) {
      continue; // still walking the order out
    }
    if (march?.resume === true) {
      const o = world.mut(e, PlayerOrder);
      if (o.attackMove !== undefined) o.attackMove.resume = false;
      world.add(e, MoveGoal, { cell: march.goal }); // the fight is over - walk on to the ordered spot
      continue;
    }
    world.remove(e, PlayerOrder); // arrived - economy resumes (plannerSystem re-tasks this tick)
  }
};
