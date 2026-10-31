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
import { crewInside } from '../../../vehicles/movement.js';
import { vehicleIndex } from '../../../vehicles/registry.js';
import { computerProfileOf } from '../../difficulty.js';
import { type SeaRoute, seaRouteOf } from '../../sea-route.js';
import { LANDING_FLEET_MIN_SHIPS, landingFleetShips } from '../../workforce/craft.js';
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
// soldiers at home, sails them together to the rival's shore nearest his headquarters outside his towers'
// reach, sets every man but each ship's commander ashore once the fleet lies there, sends the ships home
// and marches the landed men on what the campaign would strike on that land. Every figure below is
// authored unless it says otherwise.

const SECONDS_PER_MINUTE = 60;

/** Owner ruling: ships are spent only on a big landing, never on a small band. Every ship a landing takes
 *  is loaded to at least this share of its seats, in percent, the commanders' included. */
export const LANDING_LOAD_PCT = 90;
/** Owner ruling: a big landing sails with at least 4 loaded ships, about 80 men, or with the seat's whole
 *  landing fleet ({@link landingFleetShips}) when that is smaller, and never fewer than
 *  {@link LANDING_FLEET_MIN_SHIPS}. */
export const LANDING_BIG_SHIPS = 4;
/** How long after a landing ends before the next one forms. */
export const LANDING_COOLDOWN_TICKS = 5 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The most a landing waits for its men to walk to their ships and board. */
export const LANDING_FORM_TIMEOUT_TICKS = 4 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The most its ships sail out before it turns back, and sail home before it lets the crews go. */
export const LANDING_SAIL_TIMEOUT_TICKS = 12 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** How far apart, in half-cell nodes, the ships' shore points lie, so the hulls moor side by side. */
export const LANDING_SHORE_SPACING_NODES = 10;
/** The most the first ship moored at its shore keeps its men aboard waiting for the rest of the fleet,
 *  so the wave lands together. Authored: on arabskie_wyspy_wolna_gra_mieszana a wave whose ships cast
 *  off one by one landed in parts a minute or more apart, and the first men ashore fell alone. */
export const LANDING_SHORE_WAIT_TICKS = SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** How long past {@link LANDING_SAIL_TIMEOUT_TICKS} a ship still at sea keeps its landing open on its way
 *  home before the landing lets it go with its crew aboard. */
