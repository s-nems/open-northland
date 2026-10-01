import {
  Equipment,
  Vehicle,
  VehicleDrive,
  vehicleCommander,
  vehiclePassengers,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistance, hexDistanceBetween } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { VEHICLE_SCAN_RADIUS_POINTS } from '../../conflict/engage-vehicle.js';
import type { SystemContext } from '../../context.js';
import { vehicleAnchor } from '../../footprint/index.js';
import { isSiegeVehicle } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { canAttachToVehicle } from '../../vehicles/crew.js';
import { VEHICLE_TARGET_SNAP_RADIUS, vehicleRestBlocks } from '../../vehicles/movement.js';
import { vehicleIndex } from '../../vehicles/registry.js';
import { seatBarracksOf } from '../base.js';
import { anchorNodeOf, nearestRingNode, towardNode } from '../node-geometry.js';
import { isBuilt } from '../seat-roster.js';
import { fighterWeaponClass } from './census.js';
import { garrisonSlots } from './defence/posts.js';
import type { Raider } from './defence/threat.js';
import { spokenFor } from './errand.js';

// The seat's catapults: a soldier drives each one, and one idle at home parks on the attack stance by the
// barracks or a tower, where its own scan (`conflict/engage-vehicle.ts`) answers what comes near; a raid
// beyond that scan draws it out on an attack-move. Every distance here is authored.

/** The band around a barracks or tower door (Manhattan half-cell nodes) a catapult parks in: off the
 *  door and its approach, still inside the settlement. */
export const PARK_RING_MIN_NODES = 6;
export const PARK_RING_MAX_NODES = 16;

/** How far apart (Manhattan half-cell nodes) two parked catapults stand: three cells, so their bodies
 *  never touch and one enemy volley cannot catch both. */
export const PARK_SPACING_NODES = 6;

/** How far around a catapult the AI looks for a parking spot, and how far it sends one per goto: a
 *  farther goal is reached in hops, each judged again from where the catapult then stands. The
 *  original's vehicle walk range. */
export const CATAPULT_REACH_NODES = 60;

/** The longest drive toward a goal beyond {@link CATAPULT_REACH_NODES}: short enough that the target
 *  snap cannot carry the goal past that reach. */
export const VEHICLE_HOP_NODES = CATAPULT_REACH_NODES - VEHICLE_TARGET_SNAP_RADIUS;

/** A catapult and the man in its commander seat, aboard or still walking to its door. */
export interface CrewedCatapult {
  readonly vehicle: Entity;
  readonly driver: Entity;
}

export interface SiegeCrewDecision {
  readonly commands: readonly PlayerCommand[];
  /** Men attached this decision. The attach applies next tick, so no other order may take them now. */
  readonly drafted: ReadonlySet<Entity>;
  /** Drivers aboard a catapult parked at home: the outfit rung may call them down for an errand. */
  readonly parkedDrivers: readonly Entity[];
}

const NO_CREW: SiegeCrewDecision = { commands: [], drafted: new Set(), parkedDrivers: [] };

/** The seat's siege vehicles standing on the map, ascending id. Read off the vehicle index, so the cost
 *  is the seat's vehicles. */
export function seatCatapults(world: World, ctx: SystemContext, player: number): Entity[] {
  const types = contentIndex(ctx.content).vehicles;
  return vehicleIndex(world)
    .ownedBy(player)
    .filter((e) => {
      const state = world.get(e, Vehicle);
      const type = types.get(state.vehicleType);
      return type !== undefined && isSiegeVehicle(type) && state.carrier === null;
    });
}

/** The seat's catapults that have a driver, ascending by vehicle id. */
export function crewedCatapults(world: World, ctx: SystemContext, player: number): CrewedCatapult[] {
  return crewedOf(world, seatCatapults(world, ctx, player));
}

function crewedOf(world: World, catapults: readonly Entity[]): CrewedCatapult[] {
  const crewed: CrewedCatapult[] = [];
  for (const vehicle of catapults) {
    const driver = vehicleCommander(world.get(vehicle, Vehicle));
    if (driver !== null) crewed.push({ vehicle, driver });
  }
  return crewed;
}

