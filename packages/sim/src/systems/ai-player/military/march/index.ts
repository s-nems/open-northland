import {
  AttackOrder,
  Engagement,
  Health,
  Vehicle,
  VehicleDrive,
  vehicleCommander,
  WaveMarch,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { vehicleAnchor } from '../../../footprint/index.js';
import { MILITARY_MODE } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { VEHICLE_TARGET_SNAP_RADIUS } from '../../../vehicles/movement.js';
import { seatBarracksOf } from '../../base.js';
import { anchorCentroid } from '../../node-geometry.js';
import { isRangedFighter, weaponMix } from '../census.js';
import { enemyPosts, seatRaiders } from '../defence/index.js';
import { meleeCoreFor, waveWorthy } from '../muster.js';
import { crewedCatapults, PARK_RING_MAX_NODES, PARK_SPACING_NODES } from '../siege-crew.js';
import { formation, type WaveMarchView } from './formation.js';
import { manhattanOf, nodeOf } from './geometry.js';
import { catapultOrders, driveCatapult, type Fire, placeOrders, ringOrders, type Wave } from './orders.js';
import { routeTo } from './route.js';
import { arrivalOrders, enemyTowerNodesNear } from './siege.js';

export { RANKS_BEHIND_CATAPULTS_NODES } from './formation.js';
export { LEG_NODES, SIEGE_STANDOFF_NODES, SIEGE_TOWER_STANDOFF_NODES } from './route.js';
export { SIEGE_TOWER_RADIUS_NODES } from './siege.js';

// A launched wave marches as one body: leg by leg along one route, the next leg ordered only once
// everybody stands closed up on the last. The original's army formation is unobserved, so every distance,
// shape and threshold here is an approximation. Distances are Manhattan half-cell nodes unless named hex.

/** How near his own place a man stands to count as closed up. */
export const REGROUP_SLACK_NODES = 4;

/** How long a leg waits for its stragglers before the wave marches on without them. */
export const LEG_TIMEOUT_TICKS = 60 * TICKS_PER_SECOND;

/** How far around the wave's centre enemy fighters count toward a charge. */
export const CHARGE_RADIUS_NODES = 24;

/** The fewest enemy fighters near the wave that make it charge, and the share of its own men that
 *  raises that floor for a bigger wave. */
export const CHARGE_MIN_ENEMIES = 5;
export const CHARGE_ARMY_DIVISOR = 3;

/** How near the barracks door a crewed catapult stands to join a launching wave: the park band and one
 *  spacing more. */
const HOME_CATAPULT_NODES = PARK_RING_MAX_NODES + PARK_SPACING_NODES;

export interface WaveDecision {
  readonly commands: readonly PlayerCommand[];
  /** Whether a wave still marches after this decision: the door does not launch another meanwhile. */
  readonly active: boolean;
}

const NO_WAVE: WaveDecision = { commands: [], active: false };

/** The men and catapults of the seat's marching wave, or null while none marches. */
export function marchingWave(
  world: World,
  ctx: SystemContext,
  player: number,
): { readonly men: ReadonlySet<Entity>; readonly catapults: ReadonlySet<Entity> } | null {
  const barracks = seatBarracksOf(world, ctx, player);
  const state = barracks === null ? undefined : world.tryGet(barracks, WaveMarch);
  return state === undefined ? null : { men: new Set(state.men), catapults: new Set(state.catapults) };
}

export function endMarch(world: World, barracks: Entity): void {
  world.remove(barracks, WaveMarch);
}

/**
 * Launch `men` from the barracks door `home` on `target`, taking the crewed catapults parked at home: the
 * route is found once, over the lead catapult's walk-block when one goes, so every leg end is ground the
 * catapults can stand on too.
 */
export function launchWave(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  home: NodeId,
  target: Entity,
  objective: NodeId,
  men: readonly Entity[],
): void {
  const door = nodeOf(terrain, home);
  const catapults = crewedCatapults(world, ctx, player)
    .filter(({ vehicle }) => {
      const at = vehicleAnchor(world, vehicle);
      return (
        at !== null &&
        world.get(vehicle, Vehicle).attack === null &&
        manhattanOf(at, door) <= HOME_CATAPULT_NODES
      );
    })
    .map(({ vehicle }) => vehicle);
  const towers = enemyTowerNodesNear(world, ctx, terrain, player, objective);
  const route = routeTo(world, ctx, terrain, home, objective, towers, catapults[0] ?? null);
  world.add(barracks, WaveMarch, {
    target,
    origin: door,
    waypoints: route,
    leg: 0,
    legSince: ctx.tick,
    arrived: route.length === 0,
    men: [...men],
    catapults,
  });
}

/**
 * One decision for the marching wave: a charge when enough enemy fighters stand near it, else the next leg
 * once it has closed up on the last, else the siege or the assault once it has arrived. `field` holds the
 * wave's men this decision may count on; a man in a fight still belongs to it, anyone else has left it.
 * A new `target` routes the wave again from where it stands, and a wave no longer {@link waveWorthy} is
 * spent: its men fall back to the muster.
 */
export function advanceWave(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  target: Entity,
  objective: NodeId,
  field: readonly Entity[],
): WaveDecision {
  const held = world.tryGet(barracks, WaveMarch);
  if (held === undefined) return NO_WAVE;
  const inField = new Set(field);
  const men = held.men.filter((e) => inField.has(e) || fighting(world, e));
  const catapults = held.catapults.filter((v) => crewed(world, v));
  const mix = weaponMix(world, ctx, men);
  if (!waveWorthy(mix, meleeCoreFor(mix))) {
    endMarch(world, barracks);
    return NO_WAVE;
  }
  const centre = anchorCentroid(world, [...men, ...catapults]);
  if (centre === null) {
    endMarch(world, barracks);
    return NO_WAVE;
  }
  if (held.target !== target)
    retarget(world, ctx, terrain, barracks, player, { target, objective }, centre, men, catapults);
  const state = world.get(barracks, WaveMarch);
  const wave: Wave = { men: men.filter((e) => inField.has(e)), members: men, catapults, centre };

  const charge = chargePoint(world, ctx, terrain, player, wave);
  if (charge !== null) return { commands: chargeOrders(world, terrain, wave, charge), active: true };
  if (!state.arrived) {
    const commands = legOrders(world, ctx, terrain, barracks, player, state, wave);
    if (commands !== null) return { commands, active: true };
  }
  const arrived = world.get(barracks, WaveMarch);
  const fire = fireOver(world, ctx, terrain, player, wave);
  return {
    commands: arrivalOrders(world, ctx, terrain, player, arrived, wave, objective, fire),
    active: true,
  };
}

function fighting(world: World, e: Entity): boolean {
  return world.isAlive(e) && (world.has(e, Engagement) || world.has(e, AttackOrder));
}

function crewed(world: World, vehicle: Entity): boolean {
  const state = world.tryGet(vehicle, Vehicle);
  return (
    state !== undefined &&
    (world.tryGet(vehicle, Health)?.hitpoints ?? 0) > 0 &&
    vehicleCommander(state) !== null
  );
}

function retarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  { target, objective }: { readonly target: Entity; readonly objective: NodeId },
  centre: HalfCellNode,
  men: readonly Entity[],
  catapults: readonly Entity[],
): void {
  const start = nearestMemberNode(world, terrain, centre, men) ?? terrain.nodeAtClamped(centre.hx, centre.hy);
  const towers = enemyTowerNodesNear(world, ctx, terrain, player, objective);
  const route = routeTo(world, ctx, terrain, start, objective, towers, catapults[0] ?? null);
  const live = world.mut(barracks, WaveMarch);
  live.target = target;
  live.origin = nodeOf(terrain, start);
  live.waypoints = route;
  live.leg = 0;
  live.legSince = ctx.tick;
  live.arrived = route.length === 0;
}

