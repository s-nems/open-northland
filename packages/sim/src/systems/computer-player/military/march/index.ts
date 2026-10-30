import {
  AttackOrder,
  Engagement,
  Health,
  Vehicle,
  vehicleCommander,
  WaveMarch,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { weaponMix } from '../../../ai-shared/military/census.js';
import { anchorCentroid } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import { vehicleAnchor } from '../../../footprint/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { VEHICLE_TARGET_SNAP_RADIUS } from '../../../vehicles/movement.js';
import { seatBarracksOf } from '../../base.js';
import { ASSAULT_RING_RADIUS_NODES, meleeCoreFor, waveWorthy } from '../muster.js';
import { crewedCatapults, PARK_RING_MAX_NODES, PARK_SPACING_NODES } from '../siege-crew.js';
import { nodeOf } from './geometry.js';
import { asGroupOrder, driveCatapult, ringOrders } from './orders.js';
import { gatheringPoint } from './route.js';
import { enemyTowerNodesNear, siegeOrders } from './siege.js';

export {
  GATHER_STANDOFF_NODES,
  GATHER_TOWER_CLEARANCE_HEX,
} from './route.js';
export { SIEGE_TIMEOUT_TICKS, SIEGE_TOWER_RADIUS_NODES } from './siege.js';

// A launched wave walks to a gathering point short of the enemy base, waits there until most of it has
// arrived, then goes in on its objective as one group attack-move. Owner ruling: attacks must not crawl;
// gathering once and then attacking replaces a march in closed-up legs. Every distance, share and timeout
// here is an approximation. Distances are Manhattan half-cell nodes unless named hex.

/** The fewest crewed catapults that make a wave a siege march: fewer stay parked at home, and a gathering
 *  wave whose catapults fall below it sends the rest home and goes on without them. */
export const SIEGE_MARCH_MIN_CATAPULTS = 4;

/** The share of the wave's men (percent) that has to stand at the gathering point before it goes in. */
export const GATHER_QUORUM_PERCENT = 75;

/** How long the wave waits at the gathering point for its stragglers, from its first man's arrival. */
export const GATHER_WAIT_TICKS = 45 * TICKS_PER_SECOND;

/** How long the wave may take to gather at all, from setting out: a band held up on the way, or stuck in
 *  fights, goes in with whoever it has rather than stand forever. */
export const GATHER_MARCH_TIMEOUT_TICKS = 5 * 60 * TICKS_PER_SECOND;

/** How far past the ring around the gathering point a man still counts as arrived: one cell, so a man the
 *  idle de-stack steps off his spot is not counted out. */
const GATHERED_SLACK_NODES = 2;

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
 * Launch `men` from the barracks door `home` on `target`, taking the crewed catapults parked at home when
 * there are at least {@link SIEGE_MARCH_MIN_CATAPULTS} of them. The gathering point is found once, over the
 * lead catapult's walk-block when one goes, so the catapults can stand there too.
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
  const atHome = crewedCatapults(world, ctx, player)
    .filter(({ vehicle }) => {
      const at = vehicleAnchor(world, vehicle);
      return (
        at !== null &&
        world.get(vehicle, Vehicle).attack === null &&
        nodeManhattan(at, door) <= HOME_CATAPULT_NODES
      );
    })
    .map(({ vehicle }) => vehicle);
  // Too few for a siege march: they stay parked as the settlement's defence.
  const catapults = atHome.length >= SIEGE_MARCH_MIN_CATAPULTS ? atHome : [];
  const towers = enemyTowerNodesNear(world, ctx, terrain, player, objective);
  world.add(barracks, WaveMarch, {
    target,
    gatherAt: gatheringPoint(world, ctx, terrain, home, objective, towers, catapults[0] ?? null),
    since: ctx.tick,
    firstArrival: null,
    men: [...men],
    catapults,
  });
}

