import type { ContentSet, VehicleType } from '@open-northland/data';
import {
  Building,
  CARRY_CAPACITY,
  Carrying,
  fillCommanderSeat,
  HaulingCart,
  type HaulingLift,
  JobAssignment,
  ownerOf,
  Position,
  Rider,
  Settler,
  TradeShip,
  Vehicle,
  VehicleStock,
  vehicleLoad,
  vehiclePassengers,
  vehicleStockEntries,
  WalkFacing,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import {
  type HalfCellNode,
  HEX_DIRECTIONS,
  type HexDirection,
  type HexHeading,
  hexagonRing,
  hexDistance,
  nodeOfPosition,
  stepHex,
} from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../context.js';
import {
  buildingDoorwayNodes,
  dynamicBlockOverlay,
  vehicleAnchor,
  vehicleBlockedCells,
  vehicleDoorNode,
} from '../footprint/index.js';
import { hexHeadingOfWalk, walkOfHexHeading } from '../movement/turning.js';
import { groupPlacementOrder } from '../orders/group-placement.js';
import { sendUnit } from '../orders/movement.js';
import { isCarrierJobRow, isTrader } from '../readviews/jobs.js';
import { addCarry, shrinkCarry } from '../settlers/atomics/effects/goods/carry.js';
import { pickupFromStore, pileupIntoStore } from '../settlers/atomics/effects/goods/transfer.js';
import { carriedGoodForm } from '../settlers/drives/economy/delivery-targets.js';
import { abandonCargoRun } from './cargo.js';
import {
  attachToVehicle,
  canAttachToVehicle,
  doorReachable,
  passengerJobAllowed,
  placeOnNode,
} from './crew.js';
import { cartLiftTicks, cartSpeedLossPercent, isAnimalDrawnType, isCartType } from './drag.js';
import { endDrive, isOpenLand } from './movement.js';
import { tradeVehicleStock, vehicleLineCap, vehicleStockGood } from './stock.js';

// A hauling cart (`HaulingCart` in `components/vehicle.ts`), the work tool of a posted carrier or a
// trader: the take, the lifts with the standing cart, the park for a break, the room it lends and the
// set-down. The planner's `planHaulingCart` rung walks the puller to the cart and runs a carrier's lifts;
// a trader's route work stands and takes the cart up itself (`trade/drive.ts`).

/**
 * Whether a unit moving between a standing hauling cart and `at` goes through the puller's hands, a trip
 * each: lifted at the cart, carried to the door and handed over inside, or the other way round. Original
 * behavior for a house. A ground pile has no door: the cart stands beside it and a unit moves in one
 * lift (named addition).
 */
export function carriesBetweenCartAndDoor(world: World, at: Entity): boolean {
  return world.has(at, Building);
}

/** A carrier posted to a workplace: the trade and the post that a hauling cart serves. */
export function isPostedCarrier(world: World, content: ContentSet, settler: Entity): boolean {
  const jobType = world.tryGet(settler, Settler)?.jobType;
  if (jobType === undefined || jobType === null) return false;
  const job = contentIndex(content).jobs.get(jobType);
  return job !== undefined && isCarrierJobRow(job) && world.has(settler, JobAssignment);
}

/** Whether `settler` works with a hauling cart as its tool: a posted carrier or a trader. */
export function worksWithHaulingCart(world: World, content: ContentSet, settler: Entity): boolean {
  return isPostedCarrier(world, content, settler) || isTrader(world, content, settler);
}

/** Whether `settler` lifts with its hauling cart: the cart in hand, or standing beside it for a lift. A
 *  cart parked for a break is neither; the carrier takes it up before its next lift. */
export function liftsWithHaulingCart(world: World, settler: Entity): boolean {
  const held = world.tryGet(settler, HaulingCart);
  return held !== undefined && (held.taken || held.lift !== null);
}

/** Whether `settler` has its hauling cart in hand right now, off the map and travelling with it. */
export function pullsHaulingCart(world: World, settler: Entity): boolean {
  return world.tryGet(settler, HaulingCart)?.taken === true;
}

/**
 * Whether the attach order would hand `vehicle` to `settler` as its hauling cart rather than seat it as
 * crew: a posted carrier or a trader (owner's choice: the original's trader commands its cart), and an own cart its trade may ride that nobody else pulls, commands, rides or
 * carries, standing on the map with its door on the settler's continent. The ring's "Assign Vehicle" pick
 * lights carts by it beside the crew gate.
 */
export function canTakeHaulingCart(world: World, ctx: MapContext, settler: Entity, vehicle: Entity): boolean {
  if (!worksWithHaulingCart(world, ctx.content, settler) || world.has(settler, Rider)) return false;
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined || ownerOf(world, vehicle) !== ownerOf(world, settler)) return false;
  if (world.tryGet(settler, HaulingCart)?.vehicle === vehicle) return true;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined || !isCartType(type)) return false;
  if (!passengerJobAllowed(type, world.get(settler, Settler).jobType)) return false;
  if (state.hauler !== null || state.carrier !== null || vehiclePassengers(state).length > 0) return false;
  return world.has(vehicle, Position) && doorReachable(world, ctx, settler, vehicle);
}

