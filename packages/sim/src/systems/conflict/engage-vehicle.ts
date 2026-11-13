import type { VehicleType, WeaponType } from '@open-northland/data';
import {
  Health,
  ownerOf,
  Position,
  Projectile,
  type SettlerIdentity,
  SettlerProgress,
  Vehicle,
  type VehicleAttack,
  type VehicleAttackTarget,
  VehicleDrive,
  type VehicleStance,
  type VehicleStateView,
  vehicleCommander,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import {
  type HalfCellNode,
  HEX_DIRECTIONS,
  hexDistance,
  hexDistanceBetween,
  hexHeadingBetween,
  positionOfNode,
  stepHex,
} from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { FIGHT_EXPERIENCE_TYPE } from '../progression/index.js';
import { isAreaWeapon } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { facingOfStep } from '../vehicles/helm.js';
import {
  crewInside,
  cutRouteAtRest,
  endMarch,
  freeGoal,
  refuseMove,
  rejoinMarch,
  startVehicleDrive,
  startVehicleDriveToNearest,
  touchesAnotherVehicle,
  vehicleBodyClear,
  vehicleRestBlocks,
} from '../vehicles/movement.js';
import { exploreAround, SIEGE_SHOT_SIGHT_NODES } from '../vision/index.js';
import type { CombatPass } from './pass.js';
import { mapPointDistance, shotFlightTicks, shotLandDelay } from './shot-aim.js';
import { combatTargetNode } from './target-node.js';
import { isValidOrderedTarget, isValidTarget } from './targeting.js';
import { noteUnreachableTarget } from './unreachable-targets.js';
import { scanForTarget } from './vehicle-targets.js';
import { attackClipTiming, vehicleWeapon } from './weapons.js';

// The siege vehicle's fight (docs/formats/VEHICLES.md "Catapult"): the target its scan finds
// (`vehicle-targets.ts`), backed off from, closed on or fired at, and the shot itself, a ground burst
// the projectile system flies to its scattered landing node. An attack-move's march is driven from here
// too. Ranges are map points (`hexNodeDistance`), the metric every other weapon band counts in. Original
// behavior.

/** How far, in map points, from its guard position a defending vehicle keeps a chase before dropping the
 *  target (original behavior). */
export const VEHICLE_DEFENCE_LEASH_POINTS = 60;
/** How long a march drives on unscanning after a chase could not reach its find: a few legs, so it
 *  gets past enemies it cannot close on. Approximation: the settlers' march rests one repath cadence,
 *  which is shorter than one vehicle leg. */
const MARCH_REST_TICKS = 5 * TICKS_PER_SECOND;
/** A vehicle too far from its target drives to a node this many map points inside its far reach
 *  (original behavior: `maxRange - 5`). */
export const APPROACH_BAND_DEPTH = 5;
/** Deviation (owner's choice): a vehicle looses its stone this many ticks after its clip's attack event,
 *  so one that has just stopped stands a moment before the shot. The clip's length, the cadence, stays. */
export const VEHICLE_SHOT_SETTLE_TICKS = 12;
/** The scatter roll is a percent; the base accuracy every commander has before any catapult
 *  experience (original behavior: `skill + 10`). */
const SCATTER_ROLL = 100;
const SCATTER_BASE_ACCURACY = 10;
/** The scatter's reach grows with a quarter of the flight distance (original behavior: `dist >> 2`). */
const SCATTER_DISTANCE_DIVISOR = 4;
/** How many firing spots a vehicle weighs by their routes, and how far apart, in map points, they lie, so
 *  the choice spans more than one pocket between obstacles. */
const FIRING_SPOT_CHOICES = 4;
const FIRING_SPOT_SPREAD_POINTS = 6;
/** How often a vehicle touching another judges whether the shot is its own and looks for a free spot. */
const FIRING_SPOT_RETRY_TICKS = TICKS_PER_SECOND;

/**
 * Resolve one vehicle's fight this tick: an unarmed, carried or uncommanded vehicle does nothing; an
 * armed one with its crew aboard plays its clip out, holds its target and acts on the distance to it,
 * or scans for one by its stance.
 */
export function engageVehicle(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  e: Entity,
): void {
  const state = world.get(e, Vehicle);
  if (world.get(e, Health).hitpoints <= 0) return;
  const weapon = vehicleWeapon(ctx, state);
  if (weapon === null) return;
  // Carried, uncrewed or with its crew still outside: nothing is aimed, so a held target is let go
  // rather than keeping the combat pass awake for a vehicle that cannot fire. An ordered attack that
  // waits on its boarding is the one exception: the boarding pass hands it back once the crew is in.
  // A march held for the same boarding waits too; one whose crew stepped out or lost its commander is
  // over, so it neither drives off on its own once a new crew boards nor keeps the pass awake.
  if (state.carrier !== null || !crewInside(state) || vehicleCommander(state) === null) {
    endClip(world, e);
    const boarding = state.task === 'waitsForHuman';
    if (!(boarding && state.attack?.ordered === true)) dropTarget(world, e);
    if (!boarding) endMarch(world, e);
    return;
  }
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined || !world.has(e, Position)) return;
  const identity = vehicleIdentity(type, state.tribe);
  const here = entityNode(world, terrain, e);

  // A clip that ended this tick: the vehicle was firing from here, which keeps the spot its own.
  const firedHere = state.attackClipStart !== null;
  if (firedHere) {
    const elapsed = ctx.tick - state.attackClipStart;
    const clip = vehicleShotTiming(ctx.content, identity);
    // A clip with no stone loosed yet ends without one when its aim is gone, reaped, out of the band or
    // ordered away, and the target is judged again below (the original checks the target's validity
    // before the roll). Past the shot only its end frees the weapon: the clip is not interruptible.
    if (elapsed <= clip.shotAt && !canLoose(world, ctx, terrain, e, identity, weapon, here)) {
      endClip(world, e);
    } else {
      if (elapsed === clip.shotAt) fire(world, ctx, terrain, e, state, weapon.weapon, here, clip.length);
      if (elapsed < clip.length) return;
      endClip(world, e); // the clip is over; the target is judged again below, this tick
    }
  }

  const judged = world.get(e, Vehicle);
  const held = judged.attack;
  const standing = held !== null && targetStands(world, ctx, e, identity, held) ? held.target : null;
  const ordered = standing !== null && held?.ordered === true;
  // The fight a march waits behind is over once the vehicle holds nothing that still stands.
  let march = judged.march;
  if (march?.behindFight === true && standing === null) {
    march = { ...march, behindFight: false };
    world.mut(e, Vehicle).march = march;
  }
  // A march fights in the attack stance whatever the vehicle's own stance says, once it has started.
  const stance: VehicleStance = march !== null && !march.behindFight ? 'attack' : state.stance;
  let target = standing;
  if (!ordered) {
    // A resting march drives on without looking.
    if (march !== null && ctx.tick < march.restUntil) {
      dropTarget(world, e);
      marchOn(world, ctx, terrain, e, here, march.goal);
      return;
    }
    // A plain goto in progress, or one held for the crew to board, is not hijacked by a scan; a march is.
    // A drive that still carries a target is the chase of one that fell or was taken off the map.
    if (march === null && target === null && (world.has(e, VehicleDrive) || state.heldGoal !== null)) {
      if (held !== null) quitChase(world, ctx, terrain, e);
      else dropTarget(world, e);
      return;
    }
    const found = scanForTarget(
      world,
      ctx,
      terrain,
      pass,
      e,
      stance,
      state.guard,
      identity,
      weapon,
      here,
      target,
    );
    if (found === 'pressed') {
      standPressed(world, ctx, terrain, e);
      return;
    }
    target = found;
  }
  if (target === null) {
    dropTarget(world, e);
    if (march !== null) marchOn(world, ctx, terrain, e, here, march.goal);
    return;
  }
  if (held === null || !sameTarget(held.target, target) || held.ordered !== ordered) {
    world.mut(e, Vehicle).attack = { target, ordered };
    // A find cuts the march short on the node it is crossing, so the next judgement closes or fires.
    if (march !== null) cutRouteAtRest(world, ctx, terrain, e);
  }
  actOnTarget(world, ctx, terrain, e, type, stance, weapon, here, target, ordered, firedHere);
}

