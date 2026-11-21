import {
  AttackOrder,
  Building,
  CoinDrillOrder,
  Engagement,
  EquipOrder,
  engagementRecord,
  Garrison,
  HuntFocus,
  isMachinePlayer,
  isWildlife,
  JobAssignment,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Rider,
  Settler,
  Stance,
  StandIn,
  TrainingOrder,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { forEachRingNode, hexDistanceBetween, positionOfNode } from '../../nav/halfcell.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { routeRegions } from '../footprint/index.js';
import { walkBlockMask } from '../footprint/walk-block-mask.js';
import { hasBodyCollision, standingFighterPosts } from '../movement/collision/index.js';
import { clearNavState, isTravelling, redirectRoute, stopAtNextNode } from '../movement/nav-state.js';
import { structureRouteSealed } from '../movement/structure-route.js';
import { breakThroughWall } from '../palisades/breach.js';
import { isRangedWeapon, MILITARY_MODE, stanceMode } from '../readviews/index.js';
import { anyNeedPressing } from '../settlers/drives/needs.js';
import { markLostWay } from '../settlers/lost-way.js';
import { closer, hexNodeDistance, nearestHexCell } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import {
  type CombatantStance,
  DEFEND_LEASH_NODES,
  type EngageSpec,
  enemyInReachFrom,
  enemyUnitInReach,
} from './engagement.js';
import type { MeleeSlots, OwnClaims } from './melee-slots.js';
import type { CombatPass } from './pass.js';
import { combatTargetNode, targetBodyNodes } from './target-node.js';
import { noteUnreachableTarget } from './unreachable-targets.js';
import type { WalkLocal } from './walk-local.js';
import { bandNodeCount, forEachNodeInBand, ringNodeCount, type WeaponBand } from './weapon-band.js';
import type { ArmedWith } from './weapons.js';

// The walk-into-melee half of combat: advance an owned combatant on an out-of-reach enemy, deal each chaser
// a distinct contact cell near it, park the rest as near the front as they get, and respect the DEFEND leash.

/** The chase's pre-resolved target: the entity, the combat node the reach check measured (its own node for
 *  a unit, its nearest body node for a building or a wall), and that structure's whole body (`null` for a
 *  unit). */
export interface ChaseTarget {
  readonly entity: Entity;
  readonly node: NodeId;
  readonly body: readonly NodeId[] | null;
}

type DefendPost = EngageSpec['defend'];

/** The band a chaser closes into, and whether it takes a melee contact slot there. */
export interface ApproachBand extends WeaponBand {
  readonly contact: boolean;
}

/** How far from itself (map points) a melee attacker looks for a contact slot, and among how many of the
 *  free slots at the nearest distance it finds one it draws. Original behavior. */
const CONTACT_SLOT_RADIUS = 5;
const CONTACT_SLOT_CHOICES = 6;

/**
 * How many ticks a chaser follows its current path toward an enemy before re-issuing a fresh one. A per-tick
 * full re-path of every chaser would breach the scale budget and eat the pathfinder's per-tick node budget;
 * between repaths the unit keeps walking its last route, and the distance-based swing check still catches it
 * the instant it steps into reach. Approximation (source basis "Combat chase / repath cadence").
 */
export const REPATH_CADENCE = 8;

/**
 * How long a machine seat's attack-move rests its aggression after a refused chase it found no wall to
 * break through, unless a wall falls first (`endMachineMarchRests`). Such refusals are mostly walls it
 * plans as closed, which stand far longer than a chase cadence; one across water rests as long, an
 * approximation chosen for cost. A human's march rests the cadence alone. Authored.
 */
export const MACHINE_MARCH_REST_TICKS = 15 * REPATH_CADENCE;

/**
 * How many chase cadences in a row routing may refuse a route to the same target before the chase asks
 * whether buildings and resources alone seal it and, if so, gives it up as unreachable. Standing bodies never
 * refuse a chase, its grind reroutes included (`movement/chase-route.ts`). Approximation: the original's rule
 * is not readable.
 */
export const SEALED_TARGET_ROUTE_FAILURES = 3;

/** The ticks `e`'s attack-move rests after a refused chase: {@link MACHINE_MARCH_REST_TICKS} for a machine
 *  seat's unit, the chase cadence for anyone else's. */
function marchRestTicks(world: World, e: Entity): number {
  const player = world.tryGet(e, Owner)?.player;
  return player !== undefined && isMachinePlayer(world, player) ? MACHINE_MARCH_REST_TICKS : REPATH_CADENCE;
}

/** Send a DEFEND guard, or an ATTACK fighter that strayed, back to its anchor when nothing is left to
 *  fight. The {@link Engagement} always drops here, or the planner's Engagement gate would bench the unit for
 *  good; the walk home defers to a live equip errand or coin drill, whose end re-holds the unchanged anchor,
 *  to a school lesson, and to a pressing need, which the planner answers above the DEFEND hold. Without that,
 *  a guard facing an enemy it cannot reach is turned back from every meal and starves beside the store, and a
 *  soldier sent to school is turned back at its door. */
function returnToAnchor(world: World, ctx: SystemContext, e: Entity, here: NodeId, anchorCell: NodeId): void {
  world.remove(e, Engagement);
  world.remove(e, HuntFocus); // a post-holder holds no prey
  if (
    world.has(e, EquipOrder) ||
    world.has(e, CoinDrillOrder) ||
    world.has(e, TrainingOrder) ||
    anyNeedPressing(world, ctx, e)
  )
    return;
  if (holdsStandIn(world, ctx, e, here, anchorCell)) return;
  clearNavState(world, e);
  const post = ctx.terrain === undefined ? anchorCell : guardPost(world, ctx, ctx.terrain, anchorCell, here);
  if (here !== post) world.add(e, MoveGoal, { cell: post });
}

/** The posts {@link guardPost} found beside covered anchors, by anchor and guard node, valid while the
 *  walk-block mask holds `version`: the route regions the reach test reads derive from that mask alone.
 *  Derived state, never hashed. */
interface GuardPosts {
  readonly terrain: TerrainGraph;
  version: number;
  readonly posts: Map<number, NodeId>;
}

const guardPostsByWorld = new WeakMap<World, GuardPosts>();

/** Held posts past which the cache starts over, so guards standing at many nodes under one mask version
 *  keep it bounded. */
const GUARD_POST_CACHE_CAP = 4096;

/** The node a guard on `here` holds for `anchorCell`: the anchor, or, when a building or resource stands
 *  on it, as on a unit a map places on a mine deposit, the nearest open node beside it the guard can reach
 *  (same land, not proven walled off). No route ends on a blocked node, so walking at the anchor itself
 *  would fail on every break-off. The anchor itself when no such node is near. A guard settled beside a
 *  covered anchor asks every combat pass, so the search is held until a walk block changes. */
export function guardPost(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  anchorCell: NodeId,
  here: NodeId,
): NodeId {
  const blocked = walkBlockMask(world, ctx, terrain);
  if (!blocked.has(anchorCell)) return anchorCell;
  const version = blocked.version;
  let held = guardPostsByWorld.get(world);
  if (held === undefined || held.terrain !== terrain) {
    held = { terrain, version, posts: new Map() };
    guardPostsByWorld.set(world, held);
  } else if (held.version !== version || held.posts.size >= GUARD_POST_CACHE_CAP) {
    held.version = version;
    held.posts.clear();
  }
  const key = anchorCell * terrain.nodeCount + here;
  const known = held.posts.get(key);
  if (known !== undefined) return known;
  const land = terrain.componentOf(here);
  const regions = routeRegions(world, ctx, terrain);
  const reachable = (n: NodeId): boolean => terrain.componentOf(n) === land && !regions.unroutable(here, n);
  const post = nearestUnblockedNode(terrain, anchorCell, blocked, { reachable }) ?? anchorCell;
  held.posts.set(key, post);
  return post;
}

/** Whether `e` stands on the stand-in routing gave it beside `anchorCell` while a standing unit still holds
 *  the anchor: that stand is its post until the anchor frees, and then it walks on. */
function holdsStandIn(
  world: World,
  ctx: SystemContext,
  e: Entity,
  here: NodeId,
  anchorCell: NodeId,
): boolean {
  const stood = world.tryGet(e, StandIn);
  if (stood?.goal !== anchorCell || stood.at !== here || isTravelling(world, e)) return false;
  return ctx.terrain !== undefined && standingFighterPosts(world, ctx.content, ctx.terrain).has(anchorCell);
}

/** Hand a combatant that will not advance this tick back to its idle duty: a post-holder walks back to its
 *  anchor, and so does an ATTACK fighter that has strayed from its own; everyone else disengages. A
 *  hunter's leash carries `hold: false` because its between-hunts time belongs to the flag-gatherer drive,
 *  which a combat walk-back would fight for the unit. */
export function breakOff(
  world: World,
  ctx: SystemContext,
  e: Entity,
  here: NodeId,
  defend: DefendPost,
): void {
  // A rider's walk belongs to its vehicle: a guard sent back from the door would never step in.
  if (defend?.hold === true && !world.has(e, Rider)) {
    returnToAnchor(world, ctx, e, here, defend.anchorCell);
    return;
  }
  const home = defend === null ? strayedFrom(world, ctx, e, here) : null;
  if (home !== null) returnToAnchor(world, ctx, e, here, home);
  else disengage(world, e);
}

/**
 * ATTACK stance - how far (map points) a fighter may stand from its anchor before, with nothing to fight, it
 * walks back to it. Original behavior. Approximation: the original asks each time an idle soldier with no
 * enemy near turns to its duty; this build asks when the combat pass breaks it off, which also follows a
 * chase given up on a target across water or behind walls, and a soldier that wandered off for a meal with
 * no one near stays where it ate.
 */
export const ATTACK_RETURN_SLACK_NODES = 18;

/** The anchor an owned ATTACK fighter breaking off should walk back to, or null: none is kept, it stands
 *  within {@link ATTACK_RETURN_SLACK_NODES}, a player's order or march owns its walk, or a workplace (a
 *  tower post included, while he is down for a meal) or a vehicle holds it. */
function strayedFrom(world: World, ctx: SystemContext, e: Entity, here: NodeId): NodeId | null {
  const anchor = world.tryGet(e, Stance)?.anchorCell ?? null;
  if (anchor === null || ctx.terrain === undefined) return null;
  if (world.has(e, AttackOrder) || world.has(e, PlayerOrder)) return null;
  if (world.has(e, JobAssignment) || world.has(e, Garrison) || world.has(e, Rider)) return null;
  const { jobType } = world.get(e, Settler);
  if (stanceMode(world, ctx.content, e, jobType) !== MILITARY_MODE.ATTACK) return null;
  // An anchor across water is no walk home: the route would be refused and leave the soldier lost.
  if (ctx.terrain.componentOf(anchor) !== ctx.terrain.componentOf(here)) return null;
  return hexNodeDistance(ctx.terrain, anchor, here) > ATTACK_RETURN_SLACK_NODES ? anchor : null;
}

/** Whether routing delivered `e`'s last route: the request is gone and its goal or path stands. A refused
 *  request stays until the chase clears it, and a hold issues nothing. */
function routeDelivered(world: World, e: Entity): boolean {
  return !world.has(e, PathRequest) && isTravelling(world, e);
}

/**
 * Advance an owned combatant on `enemy` it can't yet reach with `reach`. It keeps an {@link Engagement}
 * marker so the PlannerSystem leaves the unit to combat, and re-issues a {@link MoveGoal} toward an
 * {@link approachCell} at most every {@link REPATH_CADENCE} ticks; between repaths it follows its live
 * route and the distance-based swing check catches it the instant it steps into reach. A refused route is
 * stood out for a cadence; an ordered unit whose route cannot resolve gives the order up at once. A building
 * target's wall list lets a chaser whose nearest face is fully manned encircle to a free face it walks to.
 *
 * A chaser routing stood in short of its cell strikes an enemy it reaches from there ({@link
 * enemyUnitInReach}), else waits and looks again on its stride: a melee chaser behind a fully taken front of
 * a unit steps along it ({@link seamStep}), and any steps up once a node nearer frees. `holder` carries the
 * spec whose targets it may turn to; a breaker stays on its wall.
 *
 * Returns whether it gave the target up this tick.
 */
export function chase(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  e: Entity,
  here: NodeId,
  enemy: Entity,
  reach: ArmedWith,
  stance: CombatantStance,
  defend: DefendPost,
  holder: EngageSpec | null,
): boolean {
  const { slots } = pass;
  const engagement = engagementFor(world, ctx, e, enemy);

  const marching = world.tryGet(e, PlayerOrder)?.attackMove !== undefined;
  const order = world.tryGet(e, AttackOrder);
  // The enemy an ordered man turned aside to from his order's target: giving it up hands him back to it.
  const asideFrom =
    stance.ordered && order !== undefined && order.breach === undefined && order.target !== enemy
      ? order.target
      : null;
  const aside = asideFrom !== null;
  const commanded = (stance.ordered && !aside) || marching; // player-driven: it releases here, not on the bank
  // A failed chase route ends an explicit attack order. An attack-move march instead rests its aggression
  // and walks on: without the rest, an enemy visible across a river holds the marcher in a failing search
  // every tick and the order can never complete.
  const request = world.tryGet(e, PathRequest);
  // A refused grind reroute is no answer to the chase: routing dropped the walk, so next tick the planner
  // asks a plain route from where the walker stands to its goal, and a refusal of that one is answered below.
  if (request?.failed && request.grind === true) {
    world.remove(e, PathRequest);
    return false;
  }
  if (request?.failed) {
    // The breach this chase walks to, whose target a further wall found on the way still leads back to.
    const breach = order?.target === enemy ? order.breach : undefined;
    // A player-driven walk walled off by a palisade breaks through it: toward the ordered target, else toward
    // the march's goal.
    if (commanded) {
      const march = world.tryGet(e, PlayerOrder)?.attackMove;
      const goal = stance.ordered ? request.goal : march?.goal;
      const resume = stance.ordered ? (breach === undefined ? enemy : breach.resume) : null;
      if (
        goal !== undefined &&
        breakThroughWall(world, ctx, terrain, e, { start: request.start, goal }, { kind: 'order', resume })
      ) {
        return true;
      }
    }
    clearNavState(world, e);
    if (commanded) {
      world.remove(e, AttackOrder);
      world.remove(e, Engagement);
      if (marching) {
        const order = world.mut(e, PlayerOrder);
        if (order.attackMove !== undefined)
          order.attackMove.blockedUntil = ctx.tick + marchRestTicks(world, e);
      } else {
        // Only the dropped attack order is worth a note; the march above keeps walking.
        markLostWay(world, ctx, e, request.goal);
      }
      return true;
    }
    // Original behavior: an animal's attack ends the moment its walk to the target fails. The memo keeps
    // its search off the sealed-off target, which would otherwise cost a failed route every other tick.
    if (isWildlife(world, e) && !world.has(e, Owner)) {
      noteUnreachableTarget(world, ctx, e, enemy);
      breakOff(world, ctx, e, here, defend);
      return true;
    }
    // Stand the refused route out for a cadence and count it; from the threshold on, only a refusal that
    // buildings and resources alone explain releases the target. A fighter free to leave its spot breaks
    // an enemy wall that seals it off from an enemy player instead.
    const routes = (engagement.stall?.routes ?? 0) + 1;
    if (
      routes >= SEALED_TARGET_ROUTE_FAILURES &&
      structureRouteSealed(world, ctx, terrain, request.start, request.goal)
    ) {
      const sealedFrom = breach?.enemy ?? enemy;
      const route = { start: request.start, goal: request.goal, sealed: true };
      if (aside) {
        dropAside(world, ctx, e, enemy);
        return true;
      }
      if (
        defend === null &&
        worthASiege(world, sealedFrom) &&
        breakThroughWall(world, ctx, terrain, e, route, { kind: 'own', enemy: sealedFrom })
      ) {
        return true;
      }
      noteUnreachableTarget(world, ctx, e, enemy);
      markLostWay(world, ctx, e, request.goal);
      breakOff(world, ctx, e, here, defend);
      return true;
    }
    const held = world.mut(e, Engagement);
    held.stall = { target: enemy, routes };
    held.repathAt = ctx.tick + REPATH_CADENCE;
    return false;
  }

  const travelling = isTravelling(world, e);
  // Still closing on a live route, or standing out a refused one's cadence: don't re-path.
  if (ctx.tick < engagement.repathAt && (travelling || engagement.stall !== undefined)) return false;
  // A man waiting at the front holds his node and looks again on his stride.
  if (engagement.waiting === true && !travelling && !onStride(ctx.tick, e, REPATH_CADENCE)) return false;

  // Resolved past the cadence gate, so a chaser still closing on its live route reads no target body.
  const target = chaseTargetOf(world, ctx, terrain, here, enemy);
  const weapon = approachBand(reach);
  // Only a melee fighter holding a unit forms a front to step along; a besieger encircles its wall instead.
  const front = holder?.hold?.contact === true && target.body === null ? holder : null;

  const ownGoal = world.tryGet(e, MoveGoal)?.cell;
  // A close-range breaker without a breach slot must exclude the wall's inaccessible far side.
  // Ordinary approaches use terrain alone; a crowded breach asks for structural regions lazily.
  const crowdedBreach =
    weapon.minRange <= 1 && order?.target === target.entity && order.breach?.stand === null;
  const terrainBank = terrain.isWalkable(here) ? terrain.componentOf(here) : null;
  const banked = crowdedBreach ? slots.hasBank(here, e) : terrainBank !== null;
  const onOurBank = bankTest(terrain, slots, e, here, banked, crowdedBreach, terrainBank);

  // Its own body does not take the node it stands on from itself. A walker crossing a node its own side
  // stands on holds no claim there: routes pass friends, but no two bodies come to rest on one node.
  const crossingFriend =
    (world.has(e, PathFollow) && slots.isOccupied(here)) || slots.isTaken(here, ownGoal, here);
  const mine: OwnClaims = {
    chaser: { entity: e, target: target.entity },
    goal: ownGoal,
    standingOn: onNodeCentre(world, terrain, e, here) && !crossingFriend ? here : undefined,
  };
  const near = slots.nearChaser(e, here);
  const collides = hasBodyCollision(world, ctx.content, e);
  // The near-side node a breach dealt this breaker comes first, while it is open and untaken.
  const stand = breachStand(world, terrain, e, target, weapon);
  let approach: Approach =
    stand !== null && slots.isOpen(stand) && !slots.isTaken(stand, mine.goal, mine.standingOn, mine.chaser)
      ? { cell: stand, free: true }
      : target.body !== null && target.body.length > 0
        ? faceApproach(terrain, slots, here, target, weapon, mine, onOurBank, near, collides)
        : approachCell(ctx, terrain, here, target, weapon, slots, mine, onOurBank, near, collides);
  // The enemy a step along the front brings into reach, taken up in place of the held one.
  let alongFront: Entity | null = null;
  if (!approach.free && front !== null && mine.standingOn !== undefined) {
    const step = seamStep(world, ctx, terrain, pass, front, target.entity, weapon, here, mine, onOurBank);
    if (step !== null) {
      approach = { cell: step.cell, free: true };
      alongFront = step.enemy;
    }
  }
  // A walker crossing a friend's node is never dealt it: it waits on the nearest node no body holds.
  if (crossingFriend && approach.cell === here) {
    const off = freeNodeNear(terrain, slots, here, mine, onOurBank);
    if (off === null) {
      // Walk the live route off it and ask again on the cadence.
      world.mut(e, Engagement).repathAt = ctx.tick + REPATH_CADENCE;
      return false;
    }
    approach = { cell: off, free: true };
  }
  const dest = approach.cell;
  // `dest` fell back to the target itself: no cell that would bring it into reach is one this unit can stand
  // on. Only the walk is refused - the reach check ran before the chase, so an archer still shoots across
  // water. Giving up here is an approximation (source basis "Combat chase").
  if (!commanded && terrainBank !== null && terrain.componentOf(dest) !== terrainBank) {
    letGo(world, ctx, e, here, target.entity, aside, defend);
    return true;
  }
  // Anchor leash: a target hittable only by stepping past `leash` from the anchor is left alone, and so is
  // one routing stands the guard in for past it.
  const standIn = world.tryGet(e, StandIn);
  const restsOn = standIn?.goal === dest ? standIn.at : dest;
  if (
    defend !== null &&
    Math.max(leashDistance(terrain, defend, dest), leashDistance(terrain, defend, restsOn)) > defend.leash
  ) {
    letGo(world, ctx, e, here, target.entity, aside, defend);
    return true;
  }
  // Owner rule: a man turned aside fights within a DEFEND leash of his order's target. An enemy past it is
  // let go unremembered, so it is answered again once it comes back within.
  if (
    asideFrom !== null &&
    hexNodeDistance(terrain, entityNode(world, terrain, asideFrom), dest) >
      DEFEND_LEASH_NODES + weapon.maxRange
  ) {
    releaseAside(world, e);
    return true;
  }
  if (dest === here && !travelling) {
    // Standing on its own best approach cell yet out of range: the target cannot be closed on, so give up
    // rather than loop engaged-but-frozen. Next tick the unit re-acquires another enemy, or the economy
    // relocates it, so it never stays stuck. A travelling unit falls through instead, finishes its step and
    // swings next pass.
    if (aside) dropAside(world, ctx, e, target.entity);
    else disengage(world, e);
    return true;
  }
  if (!travelling && restsOn === here && onNodeCentre(world, terrain, e, here)) {
    // Standing where routing stood it short of `dest`: it strikes an enemy it reaches from here, else waits
    // idle, with no route for the render to read as a walk, until a place nearer the front frees. Routing
    // was not asked, so no refusal stands.
    const struck =
      holder === null || order?.breach !== undefined
        ? null
        : enemyUnitInReach(world, ctx, terrain, pass, holder, target.entity, reach, here);
    // Routing ranks a stand-in by its nearness to the unit chased, else to the cell asked for.
    const ranked = target.body === null ? target.node : dest;
    const walk = slots.nearChaser(e, here);
    if (struck !== null || waitsAtFront(ctx, terrain, slots, walk, e, here, target.node, ranked, mine)) {
      stopAtNextNode(world, e);
      slots.claim(here, world.tryGet(e, Owner)?.player ?? null);
      if (engagement.stall !== undefined || engagement.waiting !== true) {
        const held = world.mut(e, Engagement);
        held.stall = undefined;
        held.waiting = true;
      }
      if (struck !== null) holdEnemy(world, ctx, e, struck);
      return false;
    }
  }
  if (travelling && walksToStandIn(world, slots, e, dest, mine)) {
    world.mut(e, Engagement).repathAt = ctx.tick + REPATH_CADENCE;
    return false;
  }
  redirectRoute(world, e, dest); // keep the live route - dropping it reset the gait (chase stutter)
  // A taken front cell is no slot to deal: routing parks the chaser beside it.
  if (approach.free) {
    slots.claim(
      dest,
      world.tryGet(e, Owner)?.player ?? null,
      alongFront === null ? mine.chaser : { entity: e, target: alongFront },
    );
  }
  const held = world.mut(e, Engagement);
  held.repathAt = ctx.tick + REPATH_CADENCE;
  held.waiting = undefined;
  if (alongFront !== null) held.target = alongFront;
  return false;
}

/** `enemy` as the chase advances on it: the combat node the reach check measures, toward where the swing
 *  lands, and a building's full wall list, so a chaser whose nearest face is manned encircles to another. */
function chaseTargetOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  enemy: Entity,
): ChaseTarget {
  return {
    entity: enemy,
    node: combatTargetNode(world, ctx, terrain, here, enemy),
    body: targetBodyNodes(world, ctx, terrain, enemy),
  };
}