/** The attach order: a posted carrier or a trader takes a free cart as its hauling cart, anyone else crews
 *  the vehicle.
 *  A seated crew member gives up its post, and its hauling cart with it (`releaseEmployment`). */
export function orderAttachToVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'attachToVehicle' }>,
): void {
  if (canTakeHaulingCart(world, ctx, command.entity, command.vehicle)) {
    orderHaulingCart(world, ctx, command.entity, command.vehicle);
  } else {
    attachToVehicle(world, ctx, command);
  }
}

/** Crew one vehicle from a group - see the command doc and {@link groupPlacementOrder}. A member the
 *  vehicle no longer admits, a full vehicle's surplus above all, stays as it was. */
export function attachToVehicleGroup(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'attachToVehicleGroup' }>,
): void {
  const vehicle = command.vehicle;
  if (!world.has(vehicle, Vehicle)) return;
  const door = vehicleDoorNode(world, ctx, vehicle);
  const vehicleOf = (e: Entity): Entity | undefined =>
    world.tryGet(e, Rider)?.vehicle ?? world.tryGet(e, HaulingCart)?.vehicle;
  const at = door === null ? null : { x: door.hx, y: door.hy };
  for (const { entity } of groupPlacementOrder(world, command.members, vehicle, at, vehicleOf)) {
    if (!canAttachToVehicle(world, ctx, entity, vehicle) && !canTakeHaulingCart(world, ctx, entity, vehicle))
      continue;
    orderAttachToVehicle(world, ctx, { kind: 'attachToVehicle', entity, vehicle });
  }
}

/**
 * The attach order's hauling-cart half: `settler` keeps its post and walks to the cart's door to take it
 * there; a cart it already pulls is set down first. A trader is left to the planner's hauling-cart rung
 * for the walk, since the walk order would set down a route unit it carries. The caller has passed
 * {@link canTakeHaulingCart}.
 */
export function orderHaulingCart(world: World, ctx: SystemContext, settler: Entity, vehicle: Entity): void {
  if (world.tryGet(settler, HaulingCart)?.vehicle === vehicle) return;
  releaseHaulingCart(world, ctx, settler);
  world.add(settler, HaulingCart, { vehicle, taken: false, parked: false, lift: null });
  world.mut(vehicle, Vehicle).hauler = settler;
  if (isTrader(world, ctx.content, settler)) return;
  const door = vehicleDoorNode(world, ctx, vehicle);
  if (door !== null) sendUnit(world, ctx, settler, door.hx, door.hy);
}

/**
 * The puller standing at the door takes the cart: it leaves the map and travels with the puller. A
 * carrier's hold, the lift's or a parked load, goes into its hands to deliver; the hands hold one good,
 * so a second good aboard stays aboard and takes up that much room. A trader's goods stay in the hold,
 * and a route unit in its hands goes in beside them.
 */
export function takeHaulingCart(world: World, content: ContentSet, settler: Entity): void {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined || held.taken || world.tryGet(held.vehicle, Vehicle)?.carrier !== null) return;
  endDrive(world, held.vehicle);
  world.remove(held.vehicle, Position);
  const live = world.mut(held.vehicle, Vehicle);
  if (live.task !== 'none') live.task = 'none';
  const mine = world.mut(settler, HaulingCart);
  mine.taken = true;
  mine.parked = false;
  mine.lift = null;
  if (isTrader(world, content, settler)) stowHands(world, content, settler, held.vehicle);
  else liftOutOfHold(world, content, settler, held.vehicle, Number.POSITIVE_INFINITY);
}

