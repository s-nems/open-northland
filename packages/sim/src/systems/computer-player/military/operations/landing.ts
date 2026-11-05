import {
  AttackOrder,
  diplomacyStance,
  Engagement,
  type LandingOperation,
  type LandingShip,
  type OperationEndReason,
  Position,
  type RescueOperation,
  Rider,
  type SeaLanding,
  seatPeaceEndTick,
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
import { colonyHeldShips } from '../../../ai-shared/home-roster.js';
import { onErrand, spokenFor } from '../../../ai-shared/military/errand.js';
import { isShipVehicle } from '../../../readviews/vehicles.js';
import { type MooringSpots, mooringSpotsOf } from '../../../vehicles/dock.js';
import { crewInside } from '../../../vehicles/movement.js';
import { vehicleIndex } from '../../../vehicles/registry.js';
import { computerProfileOf } from '../../difficulty.js';
import { LANDING_SHORE_SPACING_NODES, landOfPoint, shorePoints } from '../../sea-route.js';
import {
  LANDING_FLEET_MIN_SHIPS,
  landingFewestShips,
  landingFleetShips,
  SOLDIERS_PER_SHIP,
} from '../../workforce/craft.js';
import { underAttack } from '../../workforce/garrison.js';
import { ownArmyPoints } from '../enemy-strength.js';
import { marchOrders } from '../muster.js';
import { unitPoints } from '../points.js';
import { homeOf } from './band.js';
import {
  type LandingAim,
  type LandingRoom,
  landingAim,
  type RankedMan,
  stormObjective,
} from './landing-aim.js';
import { isRescue, mayRescue, ownPointsOnLand, rescueAim, rescueObjective } from './landing-relief.js';
import { believedLand, type FireSource, landingObjective, underFire } from './landing-target.js';
import { enter, type Opened, type OperationEnv, type OperationHandler } from './lifecycle.js';
import {
  believedEnemyTowers,
  nodeOfEntity,
  RAID_DEFENCE_RADIUS_NODES,
  RAID_TOWER_CLEARANCE_NODES,
  visibleEnemyFighters,
} from './raid-target.js';

// A naval landing (owner ruling): a seat fills its moored ships with soldiers at home and sails them
// together to the shore of the land it aims at (`landing-aim.ts`), outside the reach of the towers and
// shelters it believes stand there where it can, sets every man but each ship's commander ashore once the
// fleet lies there and marches the landed men on their objective: a rival's buildings. A rescue
// (`landing-relief.ts`) sails the same way to the enemy band on one of the seat's colonies. The ships lie
// at the shore meanwhile and take the survivors home once the landing is losing or has nothing left to
// strike.
// Every figure below is authored unless it says otherwise.

const SECONDS_PER_MINUTE = 60;

/** How long after a landing ends before the next one forms, for an army its landing fleet seats. */
export const LANDING_COOLDOWN_TICKS = 5 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The shortest such pause, for an army far bigger than its fleet seats (`cooldownTicks`). */
export const LANDING_QUICK_COOLDOWN_TICKS = SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The most a landing waits for its men to walk to their ships and board. */
export const LANDING_FORM_TIMEOUT_TICKS = 4 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The most its ships sail out before it turns back, and sail home before it lets the crews go. */
export const LANDING_SAIL_TIMEOUT_TICKS = 12 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
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
 *  ships and sail home. Authored: observed on arabskie_wyspy_wolna_gra_mieszana, the waves that lost half
 *  their landed men lost nearly all the rest within a minute or two, to tower and shelter fire. */
export const LANDING_RETREAT_LOSS_PCT = 50;
/** The most the ships lie at the shore to take the landed men back; past it they sail home and the men
 *  fight on alone. */
export const LANDING_SHORE_STAY_TICKS = LANDING_SAIL_TIMEOUT_TICKS;
/** The most landed men fight on as the landing's own once its ships sailed home: past it they are let go
 *  where they stand, so the seat may land again. */
export const LANDING_ASHORE_ALONE_TICKS = LANDING_SAIL_TIMEOUT_TICKS;
/** The most the waiting ships wait for the men called back to walk aboard before they sail without the
 *  rest. */
export const LANDING_REEMBARK_TICKS = 2 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;

const PERCENT = 100;

/** The node `e` stands on as a terrain node, or null for a man aboard. */
function standingNode(world: World, terrain: TerrainGraph, e: Entity): NodeId | null {
  const at = nodeOfEntity(world, e);
  return at === null || !terrain.inBounds(at.hx, at.hy) ? null : terrain.nodeAt(at.hx, at.hy);
}

/** What a read of a seat's ships takes, a landing's or a colony's. */
export type ShipEnv = Pick<OperationEnv, 'world' | 'ctx' | 'terrain' | 'seat'>;

/** The seat's ships a landing may take, ascending id: on the map, moored at a shore of `home`, crewless,
 *  not under way, riding no carrier and held by no colony. */
export function freeShips(env: ShipEnv, home: number): Entity[] {
  const { world, ctx, terrain, seat } = env;
  const vehicles = contentIndex(ctx.content).vehicles;
  const held = colonyHeldShips(world, seat);
  const ships: Entity[] = [];
  for (const e of vehicleIndex(world).ownedBy(seat)) {
    if (held.includes(e)) continue;
    const state = world.get(e, Vehicle);
    const type = vehicles.get(state.vehicleType);
    if (type === undefined || !isShipVehicle(type) || type.passengerVector === undefined) continue;
    if (!world.has(e, Position) || world.has(e, VehicleDrive) || state.carrier !== null) continue;
    if (!state.moored || state.mooring === null || vehiclePassengers(state).length > 0) continue;
    if (landOfPoint(terrain, state.mooring) === home) ships.push(e);
  }
  return ships.sort((a, b) => a - b);
}

/**
 * The shore points of a landing's ships ({@link shorePoints}) on the `aim`'s land, nearest where it heads,
 * outside the reach of every tower and shelter the seat believes stands there ({@link underFire}), so the
 * hulls waiting at the shore are not shot; a storm too lands clear of them and walks in. Shores whose
 * course from `ship`'s mooring passes no tower the seat believes stands ({@link courseClear}) come first;
 * with none, any clear shore. Ships beyond the shores found share them. Authored: observed on
 * arabskie_wyspy_wolna_gra_mieszana, ships moored beside a rival's headquarters, its people shooting from
 * inside, lost most hulls and every man aboard before the last one moored, and fleets sailing past
 * coastal towers lost most hulls before they reached the shore.
 */
function landingShores(env: OperationEnv, ship: Entity, aim: LandingAim, count: number): HalfCellNode[] {
  const { world, ctx, terrain, seat } = env;
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null) return [];
  const fire = fireKeyOf(aim.believed.sources);
  const failed = shoreless.get(spots);
  if (failed?.get(aim.land) === fire) return [];
  const clear = (at: HalfCellNode): boolean => !underFire(aim.believed.sources, at);
  const from = world.get(ship, Vehicle).mooring;
  const towers = believedEnemyTowers(world, ctx, seat).map((t) => t.at);
  const safe = (at: HalfCellNode): boolean => clear(at) && (from === null || courseClear(towers, from, at));
  const shores = shorePoints(world, ctx, terrain, ship, aim.land, aim.towards, safe, count);
  if (shores.length > 0) return shores;
  const anyClear = shorePoints(world, ctx, terrain, ship, aim.land, aim.towards, clear, count);
  if (anyClear.length === 0) {
    if (failed === undefined) shoreless.set(spots, new Map([[aim.land, fire]]));
    else failed.set(aim.land, fire);
  }
  return anyClear;
}

