import type { VehicleType, WeaponType } from '@open-northland/data';
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
import { type HalfCellNode, hexDistanceBetween, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { FIGHT_EXPERIENCE_TYPE } from '../progression/index.js';
import { isAreaWeapon } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { facingOfStep } from '../vehicles/helm.js';
import {
  crewInside,
  cutRoute,
  endMarch,
  freeGoal,
  keepMarchRoute,
  refuseMove,
  rejoinMarch,
  startVehicleDrive,
  touchesAnotherVehicle,
  vehicleBodyClear,
  vehicleRestBlocks,
} from '../vehicles/movement.js';
import { exploreAround, playerSeesEntity, SIEGE_SHOT_SIGHT_NODES } from '../vision/index.js';
import type { CombatPass } from './pass.js';
import { mapPointDistance, shotFlightTicks, shotLandDelay } from './shot-aim.js';
import { combatTargetNode } from './target-node.js';
import { isValidOrderedTarget, isValidTarget } from './targeting.js';
import { givenUpTargetVeto, noteUnreachableTarget } from './unreachable-targets.js';
import { attackClipTiming, vehicleWeapon } from './weapons.js';

// The siege vehicle's fight (docs/formats/VEHICLES.md "Catapult"): a stance-driven scan, a target it
// backs off from, closes on or fires at, and the shot itself, a ground burst the projectile system
// flies to its scattered landing node. An attack-move's march is driven from here too. Ranges are map
// points (`hexNodeDistance`), the metric every other weapon band counts in. Original behavior.

/** How far, in map points, an attacking or defending siege vehicle looks for an enemy (original
 *  behavior). */
export const VEHICLE_SCAN_RADIUS_POINTS = 40;
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
/** The scatter roll is a percent; the base accuracy every commander has before any catapult
 *  experience (original behavior: `skill + 10`). */
const SCATTER_ROLL = 100;
const SCATTER_BASE_ACCURACY = 10;
/** The scatter's reach grows with a quarter of the flight distance (original behavior: `dist >> 2`). */
const SCATTER_DISTANCE_DIVISOR = 4;

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

  if (state.attackClipStart !== null) {
    const elapsed = ctx.tick - state.attackClipStart;
    const clip = attackClipTiming(ctx.content, identity);
    // A clip with no stone loosed yet ends without one when its aim is gone, reaped, out of the band or
    // ordered away, and the target is judged again below (the original checks the target's validity
    // before the roll). Past the shot only its end frees the weapon: the clip is not interruptible.
    if (elapsed <= clip.shotAt && !canLoose(world, ctx, terrain, e, identity, weapon, here)) {
      endClip(world, e);
    } else {
      if (elapsed === clip.shotAt) fire(world, ctx, terrain, e, state, weapon.weapon, here);
      if (elapsed < clip.length) return;
      endClip(world, e); // the clip is over; the target is judged again below, this tick
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
    // A drive that still carries a target is the chase of one that fell or was taken off the map.
    if (march === null && target === null && (world.has(e, VehicleDrive) || state.heldGoal !== null)) {
      if (held !== null) quitChase(world, e);
      else dropTarget(world, e);
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
    world.mut(e, Vehicle).attack = { target, ordered };
    // A find cuts the march short on the node it is crossing, so the next judgement closes or fires.
    if (march !== null) finishLeg(world, e);
  }
  actOnTarget(world, ctx, terrain, e, type, stance, weapon, here, target, ordered);
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

/** End a drive's route after the leg under way, keeping a march's rest to rejoin. False when no drive
 *  stands. */
function finishLeg(world: World, e: Entity): boolean {
  keepMarchRoute(world, e);
  return cutRoute(world, e);
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
  const maxDist = stance === 'hold' ? weapon.maxRange : VEHICLE_SCAN_RADIUS_POINTS;
  const x = terrain.xOf(centre);
  const y = terrain.yOf(centre);
  const owner = world.tryGet(e, Owner);
  if (owner !== undefined && !pass.index.othersWithin(owner.player, x, y, maxDist)) return held;
  pass.vehicleScan ??= new VehicleScan(world, ctx);
  const scan = pass.vehicleScan.aim(e, identity, owner?.player, givenUpTargetVeto(world, ctx, e));
  const found = pass.index.nearest(x, y, minDist, maxDist, scan.accept, owner?.player ?? null, 'hex');
  if (found === null) return held;
  if (held !== null && held.kind === 'entity') {
    if (held.entity === found.entity) return held;
    // Both measured from the scan centre, the metric the find carries.
    const heldDist = hexNodeDistance(
      terrain,
      centre,
      combatTargetNode(world, ctx, terrain, centre, held.entity),
    );
    if (heldDist <= found.distance) return held;
  }
  return { kind: 'entity', entity: found.entity };
}

/** One pass's vehicle scan filter, re-aimed per vehicle so a scan allocates no closure: the nearest valid,
 *  seen target the vehicle has not given up on. */
export class VehicleScan {
  private e = 0 as Entity;
  private identity: SettlerIdentity = { tribe: 0, jobType: null };
  private player: number | undefined;
  private givenUp: ((t: Entity) => boolean) | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
  ) {}

  readonly accept = (t: Entity): boolean =>
    this.givenUp?.(t) !== true &&
    isValidTarget(this.world, this.ctx, this.e, this.identity, t) &&
    (this.player === undefined || playerSeesEntity(this.world, this.ctx.fog, this.player, t));

  aim(
    e: Entity,
    identity: SettlerIdentity,
    player: number | undefined,
    givenUp: ((t: Entity) => boolean) | undefined,
  ): this {
    this.e = e;
    this.identity = identity;
    this.player = player;
    this.givenUp = givenUp;
    return this;
  }
}

/** Content-keyed: the identity a vehicle type's crew fights as, per tribe, so a pass mints none. */
const vehicleIdentities = new WeakMap<VehicleType, Map<number, SettlerIdentity>>();

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
 * Too close backs off to a node inside the band, in range fires (once the vehicle stands, outside every
 * other vehicle's disc), too far closes to a node inside the far reach. For a scanned target a holding
 * vehicle moves only to leave another's disc and otherwise drops it, and a defending one drops it once
 * its chase has taken it past the leash; an ordered target is closed on in every stance (original
 * behavior). An auto target no firing node can be reached for is given up.
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
): void {
  const state = world.get(e, Vehicle);
  const targetNode = aimNode(world, ctx, terrain, here, target);
  if (!ordered && stance === 'defence' && state.guard !== null) {
    const leash = hexNodeDistance(terrain, terrain.nodeAtClamped(state.guard.hx, state.guard.hy), here);
    if (leash > VEHICLE_DEFENCE_LEASH_POINTS) {
      quitChase(world, e);
      return;
    }
  }
  const dist = hexNodeDistance(terrain, here, targetNode);
  const inRange = dist >= weapon.minRange && dist <= weapon.maxRange;
  // Deviation (owner's choice): a vehicle whose disc shares a cell with another's never fires from there.
  // It drives apart to a firing node of its own first, in any stance, since a stacked battery would be
  // too strong; movement alone lets a catapult pass close by another.
  const stacked = inRange && touchesAnotherVehicle(world, ctx, terrain, e, type);
  if (inRange && !stacked) {
    if (finishLeg(world, e)) return; // fire once the leg is done

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
  const band: [number, number] =
    dist < weapon.minRange || stacked
      ? [weapon.minRange, weapon.maxRange]
      : [Math.max(weapon.minRange, weapon.maxRange - APPROACH_BAND_DEPTH), weapon.maxRange];
  const goal = firingNode(world, ctx, terrain, e, here, targetNode, band);
  if (goal !== null && startVehicleDrive(world, ctx, terrain, e, goal)) return;
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

/**
 * The node nearest `here` (map points, then node id) that the vehicle may stand on (never a gap it may
 * only pass), where its disc touches no other vehicle's, standing or bound for its drive's goal, lies on
 * its own continent and is `band` map points from `target`. Approximation: the
 * original walks its own move-point search near the target and floods a radius-5 disc for a firing spot
 * across a continent seam; a target with no such node on this continent is unreachable here too.
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
  const blocked = vehicleRestBlocks(world, ctx, terrain, e, type);
  const clear = vehicleBodyClear(world, ctx, terrain, e, type);
  const claimed = claimedGoals(world, ctx, e);
  const size = type.logicSize;
  const continent = terrain.componentOf(here);
  const t = terrain.coordsOf(target);
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
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
      if (claimed.some((goal) => hexDistanceBetween(x, y, goal.hx, goal.hy) <= goal.radius + size)) continue;
      const dist = hexNodeDistance(terrain, here, node);
      if (dist > bestDist || !clear(node)) continue;
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
  const dist = hexNodeDistance(terrain, here, terrain.nodeAt(aim.x, aim.y));
  const spread = Math.floor(((roll - accuracy) * Math.floor(dist / SCATTER_DISTANCE_DIVISOR)) / roll);
  const half = spread >> 1;
  const dx = ctx.rng.int(spread + 1) - half;
  const dy = ctx.rng.int(spread + 1) - half;
  const clamped = terrain.coordsOf(terrain.nodeAtClamped(aim.x + dx, aim.y + dy));
  return { hx: clamped.x, hy: clamped.y };
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
function quitChase(world: World, e: Entity): void {
  dropTarget(world, e);
  if (!cutRoute(world, e)) return;
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