/** Up to `units` of `only`, or of the hold's first good, that the hands can take, out of the hold into
 *  the hands. */
function liftOutOfHold(
  world: World,
  content: ContentSet,
  settler: Entity,
  vehicle: Entity,
  units: number,
  only?: number,
): number {
  const stock = world.tryGet(vehicle, VehicleStock);
  if (stock === undefined) return 0;
  const inHand = world.tryGet(settler, Carrying)?.goodType;
  for (const [goodType, line] of vehicleStockEntries(stock)) {
    if (only !== undefined && only !== goodType) continue;
    if (line.current <= 0 || (inHand !== undefined && inHand !== goodType)) continue;
    const moved = -tradeVehicleStock(world, vehicle, content, goodType, -Math.min(units, line.current));
    if (moved > 0) addCarry(world, settler, goodType, moved);
    return moved;
  }
  return 0;
}

/**
 * The goods the carrier's hauling cart carries, ascending: the hold's lines, which hold the whole load
 * while the cart stands, and the good in its hands. Empty without a cart.
 */
export function haulingCartGoods(world: World, settler: Entity): number[] {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined) return [];
  const goods = new Set<number>();
  const stock = world.tryGet(held.vehicle, VehicleStock);
  if (stock !== undefined) {
    for (const [goodType, line] of vehicleStockEntries(stock)) if (line.current > 0) goods.add(goodType);
  }
  const load = world.tryGet(settler, Carrying);
  if (load !== undefined && load.amount > 0) goods.add(load.goodType);
  return [...goods].sort((a, b) => a - b);
}

/** Whether the carrier's hauling cart has a hold line for `goodType`; any other good rides in the hands,
 *  which hold one good, so a load of it is never mixed with another. */
export function haulingCartTakes(
  world: World,
  content: ContentSet,
  settler: Entity,
  goodType: number,
): boolean {
  const type = haulingCartType(world, content, settler);
  return type !== undefined && vehicleStockGood(content, type, goodType) !== null;
}

/** The good the carrier's hauling cart books `goodType` under, itself for a good its hold has no line
 *  for. */
export function haulingCartHoldGood(
  world: World,
  content: ContentSet,
  settler: Entity,
  goodType: number,
): number {
  const type = haulingCartType(world, content, settler);
  return (type === undefined ? null : vehicleStockGood(content, type, goodType)) ?? goodType;
}

/** The units of `goodType` the carrier's hauling cart carries, in the hold and in its hands. */
export function haulingCartUnits(world: World, settler: Entity, goodType: number): number {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined) return 0;
  const aboard = world.tryGet(held.vehicle, VehicleStock)?.lines.get(goodType)?.current ?? 0;
  const load = world.tryGet(settler, Carrying);
  return aboard + (load !== undefined && load.goodType === goodType ? load.amount : 0);
}

/**
 * With the cart in hand, change the good the carrier holds to `goodType` from the hold: the hands hold
 * one good, the one the delivery rung routes, and the rest of a mixed load rides aboard. False, the
 * hands as they were, when the hold will not take what they hold or has none of `goodType`.
 */
export function handHaulingCartGood(
  world: World,
  content: ContentSet,
  settler: Entity,
  goodType: number,
): boolean {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined || !held.taken) return false;
  if ((world.tryGet(held.vehicle, VehicleStock)?.lines.get(goodType)?.current ?? 0) <= 0) return false;
  stowHands(world, content, settler, held.vehicle);
  const left = world.tryGet(settler, Carrying);
  if (left !== undefined && left.amount > 0 && left.goodType !== goodType) return false;
  return liftOutOfHold(world, content, settler, held.vehicle, Number.POSITIVE_INFINITY, goodType) > 0;
}

/** What the carrier holds in its hands into the hold; a unit the hold refuses stays in hand. */
function stowHands(world: World, content: ContentSet, settler: Entity, vehicle: Entity): void {
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return;
  const moved = tradeVehicleStock(world, vehicle, content, load.goodType, load.amount);
  if (moved > 0) shrinkCarry(world, settler, load, moved);
}

