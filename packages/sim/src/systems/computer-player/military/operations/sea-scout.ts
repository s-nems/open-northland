import {
  aiControlEntity,
  ComputerOperations,
  diplomacyStance,
  isOperationOpen,
  type OperationEndReason,
  type SeaScoutOperation,
  seatPeaceEndTick,
  Vehicle,
  VehicleDrive,
  vehiclePassengers,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { mooringSpotsOf } from '../../../vehicles/dock.js';
import { type SeaRoute, seaRouteOf } from '../../sea-route.js';
import { unitPoints } from '../points.js';
import { freeShips, LANDING_FORM_TIMEOUT_TICKS } from './landing.js';
import { enter, type Opened, type OperationEnv, type OperationHandler } from './lifecycle.js';
import { believedTowers, nodeOfEntity, towerInReach } from './raid-target.js';

// Sea scouting (owner ruling): a seat whose rival lies over the sea cannot see him from home, so once its
// peace is over it takes one free moored ship, puts one soldier aboard and sails it round the rival's
// island outside his believed towers' reach, then home. The seat learns only what that ship sees, and its
// posture and landings read that belief. Every figure below is authored.

const SECONDS_PER_MINUTE = 60;

/** How long after one scouting trip ends before the next sets out (authored): a remembered army's peak
 *  halves every two game minutes (`knowledge/intel`), so after eight it reads a sixteenth and the seat
 *  looks again. */
export const SEA_SCOUT_INTERVAL_TICKS = 8 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The most a trip sails before it turns home, and sails home before it lets the ship go (authored): a
 *  loop round a large island of the island maps with room to spare. */
export const SEA_SCOUT_TRIP_TIMEOUT_TICKS = 20 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The sectors round the rival's island, one waypoint each: the eight octants about its coast's centre. */
export const SEA_SCOUT_SECTORS = 8;

/** The shore points `ship` can sail off on the rival's land outside every believed tower's reach. */
function rivalShore(env: OperationEnv, ship: Entity, route: SeaRoute): HalfCellNode[] {
  const { world, ctx, terrain, seat } = env;
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null) return [];
  const towers = believedTowers(world, ctx, seat, route.headquarters.owner);
  const shore: HalfCellNode[] = [];
  for (const node of spots.spots) {
    if (terrain.componentOf(node) !== route.rival) continue;
    const { x, y } = terrain.coordsOf(node);
    const at = { hx: x, hy: y };
    if (!towerInReach(towers, at)) shore.push(at);
  }
  return shore;
}

/** The octant, 0 to {@link SEA_SCOUT_SECTORS} - 1 clockwise from north, of the offset `(dx, dy)`, in
 *  integers so the choice is exact. */
export function octantOf(dx: number, dy: number): number {
  const steep = Math.abs(dy) > Math.abs(dx);
  if (dx >= 0 && dy < 0) return steep ? 0 : 1;
  if (dx > 0 && dy >= 0) return steep ? 3 : 2;
  if (dx <= 0 && dy > 0) return steep ? 4 : 5;
  if (dx < 0) return steep ? 7 : 6;
  return 0;
}

/**
 * The loop round the rival's island: in each octant about the centre of `shore`, the point farthest from
 * it (the lowest node on a tie), in clockwise order from the octant `start` lies in.
 */
export function scoutLoop(
  terrain: TerrainGraph,
  shore: readonly HalfCellNode[],
  start: HalfCellNode,
): HalfCellNode[] {
  if (shore.length === 0) return [];
  let sumX = 0;
  let sumY = 0;
  for (const at of shore) {
    sumX += at.hx;
    sumY += at.hy;
  }
  const cx = Math.floor(sumX / shore.length);
  const cy = Math.floor(sumY / shore.length);
  const best: ({ at: HalfCellNode; reach: number; node: NodeId } | undefined)[] = [];
  for (const at of shore) {
    const dx = at.hx - cx;
    const dy = at.hy - cy;
    const sector = octantOf(dx, dy);
    const reach = Math.abs(dx) + Math.abs(dy);
    const node = terrain.nodeAt(at.hx, at.hy);
    const held = best[sector];
    if (held === undefined || reach > held.reach || (reach === held.reach && node < held.node))
      best[sector] = { at, reach, node };
  }
  const first = octantOf(start.hx - cx, start.hy - cy);
  const loop: HalfCellNode[] = [];
  for (let i = 0; i < SEA_SCOUT_SECTORS; i++) {
    const picked = best[(first + i) % SEA_SCOUT_SECTORS];
    if (picked !== undefined) loop.push(picked.at);
  }
  return loop;
}

