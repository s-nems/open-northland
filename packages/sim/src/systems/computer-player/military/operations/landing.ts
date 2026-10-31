import {
  AttackOrder,
  diplomacyStance,
  Engagement,
  EquipOrder,
  type LandingOperation,
  type LandingShip,
  MAX_PLAYERS,
  type OperationEndReason,
  Position,
  Rider,
  seatPeaceEndTick,
  TrainingOrder,
  Vehicle,
  VehicleDrive,
  vehicleCommander,
  vehiclePassengers,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../../../nav/terrain/index.js';
import { isTravelling } from '../../../movement/nav-state.js';
import { isShipVehicle } from '../../../readviews/vehicles.js';
import { anotherSystemOwns } from '../../../settlers/action-owner.js';
import { atomicHoldsSettler } from '../../../settlers/atomics/busy.js';
import { mooringSpotsOf } from '../../../vehicles/dock.js';
import { vehicleIndex } from '../../../vehicles/registry.js';
import { computerProfileOf } from '../../difficulty.js';
import { type SeaRoute, seaRouteOf } from '../../sea-route.js';
import { landingFleetShips } from '../../workforce/craft.js';
import { campaignObjective } from '../campaign.js';
import { believedDefendingPoints } from '../enemy-strength.js';
import { marchOrders } from '../muster.js';
import { launchRatioReached } from '../plan.js';
import { unitPoints } from '../points.js';
import { enter, type Opened, type OperationEnv, type OperationHandler } from './lifecycle.js';
import {
  believedTowers,
  nodeOfEntity,
  RAID_DEFENCE_RADIUS_NODES,
  towerInReach,
  visibleFighters,
} from './raid-target.js';

// A naval landing (owner ruling): a seat whose rival lies over the sea fills its moored ships with the
// soldiers at home, sails them to the rival's shore nearest his headquarters outside his towers' reach,
// sets every man but each ship's commander ashore, sends the ships home and marches the landed men on
// what the campaign would strike on that land. Every figure below is authored unless it says otherwise.

const SECONDS_PER_MINUTE = 60;

/** Owner ruling: ships are spent only on a big landing, never on a small band. A landing sails with the
 *  seat's whole landing fleet ({@link landingFleetShips}) loaded to at least this share of its seats, in
 *  percent, the commanders' included: full, or as near as the army at home allows. */
export const LANDING_LOAD_PCT = 90;
/** How long after a landing ends before the next one forms. */
export const LANDING_COOLDOWN_TICKS = 5 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The most a landing waits for its men to walk to their ships and board. */
export const LANDING_FORM_TIMEOUT_TICKS = 4 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The most its ships sail out before it turns back, and sail home before it lets the crews go. */
export const LANDING_SAIL_TIMEOUT_TICKS = 12 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** How far apart, in half-cell nodes, the ships' shore points lie, so the hulls moor side by side. */
export const LANDING_SHORE_SPACING_NODES = 10;
/** The share of its ships, in percent, a landing may lose before setting anyone ashore and still sail on. */
export const LANDING_SHIP_LOSS_PCT = 50;

const PERCENT = 100;

/** The node `e` stands on as a terrain node, or null for a man aboard. */
function standingNode(world: World, terrain: TerrainGraph, e: Entity): NodeId | null {
  const at = nodeOfEntity(world, e);
  return at === null || !terrain.inBounds(at.hx, at.hy) ? null : terrain.nodeAt(at.hx, at.hy);
}

function componentOfPoint(terrain: TerrainGraph, at: HalfCellNode): number {
  return terrain.inBounds(at.hx, at.hy) ? terrain.componentOf(terrain.nodeAt(at.hx, at.hy)) : NO_COMPONENT;
}

/** Whether another drive owns `e` or he is on an errand an attach would throw away. A walk is no errand:
 *  the muster keeps the men at home walking to the door. */
function busy(world: World, e: Entity): boolean {
  return (
    anotherSystemOwns(world, e) ||
    world.has(e, TrainingOrder) ||
    world.has(e, EquipOrder) ||
    atomicHoldsSettler(world, e)
  );
}

/** The seat's ships a landing may take, ascending id: on the map, moored at a shore of `home`, crewless,
 *  not under way and riding no carrier. */
function freeShips(env: OperationEnv, home: number): Entity[] {
  const { world, ctx, terrain, seat } = env;
  const vehicles = contentIndex(ctx.content).vehicles;
  const ships: Entity[] = [];
  for (const e of vehicleIndex(world).ownedBy(seat)) {
    const state = world.get(e, Vehicle);
    const type = vehicles.get(state.vehicleType);
    if (type === undefined || !isShipVehicle(type) || type.passengerVector === undefined) continue;
    if (!world.has(e, Position) || world.has(e, VehicleDrive) || state.carrier !== null) continue;
    if (!state.moored || state.mooring === null || vehiclePassengers(state).length > 0) continue;
    if (componentOfPoint(terrain, state.mooring) === home) ships.push(e);
  }
  return ships.sort((a, b) => a - b);
}

/**
 * Up to `count` shore points for the ships, each at least {@link LANDING_SHORE_SPACING_NODES} from the
 * others: the mooring spots `ship` can sail to ({@link mooringSpotsOf}) on the rival's land outside every
 * believed tower's reach of the rival, nearest his headquarters first, the lowest node on a tie.
 */
function landingShores(env: OperationEnv, ship: Entity, route: SeaRoute, count: number): HalfCellNode[] {
  const { world, ctx, terrain, seat } = env;
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null) return [];
  const towers = believedTowers(world, ctx, seat, route.headquarters.owner);
  const hq = route.headquarters.node;
  const candidates: { readonly at: HalfCellNode; readonly node: NodeId; readonly distance: number }[] = [];
  for (const node of spots.spots) {
    if (terrain.componentOf(node) !== route.rival) continue;
    const { x, y } = terrain.coordsOf(node);
    const at = { hx: x, hy: y };
    if (towerInReach(towers, at)) continue;
    candidates.push({ at, node, distance: nodeManhattan(at, hq) });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.node - b.node);
  const picked: HalfCellNode[] = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => nodeManhattan(p, c.at) >= LANDING_SHORE_SPACING_NODES)) picked.push(c.at);
  }
  return picked;
}

