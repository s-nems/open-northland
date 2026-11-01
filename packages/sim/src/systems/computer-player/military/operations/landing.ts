import {
  AttackOrder,
  Building,
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
import { computerProfileOf, type Share } from '../../difficulty.js';
import { type SeaRoute, seaRouteOf } from '../../sea-route.js';
import { LANDING_FLEET_MIN_SHIPS, landingFewestShips, landingFleetShips } from '../../workforce/craft.js';
import { knownDefendingPoints } from '../enemy-strength.js';
import { marchOrders } from '../muster.js';
import { launchRatioReached } from '../plan.js';
import { unitPoints } from '../points.js';
import {
  believedFireAt,
  believedLand,
  type FireSource,
  landingObjective,
  underFire,
} from './landing-target.js';
import { enter, type Opened, type OperationEnv, type OperationHandler } from './lifecycle.js';
import { nodeOfEntity, RAID_DEFENCE_RADIUS_NODES, visibleFighters } from './raid-target.js';

// A naval landing (owner ruling): a seat whose rival lies over the sea fills its moored ships with the
// soldiers at home, sails them together to the rival's shore nearest his headquarters outside the reach of
// his towers and shelters, sets every man but each ship's commander ashore once the fleet lies there and marches the landed
// men on his headquarters and then on what stands clear of his towers and shelters. The ships lie at the
// shore meanwhile and take the survivors home once the landing is losing or has nothing left to strike.
// Every figure below is authored unless it says otherwise.

const SECONDS_PER_MINUTE = 60;

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
/** The share of the men set ashore, in percent, a landing may lose before the survivors board the waiting
 *  ships and sail home. Authored: on arabskie_wyspy_wolna_gra_mieszana (seeds 7, 13) the waves that lost
 *  half their landed men lost nearly all the rest within a minute or two, to tower and shelter fire. */
export const LANDING_RETREAT_LOSS_PCT = 50;
/** The most the ships lie at the shore to take the landed men back; past it they sail home and the men
 *  fight on alone. */
export const LANDING_SHORE_STAY_TICKS = LANDING_SAIL_TIMEOUT_TICKS;
/** The most the waiting ships wait for the men called back to walk aboard before they sail without the
 *  rest. */
export const LANDING_REEMBARK_TICKS = 2 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;

/** The least a landing outweighs what the seat believes defends the rival, whatever its posture's launch
 *  ratio. Authored: on arabskie_wyspy_wolna_gra_mieszana (seed 7) 68 men landed at parity with a rival's
 *  79 soldiers all fell in two and a half minutes for 28 of his, and 68 landed against a twelfth of their
 *  weight fell too, to his towers and the fire of his sheltering people: landed men cannot fall back. */
export const LANDING_EDGE: Share = { num: 3, den: 2 };

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
 * others: the mooring spots `ship` can sail to ({@link mooringSpotsOf}) on the rival's land outside the reach
 * of every tower and shelter the seat believes stands there (`fire`, {@link underFire}), so the hulls
 * waiting at the shore are not shot, nearest his headquarters first, the lowest node on a tie. Authored: on
 * arabskie_wyspy_wolna_gra_mieszana (seed 7) four ships moored six nodes from a rival's headquarters, its
 * people shooting from inside, lost three hulls and all 61 men aboard before the last one moored.
 */
function landingShores(
  env: OperationEnv,
  ship: Entity,
  route: SeaRoute,
  fire: readonly FireSource[],
  count: number,
): HalfCellNode[] {
  const { world, ctx, terrain } = env;
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null) return [];
  const hq = route.headquarters.node;
  const candidates: { readonly at: HalfCellNode; readonly node: NodeId; readonly distance: number }[] = [];
  for (const node of spots.spots) {
    if (terrain.componentOf(node) !== route.rival) continue;
    const { x, y } = terrain.coordsOf(node);
    const at = { hx: x, hy: y };
    if (underFire(fire, at)) continue;
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
  enter(op, 'withdrawing', env.ctx.tick, reason);
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
 * The ships sailing back a landing is done waiting for, counted `from` the tick they turned home: past
 * {@link LANDING_SAIL_TIMEOUT_TICKS} a ship moored anywhere sets its crew ashore where it lies, so no man
 * stays aboard a ship the seat no longer counts free; past {@link LANDING_STRANDED_GRACE_TICKS} more, a ship
 * still at sea is let go.
 */
function releaseStranded(env: OperationEnv, op: LandingOperation, from: number): PlayerCommand[] {
  const waited = env.ctx.tick - from;
  if (waited < LANDING_SAIL_TIMEOUT_TICKS) return [];
  const commands: PlayerCommand[] = [];
  for (const ship of op.ships) {
    if (ship.leg !== 'back' && ship.leg !== 'out') continue;
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
 * after the first did, each moored one sets every man but its commander ashore and waits there; a ship
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
      ship.leg = 'waiting';
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
  /** The towers and shelters the objective was chosen clear of; none while nobody is ashore. */
  readonly fire: readonly FireSource[];
  readonly commands: readonly PlayerCommand[];
}

/**
 * The landed men march on the landing's next objective from where the first of them stands
 * ({@link landingObjective}); a man fighting or on his way is left to it.
 */
function landedOrders(env: OperationEnv, op: LandingOperation): LandedOrders {
  const { world, ctx, terrain } = env;
  const landed = landedMen(env, op);
  const first = landed[0];
  const from = first === undefined ? null : nodeOfEntity(world, first);
  if (from === null) return { landed, striking: false, fire: [], commands: [] };
  const believed = believedLand(env, rivalComponent(env, op));
  const goal = landingObjective(ctx, believed, from);
  if (goal === null) return { landed, striking: false, fire: believed.sources, commands: [] };
  const free = landed.filter(
    (e) =>
      !isTravelling(world, e) && !busy(world, e) && !world.has(e, Engagement) && !world.has(e, AttackOrder),
  );
  return {
    landed,
    striking: true,
    fire: believed.sources,
    commands: marchOrders(world, terrain, free, goal.node),
  };
}

/**
 * Whether the landed men are losing: the enemy fighters the seat sees within
 * {@link RAID_DEFENCE_RADIUS_NODES} of them outweigh them, or they lost {@link LANDING_RETREAT_LOSS_PCT} of
 * the men set ashore and one of them stands in the reach of a tower or shelter of `fire` ({@link underFire}).
 */
function losing(
  env: OperationEnv,
  op: LandingOperation,
  landed: readonly Entity[],
  fire: readonly FireSource[],
): boolean {
  const { world, ctx, seat } = env;
  const spots = landed.flatMap((e) => nodeOfEntity(world, e) ?? []);
  let own = 0;
  for (const e of landed) own += unitPoints(world, ctx, e);
  let enemy = 0;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat || diplomacyStance(world, seat, other) !== 'enemy') continue;
    for (const f of visibleFighters(world, ctx, seat, other))
      if (spots.some((at) => nodeManhattan(f.at, at) <= RAID_DEFENCE_RADIUS_NODES)) enemy += f.points;
  }
  if (enemy >= own) return true;
  if ((op.landed - landed.length) * PERCENT < op.landed * LANDING_RETREAT_LOSS_PCT) return false;
  return spots.some((at) => underFire(fire, at));
}

/** Call the landed men back aboard the waiting ships for `reason`: each walks to the waiting ship nearest
 *  him with a seat left, the lower id first; a man no ship seats stays ashore. */
function reembark(
  env: OperationEnv,
  op: LandingOperation,
  landed: readonly Entity[],
  reason: OperationEndReason,
): PlayerCommand[] {
  const { world } = env;
  enter(op, 'withdrawing', env.ctx.tick, reason);
  const berths = op.ships.flatMap((ship) => {
    const state = shipState(world, ship);
    if (ship.leg !== 'waiting' || state === undefined) return [];
    return [{ ship, at: ship.shore, left: state.passengers.length - vehiclePassengers(state).length }];
  });
  const commands: PlayerCommand[] = [];
  for (const e of [...landed].sort((a, b) => a - b)) {
    const at = nodeOfEntity(world, e);
    if (at === null) continue;
    let best: (typeof berths)[number] | null = null;
    for (const berth of berths) {
      if (berth.left <= 0) continue;
      if (best === null || nodeManhattan(berth.at, at) < nodeManhattan(best.at, at)) best = berth;
    }
    if (best === null) continue;
    best.left--;
    commands.push({ kind: 'attachToVehicle', entity: e, vehicle: best.ship.vehicle });
  }
  return commands;
}

/** Send the waiting ships home with whoever is aboard, leaving behind a man still walking to one. */
function sailWaitingHome(env: OperationEnv, op: LandingOperation, all: boolean): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const ship of op.ships) {
    const state = shipState(env.world, ship);
    if (ship.leg !== 'waiting' || state === undefined) continue;
    if (!all && !crewInside(state)) continue;
    for (const seat of vehiclePassengers(state))
      if (!seat.inside) commands.push({ kind: 'detachFromVehicle', entity: seat.entity });
    ship.leg = 'back';
    commands.push(dockAt(ship, ship.home));
  }
  return commands;
}