function shipState(world: World, op: SeaScoutOperation) {
  return world.tryGet(op.ship, Vehicle);
}

/** Whether the ship lies still with no drive and no goal held for a boarding: its last order is spent. */
function lyingStill(world: World, op: SeaScoutOperation): boolean {
  const state = shipState(world, op);
  return state !== undefined && !world.has(op.ship, VehicleDrive) && state.heldGoal === null;
}

function mooredHome(world: World, op: SeaScoutOperation): boolean {
  const state = shipState(world, op);
  return state?.moored === true && state.mooring?.hx === op.home.hx && state.mooring.hy === op.home.hy;
}

function dockHome(op: SeaScoutOperation): PlayerCommand {
  return { kind: 'dockVehicle', vehicle: op.ship, x: op.home.hx, y: op.home.hy };
}

function sailTo(op: SeaScoutOperation, at: HalfCellNode): PlayerCommand {
  return { kind: 'moveVehicle', vehicle: op.ship, x: at.hx, y: at.hy };
}

function unload(op: SeaScoutOperation): PlayerCommand {
  return { kind: 'unloadPeople', vehicle: op.ship, mooring: { x: op.home.hx, y: op.home.hy } };
}

function turnHome(
  env: OperationEnv,
  op: SeaScoutOperation,
  reason: OperationEndReason | null,
): PlayerCommand[] {
  enter(op, 'withdrawing', env.ctx.tick, reason);
  op.leg = op.waypoints.length;
  return mooredHome(env.world, op) ? homecoming(env, op) : [dockHome(op)];
}

/** Moored at home: the soldier steps ashore and the trip ends. */
function homecoming(env: OperationEnv, op: SeaScoutOperation): PlayerCommand[] {
  enter(op, 'done', env.ctx.tick, op.reason ?? 'arrivedHome');
  return [unload(op)];
}

/** Forming: the soldier walks to the ship and boards, its first leg held until he is in. Past the landing's
 *  form timeout with nobody aboard, the trip is given up. */
function forming(env: OperationEnv, op: SeaScoutOperation): PlayerCommand[] {
  const { world, ctx } = env;
  const state = shipState(world, op);
  if (state === undefined) return [];
  // Cast off, or aboard with the first leg refused: the sailing takes the next waypoint.
  if (
    vehiclePassengers(state).some((seat) => seat.inside) &&
    (!mooredHome(world, op) || lyingStill(world, op))
  ) {
    enter(op, 'moving', ctx.tick);
    return [];
  }
  if (ctx.tick - op.since < LANDING_FORM_TIMEOUT_TICKS) return [];
  enter(op, 'done', ctx.tick, 'timedOut');
  return [...op.members.map((e): PlayerCommand => ({ kind: 'detachFromVehicle', entity: e })), unload(op)];
}

/** Sailing: each time the ship lies still it sails for the next waypoint, and past the last it docks at
 *  home. The rival turning friend or the trip running out of time sends it home at once. */
function sailing(env: OperationEnv, op: SeaScoutOperation): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const owner = op.target.owner;
  if (owner === null || diplomacyStance(world, seat, owner) !== 'enemy')
    return turnHome(env, op, 'targetLost');
  if (ctx.tick - op.since >= SEA_SCOUT_TRIP_TIMEOUT_TICKS) return turnHome(env, op, 'timedOut');
  if (!lyingStill(world, op)) return [];
  op.leg++;
  const next = op.waypoints[op.leg];
  return next === undefined ? turnHome(env, op, null) : [sailTo(op, next)];
}

/** Withdrawing: the ship docks at home, sent again when it stopped short, and lets its soldier go there;
 *  past the trip timeout the operation lets go of a ship that never made it. */