/**
 * The band a chaser closes into: a melee weapon's whole reach, where it takes a contact slot, and a ranged
 * one's reach cut back to the standoff `(2 * max - min) / 2`, so an archer steps in past its farthest shot.
 * Original behavior.
 */
function approachBand(weapon: ArmedWith): ApproachBand {
  const { minRange, maxRange } = weapon;
  if (!isRangedWeapon(weapon.weapon)) return { minRange, maxRange, contact: true };
  return { minRange, maxRange: rangedStandoff(minRange, maxRange), contact: false };
}

/** The far edge of a ranged weapon's approach band: `(2 * max - min) / 2`, or its whole reach when it has no
 *  band. Original behavior. */
export function rangedStandoff(minRange: number, maxRange: number): number {
  return minRange >= maxRange ? maxRange : (2 * maxRange - minRange) >> 1;
}

/** Whether `cell` lies on the ground chaser `e` standing on `here` can walk to: its structural region for a
 *  crowded breach, else its terrain component. Built after the chase's early returns, so a chase that does
 *  not re-path allocates no closure. */
function bankTest(
  terrain: TerrainGraph,
  slots: MeleeSlots,
  e: Entity,
  here: NodeId,
  banked: boolean,
  crowdedBreach: boolean,
  terrainBank: number | null,
): (cell: NodeId) => boolean {
  return (cell) =>
    !banked || (crowdedBreach ? slots.sameBank(here, cell, e) : terrain.componentOf(cell) === terrainBank);
}

