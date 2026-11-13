import type { AiOrderOrigin } from '../../components/ai/order.js';
import {
  type AttackMoveMarch,
  AttackOrder,
  Carrying,
  Chat,
  ClaimAnimalOrder,
  CurrentAtomic,
  DeferredOrder,
  Engagement,
  EquipOrder,
  ErectSignpostOrder,
  ExploreOrder,
  Fleeing,
  GraduateWait,
  HuntFocus,
  MoveGoal,
  NeedOrder,
  OpenChestOrder,
  Owner,
  PathFollow,
  PathRequest,
  PickupClaim,
  PlayerOrder,
  Position,
  removeCurrentAtomic,
  Settler,
  Stranded,
  SupplyRun,
  TrainingOrder,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import { ringSearch } from '../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import {
  buildingDoorwayNodes,
  dynamicBlockOverlay,
  ROUTE_REGION_POCKET_CAP,
  routeRegions,
} from '../footprint/index.js';
import { isTravelling, onNodeCentre, stopAtNextNode } from '../movement/nav-state.js';
import { clickSides } from '../movement/structure-route.js';
import { breakThroughWall } from '../palisades/breach.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { startDrop } from '../settlers/atomics/start.js';
import { releaseTowerPost } from '../settlers/drives/tower-post.js';
import { heldIndoors, stepOut } from '../settlers/indoors.js';
import { announceLostWay, liftLostWalk, markLostWay } from '../settlers/lost-way.js';
import { navigationLimitFor } from '../signposts/index.js';
import { entityNode } from '../spatial/nodes.js';
import { pullsHaulingCart } from '../vehicles/hauling-cart.js';
import { ferryLandingOf, tryFerryPassage } from '../vehicles/ferry.js';
import { recordAiOrder } from './ai-lifecycle.js';
import { moveAnchor } from './combat.js';
import { deferOrderDuringAtomic, supersedeStandingOrders } from './guards.js';
import { breaksForMeal, suspendWalkForMeal } from './meal-break.js';

/**
 * Direct player control over owned units. Faithful to *Cultures*, a move order never seizes a unit
 * permanently: the economy AI reclaims it the tick it arrives, with no post-arrival stand, and the needs
 * drives can pull it away at any time. Approximation: RTS-style box-select-and-move for civilians deviates
 * from the original's hand and profession control.
 */

/**
 * Resolve a raw clicked node to one the unit can stand on: a click on a resource footprint, a building body,
 * or unwalkable terrain snaps to the nearest walkable unblocked node off every doorway with an open side, or
 * failing that a sealed one, so the unit walks to the edge of what was clicked. A click on open ground, a
 * doorway included, is the player's own stand and is kept as given.
 *
 * Only static blockers and terrain count; re-aiming a goal off a standing unit belongs to the routing
 * surround rule.
 */
export function reachableMoveGoal(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  clicked: NodeId,
): NodeId {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  if (terrain.isWalkable(clicked) && !blocked.has(clicked)) return clicked;
  const doorways = buildingDoorwayNodes(world, ctx, terrain);
  return (
    nearestUnblockedNode(terrain, clicked, blocked, { avoid: doorways, sealedFallback: true }) ?? clicked
  );
}

/**
 * {@link reachableMoveGoal} for a walker standing on `from`: a goal proven to lie in another region than
 * the walker's (a spot ringed by deposits, the far side of a closed gate, or open ground seen from a
 * walker sealed in itself) moves to the nearest node not proven apart from the walker, so the unit walks
 * up to the barrier instead of failing the route and wandering off lost. A click on a blocker itself,
 * such as a closed gate between regions too large to prove a pocket, snaps to the nearest node joined to
 * the walker around structures. A goal with no such node within the search is kept. Approximation of the
 * original's click handling.
 */