/**
 * Acting: the landed men fight while the ships wait at the shore. Once they are {@link losing}, or the land
 * holds nothing more for them to strike ({@link landingObjective}), they board the waiting ships
 * ({@link reembark}). Past {@link LANDING_SHORE_STAY_TICKS} the ships sail home and the men
 * fight on alone, let go where they stand once nothing is left to strike. Ends once no landed man is left
 * and every ship is home or lost: `wiped` when the landed men fell, `nothingToStrike` when the land holds
 * nothing more.
 */
function acting(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const stayEnd = op.since + LANDING_SHORE_STAY_TICKS;
  const homeward = [...homecoming(env, op), ...releaseStranded(env, op, stayEnd)];
  if (env.ctx.tick >= stayEnd) homeward.push(...sailWaitingHome(env, op, true));
  const { landed, striking, fire, commands } = landedOrders(env, op);
  const waiting = op.ships.some((ship) => ship.leg === 'waiting');
  if (waiting && landed.length > 0 && (!striking || losing(env, op, landed, fire)))
    return [...homeward, ...reembark(env, op, landed, striking ? 'losses' : 'nothingToStrike')];
  if (landed.length > 0 && striking) return [...homeward, ...commands];
  // Nothing left to strike: the landed men are let go where they stand.
  const gone = new Set(landed);
  op.members = op.members.filter((e) => !gone.has(e));
  if (landed.length === 0) homeward.push(...sailWaitingHome(env, op, true));
  if (op.ships.every((ship) => ship.leg === 'home'))
    enter(op, 'done', env.ctx.tick, landed.length === 0 ? 'wiped' : 'nothingToStrike');
  return homeward;
}