/** Let go of `enemy` the chase cannot close on: an enemy taken up beside an order is dropped, any other
 *  target broken off. */
function letGo(
  world: World,
  ctx: SystemContext,
  e: Entity,
  here: NodeId,
  enemy: Entity,
  aside: boolean,
  defend: DefendPost,
): void {
  if (aside) dropAside(world, ctx, e, enemy);
  else breakOff(world, ctx, e, here, defend);
}

/** How far (map points) a walker crossing a friend's node looks for a free node to wait on. Authored:
 *  two rings, past the friend's own neighbours, who are usually his line. */
const OFF_FRIEND_RADIUS = 2;

/** The free node nearest `here`, ring by ring and in ring order, or null within {@link OFF_FRIEND_RADIUS}. */
function freeNodeNear(
  terrain: TerrainGraph,
  slots: MeleeSlots,
  here: NodeId,
  mine: OwnClaims,
  onOurBank: (cell: NodeId) => boolean,
): NodeId | null {
  const at = { hx: terrain.xOf(here), hy: terrain.yOf(here) };
  let found: NodeId | null = null;
  for (let ring = 1; ring <= OFF_FRIEND_RADIUS && found === null; ring++) {
    forEachRingNode(at, ring, terrain.width, terrain.height, (hx, hy) => {
      const cell = terrain.nodeAt(hx, hy);
      if (!slots.isOpen(cell) || !onOurBank(cell) || slots.isTaken(cell, mine.goal)) return true;
      found = cell;
      return false;
    });
  }
  return found;
}