/**
 * Whether `settler` may still pull the cart it holds: the cart stands, or rides the ship the settler
 * rides, names it back, belongs to the same player, and the settler is still a posted carrier or a trader
 * riding nothing but that ship. A hold that fails is set down by {@link releaseHaulingCart}.
 */
export function haulingCartHolds(world: World, content: ContentSet, settler: Entity): boolean {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined) return false;
  const state = world.tryGet(held.vehicle, Vehicle);
  if (state === undefined || state.hauler !== settler) return false;
  if (ownerOf(world, held.vehicle) !== ownerOf(world, settler)) return false;
  const rides = world.tryGet(settler, Rider)?.vehicle;
  if (state.carrier !== (rides ?? null)) return false;
  return worksWithHaulingCart(world, content, settler);
}

/** The trader sets its hauling cart into a free vehicle slot of `ship`, the hold keeping its goods; the
 *  cart stays its own, parked, and comes off with it when it lands (`landRider`). */
export function stowCartOnShip(world: World, settler: Entity, ship: Entity): void {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined) return;
  const slot = world.get(ship, Vehicle).vehicles.indexOf(null);
  if (slot < 0) return;
  endDrive(world, held.vehicle);
  world.remove(held.vehicle, Position);
  world.mut(ship, Vehicle).vehicles[slot] = { entity: held.vehicle, inside: true };
  const live = world.mut(held.vehicle, Vehicle);
  live.carrier = ship;
  if (live.task !== 'none') live.task = 'none';
  const mine = world.mut(settler, HaulingCart);
  mine.taken = false;
  mine.parked = true;
  mine.lift = null;
}

/**
 * Stand the cart beside the carrier for a lift: the carrier at a heap, a shelf or its stand short of a
 * store's door sets the cart down where it is ({@link setDownSpot}), its load stowed in the hold, and works units between the two a
 * unit each (the planner's hauling-cart rung) until the lift is done, then takes the cart up again.
 * Original behavior of the trader loading its cart, borrowed for the carrier (named addition).
 */
export function beginCartLift(world: World, ctx: MapContext, settler: Entity, lift: HaulingLift): void {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined) return;
  const mine = world.mut(settler, HaulingCart);
  if (held.taken) {
    mine.taken = false;
    mine.parked = true;
    standCartBeside(world, ctx, settler, held.vehicle);
  }
  mine.lift = lift;
}

/** The lift is over: the cart stays standing and the planner walks the carrier back to take it up. */
export function endCartLift(world: World, settler: Entity): void {
  const held = world.tryGet(settler, HaulingCart);
  if (held !== undefined && held.lift !== null) world.mut(settler, HaulingCart).lift = null;
}

/**
 * Whether the lift with the standing cart has another unit to move: a load while units remain to lift,
 * the source will part with one of the good (now, or on its next refill) and the cart has room, an unload
 * while the hold or the carrier's hands have a unit of its good and the store is there. The planner asks
 * before each clip; the effects below move the unit afterwards.
 */
export function cartLiftContinues(
  world: World,
  ctx: MapContext,
  settler: Entity,
  lift: HaulingLift,
  sourceSupplies: (from: Entity, goodType: number) => boolean,
): boolean {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined || held.taken || !world.has(held.vehicle, Position)) return false;
  if (lift.kind === 'load') {
    if (lift.units <= 0 || !world.isAlive(lift.from)) return false;
    if (haulingCartRoom(world, ctx.content, settler) <= 0) return false;
    return sourceSupplies(lift.from, lift.goodType);
  }
  if (lift.refused || !world.isAlive(lift.store)) return false;
  return haulingCartUnits(world, settler, lift.goodType) > 0;
}

/**
 * Resolve one completed `haulLoad`: one unit of `goodType` off `from` into the carrier's hands, the same
 * move a pick-up makes ({@link pickupFromStore}: the claim ends, a dish lands as its edible, the storage
 * minimum holds). Beside a ground pile the unit goes on into the standing cart's hold; from a house the
 * carrier walks it to the cart ({@link carriesBetweenCartAndDoor}). A unit the hold refuses stays in hand,
 * and hands still holding another good end the lift with nothing taken.
 */