/** The node of the man standing nearest `centre`, the lowest id on a tie: a walkable start for the route. */
function nearestMemberNode(
  world: World,
  terrain: TerrainGraph,
  centre: HalfCellNode,
  men: readonly Entity[],
): NodeId | null {
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of men) {
    const node = entityNode(world, terrain, e);
    const distance = manhattanOf(nodeOf(terrain, node), centre);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The next leg's orders, or null once the wave has closed up on its last leg end: it has arrived. The
 * wave closes up when every man stands on his place and every catapult on its own, or when the leg has
 * waited {@link LEG_TIMEOUT_TICKS} for a straggler.
 */
function legOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  held: WaveMarchView,
  wave: Wave,
): PlayerCommand[] | null {
  const ahead = legNearest(held, wave.centre);
  if (ahead > held.leg) {
    const live = world.mut(barracks, WaveMarch);
    live.leg = ahead;
    live.legSince = ctx.tick;
  }
  const state = world.get(barracks, WaveMarch);
  let places = formation(world, ctx, terrain, state, wave.members, wave.catapults);
  if (
    closedUp(world, terrain, places, wave.members, wave.catapults) ||
    ctx.tick - state.legSince >= LEG_TIMEOUT_TICKS
  ) {
    const live = world.mut(barracks, WaveMarch);
    live.men = [...wave.members];
    // A catapult that lost its driver stays the wave's where it stands, out of the home crew's reach.
    live.catapults = state.catapults.filter((v) => (world.tryGet(v, Health)?.hitpoints ?? 0) > 0);
    if (state.leg + 1 >= state.waypoints.length) {
      live.arrived = true;
      return null;
    }
    live.leg = state.leg + 1;
    live.legSince = ctx.tick;
    places = formation(world, ctx, terrain, live, wave.members, wave.catapults);
  }
  const fire = wave.catapults.length === 0 ? null : fireOver(world, ctx, terrain, player, wave);
  return [
    ...placeOrders(world, ctx, terrain, wave.men, places, fire, MILITARY_MODE.DEFEND),
    ...catapultOrders(world, wave.catapults, places),
  ];
}