/** Drive on toward the march's goal once nothing is left to fight; standing on it, the march is over.
 *  With no route left it ends where it stands, refused with `noPath` like a goto, and that spot is the
 *  guard position its stance scans around again. A drive under way is the march's own. */
function marchOn(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  goal: HalfCellNode,
): void {
  if (world.has(e, VehicleDrive)) return;
  const aimed = terrain.nodeAtClamped(goal.hx, goal.hy);
  // A goal another vehicle stands on moves beside it, so a march several vehicles share ends there.
  const goalNode = freeGoal(world, ctx, terrain, e, aimed);
  if (goalNode !== here) {
    const rejoined = goalNode === aimed && rejoinMarch(world, ctx, terrain, e, goal);
    if (rejoined || startVehicleDrive(world, ctx, terrain, e, goalNode)) return;
  }
  endMarch(world, e);
  if (goalNode === here) return;
  world.mut(e, Vehicle).guard = pointOf(terrain, here);
  refuseMove(world, ctx, e, 'noPath');
}

/** Stand among enemies too close to shoot: a chase or back-off ends on the node it is crossing, a march
 *  leg too, keeping the rest of the march to rejoin once they are gone. */
function standPressed(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): void {
  if (world.get(e, Vehicle).attack !== null) quitChase(world, ctx, terrain, e);
  else cutRouteAtRest(world, ctx, terrain, e);
}