function walkerSideMoveGoal(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  clicked: NodeId,
  from: NodeId,
): NodeId {
  const goal = reachableMoveGoal(world, ctx, terrain, clicked);
  const regions = routeRegions(world, ctx, terrain);
  // Authored cost guard: the visits count blocked nodes too, so this reaches out about nine cells, past
  // a pocket and a thin wall but not through a thick one.
  const visits = 2 * ROUTE_REGION_POCKET_CAP;
  if (regions.unroutable(from, goal)) {
    const outside = ringSearch(terrain, clicked, visits, {
      accept: (node) => regions.standable(node) && !regions.unroutable(from, node),
    });
    return outside ?? goal;
  }
  // Open ground clicked is the player's own stand, kept even past a wall the pocket proof cannot see; a
  // walker on a blocked node has no side to judge from.
  if (goal === clicked || !regions.standable(from)) return goal;
  const sides = clickSides(world, ctx, terrain, clicked);
  if (sides.reaches(from, goal)) return goal;
  const nearSide = ringSearch(terrain, clicked, visits, {
    accept: (node) => regions.standable(node) && sides.reaches(from, node),
  });
  return nearSide ?? goal;
}

/**
 * Order one owned settler to walk to (x,y). It drops whatever the unit was doing so the order takes effect
 * immediately, except a non-interruptible atomic, which parks the order instead
 * ({@link deferOrderDuringAtomic}). A settler carrying a load sets it down where it stands first, and
 * {@link playerOrderSystem} launches the walk the tick the drop finishes. Returns whether a walk (or its
 * park) now stands; false for a refused or bad order.
 */
export function moveUnit(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveUnit' }>,
  origin?: AiOrderOrigin,
): boolean {
  const accepted = startPlayerWalk(world, ctx, command);
  if (accepted) recordAiOrder(world, command.entity, origin);
  return accepted;
}

/** A map script's walk order: the player's walk without the signpost confinement, which the original
 *  applies in its GUI and not to a queued script command (reading). With `attackMove` it is the march
 *  {@link attackMoveUnit} issues. Returns whether a walk now stands. */
export function sendUnit(
  world: World,
  ctx: SystemContext,
  e: Entity,
  x: number,
  y: number,
  { attackMove = false }: { readonly attackMove?: boolean } = {},
): boolean {
  const kind = attackMove ? 'attackMoveUnit' : 'moveUnit';
  const accepted = startPlayerWalk(world, ctx, { kind, entity: e, x, y }, { confined: false });
  if (accepted) recordAiOrder(world, e);
  return accepted;
}

/** {@link moveUnit}'s walk stamped with an {@link AttackMoveMarch} - the "Attack Position" order. */
export function attackMoveUnit(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'attackMoveUnit' }>,
  origin?: AiOrderOrigin,
): boolean {
  const accepted = startPlayerWalk(world, ctx, command);
  if (accepted) recordAiOrder(world, command.entity, origin);
  return accepted;
}