export function loadHaulingCart(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  from: Entity,
  goodType: number,
): void {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined || held.taken) return;
  const kept = world.tryGet(settler, Carrying);
  if (kept !== undefined && kept.goodType !== carriedGoodForm(world, ctx, settler, goodType)) {
    endCartLift(world, settler);
    return;
  }
  const inHand = kept?.amount ?? 0;
  pickupFromStore(world, ctx, settler, from, goodType, 1);
  const lift = held.lift;
  if (lift?.kind === 'load' && (world.tryGet(settler, Carrying)?.amount ?? 0) > inHand) {
    world.mut(settler, HaulingCart).lift = { ...lift, units: lift.units - 1 };
  }
  if (!carriesBetweenCartAndDoor(world, from)) stowHands(world, ctx.content, settler, held.vehicle);
}

/**
 * Resolve one completed `haulUnload`: the unit of `goodType` in the carrier's hands, or one out of the
 * standing cart's hold beside a ground pile, onto `store`'s shelf, the same deposit a pile-up makes
 * ({@link pileupIntoStore}). A unit the store refuses marks the lift refused, so the planner ends it and
 * the carrier finds another store for the rest of that good; it goes back aboard beside a pile and stays
 * in hand at a house, whose cart stands a walk away. True when the unit landed.
 */
export function unloadHaulingCart(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  store: Entity,
  goodType: number,
): boolean {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined || held.taken) return false;
  const inHand = world.tryGet(settler, Carrying);
  const carried = inHand !== undefined && inHand.goodType === goodType && inHand.amount > 0;
  if (!carried && liftOutOfHold(world, ctx.content, settler, held.vehicle, 1, goodType) <= 0) {
    endCartLift(world, settler);
    return false;
  }
  if (pileupIntoStore(world, ctx, settler, store) > 0) return true;
  if (!carriesBetweenCartAndDoor(world, store)) stowHands(world, ctx.content, settler, held.vehicle);
  if (held.lift?.kind === 'unload') world.mut(settler, HaulingCart).lift = { ...held.lift, refused: true };
  return false;
}

/** Whether `settler` stands its hauling cart on the map, there to stow into or fetch out of. */
function standsHaulingCart(world: World, settler: Entity, vehicle: Entity): boolean {
  const held = world.tryGet(settler, HaulingCart);
  return held !== undefined && held.vehicle === vehicle && !held.taken && world.has(vehicle, Position);
}

/** Resolve one completed `cartStow`: what the puller's hands hold goes into its standing cart's hold; a
 *  unit the hold refuses stays in hand. */
export function stowIntoHaulingCart(
  world: World,
  content: ContentSet,
  settler: Entity,
  vehicle: Entity,
): void {
  if (standsHaulingCart(world, settler, vehicle)) stowHands(world, content, settler, vehicle);
}

/** Resolve one completed `cartFetch`: one unit of `goodType` out of the puller's standing cart into its
 *  hands; nothing moves with the hands holding another good or the line empty. */
export function fetchFromHaulingCart(
  world: World,
  content: ContentSet,
  settler: Entity,
  vehicle: Entity,
  goodType: number,
): void {
  if (standsHaulingCart(world, settler, vehicle))
    liftOutOfHold(world, content, settler, vehicle, 1, goodType);
}

/** Whether the puller's hands hold a load its standing cart's hold has a line for. */
export function handsStowInCart(world: World, content: ContentSet, settler: Entity): boolean {
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return false;
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined || held.taken || !world.has(held.vehicle, Position)) return false;
  return haulingCartTakes(world, content, settler, load.goodType);
}

/**
 * Park the cart: a puller leaving its work for a meal, a bed, a chat or a player's errand, or a trader
 * working a stop, stands the cart on the nearest open land where it is, its load stowed in the hold, and
 * keeps the cart as its own, so it walks back and takes it up again once the break is over (the planner's
 * hauling-cart rung) or the trader leaves the stop. A lift under way ends. Nothing happens with the cart
 * already standing. Named addition: the cart is a work tool, not a harness.
 */
export function parkHaulingCart(world: World, ctx: MapContext, settler: Entity): void {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined) return;
  if (held.lift !== null) world.mut(settler, HaulingCart).lift = null;
  if (!held.taken) return;
  const mine = world.mut(settler, HaulingCart);
  mine.taken = false;
  mine.parked = true;
  standCartBeside(world, ctx, settler, held.vehicle);
}