/**
 * One decision for the marching wave: while it gathers, the men not yet there walk to the gathering point
 * on an attack-move, so they fight what they meet; once {@link GATHER_QUORUM_PERCENT} of its men stand
 * there, or it has waited {@link GATHER_WAIT_TICKS} since the first arrived, or
 * {@link GATHER_MARCH_TIMEOUT_TICKS} since it set out, everybody goes in on `objective` as one group
 * attack-move, the catapults at its towers first (`siege.ts`). `field` holds the wave's men this decision
 * may count on; a man in a fight still belongs to it, anyone else has left it. A new `target` finds a new
 * gathering point for a wave still gathering and sends a wave already in at the new objective; a wave no
 * longer {@link waveWorthy} is spent: its men fall back to the muster. The cost is the wave's size.
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
  const members = held.men.filter((e) => inField.has(e) || fighting(world, e));
  const catapults =
    held.gatherAt === null
      ? held.catapults.filter((v) => crewed(world, v))
      : gatheringCatapults(world, barracks, held.catapults);
  const mix = weaponMix(world, ctx, members);
  if (!waveWorthy(mix, meleeCoreFor(mix))) {
    endMarch(world, barracks);
    return NO_WAVE;
  }
  if (held.target !== target) retarget(world, ctx, terrain, barracks, player, target, objective, members);
  const men = members.filter((e) => inField.has(e));
  const gatherAt = world.get(barracks, WaveMarch).gatherAt;
  if (gatherAt !== null) {
    if (!gathered(world, ctx, terrain, barracks, members, gatherAt)) {
      const at = terrain.nodeAtClamped(gatherAt.hx, gatherAt.hy);
      return {
        commands: [
          ...asGroupOrder(ringOrders(world, terrain, men, at)),
          ...catapults.flatMap((v) => driveCatapult(world, v, gatherAt, VEHICLE_TARGET_SNAP_RADIUS)),
        ],
        active: true,
      };
    }
    const live = world.mut(barracks, WaveMarch);
    live.gatherAt = null;
    live.since = ctx.tick;
  }
  const { since } = world.get(barracks, WaveMarch);
  return {
    commands: [
      ...asGroupOrder(ringOrders(world, terrain, men, objective)),
      ...siegeOrders(world, ctx, terrain, player, catapults, objective, since),
    ],
    active: true,
  };
}

/**
 * Whether the gathering wave goes in: {@link GATHER_QUORUM_PERCENT} of `members` stand within the ring
 * around `gatherAt`, or a timeout has run out. Notes the first man's arrival, from which the wait runs.
 */
function gathered(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  members: readonly Entity[],
  gatherAt: HalfCellNode,
): boolean {
  const reach = ASSAULT_RING_RADIUS_NODES + GATHERED_SLACK_NODES;
  let arrived = 0;
  for (const e of members) {
    if (nodeManhattan(nodeOf(terrain, entityNode(world, terrain, e)), gatherAt) <= reach) arrived++;
  }
  const state = world.get(barracks, WaveMarch);
  if (arrived > 0 && state.firstArrival === null) world.mut(barracks, WaveMarch).firstArrival = ctx.tick;
  const firstArrival = world.get(barracks, WaveMarch).firstArrival;
  return (
    arrived * 100 >= members.length * GATHER_QUORUM_PERCENT ||
    (firstArrival !== null && ctx.tick - firstArrival >= GATHER_WAIT_TICKS) ||
    ctx.tick - state.since >= GATHER_MARCH_TIMEOUT_TICKS
  );
}

/**
 * The crewed ones of a gathering wave's `catapults`, or none once fewer than
 * {@link SIEGE_MARCH_MIN_CATAPULTS} are left: those go home to be parked (`siege-crew.ts`) and the wave
 * gathers without them. A wave sent in keeps whatever it has left. A catapult that lost its driver stays
 * the wave's where it stands, out of the home crew's reach.
 */
function gatheringCatapults(world: World, barracks: Entity, catapults: readonly Entity[]): Entity[] {
  const manned = catapults.filter((v) => crewed(world, v));
  if (manned.length >= SIEGE_MARCH_MIN_CATAPULTS) return manned;
  const home = new Set(manned);
  const kept = catapults.filter((v) => !home.has(v) && (world.tryGet(v, Health)?.hitpoints ?? 0) > 0);
  if (kept.length !== catapults.length) world.mut(barracks, WaveMarch).catapults = kept;
  return [];
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

/** Point the wave at `target`: a wave still gathering gathers again on the way there from where it
 *  stands, and its clocks restart; a wave already sent in is sent at the new objective by the next
 *  orders. */
function retarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  target: Entity,
  objective: NodeId,
  members: readonly Entity[],
): void {
  const state = world.get(barracks, WaveMarch);
  if (state.gatherAt === null) {
    world.mut(barracks, WaveMarch).target = target;
    return;
  }
  const centre = anchorCentroid(world, members);
  const start =
    (centre === null ? null : nearestMemberNode(world, terrain, centre, members)) ??
    terrain.nodeAtClamped(state.gatherAt.hx, state.gatherAt.hy);
  const towers = enemyTowerNodesNear(world, ctx, terrain, player, objective);
  const live = world.mut(barracks, WaveMarch);
  live.target = target;
  live.gatherAt = gatheringPoint(world, ctx, terrain, start, objective, towers, live.catapults[0] ?? null);
  live.since = ctx.tick;
  live.firstArrival = null;
}

/** The node of the man standing nearest `centre`, the lowest id on a tie: a walkable start for the
 *  route. */
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
    const distance = nodeManhattan(nodeOf(terrain, node), centre);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}