/**
 * One decision for the seat's catapults at home: a driver for each one without, taken from `free` (the men
 * no tower, raid or fight holds), then the idle ones sent at a `raid` beyond their scan
 * ({@link raidOrders}) or parked ({@link parkingOrders}). The catapults of a marching wave (`marching`) are
 * its own: one that loses its driver on the way stays where it stands.
 */
export function siegeCrewOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  free: readonly Entity[],
  marching: ReadonlySet<Entity>,
  raid: Raider | null,
): SiegeCrewDecision {
  const catapults = seatCatapults(world, ctx, player).filter((e) => !marching.has(e));
  if (catapults.length === 0) return NO_CREW;
  const draft = draftDrivers(world, ctx, catapults, free);
  const crewed = crewedOf(world, catapults);
  const sortie = raid === null ? [] : raidOrders(world, terrain, crewed, raid);
  const park = parkingOrders(world, ctx, terrain, player, owned, crewed, raid !== null);
  return {
    commands: [...draft.commands, ...sortie, ...park.commands],
    drafted: draft.drafted,
    parkedDrivers: park.parkedDrivers,
  };
}

/** How well a man is kitted out: weapon and armour first, the misc slots after. Lower drives first. */
interface Kit {
  readonly arms: number;
  readonly trinkets: number;
}

function kitOf(world: World, ctx: SystemContext, e: Entity): Kit {
  const eq = world.tryGet(e, Equipment);
  const armed = fighterWeaponClass(world, ctx, e) === null ? 0 : 1;
  const armoured = (eq?.armor ?? null) === null ? 0 : 1;
  const trinkets = eq?.misc.filter((slot) => slot !== null).length ?? 0;
  return { arms: armed + armoured, trinkets };
}

/**
 * Attach a man to each commanderless catapult: the least kitted-out ({@link Kit}) of the free men who may
 * crew it, then the nearest, then the lowest id. `free` arrives ascending, so the strict comparison keeps
 * the lowest id.
 */
function draftDrivers(
  world: World,
  ctx: SystemContext,
  catapults: readonly Entity[],
  free: readonly Entity[],
): { commands: PlayerCommand[]; drafted: Set<Entity> } {
  const commands: PlayerCommand[] = [];
  const drafted = new Set<Entity>();
  const kits = new Map<Entity, Kit>();
  for (const vehicle of catapults) {
    if (vehicleCommander(world.get(vehicle, Vehicle)) !== null) continue;
    const at = vehicleAnchor(world, vehicle);
    if (at === null) continue;
    let best: { e: Entity; kit: Kit; distance: number } | null = null;
    for (const e of free) {
      if (drafted.has(e) || spokenFor(world, e) || !canAttachToVehicle(world, ctx, e, vehicle)) continue;
      const node = anchorNodeOf(world, e);
      if (node === null) continue;
      let kit = kits.get(e);
      if (kit === undefined) {
        kit = kitOf(world, ctx, e);
        kits.set(e, kit);
      }
      const distance = hexDistance(node, at);
      if (best !== null && !barerOrNearer(kit, distance, best)) continue;
      best = { e, kit, distance };
    }
    if (best === null) continue;
    drafted.add(best.e);
    commands.push({ kind: 'attachToVehicle', entity: best.e, vehicle });
  }
  return { commands, drafted };
}

function barerOrNearer(kit: Kit, distance: number, best: { kit: Kit; distance: number }): boolean {
  if (kit.arms !== best.kit.arms) return kit.arms < best.kit.arms;
  if (kit.trinkets !== best.kit.trinkets) return kit.trinkets < best.kit.trinkets;
  return distance < best.distance;
}