/**
 * Where a melee fighter standing one step behind a full front steps next: the open, untaken cell one walk
 * step from `here` that brings an enemy into reach, the one nearest an enemy body first, then the lowest
 * cell id. Null when no step does, and the fighter holds where it stands. Intentional deviation: the
 * original walks up and fights from a taken node, so it never waits behind a friend; with bodies
 * colliding here, the rear presses into the gaps and seams between the friends in contact instead of
 * queueing behind one of them.
 */
function seamStep(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  front: EngageSpec,
  held: Entity,
  weapon: WeaponBand,
  here: NodeId,
  mine: OwnClaims,
  onOurBank: (cell: NodeId) => boolean,
): { cell: NodeId; enemy: Entity } | null {
  const { slots } = pass;
  const seam = enemyInReachFrom(world, ctx, terrain, pass, front, held, weapon);
  let best: { cell: NodeId; enemy: Entity } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const step of terrain.steps(here)) {
    const cell = step.node;
    if (!onOurBank(cell) || !slots.isOpen(cell) || slots.isTaken(cell, mine.goal, mine.standingOn)) continue;
    const found = seam(cell);
    if (found !== null && closer(found.distance, cell, bestDist, bestCell)) {
      best = { cell, enemy: found.entity };
      bestDist = found.distance;
      bestCell = cell;
    }
  }
  return best;
}