export function sameTarget(a: VehicleAttackTarget, b: VehicleAttackTarget): boolean {
  if (a.kind === 'entity') return b.kind === 'entity' && a.entity === b.entity;
  return b.kind === 'ground' && a.hx === b.hx && a.hy === b.hy;
}

/** Whether the vehicle, standing still, holds a target it may shoot at from here. */
function canLoose(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  identity: SettlerIdentity,
  weapon: { minRange: number; maxRange: number },
  here: NodeId,
): boolean {
  const { attack } = world.get(e, Vehicle);
  if (attack === null || world.has(e, VehicleDrive)) return false;
  if (!targetStands(world, ctx, e, identity, attack)) return false;
  const dist = hexNodeDistance(terrain, here, aimNode(world, ctx, terrain, here, attack.target));
  return dist >= weapon.minRange && dist <= weapon.maxRange;
}

/** Whether a held target still stands and may be fought: a map point always does. An entity must
 *  still be positioned, which `isValidTarget` checks too, so a reaped or boarded mark reads gone. */
function targetStands(
  world: World,
  ctx: SystemContext,
  self: Entity,
  identity: SettlerIdentity,
  attack: Pick<VehicleAttack, 'target' | 'ordered'>,
): boolean {
  const target = attack.target;
  if (target.kind === 'ground') return true;
  // An ordered target may be what no scan picks, a wall included, as a soldier's ordered strike may.
  return attack.ordered
    ? isValidOrderedTarget(world, ctx, self, identity, target.entity)
    : isValidTarget(world, ctx, self, identity, target.entity);
}

/** Content-keyed: the identity a vehicle type's crew fights as, per tribe, so a pass mints none. */
const vehicleIdentities = new WeakMap<VehicleType, Map<number, SettlerIdentity>>();

/** The vehicle's attack clip with its shot held back by {@link VEHICLE_SHOT_SETTLE_TICKS}, never past
 *  the clip's end. */
function vehicleShotTiming(
  content: SystemContext['content'],
  identity: SettlerIdentity,
): { readonly length: number; readonly shotAt: number } {
  const clip = attackClipTiming(content, identity);
  return { length: clip.length, shotAt: Math.min(clip.shotAt + VEHICLE_SHOT_SETTLE_TICKS, clip.length) };
}

function vehicleIdentity(type: VehicleType, tribe: number): SettlerIdentity {
  let byTribe = vehicleIdentities.get(type);
  if (byTribe === undefined) {
    byTribe = new Map();
    vehicleIdentities.set(type, byTribe);
  }
  let identity = byTribe.get(tribe);
  if (identity === undefined) {
    identity = { tribe, jobType: type.jobId };
    byTribe.set(tribe, identity);
  }
  return identity;
}