/** How far around the carrier the set-down looks for open land before using its own node. */
const SET_DOWN_RINGS = 3;

/** A taken cart stands again where the carrier is ({@link setDownSpot}), its
 *  hold taking what the carrier had on its hands; a unit the hold refuses stays in hand. */
function standCartBeside(world: World, ctx: MapContext, settler: Entity, vehicle: Entity): void {
  if (world.has(vehicle, Position)) return;
  const spot = setDownSpot(world, ctx, settler);
  if (spot !== null) {
    standCartOn(world, vehicle, spot.at);
    if (spot.front !== null) world.mut(vehicle, Vehicle).facing = walkOfHexHeading(spot.front);
  }
  stowHands(world, ctx.content, settler, vehicle);
}

/** Stand a cart in hand on `point`. The write to its record is what tells the caches keyed on vehicle
 *  writes, such as the cells standing vehicles cover, that it stands again. */
function standCartOn(world: World, vehicle: Entity, point: HalfCellNode): void {
  placeOnNode(world, vehicle, point);
  world.mut(vehicle, Vehicle);
}

/**
 * Set a hauling cart down for good: the carrier's link and the cart's go, and a cart in hand stands again
 * beside the carrier as {@link parkHaulingCart} stands it. A carrier still walking to the cart leaves it
 * standing where it is. Nothing happens without a cart.
 */
export function releaseHaulingCart(world: World, ctx: MapContext, settler: Entity): void {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined) return;
  world.remove(settler, HaulingCart);
  const vehicle = held.vehicle;
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined) return;
  if (state.hauler === settler) world.mut(vehicle, Vehicle).hauler = null;
  if (held.taken) standCartBeside(world, ctx, settler, vehicle);
}

/** Where a cart set down stands and the heading its front faces, null to keep the one it has. */
type SetDownSpot = { readonly at: HalfCellNode; readonly front: HexHeading | null };

/** Which nodes a cart may be stood on: `free` is open land outside every doorway that no standing cart
 *  covers, `apart` a node with no standing cart beside it, since a cart's art is wider than a node and
 *  neighbours would draw as one. */
type CartStandTest = {
  readonly open: (point: HalfCellNode) => boolean;
  readonly free: (point: HalfCellNode) => boolean;
  readonly apart: (point: HalfCellNode) => boolean;
};

function cartStandTest(world: World, ctx: MapContext, terrain: TerrainGraph): CartStandTest {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const carts = vehicleBlockedCells(world, ctx, terrain);
  const doorways = buildingDoorwayNodes(world, ctx, terrain);
  const open = (point: HalfCellNode): boolean => isOpenLand(terrain, blocked, point);
  return {
    open,
    free: (point) => {
      if (!open(point)) return false;
      const node = terrain.nodeAt(point.hx, point.hy);
      return !carts.has(node) && !doorways.has(node);
    },
    apart: (point) =>
      HEX_DIRECTIONS.every((direction) => {
        const beside = stepHex(point, direction);
        return !terrain.inBounds(beside.hx, beside.hy) || !carts.has(terrain.nodeAt(beside.hx, beside.hy));
      }),
  };
}

/**
 * Where a taken cart is set down, its front the way the carrier faces: the carrier's own node, where the
 * cart it pulls already draws. Where that node is a doorway or another cart stands on or beside it, the
 * nearest ring node clear of both, so carts at one door stand apart and the later ones further out. With
 * no such spot the first open land node, else the carrier's own node (as a carried cart lands on a door);
 * null off the map.
 */
function setDownSpot(world: World, ctx: MapContext, settler: Entity): SetDownSpot | null {
  const pos = world.tryGet(settler, Position);
  if (pos === undefined) return null;
  const own = nodeOfPosition(pos.x, pos.y);
  const terrain = ctx.terrain;
  if (terrain === undefined) return { at: own, front: null };
  const facing = world.tryGet(settler, WalkFacing);
  const front = facing === undefined ? null : hexHeadingOfWalk(facing.direction);
  const { open, free, apart } = cartStandTest(world, ctx, terrain);
  if (free(own) && apart(own)) return { at: own, front };
  let fallback: HalfCellNode | null = null;
  for (let radius = 1; radius <= SET_DOWN_RINGS; radius++) {
    for (const { point } of hexagonRing(own, radius)) {
      if (fallback === null && open(point)) fallback = point;
      if (free(point) && apart(point)) return { at: point, front };
    }
  }
  return { at: fallback ?? own, front };
}