export const LANDING_STRANDED_GRACE_TICKS = LANDING_SAIL_TIMEOUT_TICKS;
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
export function freeShips(env: OperationEnv, home: number): Entity[] {
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

/** A ship lying still short of where its leg docks it, its dock order spent or refused. */
function stoppedShort(world: World, ship: LandingShip, at: HalfCellNode): boolean {
  const state = shipState(world, ship);
  return (
    state !== undefined &&
    !world.has(ship.vehicle, VehicleDrive) &&
    state.heldGoal === null &&
    !mooredAt(state, at)
  );
}

/** Turn every ship still out for home for `reason`: one still moored on home land frees its crew there. */
function withdraw(env: OperationEnv, op: LandingOperation, reason: OperationEndReason): PlayerCommand[] {
  const { world, ctx } = env;
  enter(op, 'withdrawing', ctx.tick, reason);
  const commands: PlayerCommand[] = [];
  for (const ship of op.ships) {
    if (ship.leg !== 'out') continue;
    ship.leg = 'back';
    const mooring = homeMooring(env, ship);
    if (mooring !== null) commands.push(...freeCrew(ship, mooring));
    else commands.push(dockAt(ship, ship.home));
  }
  return commands;
}

/** Where `ship` lies moored on the land of its home shore, or null while it lies anywhere else. */
function homeMooring(env: OperationEnv, ship: LandingShip): HalfCellNode | null {
  const state = shipState(env.world, ship);
  const mooring = state?.moored === true ? state.mooring : null;
  if (mooring === null) return null;
  const home = componentOfPoint(env.terrain, ship.home);
  return home !== NO_COMPONENT && componentOfPoint(env.terrain, mooring) === home ? mooring : null;
}

/** Free the crew of a ship moored at `mooring` and mark it home. */
function freeCrew(ship: LandingShip, mooring: DeepReadonly<HalfCellNode>): PlayerCommand[] {
  ship.leg = 'home';
  return [{ kind: 'unloadPeople', vehicle: ship.vehicle, mooring: { x: mooring.hx, y: mooring.hy } }];
}

/**
 * The ships a landing is done waiting for, `since` the tick its current state began: past
 * {@link LANDING_SAIL_TIMEOUT_TICKS} a ship moored anywhere sets its crew ashore where it lies, so no man
 * stays aboard a ship the seat no longer counts free; past {@link LANDING_STRANDED_GRACE_TICKS} more, a ship
 * still at sea is let go.
 */
function releaseStranded(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const waited = env.ctx.tick - op.since;
  if (waited < LANDING_SAIL_TIMEOUT_TICKS) return [];
  const commands: PlayerCommand[] = [];
  for (const ship of op.ships) {
    if (ship.leg === 'home') continue;
    const state = shipState(env.world, ship);
    if (state?.moored === true && state.mooring !== null) commands.push(...freeCrew(ship, state.mooring));
    else if (waited >= LANDING_SAIL_TIMEOUT_TICKS + LANDING_STRANDED_GRACE_TICKS) ship.leg = 'home';
  }
  return commands;
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
 *  least the men aboard: read from the first ship's mooring on, while the wave waits aboard for the rest,
 *  for the whole wave. Costs the enemies' fighters. */
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
 * Forming: the men walk to their ships and board; once every ship's crew is in, the fleet casts off
 * together. Past {@link LANDING_FORM_TIMEOUT_TICKS} a ship still waiting leaves its men outside behind,
 * or, with nobody aboard, drops out of the landing, and the rest cast off.
 */
function forming(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const { world, ctx } = env;
  const reason = abortReason(env, op);
  if (reason !== null) return withdraw(env, op, reason);
  const boarded = op.ships.every((ship) => {
    const state = shipState(world, ship);
    return state === undefined || crewInside(state);
  });
  if (!boarded && ctx.tick - op.since < LANDING_FORM_TIMEOUT_TICKS) return [];
  const commands: PlayerCommand[] = [];
  for (const ship of op.ships) {
    const state = shipState(world, ship);
    if (state === undefined) continue;
    const seats = vehiclePassengers(state);
    if (!seats.some((seat) => seat.inside)) {
      commands.push(...freeCrew(ship, ship.home));
      continue;
    }
    for (const seat of seats)
      if (!seat.inside) commands.push({ kind: 'detachFromVehicle', entity: seat.entity });
    commands.push(dockAt(ship, ship.shore));
  }
  enter(op, 'moving', ctx.tick);
  return commands;
}

/**
 * Sailing out: once every ship still out lies moored at its shore, or {@link LANDING_SHORE_WAIT_TICKS}
 * after the first did, each moored one sets every man but its commander ashore and sails home; a ship
 * mooring later lands its men on arrival, or turns home with them {@link LANDING_SAIL_TIMEOUT_TICKS}
 * after the fleet cast off. While nobody is ashore yet, the enemy the seat sees at the shores outweighing
 * the men aboard turns the whole landing back. A ship that stopped short docks at another shore of that
 * land ({@link otherShore}). Once no ship is out the landed men fight.
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
  const out = op.ships.filter((ship) => ship.leg === 'out');
  const moored = out.filter((ship) => {
    const state = shipState(world, ship);
    return state !== undefined && mooredAt(state, ship.shore);
  });
  if (op.landed === 0 && moored.length > 0) {
    if (outmatchedAshore(env, op)) return withdraw(env, op, 'outmatched');
    op.firstMooredAt ??= ctx.tick;
  }
  const lands =
    op.landed > 0 ||
    moored.length === out.length ||
    (op.firstMooredAt !== null && ctx.tick - op.firstMooredAt >= LANDING_SHORE_WAIT_TICKS);
  for (const ship of out) {
    const state = shipState(world, ship);
    if (state === undefined) continue;
    if (mooredAt(state, ship.shore)) {
      if (!lands) continue;
      const commander = vehicleCommander(state);
      for (const seat of vehiclePassengers(state)) {
        if (seat.entity === commander || !world.isAlive(seat.entity)) continue;
        commands.push({ kind: 'detachFromVehicle', entity: seat.entity });
        op.landed++;
      }
      ship.leg = 'back';
      commands.push(dockAt(ship, ship.home));
    } else if (op.landed > 0 && ctx.tick - op.since >= LANDING_SAIL_TIMEOUT_TICKS) {
      ship.leg = 'back';
      commands.push(dockAt(ship, ship.home));
    } else if (stoppedShort(world, ship, ship.shore)) {
      ship.shore = otherShore(env, ship, ship.shore) ?? ship.shore;
      commands.push(dockAt(ship, ship.shore));
    }
  }
  if (op.ships.every((ship) => ship.leg !== 'out')) {
    if (op.landed === 0) enter(op, 'withdrawing', ctx.tick, 'losses');
    else enter(op, 'acting', ctx.tick);
  }
  return [...commands, ...landedOrders(env, op).commands];
}

/** The ships sailing back: one moored on home land frees its commander, one stopped short docks at
 *  another shore of home ({@link otherShore}), or at its own again when home has no other. */
function homecoming(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const ship of op.ships) {
    if (ship.leg !== 'back') continue;
    const state = shipState(env.world, ship);
    if (state === undefined) continue;
    const mooring = homeMooring(env, ship);
    if (mooring !== null) commands.push(...freeCrew(ship, mooring));
    else if (stoppedShort(env.world, ship, ship.home)) {
      ship.home = otherShore(env, ship, ship.home) ?? ship.home;
      commands.push(dockAt(ship, ship.home));
    }
  }
  return commands;
}

/**
 * Another shore point on the land of `refused` for a ship lying still short of it, the way hulls moored
 * there since or lying across its berth refuse its dock order: the mooring spot nearest the ship, the
 * lowest node on a tie, at least {@link LANDING_SHORE_SPACING_NODES} from `refused` and from every other
 * ship of the seat's mooring. Null when that land has none. Costs the ship's mooring spots.
 */
function otherShore(env: OperationEnv, ship: LandingShip, refused: HalfCellNode): HalfCellNode | null {
  const { world, ctx, terrain, seat } = env;
  const at = nodeOfEntity(world, ship.vehicle);
  const spots = mooringSpotsOf(world, ctx, terrain, ship.vehicle);
  const land = componentOfPoint(terrain, refused);
  if (at === null || spots === null || land === NO_COMPONENT) return null;
  const taken: HalfCellNode[] = [refused];
  for (const e of vehicleIndex(world).ownedBy(seat)) {
    const mooring = e === ship.vehicle ? null : world.get(e, Vehicle).mooring;
    if (mooring !== null) taken.push(mooring);
  }
  let best: { readonly at: HalfCellNode; readonly node: NodeId; readonly distance: number } | null = null;
  for (const node of spots.spots) {
    if (terrain.componentOf(node) !== land) continue;
    const { x, y } = terrain.coordsOf(node);
    const spot = { hx: x, hy: y };
    if (taken.some((t) => nodeManhattan(t, spot) < LANDING_SHORE_SPACING_NODES)) continue;
    const distance = nodeManhattan(spot, at);
    if (best === null || distance < best.distance || (distance === best.distance && node < best.node))
      best = { at: spot, node, distance };
  }
  return best?.at ?? null;
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

/** Acting: the landed men fight, the ships sail home ({@link releaseStranded} past the sail timeout). Ends
 *  once no landed man is left and every ship is home or lost: `wiped` when the landed men fell,
 *  `nothingToStrike` when the land holds nothing more. */
function acting(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const homeward = [...homecoming(env, op), ...releaseStranded(env, op)];
  const { landed, striking, commands } = landedOrders(env, op);
  if (landed.length > 0 && striking) return [...homeward, ...commands];
  // Nothing left to strike: the landed men are let go where they stand.
  const gone = new Set(landed);
  op.members = op.members.filter((e) => !gone.has(e));
  if (op.ships.every((ship) => ship.leg === 'home'))
    enter(op, 'done', env.ctx.tick, landed.length === 0 ? 'wiped' : 'nothingToStrike');
  return homeward;
}

/** Withdrawing: every ship sails home and frees its crew there ({@link releaseStranded} past the sail
 *  timeout); done once every ship is home or let go. */
function withdrawing(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const commands = [...homecoming(env, op), ...releaseStranded(env, op)];
  if (op.ships.every((ship) => ship.leg === 'home'))
    enter(op, 'done', env.ctx.tick, op.reason ?? 'arrivedHome');
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
 * ({@link seaRouteOf}) and is an enemy, and the free men on its home land load at least
 * {@link LANDING_BIG_SHIPS} of its free moored ships to {@link LANDING_LOAD_PCT}, as many as they fill,
 * weighing the posture's launch ratio of what the seat believes defends the rival. The men fill the ships
 * in id order, the first one each ship takes holding its helm; each ship docks at its own shore point
 * ({@link landingShores}).
 */
function open(env: OperationEnv, free: readonly Entity[], id: number): Opened<LandingOperation> | null {
  const { world, ctx, terrain, seat, orders } = env;
  const ratio = orders.launchRatio;
  if (ratio === null || ctx.tick < landingFromTick(world, seat)) return null;
  const route = seaRouteOf(world, ctx, seat);
  if (route === null) return null;
  const fleet = landingFleetShips(world, seat, computerProfileOf(world, seat));
  const fewest = Math.max(LANDING_FLEET_MIN_SHIPS, Math.min(LANDING_BIG_SHIPS, fleet));
  const moored = freeShips(env, route.home).slice(0, fleet);
  if (moored.length < fewest) return null;
  const owner = route.headquarters.owner;
  if (diplomacyStance(world, seat, owner) !== 'enemy') return null;
  const men = free.filter((e) => {
    const node = standingNode(world, terrain, e);
    return node !== null && terrain.componentOf(node) === route.home && !busy(world, e);
  });
  // The most ships, in id order, the men at home load to the share.
  const ships: Entity[] = [];
  let capacity = 0;
  for (const ship of moored) {
    const seats = world.get(ship, Vehicle).passengers.length;
    if (men.length * PERCENT < (capacity + seats) * LANDING_LOAD_PCT) break;
    ships.push(ship);
    capacity += seats;
  }
  if (ships.length < fewest) return null;
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
    firstMooredAt: null,
  };
  return { op, commands };
}

export const landingHandler: OperationHandler<LandingOperation> = {
  phase: 'beforeCampaign',
  cooldownTicks: () => LANDING_COOLDOWN_TICKS,
  step: (env, op) => step(env, op),
  open,
};