function withdrawing(env: OperationEnv, op: SeaScoutOperation): PlayerCommand[] {
  const { world, ctx } = env;
  if (mooredHome(world, op)) return homecoming(env, op);
  if (ctx.tick - op.since >= SEA_SCOUT_TRIP_TIMEOUT_TICKS) {
    enter(op, 'done', ctx.tick, 'timedOut');
    return [];
  }
  return lyingStill(world, op) ? [dockHome(op)] : [];
}

function step(env: OperationEnv, op: SeaScoutOperation): readonly PlayerCommand[] {
  if (!env.world.has(op.ship, Vehicle)) {
    enter(op, 'done', env.ctx.tick, 'losses');
    return [];
  }
  // The soldier fell: nobody commands the ship any more.
  if (op.members.length === 0) {
    enter(op, 'done', env.ctx.tick, 'wiped');
    return [];
  }
  switch (op.state) {
    case 'forming':
      return forming(env, op);
    case 'moving':
      return sailing(env, op);
    case 'withdrawing':
      return withdrawing(env, op);
    case 'acting':
    case 'done':
    case 'failed':
      return [];
  }
}

function landingUnderWay(world: World, seat: number): boolean {
  const carrier = aiControlEntity(world, seat);
  const held = carrier === null ? undefined : world.tryGet(carrier, ComputerOperations);
  return held?.operations.some((op) => op.kind === 'landing' && isOperationOpen(op)) ?? false;
}

/** The weakest of `men` by points, the lowest id on a tie (`men` ascend by id). */
function weakest(env: OperationEnv, men: readonly Entity[]): Entity | null {
  let pick: Entity | null = null;
  let least = Number.POSITIVE_INFINITY;
  for (const e of men) {
    const points = unitPoints(env.world, env.ctx, e);
    if (points < least) {
      pick = e;
      least = points;
    }
  }
  return pick;
}

/**
 * A scouting trip when the seat's peace is over, its rival lies over the sea ({@link seaRouteOf}) as an
 * enemy whose headquarters it does not see now, no landing is under way and it has a free moored ship
 * ({@link freeShips}): the highest-id one, so the landing keeps the ships it fills first. The weakest free
 * soldier on the home land boards it and it sails the loop round the rival's island ({@link scoutLoop}).
 */
function open(env: OperationEnv, free: readonly Entity[], id: number): Opened<SeaScoutOperation> | null {
  const { world, ctx, terrain, seat } = env;
  if (ctx.tick < seatPeaceEndTick(world, seat) || landingUnderWay(world, seat)) return null;
  const route = seaRouteOf(world, ctx, seat);
  if (route === null || route.headquarters.seen) return null;
  const owner = route.headquarters.owner;
  if (diplomacyStance(world, seat, owner) !== 'enemy') return null;
  const ship = freeShips(env, route.home).at(-1);
  const mooring = ship === undefined ? null : world.get(ship, Vehicle).mooring;
  if (ship === undefined || mooring === null) return null;
  const men = free.filter((e) => {
    const at = nodeOfEntity(world, e);
    return (
      at !== null &&
      terrain.inBounds(at.hx, at.hy) &&
      terrain.componentOf(terrain.nodeAt(at.hx, at.hy)) === route.home
    );
  });
  const soldier = weakest(env, men);
  if (soldier === null) return null;
  const waypoints = scoutLoop(terrain, rivalShore(env, ship, route), mooring);
  const first = waypoints[0];
  if (first === undefined) return null;
  const hq = route.headquarters;
  const op: SeaScoutOperation = {
    id,
    kind: 'seaScout',
    state: 'forming',
    since: ctx.tick,
    members: [soldier],
    target: { hx: hq.node.hx, hy: hq.node.hy, entity: hq.entity, owner },
    reason: null,
    ship,
    home: { hx: mooring.hx, hy: mooring.hy },
    waypoints,
    leg: 0,
  };
  return {
    op,
    commands: [{ kind: 'attachToVehicle', entity: soldier, vehicle: ship }, sailTo(op, first)],
  };
}

export const seaScoutHandler: OperationHandler<SeaScoutOperation> = {
  phase: 'beforeCampaign',
  cooldownTicks: () => SEA_SCOUT_INTERVAL_TICKS,
  step: (env, op) => step(env, op),
  open,
};