/** The nearest and farthest ring around a house's door a cart bound for it is stood on: beside the
 *  door for the first carts and further out for the later ones, never on it, so the puller stops, lets
 *  go of the cart and walks the rest. */
const CART_STAND_NEAREST_RING = 1;
const CART_STAND_FARTHEST_RING = 4;

/**
 * The node a puller bound for the house door `door` stands its cart on: a node of the rings around the
 * door a cart may stand on ({@link cartStandTest}), on the puller's continent and not `vetoed`: of the
 * nearest ring that has one, the node nearest `from`, the first in ring order on a tie. Null with none.
 */
export function cartStandNear(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  door: NodeId,
  from: NodeId,
  vetoed?: (node: NodeId) => boolean,
): NodeId | null {
  const { free, apart } = cartStandTest(world, ctx, terrain);
  const centre = { hx: terrain.xOf(door), hy: terrain.yOf(door) };
  const origin = { hx: terrain.xOf(from), hy: terrain.yOf(from) };
  const continent = terrain.componentOf(from);
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let radius = CART_STAND_NEAREST_RING; radius <= CART_STAND_FARTHEST_RING; radius++) {
    for (const { point } of hexagonRing(centre, radius)) {
      const distance = hexDistance(point, origin);
      if (distance >= bestDistance || !free(point) || !apart(point)) continue;
      const node = terrain.nodeAt(point.hx, point.hy);
      if (terrain.componentOf(node) !== continent || (node !== from && vetoed?.(node) === true)) continue;
      best = node;
      bestDistance = distance;
    }
    if (best !== null) return best;
  }
  return null;
}

/** The side of a standing cart its puller works it from, below and right of it whichever way the cart
 *  faces (owner's choice, by how the lift reads against the cart's art). */
const CART_WORK_SIDE: HexDirection = 'southEast';

/**
 * The node a puller works its standing cart from: the one on the cart's work side, where that is open
 * ground. With that node closed a handcart is worked from its own node; null for an animal-drawn cart
 * then, or one off the map, and the caller falls back to the cart's door.
 */
export function cartWorkNode(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  vehicle: Entity,
): NodeId | null {
  const state = world.tryGet(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  if (state === undefined || anchor === null || !terrain.inBounds(anchor.hx, anchor.hy)) return null;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return null;
  const drawn = isAnimalDrawnType(ctx.content, type);
  const stand = stepHex(anchor, CART_WORK_SIDE);
  if (!isOpenLand(terrain, dynamicBlockOverlay(world, ctx, terrain), stand)) {
    return drawn ? null : terrain.nodeAt(anchor.hx, anchor.hy);
  }
  return terrain.nodeAt(stand.hx, stand.hy);
}

/**
 * The set-down of a carrier leaving the world without a map context (a script's removal, a match's
 * teardown): a taken cart stands again on the carrier's own node, its hold taking nothing, since what the
 * carrier had in hand goes with it the way the caller settles the rest of its goods.
 */
export function abandonHaulingCart(world: World, settler: Entity): void {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined) return;
  world.remove(settler, HaulingCart);
  const state = world.tryGet(held.vehicle, Vehicle);
  if (state === undefined) return;
  if (state.hauler === settler) world.mut(held.vehicle, Vehicle).hauler = null;
  if (!held.taken || world.has(held.vehicle, Position)) return;
  const pos = world.tryGet(settler, Position);
  if (pos !== undefined) standCartOn(world, held.vehicle, nodeOfPosition(pos.x, pos.y));
}

/**
 * The player commands that set a carrier's hauling cart down for good first: the ones that end or change
 * its post or take it off on another errand. A walk, a need, a home, a marriage or an equipment order
 * keeps the cart as the carrier's own; the break parks it. Named addition.
 */
export function releasesHaulingCart(command: Command): command is Command & { entity: Entity } {
  switch (command.kind) {
    case 'assignBuilder':
    case 'trainSoldier':
    case 'learn':
    case 'explore':
    case 'placeSignpost':
    case 'claimAnimal':
    case 'openChest':
      return true;
    default:
      return false;
  }
}