/** The tick from which the seat may land: its peace over and its difficulty's first wave due. */
function landingFromTick(world: World, seat: number): number {
  return Math.max(seatPeaceEndTick(world, seat), computerProfileOf(world, seat).army.firstWaveFromTick);
}

function shipState(world: World, ship: LandingShip) {
  return world.tryGet(ship.vehicle, Vehicle);
}

function mooredAt(
  state: DeepReadonly<{ moored: boolean; mooring: HalfCellNode | null }>,
  at: HalfCellNode,
): boolean {
  return state.moored && state.mooring?.hx === at.hx && state.mooring.hy === at.hy;
}

function dockAt(ship: LandingShip, at: HalfCellNode): PlayerCommand {
  return { kind: 'dockVehicle', vehicle: ship.vehicle, x: at.hx, y: at.hy };
}

/** A ship lying still short of where its leg docks it, its dock order spent: it is sent again. */
function stoppedShort(world: World, ship: LandingShip, at: HalfCellNode): boolean {
  const state = shipState(world, ship);
  return (
    state !== undefined &&
    !world.has(ship.vehicle, VehicleDrive) &&
    state.heldGoal === null &&
    !mooredAt(state, at)
  );
}

/** Turn every ship still out for home for `reason`: one still moored at home frees its crew there. */
function withdraw(env: OperationEnv, op: LandingOperation, reason: OperationEndReason): PlayerCommand[] {
  const { world, ctx } = env;
  enter(op, 'withdrawing', ctx.tick, reason);
  const commands: PlayerCommand[] = [];
  for (const ship of op.ships) {
    if (ship.leg !== 'out') continue;
    ship.leg = 'back';
    const state = shipState(world, ship);
    if (state !== undefined && mooredAt(state, ship.home)) commands.push(...freeCrew(ship));
    else commands.push(dockAt(ship, ship.home));
  }
  return commands;
}

/** Free the crew of a ship moored at home and mark it home. */
function freeCrew(ship: LandingShip): PlayerCommand[] {
  ship.leg = 'home';
  return [{ kind: 'unloadPeople', vehicle: ship.vehicle, mooring: { x: ship.home.hx, y: ship.home.hy } }];
}