/**
 * Too close backs off to a node inside the band, in range fires (once the vehicle stands, with the spot
 * its own), too far closes to a node inside the far reach. For a scanned target a holding vehicle moves
 * only to leave another's disc and otherwise drops it, and a defending one drops it once its chase has
 * taken it past the leash; an ordered target is closed on in every stance (original behavior). An auto
 * target no firing node can be reached for is given up; a vehicle that only has to leave another's disc
 * keeps its target and waits where it stands while no spot is free.
 */
function actOnTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  type: VehicleType,
  stance: VehicleStance,
  weapon: { minRange: number; maxRange: number },
  here: NodeId,
  target: VehicleAttackTarget,
  ordered: boolean,
  firedHere: boolean,
): void {
  const state = world.get(e, Vehicle);
  const targetNode = aimNode(world, ctx, terrain, here, target);
  if (!ordered && stance === 'defence' && state.guard !== null) {
    const leash = hexNodeDistance(terrain, terrain.nodeAtClamped(state.guard.hx, state.guard.hy), here);
    if (leash > VEHICLE_DEFENCE_LEASH_POINTS) {
      quitChase(world, ctx, terrain, e);
      return;
    }
  }
  const dist = hexNodeDistance(terrain, here, targetNode);
  const inRange = dist >= weapon.minRange && dist <= weapon.maxRange;
  // Deviation (owner's choice): of the vehicles whose discs share a cell only one fires, since a stacked
  // battery would be too strong. The others drive apart to firing nodes of their own, in any stance;
  // movement alone lets a catapult pass close by another.
  const stacked = inRange && yieldsFiringSpot(world, ctx, terrain, e, type, firedHere);
  if (inRange && !stacked) {
    if (cutRouteAtRest(world, ctx, terrain, e)) return; // fire once the drive is done

    const live = world.mut(e, Vehicle);
    live.facing = facingOfStep(pointOf(terrain, here), pointOf(terrain, targetNode));
    live.task = 'attacks';
    live.attackClipStart = ctx.tick;
    return;
  }
  if (!ordered && stance === 'hold' && !stacked) {
    dropTarget(world, e);
    return;
  }
  if (world.has(e, VehicleDrive)) return; // the chase leg under way ends before the next judgement
  if (stacked) {
    if (!onFiringSpotBeat(ctx, e)) return;
    const spots = firingNodes(world, ctx, terrain, e, here, targetNode, [weapon.minRange, weapon.maxRange]);
    startVehicleDriveToNearest(world, ctx, terrain, e, spots);
    return;
  }
  const approach: [number, number] =
    dist < weapon.minRange
      ? [weapon.minRange, weapon.maxRange]
      : [Math.max(weapon.minRange, weapon.maxRange - APPROACH_BAND_DEPTH), weapon.maxRange];
  const spots = firingNodes(world, ctx, terrain, e, here, targetNode, approach);
  if (startVehicleDriveToNearest(world, ctx, terrain, e, spots)) return;
  if (ordered) {
    refuseMove(world, ctx, e, 'noPath');
  } else if (target.kind === 'entity') {
    // Without the memo an unreachable enemy in sight is found, judged and dropped again every pass; a
    // march also rests, since the memo's few entries cannot hold a bank lined with such enemies.
    noteUnreachableTarget(world, ctx, e, target.entity);
    if (state.march !== null)
      world.mut(e, Vehicle).march = { ...state.march, restUntil: ctx.tick + MARCH_REST_TICKS };
  }
  dropTarget(world, e);
}

/**
 * Whether `e`, standing in range, leaves the shot to a vehicle whose disc shares a cell with its own and
 * that is in its attack clip, so the one already firing keeps firing when another drives into it. Only
 * a standing vehicle with its crew aboard plays a clip, so one under way, unarmed or uncrewed takes no
 * spot. `firedHere` says `e` itself fired from here until this tick and is judged at once; any other
 * touching vehicle yields until its own beat, staggered by entity, so the walk over every vehicle runs
 * once a clip for a firing vehicle and once a beat for a waiting one.
 */
function yieldsFiringSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  type: VehicleType,
  firedHere: boolean,
): boolean {
  if (!touchesAnotherVehicle(world, ctx, terrain, e, type)) return false;
  if (!firedHere && !onFiringSpotBeat(ctx, e)) return true;
  const anchor = vehicleAnchor(world, e);
  if (anchor === null) return false;
  const types = contentIndex(ctx.content).vehicles;
  for (const other of world.query(Vehicle, Position)) {
    if (other === e || world.has(other, VehicleDrive)) continue;
    const state = world.get(other, Vehicle);
    if (state.attackClipStart === null) continue;
    const centre = vehicleAnchor(world, other);
    const otherType = types.get(state.vehicleType);
    if (centre === null || otherType === undefined) continue;
    if (hexDistance(anchor, centre) <= type.logicSize + otherType.logicSize) return true;
  }
  return false;
}

/** The tick on which a vehicle touching another judges its neighbours and looks for a spot of its own. */
function onFiringSpotBeat(ctx: SystemContext, e: Entity): boolean {
  return (ctx.tick + e) % FIRING_SPOT_RETRY_TICKS === 0;
}

/** The node a shot is aimed at and the distance is measured to: a unit's own node, the nearest body
 *  node of a house or vehicle, or the ordered map point. */
function aimNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  target: VehicleAttackTarget,
): NodeId {
  if (target.kind === 'ground') return terrain.nodeAtClamped(target.hx, target.hy);
  return combatTargetNode(world, ctx, terrain, here, target.entity);
}

/** Where another vehicle's drive will stand: its goal and the radius of the disc it will cover there. */
interface ClaimedGoal {
  readonly hx: number;
  readonly hy: number;
  readonly radius: number;
}

/** The goals of every other vehicle under way, so two vehicles leaving one spot pick separate spots. */
function claimedGoals(world: World, ctx: SystemContext, e: Entity): ClaimedGoal[] {
  const types = contentIndex(ctx.content).vehicles;
  const claimed: ClaimedGoal[] = [];
  for (const other of world.query(VehicleDrive, Vehicle)) {
    if (other === e) continue;
    const type = types.get(world.get(other, Vehicle).vehicleType);
    if (type === undefined) continue;
    const { goal } = world.get(other, VehicleDrive);
    claimed.push({ hx: goal.hx, hy: goal.hy, radius: type.logicSize });
  }
  return claimed;
}

/** Whether a disc of `size` map points on node (x, y) touches the disc of any of `claimed`. */
function touchesClaim(claimed: readonly ClaimedGoal[], x: number, y: number, size: number): boolean {
  for (let i = 0; i < claimed.length; i++) {
    const goal = claimed[i];
    if (goal !== undefined && hexDistanceBetween(x, y, goal.hx, goal.hy) <= goal.radius + size) return true;
  }
  return false;
}

/**
 * Up to {@link FIRING_SPOT_CHOICES} nodes the vehicle may fire from, nearest `here` first (map points, then
 * node id) and {@link FIRING_SPOT_SPREAD_POINTS} apart: each one it may stand on (never a gap it may only
 * pass), where its disc touches no other vehicle's, standing or bound for its drive's goal, on its own
 * continent and `band` map points from `target`. Approximation: the original walks its own move-point
 * search near the target and floods a radius-5 disc for a firing spot across a continent seam; a target
 * with no such node on this continent is unreachable here too.
 */