/** A vehicle leaving the map frees the carrier pulling it or the trader it is pinned to; what the carrier
 *  has in hand stays there. */
export function dropHauler(world: World, vehicle: Entity): void {
  const hauler = world.tryGet(vehicle, Vehicle)?.hauler;
  if (hauler === undefined || hauler === null) return;
  if (world.tryGet(hauler, HaulingCart)?.vehicle === vehicle) world.remove(hauler, HaulingCart);
  if (world.tryGet(hauler, TradeShip)?.vehicle === vehicle) world.remove(hauler, TradeShip);
}

/**
 * Drop the trader's pin, the ship free for anyone again, its hold as it stands. A trader aboard stays a
 * plain commander, and its carried cart a plain carried vehicle; with the trader ashore or gone the first
 * helper takes the commander's slot, and every helper's run ends while the pin still stands, since a run
 * on a pinned ship holds no booking to give back. Nothing happens without a pin.
 */
export function releaseTradeShip(world: World, trader: Entity): void {
  const ship = world.tryGet(trader, TradeShip)?.vehicle;
  if (ship === undefined) return;
  const state = world.tryGet(ship, Vehicle);
  if (state !== undefined) {
    for (const seat of vehiclePassengers(state)) abandonCargoRun(world, seat.entity);
  }
  world.remove(trader, TradeShip);
  if (state?.hauler === trader) {
    world.mut(ship, Vehicle).hauler = null;
    fillCommanderSeat(world, ship);
  }
  const cart = world.tryGet(trader, HaulingCart)?.vehicle;
  if (cart !== undefined && world.tryGet(cart, Vehicle)?.carrier === ship) abandonHaulingCart(world, trader);
}

/** The hauling cart's type, or undefined for a carrier without one. */
function haulingCartType(world: World, content: ContentSet, settler: Entity): VehicleType | undefined {
  const held = world.tryGet(settler, HaulingCart);
  if (held === undefined) return undefined;
  const state = world.tryGet(held.vehicle, Vehicle);
  return state === undefined ? undefined : contentIndex(content).vehicles.get(state.vehicleType);
}

/**
 * The units the carrier's hauling cart still takes: its hold's cap less what is aboard and what the
 * carrier holds in hand, which is the cart's load while the cart is in hand and is stowed when it stands.
 * Zero for a carrier without a cart.
 */
export function haulingCartRoom(world: World, content: ContentSet, settler: Entity): number {
  const held = world.tryGet(settler, HaulingCart);
  const type = haulingCartType(world, content, settler);
  if (held === undefined || type === undefined) return 0;
  const stock = world.tryGet(held.vehicle, VehicleStock);
  const aboard = stock === undefined ? 0 : vehicleLoad(stock);
  const inHand = world.tryGet(settler, Carrying)?.amount ?? 0;
  return Math.max(0, vehicleLineCap(type) - aboard - inHand);
}

/**
 * The most units `settler` lifts in one trip: its hands ({@link CARRY_CAPACITY}) on foot, else the room
 * left in the cart it pulls, since a carrier with a cart loads the cart and carries nothing on top.
 */
export function carryCapacityOf(world: World, content: ContentSet, settler: Entity): number {
  return pullsHaulingCart(world, settler) ? haulingCartRoom(world, content, settler) : CARRY_CAPACITY;
}

/** The ticks `settler` takes to lift one unit into or out of its hauling cart at the cart
 *  ({@link cartLiftTicks}), the lifting clip lasting `clipTicks`; the clip unchanged without a cart. */
export function haulingCartLiftTicks(
  world: World,
  content: ContentSet,
  settler: Entity,
  clipTicks: number,
): number {
  const type = haulingCartType(world, content, settler);
  return type === undefined || !isCartType(type) ? clipTicks : cartLiftTicks(content, type, clipTicks);
}

/**
 * The speed the cart in `settler`'s hands costs it, in percent ({@link cartSpeedLossPercent}): nothing on
 * foot or with an empty cart.
 */
export function haulingCartSpeedLossPercent(world: World, content: ContentSet, settler: Entity): number {
  if (!pullsHaulingCart(world, settler)) return 0;
  const type = haulingCartType(world, content, settler);
  if (type === undefined) return 0;
  return cartSpeedLossPercent(content, type, vehicleLineCap(type) - haulingCartRoom(world, content, settler));
}