/** Withdrawing: a waiting ship sails home once every man called to it is aboard, or past
 *  {@link LANDING_REEMBARK_TICKS} without the rest; every ship frees its crew at home
 *  ({@link releaseStranded} past the sail timeout); done once every ship is home or let go. */
function withdrawing(env: OperationEnv, op: LandingOperation): PlayerCommand[] {
  const late = env.ctx.tick - op.since >= LANDING_REEMBARK_TICKS;
  const commands = [
    ...sailWaitingHome(env, op, late),
    ...homecoming(env, op),
    ...releaseStranded(env, op, op.since),
  ];
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
 * The men each ship takes, its helm first: the weakest men at home hold the helms, since a commander stays
 * aboard, and the strongest of the rest fill the seats behind them, so the best-armed go ashore. Ranked by
 * {@link unitPoints}, the lower id first on a tie.
 */
function crewsOf(
  env: OperationEnv,
  ships: readonly Entity[],
  men: readonly Entity[],
): { readonly ship: Entity; readonly men: readonly Entity[] }[] {
  const { world, ctx } = env;
  const ranked = men
    .map((e) => ({ e, points: unitPoints(world, ctx, e) }))
    .sort((a, b) => b.points - a.points || a.e - b.e)
    .map((m) => m.e);
  const helms = ranked.splice(Math.max(0, ranked.length - ships.length)).reverse();
  const crews: { readonly ship: Entity; readonly men: readonly Entity[] }[] = [];
  let next = 0;
  ships.forEach((ship, i) => {
    const helm = helms[i];
    const seats = world.get(ship, Vehicle).passengers.length - 1;
    crews.push({ ship, men: [...(helm === undefined ? [] : [helm]), ...ranked.slice(next, next + seats)] });
    next += seats;
  });
  return crews;
}

/**
 * A landing when the seat's posture attacks, its peace is over, its rival lies over the sea
 * ({@link seaRouteOf}) and is an enemy, at least {@link landingFewestShips} of its ships lie free and moored,
 * and the free men on its home land fill at least {@link LANDING_FLEET_MIN_SHIPS} of them. Every such man
 * goes, in as few of those ships as seat him, weighing the posture's launch ratio, at least
 * {@link LANDING_EDGE} against an army it knows, of what the seat believes defends the rival plus the fire
 * it believes covers the first objective ({@link believedFireAt}); an unknown army counts at parity, and
 * the fire alone must not outweigh the wave. No landing sails while nothing on the rival's land lies
 * clear to strike ({@link landingObjective}). The men fill the ships by {@link crewsOf}; each ship docks
 * at its own shore point ({@link landingShores}).
 */
function open(env: OperationEnv, free: readonly Entity[], id: number): Opened<LandingOperation> | null {
  const { world, ctx, terrain, seat, orders } = env;
  const ratio = orders.launchRatio;
  if (ratio === null || ctx.tick < landingFromTick(world, seat)) return null;
  const route = seaRouteOf(world, ctx, seat);
  if (route === null) return null;
  const fleet = landingFleetShips(world, seat, computerProfileOf(world, seat));
  const fewest = landingFewestShips(fleet);
  const moored = freeShips(env, route.home).slice(0, fleet);
  if (moored.length < fewest) return null;
  const owner = route.headquarters.owner;
  if (diplomacyStance(world, seat, owner) !== 'enemy') return null;
  const men = free.filter((e) => {
    const node = standingNode(world, terrain, e);
    return node !== null && terrain.componentOf(node) === route.home && !busy(world, e);
  });
  const seatsOf = (ship: Entity): number => world.get(ship, Vehicle).passengers.length;
  let least = 0;
  for (const ship of moored.slice(0, LANDING_FLEET_MIN_SHIPS)) least += seatsOf(ship);
  if (men.length < least) return null;
  // The fewest ships, in id order, that seat every man at home.
  const ships: Entity[] = [];
  let capacity = 0;
  for (const ship of moored) {
    if (capacity >= men.length) break;
    ships.push(ship);
    capacity += seatsOf(ship);
  }
  const crews = crewsOf(env, ships, men);
  const wave = crews.flatMap((crew) => crew.men);
  let points = 0;
  for (const e of wave) points += unitPoints(world, ctx, e);
  // An enemy it knows nothing of is taken at parity on the posture's own ratio, as every launch takes him.
  const known = knownDefendingPoints(world, ctx, seat, owner);
  const edge =
    known === null || ratio.num * LANDING_EDGE.den >= LANDING_EDGE.num * ratio.den ? ratio : LANDING_EDGE;
  const believed = believedLand(env, route.rival);
  const first = crews[0];
  const shores =
    first === undefined ? [] : landingShores(env, first.ship, route, believed.sources, crews.length);
  const nearest = shores[0];
  const goal = nearest === undefined ? null : landingObjective(ctx, believed, nearest);
  if (goal === null) return null;
  const tribe = world.tryGet(route.headquarters.entity, Building)?.tribe;
  const fire = tribe === undefined ? 0 : believedFireAt(ctx, believed.sources, goal.at, tribe);
  const opposing = known === null ? Math.max(points, fire) : known + fire;
  if (!launchRatioReached(points, opposing, edge)) return null;
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