/** Issue either flavour of the player's walk order; the command's `kind` decides which. */
function startPlayerWalk(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }>,
  { confined = true }: { readonly confined?: boolean } = {},
): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return false; // mapless sim: no cells to navigate over
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Position) || !world.has(e, Owner)) {
    return false;
  }

  const clicked = terrain.nodeAtClamped(command.x, command.y);
  // A plain move order re-aims, a player's or an AI's: a script names its spot, and an attack-move
  // breaches the wall.
  const goal =
    confined && command.kind === 'moveUnit'
      ? walkerSideMoveGoal(world, ctx, terrain, clicked, entityNode(world, terrain, e))
      : reachableMoveGoal(world, ctx, terrain, clicked);
  // Signpost confinement: a civilian ordered beyond its allowed area doesn't know the way, so the
  // order is refused and the unit stays put. Approximation: the original starts the walk and lets its
  // guided pathfinder fail it, raising the same "lost" note. A goal on another island is judged at the
  // crossing's landing place instead of the far spot: the posts must lead the settler to the shore
  // where they board or wait for the ship, and whether they could walk the far island themselves is
  // the ferryman's business - the scout at the helm knows it. Still refused before the ferry hold is
  // considered: a landing place the signposts forbid is refused whatever the ships could do for it.
  if (confined) {
    const limit = navigationLimitFor(world, ctx.content, terrain, e);
    if (limit !== null && !limit.allowsNode(goal)) {
      // The landing-place exception belongs to the crossing alone: an attack-move never takes a
      // ship, so it refuses on the far goal as any walk does.
      const landing = command.kind === 'moveUnit' ? ferryLandingOf(world, ctx, terrain, e, goal) : null;
      if (landing === null || !limit.allowsNode(landing)) {
        // A settler busy with something else is not left standing lost: the refusal is news for a moment.
        // A walk to a chat partner is not business.
        const busy = (isTravelling(world, e) && !world.has(e, Chat)) || atomicHoldsSettler(world, e);
        if (busy) announceLostWay(world, ctx, e);
        else markLostWay(world, ctx, e, goal);
        return false;
      }
    }
  }
  // A goal across open water is no walk, the route dying at the sea. With the owner's idle ship
  // moored at a shore of this island with a scout aboard, the order becomes a crossing instead: the
  // settler boards, the ship docks at the target island, the walk on resumes there. No ship takes the
  // booking, the order stands as a hold and the ferry system retries it until a ship comes free. A
  // settler held by an atomic waits for the parked order the
  // same way a walk does.
  if (
    confined &&
    command.kind === 'moveUnit' &&
    !atomicHoldsSettler(world, e) &&
    tryFerryPassage(world, ctx, terrain, e, goal)
  ) {
    return true;
  }
  const existingOrder = world.tryGet(e, PlayerOrder);
  if (
    command.kind === 'moveUnit' &&
    existingOrder !== undefined &&
    existingOrder.attackMove === undefined &&
    existingOrder.pendingGoal === undefined &&
    world.tryGet(e, MoveGoal)?.cell === goal &&
    world.has(e, PathFollow) &&
    world.tryGet(e, PathRequest)?.failed !== true &&
    !world.has(e, CurrentAtomic) &&
    !world.has(e, DeferredOrder) &&
    !world.has(e, Engagement) &&
    !world.has(e, AttackOrder) &&
    !world.has(e, Fleeing)
  ) {
    supersedeStandingOrders(world, e); // the same walk, but now the player's own, not a sweep's leg
    const scripted = confined ? undefined : true;
    if (existingOrder.scripted !== scripted) world.mut(e, PlayerOrder).scripted = scripted;
    return true;
  }
  // Gated after the refusals above, so a refused click neither parks an order nor displaces a parked one.
  if (deferOrderDuringAtomic(world, ctx, e, command, { scripted: !confined })) return true;
  supersedeStandingOrders(world, e);
  // A live PathFollow is deliberately kept: the planner re-routes the same tick, and the routing splice
  // carries the walker's momentum through the turn.
  removeCurrentAtomic(world, e);
  // Out of whatever it waited in, unless another system holds it there.
  if (!heldIndoors(world, e)) stepOut(world, e);
  world.remove(e, SupplyRun); // cancel the inbound site claim
  world.remove(e, PickupClaim); // and the source promise of its pickup leg
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
  world.remove(e, OpenChestOrder);
  world.remove(e, ClaimAnimalOrder);
  // Cancelling the equip errand is the player's only way to call it off; left standing it would resume after
  // the walk and drag the settler back to its stale pre-order return spot.
  world.remove(e, EquipOrder);
  world.remove(e, TrainingOrder); // likewise the player's only way to call a barracks drill off
  world.remove(e, GraduateWait); // a graduate the player moved stays where it was sent
  world.remove(e, NeedOrder); // and an ordered meal, nap, chat or prayer the walk supersedes
  liftLostWalk(world, e); // an obeyed order is the way found; a cut-off mark waits for its own check
  // Likewise a tower posting; no other kind of worker is unemployed by a walk order.
  releaseTowerPost(world, ctx, e);

  // An attack-move walk carries its destination on the order itself: a fight overwrites the MoveGoal with
  // chase destinations, so the march would otherwise have nothing left to resume toward.
  const order: { attackMove?: AttackMoveMarch; scripted?: true } = {
    ...(command.kind === 'attackMoveUnit' ? { attackMove: { goal, resume: false, blockedUntil: 0 } } : {}),
    ...(confined ? {} : { scripted: true }),
  };

  // Hands full: set the load down first and park the destination. CurrentAtomic was cleared above, so
  // startDrop always takes. A carrier pulling its hauling cart walks with the cart and its load instead:
  // the load is the cart's, and setting it down is a lift's work, not a hand's gesture.
  if (world.has(e, Carrying) && !pullsHaulingCart(world, e)) {
    startDrop(world, ctx, e);
    world.add(e, PlayerOrder, { ...order, pendingGoal: goal });
    return true;
  }
  world.add(e, MoveGoal, { cell: goal });
  world.add(e, PlayerOrder, order);
  return true;
}

