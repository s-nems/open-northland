import type { WeaponType } from '@open-northland/data';
import {
  Health,
  Owner,
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
import { type HalfCellNode, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { FIGHT_EXPERIENCE_TYPE } from '../progression/index.js';
import { isAreaWeapon } from '../readviews/index.js';
import { manhattan } from '../spatial/metric.js';
import {
  crewInside,
  facingOfStep,
  refuseMove,
  startVehicleDrive,
  vehicleWalkBlocks,
} from '../vehicles/movement.js';
import { playerSeesEntity } from '../vision/index.js';
import type { CombatPass } from './pass.js';
import { mapPointDistance, shotFlightTicks } from './shot-aim.js';
import { combatTargetNode } from './target-node.js';
import { isValidOrderedTarget, isValidTarget } from './targeting.js';
import { givenUpTargetVeto, noteUnreachableTarget } from './unreachable-targets.js';
import { attackClipTiming, vehicleWeapon } from './weapons.js';

// The siege vehicle's fight (docs/formats/VEHICLES.md "Catapult"): a stance-driven scan, a target it
// backs off from, closes on or fires at, and the shot itself, a ground burst the projectile system
// flies to its scattered landing node. An attack-move's march is driven from here too. Ranges are
// Manhattan half-cell nodes, the metric every other weapon band here uses (approximation: the original
// measures its hexagon distance).

/** How far an attacking or defending siege vehicle looks for an enemy (original behavior). */
export const VEHICLE_SCAN_RADIUS_NODES = 40;
/** How far from its guard position a defending vehicle keeps a chase before dropping the target
 *  (original behavior). */
export const VEHICLE_DEFENCE_LEASH_NODES = 60;
/** How long a march drives on unscanning after a chase could not reach its find: a few legs, so it
 *  gets past enemies it cannot close on. Approximation: the settlers' march rests one repath cadence,
 *  which is shorter than one vehicle leg. */
const MARCH_REST_TICKS = 5 * TICKS_PER_SECOND;
/** A vehicle too far from its target drives to a node this many nodes inside its far reach
 *  (original behavior: `maxRange - 5`). */
const APPROACH_BAND_DEPTH = 5;
/** The scatter roll is a percent; the base accuracy every commander has before any catapult
 *  experience (original behavior: `skill + 10`). */
const SCATTER_ROLL = 100;
const SCATTER_BASE_ACCURACY = 10;
/** The scatter's reach grows with a quarter of the flight distance (original behavior: `dist >> 2`). */
const SCATTER_DISTANCE_DIVISOR = 4;

/**
 * Resolve one vehicle's fight this tick: an unarmed, carried or uncommanded vehicle does nothing; an
 * armed one with its crew aboard runs its clip, holds its target and acts on the distance to it, or
 * scans for one by its stance.
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
    const boarding = state.task === 'waitsForHuman';
    if (!(boarding && state.attack?.ordered === true)) dropTarget(world, e);
    if (!boarding && state.march !== null) world.mut(e, Vehicle).march = null;
    return;
  }
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  const anchor = vehicleAnchor(world, e);
  if (type === undefined || anchor === null) return;
  const identity: SettlerIdentity = { tribe: state.tribe, jobType: type.jobId };
  const here = terrain.nodeAtClamped(anchor.hx, anchor.hy);

  if (state.attack !== null && state.attack.clipStart !== null) {
    const elapsed = ctx.tick - state.attack.clipStart;
    // A mark reaped or taken off the map since the clip began is not shot at: the clip ends and the
    // target is judged again below (the original checks the target's validity before the roll).
    if (!targetStands(world, ctx, e, identity, state.attack)) endClip(world, e, state);
    else {
      const clip = attackClipTiming(ctx.content, identity);
      if (elapsed === clip.shotAt) fire(world, ctx, terrain, e, state, weapon.weapon, here);
      if (elapsed < clip.length) return;
      endClip(world, e, state); // the clip is over; the target is judged again below, this tick
    }
  }

  const { attack: held, march } = world.get(e, Vehicle);
  const standing = held !== null && targetStands(world, ctx, e, identity, held) ? held.target : null;
  const ordered = standing !== null && held?.ordered === true;
  // A march fights in the attack stance whatever the vehicle's own stance says.
  const stance: VehicleStance = march !== null ? 'attack' : state.stance;
  let target = standing;
  if (!ordered) {
    // A resting march drives on without looking.
    if (march !== null && ctx.tick < march.restUntil) {
      dropTarget(world, e);
      marchOn(world, ctx, terrain, e, here, march.goal);
      return;
    }
    // A plain goto in progress, or one held for the crew to board, is not hijacked by a scan; a march is.
    if (march === null && target === null && (world.has(e, VehicleDrive) || state.heldGoal !== null)) {
      dropTarget(world, e);
      return;
    }
    target = scanForTarget(world, ctx, terrain, pass, e, stance, state.guard, identity, weapon, here, target);
  }
  if (target === null) {
    dropTarget(world, e);
    if (march !== null) marchOn(world, ctx, terrain, e, here, march.goal);
    return;
  }
  if (held === null || !sameTarget(held.target, target) || held.ordered !== ordered) {
    world.mut(e, Vehicle).attack = { target, ordered, clipStart: null };
    // A find cuts the march short on the node it is crossing, so the next judgement closes or fires.
    if (march !== null) finishLeg(world, e);
  }
  actOnTarget(world, ctx, terrain, e, stance, weapon, here, target);
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
  const goalNode = terrain.nodeAtClamped(goal.hx, goal.hy);
  if (goalNode !== here && startVehicleDrive(world, ctx, terrain, e, goalNode)) return;
  const live = world.mut(e, Vehicle);
  live.march = null;
  if (goalNode === here) return;
  live.guard = pointOf(terrain, here);
  refuseMove(world, ctx, e, 'noPath');
}

/** End a drive's route after the leg under way. False when no drive stands. */
function finishLeg(world: World, e: Entity): boolean {
  const drive = world.tryGet(e, VehicleDrive);
  if (drive === undefined) return false;
  if (drive.route.length > 0) world.mut(e, VehicleDrive).route.length = 0;
  return true;
}

function sameTarget(a: VehicleAttackTarget, b: VehicleAttackTarget): boolean {
  if (a.kind === 'entity') return b.kind === 'entity' && a.entity === b.entity;
  return b.kind === 'ground' && a.hx === b.hx && a.hy === b.hy;
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

/**
 * The stance's scan: `hold` looks only inside the weapon band around the guard position, `defence`
 * out to the scan radius around it, `attack` around wherever the vehicle stands. The nearest valid,
 * seen enemy wins, and a held auto target no farther than the find is kept (original behavior;
 * approximation: the original's four-step preference for enemies indoors and houses is folded into
 * one nearest search). An enemy a chase could not reach is skipped for a while.
 */
function scanForTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  e: Entity,
  stance: VehicleStance,
  guard: HalfCellNode | null,
  identity: SettlerIdentity,
  weapon: { minRange: number; maxRange: number },
  here: NodeId,
  held: VehicleAttackTarget | null,
): VehicleAttackTarget | null {
  const centre = stance === 'attack' || guard === null ? here : terrain.nodeAtClamped(guard.hx, guard.hy);
  const minDist = stance === 'hold' ? weapon.minRange : 1;
  const maxDist = stance === 'hold' ? weapon.maxRange : VEHICLE_SCAN_RADIUS_NODES;
  const { x, y } = terrain.coordsOf(centre);
  const owner = world.tryGet(e, Owner);
  if (owner !== undefined && !pass.index.othersWithin(owner.player, x, y, maxDist)) return held;
  const givenUp = givenUpTargetVeto(world, ctx, e);
  const accept = (t: Entity): boolean =>
    givenUp?.(t) !== true &&
    isValidTarget(world, ctx, e, identity, t) &&
    (owner === undefined || playerSeesEntity(world, ctx.fog, owner.player, t));
  const found = pass.index.nearest(x, y, minDist, maxDist, accept, owner?.player ?? null);
  if (found === null) return held;
  if (held !== null && held.kind === 'entity') {
    if (held.entity === found.entity) return held;
    // Both measured from the scan centre, the metric the find carries.
    const heldDist = manhattan(terrain, centre, combatTargetNode(world, ctx, terrain, centre, held.entity));
    if (heldDist <= found.distance) return held;
  }
  return { kind: 'entity', entity: found.entity };
}

/**
 * Too close backs off to a node inside the band, in range fires (once the vehicle stands), too far
 * closes to a node inside the far reach; a holding vehicle never moves and drops the target instead,
 * and a defending one drops it once its chase has taken it past the leash. An auto target no firing
 * node can be reached for is given up.
 */
function actOnTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  stance: VehicleStance,
  weapon: { minRange: number; maxRange: number },
  here: NodeId,
  target: VehicleAttackTarget,
): void {
  const state = world.get(e, Vehicle);
  const targetNode = aimNode(world, ctx, terrain, here, target);
  if (stance === 'defence' && state.guard !== null) {
    const leash = manhattan(terrain, terrain.nodeAtClamped(state.guard.hx, state.guard.hy), here);
    if (leash > VEHICLE_DEFENCE_LEASH_NODES) {
      dropTarget(world, e);
      return;
    }
  }
  const dist = manhattan(terrain, here, targetNode);
  if (dist >= weapon.minRange && dist <= weapon.maxRange) {
    if (finishLeg(world, e)) return; // fire once the leg is done

    const live = world.mut(e, Vehicle);
    live.facing = facingOfStep(pointOf(terrain, here), pointOf(terrain, targetNode));
    live.task = 'attacks';
    if (live.attack !== null) live.attack.clipStart = ctx.tick;
    return;
  }
  if (stance === 'hold') {
    dropTarget(world, e);
    return;
  }
  if (world.has(e, VehicleDrive)) return; // the chase leg under way ends before the next judgement
  const band: [number, number] =
    dist < weapon.minRange
      ? [weapon.minRange, weapon.maxRange]
      : [Math.max(weapon.minRange, weapon.maxRange - APPROACH_BAND_DEPTH), weapon.maxRange];
  const goal = firingNode(world, ctx, terrain, e, here, targetNode, band);
  if (goal !== null && startVehicleDrive(world, ctx, terrain, e, goal)) return;
  // Without the memo an unreachable enemy in sight is found, judged and dropped again every pass; a
  // march also rests, since the memo's few entries cannot hold a bank lined with such enemies.
  if (target.kind === 'entity' && state.attack?.ordered !== true) {
    noteUnreachableTarget(world, ctx, e, target.entity);
    if (state.march !== null)
      world.mut(e, Vehicle).march = { ...state.march, restUntil: ctx.tick + MARCH_REST_TICKS };
  }
  dropTarget(world, e);
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

/**
 * The node nearest `here` (Manhattan, then node id) that the vehicle may stand on, lies on its own
 * continent and is `band` nodes from `target`. Approximation: the original walks its own move-point
 * search near the target and floods a radius-5 disc for a firing spot across a continent seam; a
 * target with no such node on this continent is unreachable here too.
 */
function firingNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  target: NodeId,
  [lo, hi]: readonly [number, number],
): NodeId | null {
  const state = world.get(e, Vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return null;
  const blocked = vehicleWalkBlocks(world, ctx, terrain, e, type);
  const continent = terrain.componentOf(here);
  const t = terrain.coordsOf(target);
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let dy = -hi; dy <= hi; dy++) {
    for (let dx = -hi; dx <= hi; dx++) {
      const reach = Math.abs(dx) + Math.abs(dy);
      if (reach < lo || reach > hi) continue;
      const x = t.x + dx;
      const y = t.y + dy;
      if (!terrain.inBounds(x, y)) continue;
      const node = terrain.nodeAt(x, y);
      if (terrain.componentOf(node) !== continent || blocked.has(node)) continue;
      const dist = manhattan(terrain, here, node);
      if (dist < bestDist || (dist === bestDist && best !== null && node < best)) {
        best = node;
        bestDist = dist;
      }
    }
  }
  return best;
}

/**
 * Loose the shot at the clip's event tick: the aim is scattered by the commander's roll against its
 * catapult experience, then a ground-burst projectile flies there through the shared projectile
 * system. Three draws when the roll scatters, one otherwise, exactly the original's consumption.
 */
function fire(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  state: VehicleStateView,
  weapon: WeaponType,
  here: NodeId,
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
    landTick: ctx.tick + shotFlightTicks(mapPointDistance(from, impact), weapon.speed),
    impact: { smokeTicks: weapon.impactSmokeTicks ?? null },
  });
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
 * (original behavior). The result is clamped onto the map.
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
  const dist = manhattan(terrain, here, terrain.nodeAt(aim.x, aim.y));
  const spread = Math.floor(((roll - accuracy) * Math.floor(dist / SCATTER_DISTANCE_DIVISOR)) / roll);
  const half = spread >> 1;
  const dx = ctx.rng.int(spread + 1) - half;
  const dy = ctx.rng.int(spread + 1) - half;
  const clamped = terrain.coordsOf(terrain.nodeAtClamped(aim.x + dx, aim.y + dy));
  return { hx: clamped.x, hy: clamped.y };
}

function pointOf(terrain: TerrainGraph, node: NodeId): HalfCellNode {
  const { x, y } = terrain.coordsOf(node);
  return { hx: x, hy: y };
}

/** Stop a running clip without touching the target: the vehicle judges it afresh next pass. */
function endClip(world: World, e: Entity, state: VehicleStateView): void {
  if (state.attack === null || state.attack.clipStart === null) return;
  const live = world.mut(e, Vehicle);
  if (live.attack !== null) live.attack.clipStart = null;
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

/** The attack a fresh player order stands for; the target is rebuilt by kind, so a wire payload's
 *  stray fields never reach the state. */
export function orderedAttack(target: VehicleAttackTarget): VehicleAttack {
  const own: VehicleAttackTarget =
    target.kind === 'entity'
      ? { kind: 'entity', entity: target.entity }
      : { kind: 'ground', hx: target.hx, hy: target.hy };
  return { target: own, ordered: true, clipStart: null };
}