/** The doors catapults park around: the barracks first, then each standing tower a garrison mans. */
function parkAnchors(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
): HalfCellNode[] {
  const doors: HalfCellNode[] = [];
  const add = (building: Entity): void => {
    const door = interactionCell(world, ctx, terrain, building);
    doors.push({ hx: terrain.xOf(door), hy: terrain.yOf(door) });
  };
  const barracks = seatBarracksOf(world, ctx, player);
  if (barracks !== null) add(barracks);
  for (const e of owned) {
    if (isBuilt(world, e) && garrisonSlots(world, ctx, e).size > 0) add(e);
  }
  return doors;
}

function manhattanOf(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

/** Whether `node` lies in the park band of some door and off the approach of every door. */
function inParkBand(node: HalfCellNode, doors: readonly HalfCellNode[]): boolean {
  let near = false;
  for (const door of doors) {
    const distance = manhattanOf(node, door);
    if (distance < PARK_RING_MIN_NODES) return false;
    if (distance <= PARK_RING_MAX_NODES) near = true;
  }
  return near;
}

function spacedFrom(node: HalfCellNode, taken: readonly HalfCellNode[]): boolean {
  return taken.every((other) => manhattanOf(node, other) >= PARK_SPACING_NODES);
}

/**
 * Send each idle crewed catapult standing beyond its own scan ({@link VEHICLE_SCAN_RADIUS_POINTS}) of the
 * `raider` at him on an attack-move, in hops past {@link CATAPULT_REACH_NODES}; one within its scan
 * answers him on its own. The raid is at the settlement's buildings, which bounds the drive, and
 * {@link parkingOrders} brings it home once the raid is over.
 */
function raidOrders(
  world: World,
  terrain: TerrainGraph,
  crewed: readonly CrewedCatapult[],
  raider: Raider,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const goal = { hx: raider.x, hy: raider.y };
  for (const { vehicle } of crewed) {
    const state = world.get(vehicle, Vehicle);
    const at = vehicleAnchor(world, vehicle);
    if (at === null || state.attack !== null || state.march !== null || state.heldGoal !== null) continue;
    if (world.has(vehicle, VehicleDrive) || continentOf(terrain, at) !== raider.component) continue;
    if (hexDistance(at, goal) <= VEHICLE_SCAN_RADIUS_POINTS) continue;
    const hop = hexDistance(at, goal) > VEHICLE_HOP_NODES ? towardNode(at, goal, VEHICLE_HOP_NODES) : goal;
    if (state.stance !== 'attack') commands.push({ kind: 'setVehicleStance', vehicle, stance: 'attack' });
    commands.push({ kind: 'moveVehicle', vehicle, x: hop.hx, y: hop.hy, attackMove: true });
  }
  return commands;
}

function continentOf(terrain: TerrainGraph, at: HalfCellNode): number {
  return terrain.componentOf(terrain.nodeAtClamped(at.hx, at.hy));
}

/**
 * Park the idle crewed catapults on the attack stance, one spot each in the band around a barracks or
 * tower door ({@link PARK_RING_MIN_NODES}..{@link PARK_RING_MAX_NODES}), {@link PARK_SPACING_NODES} apart.
 * A catapult already driving keeps its goal and one fighting is left to it; one standing in the band clear
 * of the others stays, so a parked catapult is never ordered again. The rest drive to the nearest free
 * spot around the door with the fewest catapults, or a hop toward the nearest door beyond its reach.
 * Once no raid stands (`raid` false), a catapult still on an attack-move, sent at a raid or come home from
 * a wave, is parked too.
 */
export function parkingOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  crewed: readonly CrewedCatapult[],
  raid = false,
): { commands: PlayerCommand[]; parkedDrivers: Entity[] } {
  const commands: PlayerCommand[] = [];
  const parkedDrivers: Entity[] = [];
  if (crewed.length === 0) return { commands, parkedDrivers };
  const doors = parkAnchors(world, ctx, terrain, player, owned);
  const taken: HalfCellNode[] = [];
  const standing: { crew: CrewedCatapult; at: HalfCellNode }[] = [];
  const unparkedHome: { crew: CrewedCatapult; at: HalfCellNode }[] = [];
  for (const crew of crewed) {
    const state = world.get(crew.vehicle, Vehicle);
    if (state.stance !== 'attack') {
      commands.push({ kind: 'setVehicleStance', vehicle: crew.vehicle, stance: 'attack' });
    }
    const at = vehicleAnchor(world, crew.vehicle);
    const homing = !raid && state.march !== null && state.attack === null;
    const goal = world.tryGet(crew.vehicle, VehicleDrive)?.goal ?? state.heldGoal;
    if (goal !== null && !homing) {
      taken.push(goal);
      continue;
    }
    if (state.attack !== null || (state.march !== null && !homing) || at === null) continue;
    if (homing) unparkedHome.push({ crew, at });
    else standing.push({ crew, at });
  }
  if (doors.length === 0) return { commands, parkedDrivers };
  const unparked = [...unparkedHome];
  for (const entry of standing) {
    if (!inParkBand(entry.at, doors) || !spacedFrom(entry.at, taken)) {
      unparked.push(entry);
      continue;
    }
    taken.push(entry.at);
    const seat = vehiclePassengers(world.get(entry.crew.vehicle, Vehicle)).find(
      (s) => s.entity === entry.crew.driver,
    );
    if (seat?.inside === true) parkedDrivers.push(entry.crew.driver);
  }
  for (const { crew, at } of unparked) {
    const goal = parkGoal(world, ctx, terrain, crew.vehicle, at, doors, taken);
    if (goal === null) continue;
    taken.push(goal);
    commands.push({ kind: 'moveVehicle', vehicle: crew.vehicle, x: goal.hx, y: goal.hy });
  }
  return { commands, parkedDrivers };
}