/** Whether a fighter's own chase breaks walls to reach `enemy`: an enemy player's settler or building. A hunt
 *  after wildlife starts no siege. */
function worthASiege(world: World, enemy: Entity): boolean {
  return world.has(enemy, Owner) && (world.has(enemy, Settler) || world.has(enemy, Building));
}

/** Whether `tick` is one of `e`'s every-`period` ticks, spread across entities by id. */
export function onStride(tick: number, e: Entity, period: number): boolean {
  return (tick + e) % period === 0;
}

/** How far `dest` lies from the anchor of `defend`, in the map points its leash counts in. */
function leashDistance(terrain: TerrainGraph, defend: NonNullable<DefendPost>, dest: NodeId): number {
  return hexNodeDistance(terrain, defend.anchorCell, dest);
}

/** `e`'s {@link Engagement} on `target`, added to repath at once on a first engagement. A stall is about one
 *  target and ends the moment a route is delivered; a chase in between writes nothing. */
function engagementFor(world: World, ctx: SystemContext, e: Entity, target: Entity) {
  const prior = world.tryGet(e, Engagement);
  if (prior === undefined) return world.add(e, Engagement, engagementRecord(ctx.tick));
  if (prior.stall !== undefined && (prior.stall.target !== target || routeDelivered(world, e))) {
    world.mut(e, Engagement).stall = undefined;
  }
  return prior;
}

/** The near-side node a breach dealt `e` for this wall, while it still brings the wall into `weapon`'s band. */
function breachStand(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  target: ChaseTarget,
  weapon: WeaponBand,
): NodeId | null {
  const order = world.tryGet(e, AttackOrder);
  const stand = order?.target === target.entity ? order.breach?.stand : undefined;
  if (stand === undefined || stand === null) return null;
  const reach = Math.min(
    ...(target.body ?? [target.node]).map((wall) => hexNodeDistance(terrain, stand, wall)),
  );
  return reach >= weapon.minRange && reach <= weapon.maxRange ? stand : null;
}

