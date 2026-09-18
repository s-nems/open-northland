import type { VehicleType } from '@open-northland/data';
import {
  CurrentAtomic,
  commanderSlotOf,
  DraughtAnimal,
  FarmAnimal,
  Frightened,
  Health,
  Livestock,
  ownerOf,
  Position,
  Resting,
  Settler,
  StayPoint,
  Vehicle,
  type VehicleSeat,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistance } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { removeSettlerSilently } from '../lifecycle/death.js';
import { isTravelling, redirectRoute } from '../movement/nav-state.js';
import { awaitsDraughtAnimal } from '../readviews/vehicles.js';
import { canonicalById, entityNode } from '../spatial/nodes.js';
import { boardingNode } from './crew.js';
import { nodeOf } from './movement.js';

// The draught animal of docs/formats/VEHICLES.md "Lifecycle": a cart whose type names a
// `draggingAnimalTribe` waits under task 4 and recruits the animal itself from its owner's herd on the
// door's continent, skipping the first two eligible animals (a breeding pair) and taking the nearest;
// the animal walks over, is consumed at the door, and the cart becomes its `transformVehicleType`.

/** How often a waiting cart scans the herd for a recruit, in ticks. Approximation: the original's
 *  scan cadence is not read; the walk to the door is the long part. */
export const DRAUGHT_RECRUIT_CADENCE_TICKS = 20;

/** The eligible animals a recruit scan passes over, in ascending entity id, so a herd keeps a breeding
 *  pair (byte-verified count; approximation: the original's list order is not read). */
export const DRAUGHT_BREEDING_PAIR = 2;

/**
 * The owner's animal of `tribe` the cart takes: alive on the map, not inside a farm, booked by no visit
 * or other cart, not scattering, and on the door's continent; the first {@link DRAUGHT_BREEDING_PAIR}
 * such animals by id are passed over and the nearest of the rest by hexagon distance wins, ties to the
 * lower id. The scan walks the livestock store, since only a catchable species is ever owned. Null for
 * an unowned cart.
 */
export function pickDraughtAnimal(
  world: World,
  terrain: TerrainGraph,
  vehicle: Entity,
  tribe: number,
  door: NodeId,
): Entity | null {
  const owner = ownerOf(world, vehicle);
  if (owner === undefined) return null;
  const continent = terrain.componentOf(door);
  const doorPoint = nodeOf(terrain, door);
  let passed = 0;
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of canonicalById(world.query(Livestock, Settler, Position))) {
    if (world.get(e, Settler).tribe !== tribe || ownerOf(world, e) !== owner) continue;
    if (world.has(e, DraughtAnimal) || world.tryGet(e, FarmAnimal)?.summoner != null) continue;
    if (world.has(e, Resting)) continue;
    if (world.has(e, Frightened)) continue;
    const node = entityNode(world, terrain, e);
    if (terrain.componentOf(node) !== continent) continue;
    if (passed < DRAUGHT_BREEDING_PAIR) {
      passed += 1;
      continue;
    }
    const distance = hexDistance(nodeOf(terrain, node), doorPoint);
    if (distance < bestDistance) {
      best = e;
      bestDistance = distance;
    }
  }
  return best;
}

/** The seats of a transformed vehicle: the old ones kept in slot order, with the commander moved to the
 *  new last slot where the list has one, and anything beyond the new capacity dropped (empty on every
 *  shipped transform, whose source type admits no crew). */
function reseat(
  seats: readonly (VehicleSeat | null)[],
  capacity: number,
  withCommander: boolean,
): (VehicleSeat | null)[] {
  const next = new Array<VehicleSeat | null>(capacity).fill(null);
  const commander = withCommander ? commanderSlotOf(seats.length - 1) : -1;
  for (let slot = 0; slot < seats.length; slot++) {
    const seat = seats[slot];
    if (seat === null || seat === undefined) continue;
    const target = slot === commander ? commanderSlotOf(capacity - 1) : slot;
    if (target >= 0 && target < capacity) next[target] = seat;
  }
  return next;
}

/**
 * The animal arrived: it is consumed and the cart is harnessed, taking its type's `transformVehicleType`
 * in place with that type's seats and hit-point pool (the pool keeps its current points, clamped;
 * approximation: the original's transform is not read beyond the type change). A type with no
 * transform keeps its own.
 */