/**
 * Retire a move order the moment its walk is done and hand the unit back to the autonomous economy. It runs
 * just before the planner so an arriving unit is re-tasked the same tick.
 *
 * The branches below are a priority ladder: combat is checked above the failed-route and acting rungs
 * because a swing is a {@link CurrentAtomic} and a failed chase route is not the march's. While the order
 * stands, the planner's economy branch skips the unit; only hunger takes it off a walk (`meal-break.ts`).
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
      world.add(e, PlayerOrder, {
        ...(march === undefined ? {} : { attackMove: march }),
        ...(order.scripted === true ? { scripted: true } : {}),
      });
      continue;
    }
    if (march !== undefined && world.has(e, Engagement)) {
      // The fight has the unit; the march waits it out and resumes below when combat lets go. Marked once,
      // so a long fight does not rewrite the order every tick.
      if (!march.resume) {
        const o = world.mut(e, PlayerOrder);
        if (o.attackMove !== undefined) o.attackMove.resume = true;
      }
      continue;
    }
    const request = world.tryGet(e, PathRequest);
    if (request?.failed) {
      if (march !== undefined) {
        const route = { start: request.start, goal: march.goal };
        if (breakThroughWall(world, ctx, ctx.terrain, e, route, { kind: 'order', resume: null })) continue;
      }
      // A failed request is never retried, so the order must be dropped or the unit freezes on it forever.
      // A signpost errand is the original's build-guide task, whose failure is a plain task failure,
      // never a lost note; an explore leg's goal is the sweep's own pick, which it steers around next.
      const sweep = world.tryMut(e, ExploreOrder);
      if (sweep !== undefined) {
        if (sweep.leg !== null) sweep.leg.failed = true;
      } else if (!world.has(e, ErectSignpostOrder)) {
        markLostWay(world, ctx, e, request.goal);
      }
      world.remove(e, PlayerOrder);
      stopAtNextNode(world, e);
      continue;
    }
    if (world.has(e, CurrentAtomic)) {
      world.remove(e, PlayerOrder); // a need drive took over
      continue;
    }
    if (isTravelling(world, e)) {
      // Still walking the order out, unless hunger takes it off a player's walk at a node it reaches.
      if (order.scripted !== true && breaksForMeal(world, ctx, e) && onNodeCentre(world, e)) {
        suspendWalkForMeal(world, ctx.terrain, e);
      }
      continue;
    }
    if (march?.resume === true) {
      const o = world.mut(e, PlayerOrder);
      if (o.attackMove !== undefined) o.attackMove.resume = false;
      world.add(e, MoveGoal, { cell: march.goal }); // the fight is over - walk on to the ordered spot
      continue;
    }
    world.remove(e, PlayerOrder); // arrived - economy resumes (plannerSystem re-tasks this tick)
    // Original behavior: a completed walk makes where it ended the guard point; a walk given up keeps the
    // old one, so a guard never stays tied to a spot it could not reach. A rider has no spot of its own.
    if (world.has(e, Position)) moveAnchor(world, ctx.content, e, entityNode(world, ctx.terrain, e));
  }
};