/** Whether `e` stands exactly on the centre of `node`, where a stop leaves no walker frozen mid-leg. */
function onNodeCentre(world: World, terrain: TerrainGraph, e: Entity, node: NodeId): boolean {
  const centre = positionOfNode(terrain.xOf(node), terrain.yOf(node));
  const p = world.get(e, Position);
  return p.x === centre.x && p.y === centre.y;
}

/** Where a chaser heads: a cell that brings its target into reach and that it takes (`free`), or a taken
 *  one: beside it routing parks a body that collides, and a chaser without one fights from it. */
interface Approach {
  readonly cell: NodeId;
  readonly free: boolean;
}

/**
 * The cell a chaser should walk to in order to bring `target` into its weapon band: a melee contact slot
 * ({@link contactSlot}) once one lies near it by walking, else the open `reachable` band cell nearest `from`
 * by (map points, cell id), taken or not, a free one winning a tie; a ranged chaser takes the nearest free
 * cell of its wide band before a taken one. A melee unit therefore stops a map point short of the enemy
 * rather than on it, where distance 0 would sit below every weapon's near reach. Falls back to the target's
 * own cell when no cell in the band is open and reachable at all.
 *
 * Original behavior: with every side taken the attacker keeps its target, walks up and fights from a taken
 * node, so no cap limits how many strike one enemy. Authored: a chaser without body collision takes the
 * band's nearest free cell however far, else its nearest open one; a standing fighter's body blocks its node
 * (authored body collision, `movement/collision`), so a colliding overflow heads for the taken front, stands
 * on the free node nearest it by walking (`movement/chase-route.ts`) and strikes from there an enemy in
 * reach ({@link enemyUnitInReach}).
 */
function approachCell(
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
  target: ChaseTarget,
  weapon: ApproachBand,
  slots: MeleeSlots,
  mine: OwnClaims,
  reachable: (cell: NodeId) => boolean,
  near: WalkLocal,
  collides: boolean,
): Approach {
  const targetCell = target.node;
  const slot = weapon.contact ? contactSlot(ctx, terrain, from, targetCell, weapon, slots, mine, near) : null;
  if (slot !== null) return { cell: slot, free: true };
  const band = nearestFreeInBand(terrain, from, targetCell, weapon, slots, mine, reachable);
  if (band.open === null) return { cell: targetCell, free: true };
  if (band.free !== null && (!collides || !weapon.contact || asNear(terrain, from, band.free, band.open))) {
    return { cell: band.free, free: true };
  }
  return { cell: band.open, free: false };
}

/** {@link approachCell} around a building's walls: a melee chaser's nearest free face it walks to round the
 *  building ({@link walkedFace}), else the face nearest by map points, taken or not; a chaser without body
 *  collision, or a ranged one, takes the nearest free face however far before a taken one. With no face on
 *  our bank there is no front at all: aim at the body, which the chase's bank check refuses. */
function faceApproach(
  terrain: TerrainGraph,
  slots: MeleeSlots,
  here: NodeId,
  target: ChaseTarget,
  weapon: ApproachBand,
  mine: OwnClaims,
  onOurBank: (cell: NodeId) => boolean,
  near: WalkLocal,
  collides: boolean,
): Approach {
  // The open faces are the held band's cells the walk block leaves, tested lazily rather than copied out.
  const openOnBank = (cell: NodeId): boolean => slots.isOpen(cell) && onOurBank(cell);
  const free = (cell: NodeId): boolean =>
    openOnBank(cell) && !slots.isTaken(cell, mine.goal, mine.standingOn, mine.chaser);
  const faces = slots.encircleCells(target.entity, target.body, weapon);
  let slot: NodeId | null = null;
  const beside = besideBand(weapon);
  // A chaser more than a step outside the cells beside the building has no walk along it to ask about.
  if (weapon.contact && hexNodeDistance(terrain, here, target.node) <= beside.maxRange + 1) {
    near.along(slots.encircleCells(target.entity, target.body, beside));
    slot = walkedFace(terrain, faces, here, free, near);
  }
  if (slot !== null) return { cell: slot, free: true };
  const face = nearestHexCell(terrain, faces, here, openOnBank);
  if (face === null) return { cell: target.node, free: true };
  const freeFace = nearestHexCell(terrain, faces, here, free);
  if (freeFace !== null && (!collides || !weapon.contact || asNear(terrain, here, freeFace, face)))
    return { cell: freeFace, free: true };
  return { cell: face, free: false };
}

/** How many steps past a melee band a walk round a building may stray from its body: room to pass an enemy
 *  standing at it. Authored. */
const BESIDE_STEPS = 1;

/** The cells a walk round a building keeps to: `band` and {@link BESIDE_STEPS} rings past it. */
function besideBand(band: WeaponBand): WeaponBand {
  return { minRange: band.minRange, maxRange: band.maxRange + BESIDE_STEPS };
}

/** Scratch for {@link walkedFace}: the free faces it weighs, as (map points * node count + cell). */
const faceKeys: number[] = [];

/**
 * The free face nearest `here` by (map points, cell id) that the chaser walks to within its map distance plus
 * the longest way round the building, half its ring of faces, keeping beside the building ({@link
 * besideBand}): round walls and enemy bodies, through friends. A face behind a wall or an enemy line is a
 * longer walk and stays out, and a chaser farther off heads for the front first. Authored, so a siege mans
 * every face its army reaches round the building while the rest of it waits at the front.
 */
function walkedFace(
  terrain: TerrainGraph,
  faces: readonly NodeId[],
  here: NodeId,
  free: (cell: NodeId) => boolean,
  near: WalkLocal,
): NodeId | null {
  const round = faces.length >> 1;
  const hx = terrain.xOf(here);
  const hy = terrain.yOf(here);
  const nodes = terrain.nodeCount;
  faceKeys.length = 0;
  for (const cell of faces) {
    if (free(cell))
      faceKeys.push(hexDistanceBetween(hx, hy, terrain.xOf(cell), terrain.yOf(cell)) * nodes + cell);
  }
  // Nearest first, one selection per face asked: the first one asked is usually walked to.
  for (let next = 0; next < faceKeys.length; next++) {
    let best = next;
    for (let i = next + 1; i < faceKeys.length; i++) if ((faceKeys[i] ?? 0) < (faceKeys[best] ?? 0)) best = i;
    const key = faceKeys[best] ?? 0;
    faceKeys[best] = faceKeys[next] ?? 0;
    faceKeys[next] = key;
    const cell = (key % nodes) as NodeId;
    if (near.within(cell, (key - cell) / nodes + round)) return cell;
  }
  return null;
}