/** Why the landing should turn back before setting anyone ashore, or null: its posture no longer
 *  attacks, the target's owner is no enemy, or it lost {@link LANDING_SHIP_LOSS_PCT} of its ships. */
function abortReason(env: OperationEnv, op: LandingOperation): OperationEndReason | null {
  const owner = op.target.owner;
  if (env.orders.launchRatio === null) return 'postureChanged';
  if (owner === null || diplomacyStance(env.world, env.seat, owner) !== 'enemy') return 'targetLost';
  if ((op.startShips - op.ships.length) * PERCENT >= op.startShips * LANDING_SHIP_LOSS_PCT) return 'losses';
  return null;
}

/** Whether the enemy fighters the seat sees near any of the ships' shores, each counted once, weigh at
 *  least the men aboard: the ships moor one by one, so the first to arrive judges for the whole wave.
 *  Costs the enemies' fighters. */
function outmatchedAshore(env: OperationEnv, op: LandingOperation): boolean {
  const { world, ctx, seat } = env;
  let own = 0;
  for (const e of op.members) own += unitPoints(world, ctx, e);
  let enemy = 0;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat || diplomacyStance(world, seat, other) !== 'enemy') continue;
    for (const f of visibleFighters(world, ctx, seat, other)) {
      if (op.ships.some((ship) => nodeManhattan(f.at, ship.shore) <= RAID_DEFENCE_RADIUS_NODES))
        enemy += f.points;
    }
  }
  return enemy > 0 && enemy >= own;
}

/**
 * Forming: the men walk to their ships and board, each ship casting off on its own once its crew is in.
 * Past {@link LANDING_FORM_TIMEOUT_TICKS} a ship still waiting leaves its men outside behind, or, with
 * nobody aboard, drops out of the landing.
 */
function forming(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const { world, ctx } = env;
  const reason = abortReason(env, op);
  if (reason !== null) return withdraw(env, op, reason);
  const waiting = op.ships.filter((ship) => {
    const state = shipState(world, ship);
    return state !== undefined && mooredAt(state, ship.home);
  });
  if (waiting.length === 0) {
    enter(op, 'moving', ctx.tick);
    return sailing(env, op);
  }
  if (ctx.tick - op.since < LANDING_FORM_TIMEOUT_TICKS) return [];
  const commands: PlayerCommand[] = [];
  for (const ship of waiting) {
    const state = shipState(world, ship);
    if (state === undefined) continue;
    const seats = vehiclePassengers(state);
    if (!seats.some((seat) => seat.inside)) {
      commands.push(...freeCrew(ship));
      continue;
    }
    for (const seat of seats)
      if (!seat.inside) commands.push({ kind: 'detachFromVehicle', entity: seat.entity });
  }
  enter(op, 'moving', ctx.tick);
  return commands;
}

/**
 * Sailing out: a ship moored at its shore sets every man but its commander ashore and sails home, unless
 * nobody is ashore yet and the enemy the seat sees at the shores outweighs the men aboard, which turns the whole
 * landing back. A ship that stopped short is sent again. Once no ship is out the landed men fight.
 */
function sailing(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const { world, ctx } = env;
  if (op.landed === 0) {
    const reason = abortReason(env, op);
    if (reason !== null) return withdraw(env, op, reason);
    if (ctx.tick - op.since >= LANDING_SAIL_TIMEOUT_TICKS) return withdraw(env, op, 'timedOut');
  }
  // The ships already sailing back are seen to first, so one turned home below is not sent twice.
  const commands = homecoming(env, op);
  for (const ship of op.ships) {
    if (ship.leg !== 'out') continue;
    const state = shipState(world, ship);
    if (state === undefined) continue;
    if (mooredAt(state, ship.shore)) {
      if (op.landed === 0 && outmatchedAshore(env, op)) return withdraw(env, op, 'outmatched');
      const commander = vehicleCommander(state);
      for (const seat of vehiclePassengers(state)) {
        if (seat.entity === commander || !world.isAlive(seat.entity)) continue;
        commands.push({ kind: 'detachFromVehicle', entity: seat.entity });
        op.landed++;
      }
      ship.leg = 'back';
      commands.push(dockAt(ship, ship.home));
    } else if (stoppedShort(world, ship, ship.shore)) commands.push(dockAt(ship, ship.shore));
  }
  if (op.ships.every((ship) => ship.leg !== 'out')) {
    if (op.landed === 0) enter(op, 'withdrawing', ctx.tick, 'losses');
    else enter(op, 'acting', ctx.tick);
  }
  return [...commands, ...landedOrders(env, op).commands];
}