/**
 * Per set of mooring spots a ship reaches ({@link mooringSpotsOf}), the lands whose search found no shore
 * clear of the fire believed there, with that fire ({@link fireKeyOf}): a pure function of the two, so the
 * search is skipped until either changes. A derived cache: a restored game finds the same answers anew.
 */
const shoreless = new WeakMap<MooringSpots, Map<number, string>>();

/** The believed towers' and shelters' spots, in a key that changes when any of them does. */
function fireKeyOf(sources: readonly FireSource[]): string {
  return sources
    .map((s) => `${s.at.hx},${s.at.hy}`)
    .sort()
    .join(';');
}

/** How often a course is tested for towers, in nodes along it. */
const COURSE_STEP_NODES = 8;

/** Whether the straight course from `from` to `to` keeps out of every one of `towers`' reach
 *  ({@link RAID_TOWER_CLEARANCE_NODES}). Approximation: a ship's route bends round the land it passes. */
function courseClear(
  towers: readonly HalfCellNode[],
  from: DeepReadonly<HalfCellNode>,
  to: HalfCellNode,
): boolean {
  if (towers.length === 0) return true;
  const steps = Math.max(1, Math.ceil(nodeManhattan(from, to) / COURSE_STEP_NODES));
  for (let i = 0; i <= steps; i++) {
    const at = {
      hx: from.hx + Math.floor(((to.hx - from.hx) * i) / steps),
      hy: from.hy + Math.floor(((to.hy - from.hy) * i) / steps),
    };
    if (towers.some((t) => nodeManhattan(t, at) <= RAID_TOWER_CLEARANCE_NODES)) return false;
  }
  return true;
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
function withdraw(env: OperationEnv, op: SeaLanding, reason: OperationEndReason): PlayerCommand[] {
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
  const home = landOfPoint(env.terrain, ship.home);
  return home !== NO_COMPONENT && landOfPoint(env.terrain, mooring) === home ? mooring : null;
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
function releaseStranded(env: OperationEnv, op: SeaLanding, from: number): PlayerCommand[] {
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

/** Why the landing should turn back before setting anyone ashore, or null: home is raided, the target's
 *  owner is no enemy, or it lost {@link LANDING_SHIP_LOSS_PCT} of its ships. A posture turning to defence
 *  for any other reason lets it sail on: the wave was weighed when it cast off, and turning a fleet round
 *  on every swing of the army's count keeps the army home. */
function abortReason(env: OperationEnv, op: SeaLanding): OperationEndReason | null {
  const owner = op.target.owner;
  if (underAttack(env.world, env.seat)) return 'defenceMode';
  if (owner === null || diplomacyStance(env.world, env.seat, owner) !== 'enemy') return 'targetLost';
  if ((op.startShips - op.ships.length) * PERCENT >= op.startShips * LANDING_SHIP_LOSS_PCT) return 'losses';
  return null;
}

/** Whether the enemy fighters the seat sees near any of the ships' shores, each counted once, weigh at
 *  least the men aboard who go ashore, a ship's commander staying at its helm, and for a rescue the seat's
 *  own fighters on that land ({@link besideAshore}): read from the first ship's mooring on, while the wave
 *  waits aboard for the rest, for the whole wave. Costs the enemies' fighters. */
function outmatchedAshore(env: OperationEnv, op: SeaLanding): boolean {
  const { world, ctx, seat } = env;
  const helms = new Set<Entity>();
  for (const ship of op.ships) {
    const state = shipState(world, ship);
    const commander = state === undefined ? null : vehicleCommander(state);
    if (commander !== null) helms.add(commander);
  }
  let own = besideAshore(env, op);
  for (const e of op.members) if (!helms.has(e)) own += unitPoints(world, ctx, e);
  let enemy = 0;
  for (const f of visibleEnemyFighters(world, ctx, seat)) {
    if (op.ships.some((ship) => nodeManhattan(f.at, ship.shore) <= RAID_DEFENCE_RADIUS_NODES))
      enemy += f.points;
  }
  return enemy > 0 && enemy >= own;
}

/** The points of the seat's own fighters a rescue finds on the colony it sails for, its own men left out,
 *  who fight the band beside it as its sizing counted them ({@link rescueAim}); 0 for any other landing. */
function besideAshore(env: OperationEnv, op: SeaLanding): number {
  return isRescue(op) ? ownPointsOnLand(env, rivalComponent(env, op), new Set(op.members)) : 0;
}

/**
 * Forming: the men walk to their ships and board; once every ship's crew is in, the fleet casts off
 * together. Past {@link LANDING_FORM_TIMEOUT_TICKS} a ship still waiting leaves its men outside behind,
 * or, with nobody aboard, drops out of the landing, and the rest cast off.
 */
function forming(env: OperationEnv, op: SeaLanding): PlayerCommand[] {
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
function sailing(env: OperationEnv, op: SeaLanding): PlayerCommand[] {
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
      ship.shore = otherShore(env, ship.vehicle, ship.shore) ?? ship.shore;
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
function homecoming(env: OperationEnv, op: SeaLanding): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const ship of op.ships) {
    if (ship.leg !== 'back') continue;
    const state = shipState(env.world, ship);
    if (state === undefined) continue;
    const mooring = homeMooring(env, ship);
    if (mooring !== null) commands.push(...freeCrew(ship, mooring));
    else if (stoppedShort(env.world, ship, ship.home)) {
      ship.home = otherShore(env, ship.vehicle, ship.home) ?? ship.home;
      commands.push(dockAt(ship, ship.home));
    }
  }
  return commands;
}

/**
 * Another shore point on the land of `refused` for a ship lying still short of it, the way hulls moored
 * there since or lying across its berth refuse its dock order: the mooring spot nearest the ship, the
 * lowest node on a tie, at least {@link LANDING_SHORE_SPACING_NODES} from `refused`, from each of `tried`
 * and from every other ship of the seat's mooring. Null when that land has none. Costs the ship's mooring
 * spots.
 */
export function otherShore(
  env: ShipEnv,
  ship: Entity,
  refused: HalfCellNode,
  tried: readonly DeepReadonly<HalfCellNode>[] = [],
): HalfCellNode | null {
  const { world, ctx, terrain, seat } = env;
  const at = nodeOfEntity(world, ship);
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  const land = landOfPoint(terrain, refused);
  if (at === null || spots === null || land === NO_COMPONENT) return null;
  const taken: DeepReadonly<HalfCellNode>[] = [refused, ...tried];
  for (const e of vehicleIndex(world).ownedBy(seat)) {
    const mooring = e === ship ? null : world.get(e, Vehicle).mooring;
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

/** The land the men were set ashore on: the target's component, read at the spot the landing aimed at. */
function rivalComponent(env: OperationEnv, op: SeaLanding): number {
  return landOfPoint(env.terrain, { hx: op.target.hx, hy: op.target.hy });
}

/** The men set ashore: members on the target's land, no longer aboard. */
function landedMen(env: OperationEnv, op: SeaLanding): Entity[] {
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
 * ({@link landingObjective}), storming covered ground while they clearly outweigh what defends it
 * ({@link stormObjective}); a man fighting or on his way is left to it.
 */
function landedOrders(env: OperationEnv, op: SeaLanding): LandedOrders {
  const { world, ctx, terrain } = env;
  const landed = landedMen(env, op);
  const first = landed[0];
  const from = first === undefined ? null : nodeOfEntity(world, first);
  if (from === null) return { landed, striking: false, fire: [], commands: [] };
  const land = rivalComponent(env, op);
  const free = landed.filter(
    (e) => !spokenFor(world, e) && !world.has(e, Engagement) && !world.has(e, AttackOrder),
  );
  if (isRescue(op)) {
    const foe = rescueObjective(env, land, from);
    if (foe === null) return { landed, striking: false, fire: [], commands: [] };
    return { landed, striking: true, fire: [], commands: marchOrders(world, terrain, free, foe) };
  }
  const believed = believedLand(env, land);
  let goal = landingObjective(ctx, believed, from);
  if (goal === null) {
    let points = 0;
    for (const e of landed) points += unitPoints(world, ctx, e);
    goal = stormObjective(env, believed, land, op.target.owner, from, points);
  }
  if (goal === null) return { landed, striking: false, fire: believed.sources, commands: [] };
  return {
    landed,
    striking: true,
    fire: believed.sources,
    commands: marchOrders(world, terrain, free, goal.node),
  };
}

/**
 * Whether the landed men are losing: the enemy fighters the seat sees within
 * {@link RAID_DEFENCE_RADIUS_NODES} of them outweigh them, with a rescue's {@link besideAshore}, or they lost
 * {@link LANDING_RETREAT_LOSS_PCT} of the men set ashore and one of them stands in the reach of a tower or
 * shelter of `fire` ({@link underFire}).
 */
function losing(
  env: OperationEnv,
  op: SeaLanding,
  landed: readonly Entity[],
  fire: readonly FireSource[],
): boolean {
  const { world, ctx, seat } = env;
  const spots = landed.flatMap((e) => nodeOfEntity(world, e) ?? []);
  let own = besideAshore(env, op);
  for (const e of landed) own += unitPoints(world, ctx, e);
  // A fighter outside the band's box grown by the radius stands farther than the radius from every man.
  const box = boundsOf(spots, RAID_DEFENCE_RADIUS_NODES);
  let enemy = 0;
  for (const f of visibleEnemyFighters(world, ctx, seat)) {
    if (f.at.hx < box.minX || f.at.hx > box.maxX || f.at.hy < box.minY || f.at.hy > box.maxY) continue;
    if (spots.some((at) => nodeManhattan(f.at, at) <= RAID_DEFENCE_RADIUS_NODES)) enemy += f.points;
  }
  if (enemy >= own) return true;
  if ((op.landed - landed.length) * PERCENT < op.landed * LANDING_RETREAT_LOSS_PCT) return false;
  return spots.some((at) => underFire(fire, at));
}

/** The box round `spots` grown by `margin` on every side; an empty box when there are none. */
function boundsOf(spots: readonly HalfCellNode[], margin: number) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { hx, hy } of spots) {
    minX = Math.min(minX, hx);
    minY = Math.min(minY, hy);
    maxX = Math.max(maxX, hx);
    maxY = Math.max(maxY, hy);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/** Call the landed men back aboard the waiting ships for `reason`: each walks to the waiting ship nearest
 *  him with a seat left, the lower id first; a man no ship seats stays ashore. */
function reembark(
  env: OperationEnv,
  op: SeaLanding,
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
function sailWaitingHome(env: OperationEnv, op: SeaLanding, all: boolean): PlayerCommand[] {
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
 * holds nothing more for them to strike ({@link landedOrders}: no building left, or for a rescue no enemy
 * fighter in sight), they board the waiting ships ({@link reembark}). Past {@link LANDING_SHORE_STAY_TICKS}
 * a rescue's men board them too, on their own colony, where no ship comes back for them; a landing's ships
 * sail home and its men fight on alone, let go where they stand once nothing is left to strike or past
 * {@link LANDING_ASHORE_ALONE_TICKS} more. Ends once no landed man is left and every ship is home or lost:
 * `wiped` when the landed men fell, `nothingToStrike` when the land holds nothing more, `timedOut` when its
 * time ran out.
 */
function acting(env: OperationEnv, op: SeaLanding): PlayerCommand[] {
  const { tick } = env.ctx;
  const stayEnd = op.since + LANDING_SHORE_STAY_TICKS;
  const late = tick >= stayEnd;
  const homeward = [...homecoming(env, op), ...releaseStranded(env, op, stayEnd)];
  const { landed, striking, fire, commands } = landedOrders(env, op);
  const waiting = op.ships.some((ship) => ship.leg === 'waiting');
  if (waiting && landed.length > 0) {
    const reason = boardingReason(env, op, { landed, striking, fire }, late);
    if (reason !== null) return [...homeward, ...reembark(env, op, landed, reason)];
  }
  if (late) homeward.push(...sailWaitingHome(env, op, true));
  const alone = tick >= stayEnd + LANDING_ASHORE_ALONE_TICKS;
  if (landed.length > 0 && striking && !alone) return [...homeward, ...commands];
  // Nothing left to strike, or their time is up: the landed men are let go where they stand.
  const gone = new Set(landed);
  op.members = op.members.filter((e) => !gone.has(e));
  if (landed.length === 0) homeward.push(...sailWaitingHome(env, op, true));
  if (op.ships.every((ship) => ship.leg === 'home'))
    enter(op, 'done', tick, landed.length === 0 ? 'wiped' : striking ? 'timedOut' : 'nothingToStrike');
  return homeward;
}

/** Why the landed men board the waiting ships now, or null while they fight on ({@link acting}). */
function boardingReason(
  env: OperationEnv,
  op: SeaLanding,
  { landed, striking, fire }: Pick<LandedOrders, 'landed' | 'striking' | 'fire'>,
  late: boolean,
): OperationEndReason | null {
  if (!striking) return 'nothingToStrike';
  if (losing(env, op, landed, fire)) return 'losses';
  return late && isRescue(op) ? 'timedOut' : null;
}

/** Withdrawing: a waiting ship sails home once every man called to it is aboard, or past
 *  {@link LANDING_REEMBARK_TICKS} without the rest; every ship frees its crew at home
 *  ({@link releaseStranded} past the sail timeout); done once every ship is home or let go. */
function withdrawing(env: OperationEnv, op: SeaLanding): PlayerCommand[] {
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
function keepMembers(env: OperationEnv, op: SeaLanding): void {
  const { world } = env;
  const ships = new Set(op.ships.map((ship) => ship.vehicle));
  const ashore = new Set(landedMen(env, op));
  op.members = op.members.filter((e) => {
    const rider = world.tryGet(e, Rider);
    return rider !== undefined ? ships.has(rider.vehicle) : ashore.has(e);
  });
}

function step<O extends SeaLanding>(env: OperationEnv, op: O): readonly PlayerCommand[] {
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

/** The ships and men a landing may take this decision: the free ships moored on home land, at most the
 *  landing fleet, and the free men on home land, strongest first. */
interface Muster {
  readonly home: number;
  readonly moored: readonly Entity[];
  readonly ranked: readonly RankedMan[];
  readonly room: LandingRoom;
}

/** The {@link Muster} of this decision, or null with no ship free at home: a headquarters landing is big
 *  once at least {@link landingFewestShips} ships lie free and the men fill
 *  {@link LANDING_FLEET_MIN_SHIPS} of them. */
function musterOf(env: OperationEnv, free: readonly Entity[]): Muster | null {
  const { world, ctx, terrain, seat } = env;
  const home = terrain.componentOf(env.home);
  if (home === NO_COMPONENT) return null;
  const fleet = landingFleetShips(world, seat, computerProfileOf(world, seat));
  const moored = freeShips(env, home).slice(0, fleet);
  if (moored.length === 0) return null;
  const men = free.filter((e) => {
    const node = standingNode(world, terrain, e);
    return node !== null && terrain.componentOf(node) === home && !onErrand(world, e);
  });
  const ships = moored.map((ship) => seatsOf(world, ship));
  let least = 0;
  for (const room of ships.slice(0, LANDING_FLEET_MIN_SHIPS)) least += room;
  let seats = 0;
  for (const room of ships) seats += room;
  const ranked = men
    .map((entity) => ({ entity, points: unitPoints(world, ctx, entity) }))
    .sort((a, b) => b.points - a.points || a.entity - b.entity);
  const bigLanding = moored.length >= landingFewestShips(fleet) && men.length >= least;
  return { home, moored, ranked, room: { ships, seats, bigLanding } };
}

function seatsOf(world: World, ship: Entity): number {
  return world.get(ship, Vehicle).passengers.length;
}

/** A {@link SeaLanding} but its kind, with the orders that start it. */
interface Voyage {
  readonly op: Omit<SeaLanding, 'kind'>;
  readonly commands: readonly PlayerCommand[];
}

/**
 * The voyage sailing `aim`'s men in as few of the `moored` ships as seat them, in id order: the men fill
 * the ships by {@link crewsOf}; each ship docks at its own shore point ({@link landingShores}). Null when
 * that land offers no shore.
 */
function launch(env: OperationEnv, aim: LandingAim, moored: readonly Entity[], id: number): Voyage | null {
  const { world, ctx } = env;
  const ships: Entity[] = [];
  let capacity = 0;
  for (const ship of moored) {
    if (capacity >= aim.men.length) break;
    ships.push(ship);
    capacity += seatsOf(world, ship);
  }
  const crews = crewsOf(env, ships, aim.men);
  const first = crews[0];
  const shores = first === undefined ? [] : landingShores(env, first.ship, aim, crews.length);
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
  const wave = crews.flatMap((crew) => crew.men);
  const op: Omit<SeaLanding, 'kind'> = {
    id,
    state: 'forming',
    since: ctx.tick,
    members: [...wave].sort((a, b) => a - b),
    target: { hx: aim.towards.hx, hy: aim.towards.hy, entity: aim.entity, owner: aim.owner },
    reason: null,
    ships: landingShips,
    startShips: landingShips.length,
    startMen: wave.length,
    landed: 0,
    firstMooredAt: null,
  };
  return { op, commands };
}

/**
 * A landing once the seat's posture attacks, its peace is over and its difficulty's first wave is due, on
 * the land {@link landingAim} picks among every land the seat believes holds an enemy building: a big
 * landing on a rival's headquarters land takes every free man on home land ({@link musterOf}); a raid on a
 * colony takes the band sized to it.
 */
function openLanding(
  env: OperationEnv,
  free: readonly Entity[],
  id: number,
): Opened<LandingOperation> | null {
  const { world, ctx, seat, orders } = env;
  const ratio = orders.launchRatio;
  if (ratio === null || ctx.tick < landingFromTick(world, seat)) return null;
  const muster = musterOf(env, free);
  if (muster === null) return null;
  const voyage = landingAim(env, muster.home, homeOf(env), muster.ranked, ratio, muster.room, (aim) =>
    launch(env, aim, muster.moored, id),
  );
  return voyage === null ? null : { op: { ...voyage.op, kind: 'landing' }, commands: voyage.commands };
}

/**
 * A rescue of the seat's colony an enemy band reaches ({@link rescueAim}) once the seat's peace is over,
 * whatever its posture, its first wave and its other landings, unless home itself is raided.
 */
function openRescue(env: OperationEnv, free: readonly Entity[], id: number): Opened<RescueOperation> | null {
  const { world, ctx, seat } = env;
  if (ctx.tick < seatPeaceEndTick(world, seat) || underAttack(world, seat) || !mayRescue(env)) return null;
  const muster = musterOf(env, free);
  if (muster === null) return null;
  const aim = rescueAim(env, muster.ranked, muster.room);
  const voyage = aim === null ? null : launch(env, aim, muster.moored, id);
  return voyage === null ? null : { op: { ...voyage.op, kind: 'rescue' }, commands: voyage.commands };
}

/**
 * How long after a landing ends before the next one forms: {@link LANDING_COOLDOWN_TICKS}, shortened in
 * proportion as the seat's fit army outgrows the seats of its landing fleet, down to
 * {@link LANDING_QUICK_COOLDOWN_TICKS}, so a bigger army lands more often. Costs the seat's fighters.
 */
function cooldownTicks(env: OperationEnv): number {
  const { world, ctx, seat } = env;
  const fleetSeats = landingFleetShips(world, seat, computerProfileOf(world, seat)) * SOLDIERS_PER_SHIP;
  const men = ownArmyPoints(world, ctx, seat).men;
  if (men <= fleetSeats) return LANDING_COOLDOWN_TICKS;
  return Math.max(LANDING_QUICK_COOLDOWN_TICKS, Math.floor((LANDING_COOLDOWN_TICKS * fleetSeats) / men));
}

export const landingHandler: OperationHandler<LandingOperation> = {
  phase: 'beforeCampaign',
  cooldownTicks,
  step,
  open: openLanding,
};

/** A rescue opens again on the decision after one ends: each is sized afresh on what the seat sees. */
export const rescueHandler: OperationHandler<RescueOperation> = {
  phase: 'beforeCampaign',
  cooldownTicks: () => 0,
  step,
  open: openRescue,
};