/** Whether `a` lies as near `from` in map points as `b`. */
function asNear(terrain: TerrainGraph, from: NodeId, a: NodeId, b: NodeId): boolean {
  return hexNodeDistance(terrain, from, a) === hexNodeDistance(terrain, from, b);
}

/**
 * How many walking steps from a chaser a free contact cell may lie and count as near it: a little past the
 * contact draw's map-point radius, so a cell that radius finds round a corner of a building still counts.
 * Authored.
 */
const WALK_LOCAL_STEPS = CONTACT_SLOT_RADIUS + 2;

/**
 * A melee attacker's contact slot: its own goal while that is still a free cell of the band, else one
 * drawn at random among up to {@link CONTACT_SLOT_CHOICES} free cells of the band at the nearest distance
 * from the attacker that holds one, searched ring by ring out to {@link CONTACT_SLOT_RADIUS}; null when
 * none lies that near, and the chase heads for the front instead. A free cell counts only when the attacker
 * walks to it within {@link WALK_LOCAL_STEPS}, never through an enemy body or a wall. Original behavior: the
 * draw never reaches past the first distance with a free cell, so a lone attacker takes the near side.
 * Approximations: the original searches by walking steps from the attacker where this counts map points and
 * bounds the walk, and its taken cell is one an own-side human stands on attacking, where
 * {@link MeleeSlots.isTaken} also counts cells dealt this tick and the goals of chasers still walking.
 * Keeping a goal still free is authored, so a cadence re-path does not redraw the slot.
 */
function contactSlot(
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  band: WeaponBand,
  slots: MeleeSlots,
  mine: OwnClaims,
  near: WalkLocal,
): NodeId | null {
  const inBand = (cell: NodeId): boolean => {
    const reach = hexNodeDistance(terrain, targetCell, cell);
    return reach >= band.minRange && reach <= band.maxRange;
  };
  const free = (cell: NodeId): boolean =>
    slots.isOpen(cell) &&
    !slots.isTaken(cell, mine.goal, mine.standingOn, mine.chaser) &&
    near.within(cell, WALK_LOCAL_STEPS);
  if (mine.goal !== undefined && inBand(mine.goal) && free(mine.goal)) return mine.goal;
  const choices: NodeId[] = [];
  const at = { hx: terrain.xOf(from), hy: terrain.yOf(from) };
  // Map points obey the triangle inequality, so only the rings within `maxRange` of the chaser's own
  // distance to the target can hold a band cell.
  const toTarget = hexNodeDistance(terrain, from, targetCell);
  const last = Math.min(CONTACT_SLOT_RADIUS, toTarget + band.maxRange);
  for (let ring = Math.max(0, toTarget - band.maxRange); ring <= last && choices.length === 0; ring++) {
    forEachRingNode(at, ring, terrain.width, terrain.height, (hx, hy) => {
      const cell = terrain.nodeAt(hx, hy);
      if (inBand(cell) && free(cell)) choices.push(cell);
      return choices.length < CONTACT_SLOT_CHOICES;
    });
  }
  if (choices.length <= 1) return choices[0] ?? null;
  return choices[ctx.rng.int(choices.length)] ?? null;
}

/** Whether a chaser routing stood in on `here` short of its approach waits there: it asks again on its
 *  stride when a node nearer `toward`, the target's combat node, is free beside it ({@link freeNearer}),
 *  though routing's rest test may still refuse that node. A free approach beyond a line of bodies waits as
 *  a taken one does. */
function waitsAtFront(
  ctx: SystemContext,
  terrain: TerrainGraph,
  slots: MeleeSlots,
  near: WalkLocal,
  e: Entity,
  here: NodeId,
  toward: NodeId,
  ranked: NodeId,
  mine: OwnClaims,
): boolean {
  return (
    !onStride(ctx.tick, e, REPATH_CADENCE) || !freeNearer(terrain, slots, near, here, toward, ranked, mine)
  );
}

/** Whether a node one step from `here`, nearer `toward` in map points, is free to step onto; or, with one
 *  beside it free and no farther, as at a gap in a wall the crowd waits beside, a free node nearer `ranked`,
 *  the node routing ranks a stand-in by, lies within {@link WALK_LOCAL_STEPS} of the chaser's walk. */
function freeNearer(
  terrain: TerrainGraph,
  slots: MeleeSlots,
  near: WalkLocal,
  here: NodeId,
  toward: NodeId,
  ranked: NodeId,
  mine: OwnClaims,
): boolean {
  const from = hexNodeDistance(terrain, here, toward);
  const free = (cell: NodeId): boolean =>
    slots.isOpen(cell) && !slots.isTaken(cell, mine.goal, mine.standingOn, mine.chaser);
  terrain.stepsInto(here, undefined, nearSteps);
  let aside = false;
  for (let i = 0; i < nearSteps.length; i++) {
    const cell = nearSteps.nodeAt(i);
    const distance = hexNodeDistance(terrain, cell, toward);
    if (distance > from || !free(cell)) continue;
    if (distance < from) return true;
    aside = true;
  }
  const rankedFrom = hexNodeDistance(terrain, here, ranked);
  return (
    aside &&
    near.reachesWithin(
      WALK_LOCAL_STEPS,
      (cell) => hexNodeDistance(terrain, cell, ranked) < rankedFrom && free(cell),
    )
  );
}

/** Scratch for {@link freeNearer}'s steps. */
const nearSteps = new StepBuffer();

/** Whether a chaser walks to the node routing parked it on short of `cell`, and no one else has taken it. */
function walksToStandIn(world: World, slots: MeleeSlots, e: Entity, cell: NodeId, mine: OwnClaims): boolean {
  const stood = world.tryGet(e, StandIn);
  if (stood?.goal !== cell || mine.goal !== stood.at) return false;
  return slots.isOpen(stood.at) && !slots.isTaken(stood.at, mine.goal, mine.standingOn, mine.chaser);
}