/**
 * Where `vehicle`, standing on `at`, drives to park: the free spot nearest it in the band of the door
 * with the fewest catapults already parked or bound there, the earlier door on a tie; a spot must stand
 * open to the vehicle, on its continent, within its reach and clear of every `taken` spot. With every
 * door beyond that reach, a hop toward the nearest one on its continent; null when nothing fits.
 */
function parkGoal(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  at: HalfCellNode,
  doors: readonly HalfCellNode[],
  taken: readonly HalfCellNode[],
): HalfCellNode | null {
  const type = contentIndex(ctx.content).vehicles.get(world.get(vehicle, Vehicle).vehicleType);
  if (type === undefined || !terrain.inBounds(at.hx, at.hy)) return null;
  const blocks = vehicleRestBlocks(world, ctx, terrain, vehicle, type);
  const continent = terrain.componentOf(terrain.nodeAt(at.hx, at.hy));
  const onContinent = (door: HalfCellNode): boolean =>
    terrain.inBounds(door.hx, door.hy) && terrain.componentOf(terrain.nodeAt(door.hx, door.hy)) === continent;
  const accept = (x: number, y: number): boolean => {
    if (!terrain.inBounds(x, y) || hexDistanceBetween(at.hx, at.hy, x, y) > CATAPULT_REACH_NODES)
      return false;
    const node = terrain.nodeAt(x, y);
    if (terrain.componentOf(node) !== continent || blocks.has(node)) return false;
    const spot = { hx: x, hy: y };
    return inParkBand(spot, doors) && spacedFrom(spot, taken);
  };
  const load = (door: HalfCellNode): number =>
    taken.filter((spot) => manhattanOf(spot, door) <= PARK_RING_MAX_NODES).length;
  const byLoad = doors
    .map((door, rank) => ({ door, rank, load: load(door) }))
    .filter(({ door }) => onContinent(door))
    .sort((a, b) => a.load - b.load || a.rank - b.rank);
  for (const { door } of byLoad) {
    const spot = nearestRingNode(door.hx, door.hy, PARK_RING_MIN_NODES, PARK_RING_MAX_NODES, at, accept);
    if (spot !== null) return spot;
  }
  let nearest: HalfCellNode | null = null;
  for (const { door } of byLoad) {
    if (nearest === null || manhattanOf(at, door) < manhattanOf(at, nearest)) nearest = door;
  }
  if (nearest === null || hexDistance(at, nearest) <= CATAPULT_REACH_NODES) return null;
  return towardNode(at, nearest, VEHICLE_HOP_NODES);
}