/** The ships sailing back: one moored at home frees its commander, one stopped short is sent again. */
function homecoming(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const ship of op.ships) {
    if (ship.leg !== 'back') continue;
    const state = shipState(env.world, ship);
    if (state === undefined) continue;
    if (mooredAt(state, ship.home)) commands.push(...freeCrew(ship));
    else if (stoppedShort(env.world, ship, ship.home)) commands.push(dockAt(ship, ship.home));
  }
  return commands;
}

/** The land the men were set ashore on: the target's component, read at its headquarters' anchor. */
function rivalComponent(env: OperationEnv, op: LandingOperation): number {
  return componentOfPoint(env.terrain, { hx: op.target.hx, hy: op.target.hy });
}

/** The men set ashore: members on the rival's land, no longer aboard. */
function landedMen(env: OperationEnv, op: LandingOperation): Entity[] {
  const { world, terrain } = env;
  const rival = rivalComponent(env, op);
  return op.members.filter((e) => {
    if (world.has(e, Rider)) return false;
    const node = standingNode(world, terrain, e);
    return node !== null && terrain.componentOf(node) === rival;
  });
}

interface LandedOrders {
  readonly landed: readonly Entity[];
  /** Whether the landed men have an objective on the rival's land. */
  readonly striking: boolean;
  readonly commands: readonly PlayerCommand[];
}

/**
 * The landed men march on what the campaign would strike from where they stand ({@link campaignObjective}
 * read at the first landed man's node, so on the rival's land); a man fighting or on his way is left to it.
 */
function landedOrders(env: OperationEnv, op: LandingOperation): LandedOrders {
  const { world, ctx, terrain, seat } = env;
  const landed = landedMen(env, op);
  const first = landed[0];
  const from = first === undefined ? null : standingNode(world, terrain, first);
  const goal = from === null ? null : campaignObjective(world, ctx, terrain, seat, from);
  if (goal === null) return { landed, striking: false, commands: [] };
  const free = landed.filter(
    (e) =>
      !isTravelling(world, e) && !busy(world, e) && !world.has(e, Engagement) && !world.has(e, AttackOrder),
  );
  return { landed, striking: true, commands: marchOrders(world, terrain, free, goal.node) };
}

/** Acting: the landed men fight, the ships sail home. Ends once no landed man is left and every ship is
 *  home or lost: `wiped` when the landed men fell, `nothingToStrike` when the land holds nothing more. */
function acting(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const homeward = homecoming(env, op);
  const { landed, striking, commands } = landedOrders(env, op);
  if (landed.length > 0 && striking) return [...homeward, ...commands];
  // Nothing left to strike: the landed men are let go where they stand.
  const gone = new Set(landed);
  op.members = op.members.filter((e) => !gone.has(e));
  if (op.ships.every((ship) => ship.leg === 'home'))
    enter(op, 'done', env.ctx.tick, landed.length === 0 ? 'wiped' : 'nothingToStrike');
  return homeward;
}

/** Withdrawing: every ship sails home and frees its crew there; past {@link LANDING_SAIL_TIMEOUT_TICKS}
 *  the landing lets go of a ship that never made it. */
function withdrawing(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const { ctx } = env;
  const commands = homecoming(env, op);
  if (op.ships.every((ship) => ship.leg === 'home') || ctx.tick - op.since >= LANDING_SAIL_TIMEOUT_TICKS)
    enter(op, 'done', ctx.tick, op.reason ?? 'arrivedHome');
  return commands;
}

/** The members still the landing's: aboard one of its ships, or set ashore on the rival's land. */
function keepMembers(env: OperationEnv, op: LandingOperation): void {
  const { world } = env;
  const ships = new Set(op.ships.map((ship) => ship.vehicle));
  const ashore = new Set(landedMen(env, op));
  op.members = op.members.filter((e) => {
    const rider = world.tryGet(e, Rider);
    return rider !== undefined ? ships.has(rider.vehicle) : ashore.has(e);
  });
}