/** The leg whose end lies nearest `centre`, searching forward from the current one: a wave a charge has
 *  carried past its leg end marches on from where it stands rather than walking back. */
function legNearest(state: WaveMarchView, centre: HalfCellNode): number {
  let leg = state.leg;
  for (;;) {
    const here = state.waypoints[leg];
    const next = state.waypoints[leg + 1];
    if (here === undefined || next === undefined || manhattanOf(next, centre) >= manhattanOf(here, centre)) {
      return leg;
    }
    leg++;
  }
}

function closedUp(
  world: World,
  terrain: TerrainGraph,
  places: ReadonlyMap<Entity, HalfCellNode>,
  members: readonly Entity[],
  catapults: readonly Entity[],
): boolean {
  for (const e of members) {
    const place = places.get(e);
    if (place === undefined) continue;
    if (manhattanOf(nodeOf(terrain, entityNode(world, terrain, e)), place) > REGROUP_SLACK_NODES)
      return false;
  }
  for (const vehicle of catapults) {
    const place = places.get(vehicle);
    const at = vehicleAnchor(world, vehicle);
    if (place === undefined || at === null) continue;
    if (world.has(vehicle, VehicleDrive) || hexDistance(at, place) > REGROUP_SLACK_NODES) return false;
  }
  return true;
}

/** The enemy fire the wave's men may stand in: every manned tower post, and the loose enemy archers near
 *  enough the wave for their reach to meet it. */
function fireOver(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  wave: Wave,
): readonly Fire[] {
  const fire: Fire[] = enemyPosts(world, ctx, terrain, player).map((post) => ({
    ...post,
    target: post.tower,
  }));
  for (const raider of seatRaiders(world, ctx, terrain, player)) {
    const near =
      manhattanOf({ hx: raider.x, hy: raider.y }, wave.centre) <= CHARGE_RADIUS_NODES + raider.reach;
    if (near && isRangedFighter(world, ctx, raider.entity)) fire.push({ ...raider, target: raider.entity });
  }
  return fire;
}

/**
 * Where the wave charges, or null: once at least max({@link CHARGE_MIN_ENEMIES}, a
 * {@link CHARGE_ARMY_DIVISOR}th of its men) enemy fighters on foot stand within {@link CHARGE_RADIUS_NODES}
 * of its centre, the node of the one nearest that centre (the lowest id on a tie). Read off the seat's
 * raider scan, which its defence has already paid for this tick.
 */
function chargePoint(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  wave: Wave,
): HalfCellNode | null {
  const threshold = Math.max(CHARGE_MIN_ENEMIES, Math.ceil(wave.members.length / CHARGE_ARMY_DIVISOR));
  let near = 0;
  let best: { at: HalfCellNode; distance: number } | null = null;
  for (const raider of seatRaiders(world, ctx, terrain, player)) {
    const at = { hx: raider.x, hy: raider.y };
    const distance = manhattanOf(at, wave.centre);
    if (distance > CHARGE_RADIUS_NODES) continue;
    near++;
    if (best === null || distance < best.distance) best = { at, distance };
  }
  return near >= threshold && best !== null ? best.at : null;
}

/** Everybody onto the enemy body: the men into the ring around `point` as a wave marches on its objective,
 *  the catapults on an attack-move to it. */
function chargeOrders(world: World, terrain: TerrainGraph, wave: Wave, point: HalfCellNode): PlayerCommand[] {
  return [
    ...ringOrders(world, terrain, wave.men, terrain.nodeAtClamped(point.hx, point.hy)),
    ...wave.catapults.flatMap((vehicle) => driveCatapult(world, vehicle, point, VEHICLE_TARGET_SNAP_RADIUS)),
  ];
}