/** A band's nearest free cell from a chaser, and its nearest open and reachable one, taken or not. */
interface FreeInBand {
  readonly free: NodeId | null;
  readonly open: NodeId | null;
}

/** What the free-cell search reads of the tick's melee slots. */
type BandSlots = Pick<MeleeSlots, 'isOpen' | 'isTaken'>;

/**
 * The untaken cell of `band` around `targetCell` nearest `from` among the open, `reachable` ones, and the
 * nearest open, `reachable` one taken or not, each by (map points from `from`, cell id). Walks the rings
 * around `from` outward first, since the winners lie on the first rings holding such a band cell; when
 * those rings would cost more than the band itself, it walks the band instead.
 */
export function nearestFreeInBand(
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  band: WeaponBand,
  slots: BandSlots,
  mine: OwnClaims,
  reachable: (cell: NodeId) => boolean,
): FreeInBand {
  return (
    freeOnRingsFrom(terrain, from, targetCell, band, slots, mine, reachable) ??
    freeOverBand(terrain, from, targetCell, band, slots, mine, reachable)
  );
}

/** {@link nearestFreeInBand} over the rings around `from` that can hold a band cell, or null once they
 *  would visit more nodes than the band holds. Map points obey the triangle inequality, so every band cell
 *  lies within `maxRange` of the chaser's own distance to the target. */
function freeOnRingsFrom(
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  band: WeaponBand,
  slots: BandSlots,
  mine: OwnClaims,
  reachable: (cell: NodeId) => boolean,
): FreeInBand | null {
  const at = { hx: terrain.xOf(from), hy: terrain.yOf(from) };
  const targetX = terrain.xOf(targetCell);
  const targetY = terrain.yOf(targetCell);
  const toTarget = hexDistanceBetween(at.hx, at.hy, targetX, targetY);
  let budget = bandNodeCount(band);
  let free: NodeId | null = null;
  let open: NodeId | null = null;
  let ring = Math.max(0, toTarget - band.maxRange);
  let openRing = ring;
  const visit = (hx: number, hy: number): boolean => {
    const reach = hexDistanceBetween(targetX, targetY, hx, hy);
    if (reach < band.minRange || reach > band.maxRange) return true;
    const cell = terrain.nodeAt(hx, hy);
    if (!slots.isOpen(cell) || !reachable(cell)) return true;
    if (open === null || (openRing === ring && cell < open)) {
      open = cell;
      openRing = ring;
    }
    if ((free === null || cell < free) && !slots.isTaken(cell, mine.goal, mine.standingOn, mine.chaser))
      free = cell;
    return true;
  };
  for (const last = toTarget + band.maxRange; ring <= last; ring++) {
    budget -= ringNodeCount(ring);
    if (budget < 0) return null;
    forEachRingNode(at, ring, terrain.width, terrain.height, visit);
    if (free !== null) return { free, open };
  }
  return { free: null, open };
}

/** {@link nearestFreeInBand} over every cell of the band. */
function freeOverBand(
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  band: WeaponBand,
  slots: BandSlots,
  mine: OwnClaims,
  reachable: (cell: NodeId) => boolean,
): FreeInBand {
  const fromX = terrain.xOf(from);
  const fromY = terrain.yOf(from);
  let free: NodeId | null = null;
  let freeDist = Number.POSITIVE_INFINITY;
  let freeCell = Number.POSITIVE_INFINITY;
  let open: NodeId | null = null;
  let openDist = Number.POSITIVE_INFINITY;
  let openCell = Number.POSITIVE_INFINITY;
  forEachNodeInBand(terrain, targetCell, band, (cell) => {
    if (!slots.isOpen(cell) || !reachable(cell)) return true;
    const d = hexDistanceBetween(fromX, fromY, terrain.xOf(cell), terrain.yOf(cell));
    if (closer(d, cell, openDist, openCell)) {
      open = cell;
      openDist = d;
      openCell = cell;
    }
    // Someone already fights (or was dealt) here.
    if (slots.isTaken(cell, mine.goal, mine.standingOn, mine.chaser)) return true;
    if (closer(d, cell, freeDist, freeCell)) {
      free = cell;
      freeDist = d;
      freeCell = cell;
    }
    return true;
  });
  return { free, open };
}

/** Make `target` the enemy `e` holds, written only when it changes. A change re-aims the chase this pass and
 *  drops the route request asked for the enemy held before: its refusal, read against the new one, would end
 *  an attack order whose man had only turned aside, or count a refusal the new enemy never got. */
export function holdEnemy(world: World, ctx: SystemContext, e: Entity, target: Entity): void {
  const engagement = world.tryGet(e, Engagement);
  if (engagement === undefined) {
    world.add(e, Engagement, engagementRecord(ctx.tick, target));
    return;
  }
  if (engagement.target === target) return;
  const held = world.mut(e, Engagement);
  held.target = target;
  held.repathAt = ctx.tick;
  world.remove(e, PathRequest);
}

/** Let go of `enemy`, taken up beside an attack order, as one it cannot get at: the enemy is neither picked
 *  nor turned on again from outside the fighter's reach while it remembers it ({@link releaseAside}). */
function dropAside(world: World, ctx: SystemContext, e: Entity, enemy: Entity): void {
  noteUnreachableTarget(world, ctx, e, enemy);
  releaseAside(world, e);
}

/** Let go of the enemy a fighter turned aside to from its attack order, which it takes up again next pass. */
function releaseAside(world: World, e: Entity): void {
  world.remove(e, Engagement);
  clearNavState(world, e);
}

/** Drop the combatant's engagement, returning it to the economy: the {@link Engagement} marker and the chase
 *  movement it drove, plus both target commitments. Only the movement of a unit that was engaged is touched,
 *  so an economy unit with no marker keeps its own. */
export function disengage(world: World, e: Entity): void {
  if (world.has(e, Engagement)) {
    world.remove(e, Engagement);
    clearNavState(world, e);
  }
  world.remove(e, AttackOrder);
  world.remove(e, HuntFocus);
}
