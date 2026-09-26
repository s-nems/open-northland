import {
  AttackOrder,
  Building,
  Engagement,
  EquipOrder,
  HuntFocus,
  MoveGoal,
  Owner,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { forEachRingNode, hexDistanceBetween, positionOfNode } from '../../nav/halfcell.js';
import { findPath } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { clearNavState, isTravelling, redirectRoute } from '../movement/nav-state.js';
import { breakThroughWall } from '../palisades/breach.js';
import { markLostWay } from '../settlers/lost-way.js';
import { closer, hexNodeDistance, manhattan, nearestHexCell } from '../spatial/metric.js';
import { type CombatantStance, type EngageSpec, enemyInReachFrom } from './engagement.js';
import { forEachNodeInBand, type MeleeSlots, type OwnClaims, type WeaponBand } from './melee-slots.js';
import type { CombatPass } from './pass.js';
import { noteUnreachableTarget } from './unreachable-targets.js';

// The walk-into-melee half of combat: advance an owned combatant on an out-of-reach enemy, deal each chaser
// a distinct contact cell so a converging mass forms ranks rather than a pile, and respect the DEFEND leash.

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
export const CONTACT_SLOT_RADIUS = 5;
export const CONTACT_SLOT_CHOICES = 6;

/**
 * How many ticks a chaser follows its current path toward an enemy before re-issuing a fresh one. A per-tick
 * full re-path of every chaser would breach the scale budget and eat the pathfinder's per-tick node budget;
 * between repaths the unit keeps walking its last route, and the distance-based swing check still catches it
 * the instant it steps into reach. Approximation (source basis "Combat chase / repath cadence").
 */
export const REPATH_CADENCE = 8;

/**
 * How many chase cadences in a row routing may refuse a route to the same target before the chase asks
 * whether buildings and resources alone seal it and, if so, gives it up as unreachable. A seal of standing
 * bodies is re-asked at the cadence for as long as it stands. Approximation: the original's rule is not
 * readable.
 */
export const SEALED_TARGET_ROUTE_FAILURES = 3;

/** Send a DEFEND unit back to its anchor when no enemy is in its defend radius. The {@link Engagement} always
 *  drops here, or the planner's Engagement gate would bench the guard for good; the walk home defers to a live
 *  equip errand, whose end re-holds the unchanged anchor. */
function returnToAnchor(world: World, e: Entity, here: NodeId, anchorCell: NodeId): void {
  world.remove(e, Engagement);
  world.remove(e, HuntFocus); // a post-holder holds no prey
  if (world.has(e, EquipOrder)) return;
  clearNavState(world, e);
  if (here !== anchorCell) world.add(e, MoveGoal, { cell: anchorCell });
}

/** Hand a combatant that will not advance this tick back to its idle duty: a post-holder walks back to its
 *  anchor, everyone else disengages. A hunter's leash carries `hold: false` because its between-hunts time
 *  belongs to the flag-gatherer drive, which a combat walk-back would fight for the unit. */
export function breakOff(world: World, e: Entity, here: NodeId, defend: DefendPost): void {
  if (defend?.hold === true) returnToAnchor(world, e, here, defend.anchorCell);
  else disengage(world, e);
}

/** Whether routing delivered `e`'s last route: the request is gone and its goal or path stands. A refused
 *  request stays until the chase clears it, and a hold issues nothing. */
function routeDelivered(world: World, e: Entity): boolean {
  return !world.has(e, PathRequest) && isTravelling(world, e);
}

/** Whether buildings and resources alone refuse every route from `from` to `goal`: the seal no standing body
 *  can lift. `from` is the request's own start, the walkable bracket node routing used; a mid-stride unit's
 *  truncated node may not be walkable at all. One search, so the chase asks only from the release threshold
 *  on. */
function sealedByStructures(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
  goal: NodeId,
): boolean {
  return findPath(terrain, from, goal, dynamicBlockOverlay(world, ctx, terrain)) === null;
}

/**
 * Advance an owned combatant on `target` it can't yet reach. It keeps an {@link Engagement} marker so the
 * PlannerSystem leaves the unit to combat, and re-issues a {@link MoveGoal} toward an {@link approachCell} at
 * most every {@link REPATH_CADENCE} ticks; between repaths it follows its live route and the distance-based
 * swing check catches it the instant it steps into reach. A refused route is stood out for a cadence; an
 * ordered unit whose route cannot resolve gives the order up at once. A building target's wall list lets a
 * chaser whose nearest face is fully manned encircle to a free slot on another face.
 *
 * A melee chaser standing behind a fully taken front steps along it instead ({@link seamStep}) when
 * `front` carries the spec whose targets it may turn to.
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
  target: ChaseTarget,
  weapon: ApproachBand,
  stance: CombatantStance,
  defend: DefendPost,
  front: EngageSpec | null,
): boolean {
  const { slots } = pass;
  const engagement = engagementFor(world, ctx, e, target.entity);

  const marching = world.tryGet(e, PlayerOrder)?.attackMove !== undefined;
  const commanded = stance.ordered || marching; // a player-driven chase - it releases here, not on the bank
  // A failed chase route ends an explicit attack order. An attack-move march instead rests its aggression
  // and walks on: without the rest, an enemy visible across a river holds the marcher in a failing search
  // every tick and the order can never complete.
  const request = world.tryGet(e, PathRequest);
  if (request?.failed) {
    // The breach this chase walks to, whose target a further wall found on the way still leads back to.
    const order = world.tryGet(e, AttackOrder);
    const breach = order?.target === target.entity ? order.breach : undefined;
    // A player-driven walk walled off by a palisade breaks through it: toward the ordered target, else toward
    // the march's goal.
    if (commanded) {
      const march = world.tryGet(e, PlayerOrder)?.attackMove;
      const goal = stance.ordered ? request.goal : march?.goal;
      const resume = stance.ordered ? (breach === undefined ? target.entity : breach.resume) : null;
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
        if (order.attackMove !== undefined) order.attackMove.blockedUntil = ctx.tick + REPATH_CADENCE;
      } else {
        // Only the dropped attack order is worth a note; the march above keeps walking.
        markLostWay(world, ctx, e);
      }
      return true;
    }
    // Stand the refused route out for a cadence and count it; from the threshold on, only a refusal that
    // buildings and resources alone explain releases the target. A fighter free to leave its spot breaks
    // an enemy wall that seals it off from an enemy player instead.
    const routes = (engagement.stall?.routes ?? 0) + 1;
    if (
      routes >= SEALED_TARGET_ROUTE_FAILURES &&
      sealedByStructures(world, ctx, terrain, request.start, request.goal)
    ) {
      const enemy = breach?.enemy ?? target.entity;
      const route = { start: request.start, goal: request.goal, sealed: true };
      if (
        defend === null &&
        worthASiege(world, enemy) &&
        breakThroughWall(world, ctx, terrain, e, route, { kind: 'own', enemy })
      ) {
        return true;
      }
      noteUnreachableTarget(world, ctx, e, target.entity);
      markLostWay(world, ctx, e);
      breakOff(world, e, here, defend);
      return true;
    }
    const held = world.mut(e, Engagement);
    held.stall = { target: target.entity, routes };
    held.repathAt = ctx.tick + REPATH_CADENCE;
    return false;
  }

  const travelling = isTravelling(world, e);
  // Still closing on a live route, or standing out a refused one's cadence: don't re-path.
  if (ctx.tick < engagement.repathAt && (travelling || engagement.stall !== undefined)) return false;

  const ownGoal = world.tryGet(e, MoveGoal)?.cell;
  // Only a cell in the chaser's own static walk component can be walked to, so the far bank is never asked
  // for. Bridges and boats are not yet walkable, so two banks really are separate; a chaser on an unwalkable
  // node (truncated onto it mid-stride) has no bank and admits every cell. Water nodes carry a label of
  // their own since ships sail them, so the walkability test is what says "no bank", not the label.
  const bank = terrain.isWalkable(here) ? terrain.componentOf(here) : -1;
  const onOurBank = (cell: NodeId): boolean => bank < 0 || terrain.componentOf(cell) === bank;

  // Its own body does not take the node it stands on from itself.
  const mine: OwnClaims = {
    goal: ownGoal,
    standingOn: onNodeCentre(world, terrain, e, here) ? here : undefined,
  };
  // A waiting second rank re-asks each tick, but draws a contact slot only on its cadence: the draw walks
  // the whole disc around it, and the nearest free side is what puts it in when a front-liner steps off.
  const drawSlot = engagement.waiting !== true || onStride(ctx.tick, e, REPATH_CADENCE);
  // The near-side node a breach dealt this breaker comes first, while it is open and untaken.
  const stand = breachStand(world, terrain, e, target, weapon);
  let approach: Approach =
    stand !== null && slots.isOpen(stand) && !slots.isTaken(stand, mine.goal, mine.standingOn)
      ? { cell: stand, waiting: false }
      : target.body !== null && target.body.length > 0
        ? faceApproach(terrain, slots, here, target, weapon, mine, onOurBank)
        : approachCell(ctx, terrain, here, target.node, weapon, slots, mine, onOurBank, drawSlot);
  // The enemy a step along the front brings into reach, taken up in place of the held one.
  let alongFront: Entity | null = null;
  if (approach.waiting && approach.cell === here && mine.standingOn !== undefined) {
    const step =
      front === null || !drawSlot
        ? null
        : seamStep(world, ctx, terrain, pass, front, target.entity, weapon, here, mine, onOurBank);
    if (step === null) {
      // A second rank standing where it waits: idle, with no route for the render to read as a walk. It
      // keeps its target and re-asks each tick, which puts it in the moment a front-liner falls or steps
      // off. Routing was not asked, so no refusal stands against the target.
      clearNavState(world, e);
      if (engagement.stall !== undefined || engagement.waiting !== true) {
        const held = world.mut(e, Engagement);
        held.stall = undefined;
        held.waiting = true;
      }
      return false;
    }
    approach = { cell: step.cell, waiting: false };
    alongFront = step.enemy;
  }
  const dest = approach.cell;
  // `dest` fell back to the target itself: no cell that would bring it into reach is one this unit can stand
  // on. Only the walk is refused - the reach check ran before the chase, so an archer still shoots across
  // water. Giving up here is an approximation (source basis "Combat chase").
  if (!commanded && !onOurBank(dest)) {
    breakOff(world, e, here, defend);
    return true;
  }
  // Anchor leash: a target hittable only by stepping past `leash` from the anchor is left alone.
  if (defend !== null && leashDistance(terrain, defend, dest) > defend.leash) {
    breakOff(world, e, here, defend);
    return true;
  }
  if (dest === here && !travelling) {
    // Standing on its own best approach cell yet out of range: the target cannot be closed on, so give up
    // rather than loop engaged-but-frozen. Next tick the unit re-acquires another enemy, or the economy
    // relocates it, so it never stays stuck. A travelling unit falls through instead, finishes its step and
    // swings next pass.
    disengage(world, e);
    return true;
  }
  redirectRoute(world, e, dest); // keep the live route - dropping it reset the gait (chase stutter)
  slots.claim(dest, world.tryGet(e, Owner)?.player ?? null);
  const held = world.mut(e, Engagement);
  held.repathAt = ctx.tick + REPATH_CADENCE;
  held.waiting = undefined;
  if (alongFront !== null) held.target = alongFront;
  return false;
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

/** How far `dest` lies from the anchor of `defend`, in the metric its leash counts in. */
function leashDistance(terrain: TerrainGraph, defend: NonNullable<DefendPost>, dest: NodeId): number {
  return defend.metric === 'hex'
    ? hexNodeDistance(terrain, defend.anchorCell, dest)
    : manhattan(terrain, defend.anchorCell, dest);
}

/** `e`'s {@link Engagement} on `target`, added to repath at once on a first engagement. A stall is about one
 *  target and ends the moment a route is delivered; a chase in between writes nothing. */
function engagementFor(world: World, ctx: SystemContext, e: Entity, target: Entity) {
  const prior = world.tryGet(e, Engagement);
  if (prior === undefined) return world.add(e, Engagement, { repathAt: ctx.tick });
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

/** Where a chaser heads: a cell that brings its target into reach, or with every such cell taken a cell a
 *  step outside them to wait on (`waiting`). */
interface Approach {
  readonly cell: NodeId;
  readonly waiting: boolean;
}

/** One map point farther than the weapon's far reach: where an overflow waits behind the front. */
function secondRank(weapon: WeaponBand): WeaponBand {
  return { minRange: weapon.maxRange + 1, maxRange: weapon.maxRange + 1 };
}

/**
 * The cell a chaser should walk to in order to bring `target` into its weapon band, among the {@link
 * MeleeSlots.isOpen open}, `reachable`, untaken cells of the band: a melee contact slot ({@link contactSlot})
 * once one lies near, else the one closest to `from`, canonicalized by (distance, cell id). A melee unit
 * therefore stops a map point short of the enemy rather than on it, where distance 0 would sit below every
 * weapon's near reach. Falls back to the target's own cell when no cell in the band is open and reachable
 * at all.
 *
 * Original behavior: with every side taken the attacker keeps its target, walks up and fights from a taken
 * node, so no cap limits how many strike one enemy. Intentional deviation: a standing fighter's body blocks
 * its node here (authored body collision, `movement/collision`), so the overflow waits on the nearest free
 * cell a step outside the band, or where it stands when that ring is full too, and steps in once a side
 * frees.
 */
function approachCell(
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  weapon: ApproachBand,
  slots: MeleeSlots,
  mine: OwnClaims,
  reachable: (cell: NodeId) => boolean,
  drawSlot: boolean,
): Approach {
  const slot =
    weapon.contact && drawSlot
      ? contactSlot(ctx, terrain, from, targetCell, weapon, slots, mine, reachable)
      : null;
  if (slot !== null) return { cell: slot, waiting: false };
  const front = nearestFreeInBand(terrain, from, targetCell, weapon, slots, mine, reachable);
  if (front.free !== null) return { cell: front.free, waiting: false };
  if (!front.anyOpen) return { cell: targetCell, waiting: false };
  const rank = nearestFreeInBand(terrain, from, targetCell, secondRank(weapon), slots, mine, reachable);
  return { cell: rank.free ?? from, waiting: true };
}

/** {@link approachCell} around a building's walls: its free contact cells on our bank, else the second
 *  rank around them. With no face on our bank there is no front at all: aim at the body, which the chase's
 *  bank check refuses. */
function faceApproach(
  terrain: TerrainGraph,
  slots: MeleeSlots,
  here: NodeId,
  target: ChaseTarget,
  weapon: WeaponBand,
  mine: OwnClaims,
  onOurBank: (cell: NodeId) => boolean,
): Approach {
  const free = (cell: NodeId): boolean => onOurBank(cell) && !slots.isTaken(cell, mine.goal, mine.standingOn);
  const faces = slots.encircleCandidates(target.entity, target.body, weapon);
  const face = nearestHexCell(terrain, faces, here, free);
  if (face !== null) return { cell: face, waiting: false };
  if (!faces.some(onOurBank)) return { cell: target.node, waiting: false };
  const rank = slots.encircleCandidates(target.entity, target.body, secondRank(weapon));
  return { cell: nearestHexCell(terrain, rank, here, free) ?? here, waiting: true };
}

/**
 * A melee attacker's contact slot: its own goal while that is still a free cell of the band, else one
 * drawn at random among up to {@link CONTACT_SLOT_CHOICES} free cells of the band at the nearest distance
 * from the attacker that holds one, searched ring by ring out to {@link CONTACT_SLOT_RADIUS}; null when
 * none lies that near, and the chase closes on the nearest free cell instead. Original behavior: the draw
 * never reaches past the first distance with a free cell, so a lone attacker takes the near side.
 * Approximations: the original searches by walking steps from the attacker where this counts map points,
 * and its taken cell is one an own-side human stands on attacking, where {@link MeleeSlots.isTaken} also
 * counts cells dealt this tick and the goals of chasers still walking. Keeping a goal still free is
 * authored, so a cadence re-path does not redraw the slot.
 */
function contactSlot(
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  band: WeaponBand,
  slots: MeleeSlots,
  mine: OwnClaims,
  reachable: (cell: NodeId) => boolean,
): NodeId | null {
  const inBand = (cell: NodeId): boolean => {
    const reach = hexNodeDistance(terrain, targetCell, cell);
    return reach >= band.minRange && reach <= band.maxRange;
  };
  const free = (cell: NodeId): boolean =>
    slots.isOpen(cell) && reachable(cell) && !slots.isTaken(cell, mine.goal, mine.standingOn);
  if (mine.goal !== undefined && inBand(mine.goal) && free(mine.goal)) return mine.goal;
  const choices: NodeId[] = [];
  const at = { hx: terrain.xOf(from), hy: terrain.yOf(from) };
  for (let ring = 0; ring <= CONTACT_SLOT_RADIUS && choices.length === 0; ring++) {
    forEachRingNode(at, ring, terrain.width, terrain.height, (hx, hy) => {
      const cell = terrain.nodeAt(hx, hy);
      if (inBand(cell) && free(cell)) choices.push(cell);
      return choices.length < CONTACT_SLOT_CHOICES;
    });
  }
  if (choices.length <= 1) return choices[0] ?? null;
  return choices[ctx.rng.int(choices.length)] ?? null;
}

/** The untaken cell of `band` around `targetCell` nearest `from` among the open, `reachable` ones, and
 *  whether any cell of the band is open and reachable at all. Costs the band's area. */
function nearestFreeInBand(
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  band: WeaponBand,
  slots: MeleeSlots,
  mine: OwnClaims,
  reachable: (cell: NodeId) => boolean,
): { free: NodeId | null; anyOpen: boolean } {
  const fromX = terrain.xOf(from);
  const fromY = terrain.yOf(from);
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  let anyOpen = false;
  forEachNodeInBand(terrain, targetCell, band, (cell) => {
    if (!slots.isOpen(cell) || !reachable(cell)) return true;
    anyOpen = true;
    if (slots.isTaken(cell, mine.goal, mine.standingOn)) return true; // someone already fights (or was dealt) here
    const d = hexDistanceBetween(fromX, fromY, terrain.xOf(cell), terrain.yOf(cell));
    if (closer(d, cell, bestDist, bestCell)) {
      best = cell;
      bestDist = d;
      bestCell = cell;
    }
    return true;
  });
  return { free: best, anyOpen };
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