function firingNodes(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  target: NodeId,
  [lo, hi]: readonly [number, number],
): NodeId[] {
  const state = world.get(e, Vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return [];
  const blocked = vehicleRestBlocks(world, ctx, terrain, e, type);
  const clear = vehicleBodyClear(world, ctx, terrain, e, type);
  const claimed = claimedGoals(world, ctx, e);
  const size = type.logicSize;
  const continent = terrain.componentOf(here);
  const t = terrain.coordsOf(target);
  const open: { readonly node: NodeId; readonly dist: number }[] = [];
  // A map-point disc of radius `hi` spans `hi` rows and, on any row, `hi` columns plus the odd-row lean.
  const columns = hi + 1;
  for (let dy = -hi; dy <= hi; dy++) {
    for (let dx = -columns; dx <= columns; dx++) {
      const x = t.x + dx;
      const y = t.y + dy;
      if (!terrain.inBounds(x, y)) continue;
      const reach = hexDistanceBetween(t.x, t.y, x, y);
      if (reach < lo || reach > hi) continue;
      const node = terrain.nodeAt(x, y);
      if (terrain.componentOf(node) !== continent || blocked.has(node)) continue;
      if (touchesClaim(claimed, x, y, size)) continue;
      open.push({ node, dist: hexNodeDistance(terrain, here, node) });
    }
  }
  open.sort((a, b) => a.dist - b.dist || a.node - b.node);
  const spots: NodeId[] = [];
  for (const { node } of open) {
    if (spots.length >= FIRING_SPOT_CHOICES) break;
    const apart = spots.every((spot) => hexNodeDistance(terrain, spot, node) >= FIRING_SPOT_SPREAD_POINTS);
    if (apart && clear(node)) spots.push(node);
  }
  return spots;
}

/**
 * Loose the shot at the clip's event tick: the aim is scattered by the commander's roll against its
 * catapult experience, then a ground-burst projectile flies there through the shared projectile
 * system. Three draws when the roll scatters, one otherwise, exactly the original's consumption. The
 * stone stands for `clipTicks`, the vehicle's attack clip, as the blow time a person it strikes earns.
 */
function fire(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  state: VehicleStateView,
  weapon: WeaponType,
  here: NodeId,
  clipTicks: number,
): void {
  const attack = state.attack;
  const commander = vehicleCommander(state);
  const from = world.tryGet(e, Position);
  if (attack === null || commander === null || from === undefined) return;
  if (weapon.speed === undefined || weapon.speed <= 0 || weapon.munitionType === undefined) return;
  const aim = terrain.coordsOf(aimNode(world, ctx, terrain, here, attack.target));
  const skill = world.tryGet(commander, SettlerProgress)?.experience.get(FIGHT_EXPERIENCE_TYPE.CATAPULT) ?? 0;
  const impactAt = scatter(ctx, terrain, here, aim, skill);
  const impact = positionOfNode(impactAt.hx, impactAt.hy);
  const shot = world.create();
  world.add(shot, Position, { x: from.x, y: from.y });
  world.add(shot, Projectile, {
    source: commander,
    target: attack.target.kind === 'entity' ? attack.target.entity : null,
    player: ownerOf(world, e) ?? null,
    // Resolved per victim on landing: the burst strikes whatever stands there.
    damage: { ...weapon.damage },
    hitSounds: { ...weapon.hitSounds },
    weaponMainType: weapon.mainType ?? null,
    blowTicks: clipTicks,
    missSounds: { ...weapon.missSounds },
    munitionType: weapon.munitionType,
    hitSelf: weapon.hitSelf,
    area: isAreaWeapon(weapon),
    originX: from.x,
    originY: from.y,
    aimX: impact.x,
    aimY: impact.y,
    cover: null,
    launchTick: ctx.tick,
    // Original behavior: a stone flies for the map points to where it comes down, as an arrow does.
    landTick: ctx.tick + shotLandDelay(shotFlightTicks(mapPointDistance(from, impact), weapon.speed)),
    impact: { smokeTicks: weapon.impactSmokeTicks ?? null },
  });
  // Original behavior: the crew sees where its stone comes down.
  exploreAround(ctx.fog, ownerOf(world, e), impact, SIEGE_SHOT_SIGHT_NODES);
  ctx.events.emit({
    kind: 'projectileLaunched',
    projectile: shot,
    shooter: commander,
    ...(attack.target.kind === 'entity' ? { target: attack.target.entity } : {}),
    munitionType: weapon.munitionType,
    at: { hx: terrain.xOf(here), hy: terrain.yOf(here) },
  });
}

/**
 * The scattered landing node: a percent roll `r` above the commander's accuracy (`skill + 10`)
 * offsets the aim by up to `(r - accuracy) * (dist / 4) / r` on each axis, centred on the aim
 * (original behavior), never landing farther from the vehicle than the aim ({@link shortOfAim}). The
 * result is clamped onto the map.
 */
function scatter(
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  aim: { readonly x: number; readonly y: number },
  skill: number,
): HalfCellNode {
  const roll = ctx.rng.int(SCATTER_ROLL);
  const accuracy = skill + SCATTER_BASE_ACCURACY;
  if (roll <= accuracy) return { hx: aim.x, hy: aim.y };
  const from = pointOf(terrain, here);
  const mark = { hx: aim.x, hy: aim.y };
  const dist = hexDistance(from, mark);
  const spread = Math.floor(((roll - accuracy) * Math.floor(dist / SCATTER_DISTANCE_DIVISOR)) / roll);
  const half = spread >> 1;
  const dx = ctx.rng.int(spread + 1) - half;
  const dy = ctx.rng.int(spread + 1) - half;
  const landing = shortOfAim(from, mark, dx, dy);
  const clamped = terrain.coordsOf(terrain.nodeAtClamped(landing.hx, landing.hy));
  return { hx: clamped.x, hy: clamped.y };
}

/**
 * The miss `(dx, dy)` off `aim`, kept no farther from the vehicle at `from` than the aim, so a stone
 * never strays forward onto what stands past its mark or its reach. Deviation (owner's rule): an
 * overshoot falls as far short instead, and a sideways miss the map-point metric still counts as
 * farther is drawn back toward the vehicle onto the aim's distance.
 */
function shortOfAim(from: HalfCellNode, aim: HalfCellNode, dx: number, dy: number): HalfCellNode {
  const reach = hexDistance(from, aim);
  let landing = { hx: aim.hx + dx, hy: aim.hy + dy };
  if (hexDistance(from, landing) > reach) landing = { hx: aim.hx - dx, hy: aim.hy - dy };
  // Each step along the heading toward the vehicle is one map point nearer.
  while (hexDistance(from, landing) > reach) {
    const toward = HEX_DIRECTIONS[hexHeadingBetween(landing.hx, landing.hy, from.hx, from.hy)] ?? 'east';
    landing = stepHex(landing, toward);
  }
  return landing;
}

function pointOf(terrain: TerrainGraph, node: NodeId): HalfCellNode {
  const x = terrain.xOf(node);
  const y = terrain.yOf(node);
  return { hx: x, hy: y };
}

/** End a clip without touching the target: the vehicle judges it afresh next pass. */
function endClip(world: World, e: Entity): void {
  if (world.get(e, Vehicle).attackClipStart === null) return;
  const live = world.mut(e, Vehicle);
  live.attackClipStart = null;
  if (live.task === 'attacks') live.task = 'none';
}

/** Forget the target: the vehicle stands where it is, in its stance, and scans again next pass. A
 *  vehicle with no target is left alone, its task included (a scene may pose one as attacking). */
function dropTarget(world: World, e: Entity): void {
  if (world.get(e, Vehicle).attack === null) return;
  const live = world.mut(e, Vehicle);
  live.attack = null;
  if (live.task === 'attacks') live.task = 'none';
}

/** Forget the target of a chase under way: the drive stops on the node it is crossing, and its end
 *  leaves the guard position where the chase found it (original behavior: a chase never moves it). */
function quitChase(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): void {
  dropTarget(world, e);
  if (!cutRouteAtRest(world, ctx, terrain, e)) return;
  world.mut(e, VehicleDrive).chaseLost = true;
}

/** A player's attack target rebuilt by kind, so a wire payload's stray fields never reach the state and
 *  no two components share the object a group order hands every member. */
export function ownAttackTarget(target: VehicleAttackTarget): VehicleAttackTarget {
  return target.kind === 'entity'
    ? { kind: 'entity', entity: target.entity }
    : { kind: 'ground', hx: target.hx, hy: target.hy };
}

/** The attack a fresh player order stands for. */
export function orderedAttack(target: VehicleAttackTarget): VehicleAttack {
  return { target: ownAttackTarget(target), ordered: true };
}