export function harnessVehicle(world: World, ctx: SystemContext, vehicle: Entity, animal: Entity): void {
  removeSettlerSilently(world, animal);
  const types = contentIndex(ctx.content).vehicles;
  const state = world.get(vehicle, Vehicle);
  const type = types.get(state.vehicleType);
  const next = type?.transformVehicleType === undefined ? undefined : types.get(type.transformVehicleType);
  const live = world.mut(vehicle, Vehicle);
  live.harnessed = true;
  live.task = 'none';
  if (next === undefined || next.typeId === live.vehicleType) return;
  live.vehicleType = next.typeId;
  live.passengers = reseat(live.passengers, commanderSlotOf(next.passengerSlots) + 1, true);
  live.vehicles = reseat(live.vehicles, next.vehicleSlots, false);
  const health = world.tryGet(vehicle, Health);
  if (health !== undefined && health.max !== next.hitpoints) {
    const pool = world.mut(vehicle, Health);
    pool.max = next.hitpoints;
    pool.hitpoints = Math.min(pool.hitpoints, pool.max);
  }
}

/** A recruit whose cart is gone or harnessed by another goes back to its grazing spot. */
function releaseDraughtAnimal(world: World, animal: Entity): void {
  world.remove(animal, DraughtAnimal);
  const stay = world.tryGet(animal, StayPoint);
  if (stay !== undefined && world.has(animal, Position)) redirectRoute(world, animal, stay.cell);
}

/** Send a recruit to the cart's boarding node, over any graze leg; a running action finishes first. */
function aimAtDoor(world: World, animal: Entity, door: NodeId): void {
  if (!world.has(animal, CurrentAtomic)) redirectRoute(world, animal, door);
}

/** Re-aim a recruit that stopped short of the boarding node, unless a walk, a scare or a farm it is
 *  inside holds it. */
function escort(world: World, terrain: TerrainGraph, animal: Entity, door: NodeId): void {
  if (isTravelling(world, animal) || world.has(animal, Frightened) || world.has(animal, Resting)) return;
  if (entityNode(world, terrain, animal) !== door) aimAtDoor(world, animal, door);
}

function draughtTribeOf(
  ctx: SystemContext,
  state: { vehicleType: number; harnessed: boolean },
): number | null {
  const type: VehicleType | undefined = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  return type !== undefined && awaitsDraughtAnimal(type, state) ? (type.draggingAnimalTribe ?? null) : null;
}

/**
 * Drive every cart that waits for its animal: a recruit on its way is kept aimed at the cart's boarding
 * node (the door beside the cart, or the nearest open node when another blocker covers it, the riders'
 * approximation) and consumed on arrival; a cart with none scans the herd every
 * {@link DRAUGHT_RECRUIT_CADENCE_TICKS}. A recruit whose cart vanished is released. A cart riding a
 * carrier recruits nothing until it is set down.
 */
export const draughtAnimalSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const recruits = new Map<Entity, Entity>();
  for (const animal of canonicalById(world.query(DraughtAnimal))) {
    const vehicle = world.get(animal, DraughtAnimal).vehicle;
    const state = world.tryGet(vehicle, Vehicle);
    if (
      state === undefined ||
      draughtTribeOf(ctx, state) === null ||
      !world.has(vehicle, Position) ||
      recruits.has(vehicle) // a second recruit for one cart: only a hand-made fixture books two
    ) {
      releaseDraughtAnimal(world, animal);
      continue;
    }
    recruits.set(vehicle, animal);
  }
  const scanDue = ctx.tick % DRAUGHT_RECRUIT_CADENCE_TICKS === 0;
  for (const e of canonicalById(world.query(Vehicle, Position))) {
    const state = world.get(e, Vehicle);
    const tribe = draughtTribeOf(ctx, state);
    if (tribe === null || state.carrier !== null) continue;
    if (state.task !== 'waitsForAnimal') world.mut(e, Vehicle).task = 'waitsForAnimal';
    const recruit = recruits.get(e);
    if (recruit === undefined && !scanDue) continue; // the boarding-node search is the costly part
    const door = boardingNode(world, ctx, terrain, e);
    if (door === null) continue;
    if (recruit !== undefined) {
      if (world.has(recruit, Position) && entityNode(world, terrain, recruit) === door) {
        harnessVehicle(world, ctx, e, recruit);
      } else escort(world, terrain, recruit, door);
      continue;
    }
    const pick = pickDraughtAnimal(world, terrain, e, tribe, door);
    if (pick === null) continue;
    world.add(pick, DraughtAnimal, { vehicle: e });
    aimAtDoor(world, pick, door);
  }
};