function step(env: OperationEnv, op: LandingOperation): readonly PlayerCommand[] {
  op.ships = op.ships.filter((ship) => env.world.has(ship.vehicle, Vehicle));
  let commands: PlayerCommand[] = [];
  switch (op.state) {
    case 'forming':
      commands = forming(env, op);
      break;
    case 'moving':
      commands = sailing(env, op);
      break;
    case 'acting':
      commands = acting(env, op);
      break;
    case 'withdrawing':
      commands = withdrawing(env, op);
      break;
    case 'done':
    case 'failed':
      break;
  }
  keepMembers(env, op);
  return commands;
}

/**
 * A landing when the seat's posture attacks, its peace is over, its rival lies over the sea
 * ({@link seaRouteOf}) and is an enemy, its whole landing fleet lies moored free and the free men on its
 * home land load it to {@link LANDING_LOAD_PCT}, weighing the posture's launch ratio of what the seat
 * believes defends the rival. The men fill the ships in id order, the first one each ship takes
 * holding its helm; each ship docks at its own shore point ({@link landingShores}).
 */
function open(env: OperationEnv, free: readonly Entity[], id: number): Opened<LandingOperation> | null {
  const { world, ctx, terrain, seat, orders } = env;
  const ratio = orders.launchRatio;
  if (ratio === null || ctx.tick < landingFromTick(world, seat)) return null;
  const route = seaRouteOf(world, ctx, seat);
  if (route === null) return null;
  const fleet = landingFleetShips(world, seat, computerProfileOf(world, seat));
  const ships = freeShips(env, route.home).slice(0, fleet);
  if (ships.length < fleet) return null;
  const owner = route.headquarters.owner;
  if (diplomacyStance(world, seat, owner) !== 'enemy') return null;
  const men = free.filter((e) => {
    const node = standingNode(world, terrain, e);
    return node !== null && terrain.componentOf(node) === route.home && !busy(world, e);
  });
  let capacity = 0;
  for (const ship of ships) capacity += world.get(ship, Vehicle).passengers.length;
  if (men.length * PERCENT < capacity * LANDING_LOAD_PCT) return null;
  const crews: { readonly ship: Entity; readonly men: readonly Entity[] }[] = [];
  let next = 0;
  for (const ship of ships) {
    const seats = world.get(ship, Vehicle).passengers.length;
    crews.push({ ship, men: men.slice(next, next + seats) });
    next += seats;
  }
  const wave = crews.flatMap((crew) => crew.men);
  let points = 0;
  for (const e of wave) points += unitPoints(world, ctx, e);
  if (!launchRatioReached(points, believedDefendingPoints(world, ctx, seat, owner, points), ratio))
    return null;
  const first = crews[0];
  const shores = first === undefined ? [] : landingShores(env, first.ship, route, crews.length);
  if (shores.length === 0) return null;
  const commands: PlayerCommand[] = [];
  const landingShips: LandingShip[] = [];
  crews.forEach((crew, i) => {
    const mooring = world.get(crew.ship, Vehicle).mooring;
    const shore = shores[i % shores.length];
    if (mooring === null || shore === undefined) return;
    for (const e of crew.men) commands.push({ kind: 'attachToVehicle', entity: e, vehicle: crew.ship });
    commands.push({ kind: 'dockVehicle', vehicle: crew.ship, x: shore.hx, y: shore.hy });
    landingShips.push({
      vehicle: crew.ship,
      home: { hx: mooring.hx, hy: mooring.hy },
      shore: { hx: shore.hx, hy: shore.hy },
      leg: 'out',
    });
  });
  const hq = route.headquarters;
  const op: LandingOperation = {
    id,
    kind: 'landing',
    state: 'forming',
    since: ctx.tick,
    members: [...wave].sort((a, b) => a - b),
    target: { hx: hq.node.hx, hy: hq.node.hy, entity: hq.entity, owner },
    reason: null,
    ships: landingShips,
    startShips: landingShips.length,
    startMen: wave.length,
    landed: 0,
  };
  return { op, commands };
}

export const landingHandler: OperationHandler<LandingOperation> = {
  phase: 'beforeCampaign',
  cooldownTicks: () => LANDING_COOLDOWN_TICKS,
  step: (env, op) => step(env, op),
  open,
};
